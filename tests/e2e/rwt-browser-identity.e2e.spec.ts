/**
 * RWT browser identity × PostHog's OWN bot predicate, in a real browser (#1258 PM 5932744381, Option A).
 *
 * Every RWT journey's telemetry rows failed because posthog-js 1.298.1 classified the run's headless, automated browser
 * as a bot and dropped every event before it was sent. This drives the real `rwtProductionTest` fixture with the RWT
 * launch arguments, reads the three signals the predicate uses from the page, and asks posthog-js's exported
 * `isLikelyBot` — the same predicate its `capture` path applies — for a verdict. A plain Playwright browser is the
 * control: it must still be a bot, so the correction is confined to the RWT fixture.
 */
import { createServer, type Server } from 'node:http';
import { test as plainTest, type Page } from '@playwright/test';
import { isLikelyBot } from 'posthog-js/lib/src/utils/blocked-uas.js';
import { test, expect } from '../live/helpers/rwtProductionTest';
import { RWT_BROWSER_IDENTITY_ARGS, botSignals } from '../live/helpers/rwtBrowserIdentity';
import { goToApp } from './helpers';

let server: Server;
let url = '';

const serve = async () => {
    server = createServer((_req, reply) => { reply.writeHead(200, { 'content-type': 'text/html' }); reply.end('<!doctype html><html data-app-ready="true" data-app-visible-ready="true"><title>SpeakSharp</title><main>x</main></html>'); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    const address = server.address();
    // 127.0.0.1 is a secure context, so client hints (`navigator.userAgentData`) are exposed as on Production.
    url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;
};
const stop = () => new Promise<void>((res) => server.close(() => res()));

/** posthog-js's verdict on what the page reports (no custom blocked UAs: the product configures none). */
const postHogThinksBot = async (page: Page): Promise<{ bot: boolean; signals: Awaited<ReturnType<typeof botSignals>> }> => {
    const signals = await botSignals(page);
    const navigatorLike = {
        userAgent: signals.userAgent,
        userAgentData: { brands: signals.brands.map((brand) => ({ brand, version: '' })) },
        webdriver: signals.webdriver,
    } as unknown as Navigator;
    return { bot: isLikelyBot(navigatorLike, []), signals };
};

// Worker-scoped, so file-level: exactly the identity arguments every RWT spec's launch options carry.
test.use({ launchOptions: { args: [...RWT_BROWSER_IDENTITY_ARGS] } });

test.describe('RWT fixture — PostHog does not discard the run as a bot', () => {
    test.beforeAll(serve);
    test.afterAll(stop);

    test('RED before #1258 fix: all three signals clear, and posthog-js isLikelyBot says not a bot', async ({ page }) => {
        await goToApp(page, url);
        const { bot, signals } = await postHogThinksBot(page);
        expect(signals.userAgent, 'signal 1: the UA carries no headless token').not.toMatch(/headless/i);
        expect(signals.brands.some((b) => /headless/i.test(b)), 'signal 2: no headless client-hint brand').toBe(false);
        expect(signals.webdriver, 'signal 3: navigator.webdriver is off').toBe(false);
        expect(bot, "posthog-js's own predicate").toBe(false);
    });

    test('only the headless signals change: the real version, platform and other brands pass through', async ({ page, browser }) => {
        await goToApp(page, url);
        const { signals } = await postHogThinksBot(page);
        const version = browser.version();
        expect(signals.userAgent).toContain(`Chrome/${version}`);
        expect(signals.brands).toContain('Chromium');
        expect(signals.brands.length).toBeGreaterThanOrEqual(2); // Chromium + the browser's own GREASE brand
    });

    test('the identity survives navigation and reaches a dedicated worker', async ({ page }) => {
        await goToApp(page, url);
        await goToApp(page, `${url}again`);
        expect((await postHogThinksBot(page)).bot).toBe(false);
        const worker = await page.evaluate(async () => {
            const w = new Worker(URL.createObjectURL(new Blob(['postMessage(navigator.userAgent)'], { type: 'text/javascript' })));
            return await new Promise<string>((resolve) => { w.onmessage = (e) => resolve(String(e.data)); });
        });
        expect(worker).not.toMatch(/headless/i);
    });
});

plainTest.describe('control: a non-RWT Playwright browser is unchanged (still a bot to PostHog)', () => {
    plainTest.beforeAll(serve);
    plainTest.afterAll(stop);

    // Launched here with Playwright's defaults: the e2e project's own launch args are not the control.
    plainTest('a default Playwright Chromium keeps its headless signals, so the correction is confined to the RWT fixture', async ({ playwright }) => {
        const browser = await playwright.chromium.launch({ args: [] }); // explicit: not the file's identity args
        try {
            const page = await (await browser.newContext()).newPage();
            await goToApp(page, url);
            const { bot, signals } = await postHogThinksBot(page);
            expect(signals.webdriver).toBe(true);
            expect(bot).toBe(true);
        } finally {
            await browser.close();
        }
    });
});
