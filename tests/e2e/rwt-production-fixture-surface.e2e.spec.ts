/**
 * RWT surface guard × the ACTUAL RWT fixture, in a real browser (PM 5881740741).
 *
 * Rehearsal 1 (run 36506361220) HOLDed before signup: the RWT specs ran on `deployedLiveTest`, whose init script sets
 * `window.__E2E_CONTEXT__`, and `approvedSurfaceFailures` correctly refuses every `/__E2E|__MOCK|__MSW|TEST_MODE/i` key.
 * No test exercised the guard with the fixture the suites really use, so the self-trip first surfaced on Production.
 *
 * These drive the real `rwtProductionTest` fixture and the real `approvedSurfaceFailures` against a local page shaped
 * like a committed Production route. Only the injection verdict is asserted: origin and release are Production-only
 * checks and are expected to fail here.
 */
import { createServer, type Server } from 'node:http';
import { test, expect } from '../live/helpers/rwtProductionTest';
import { test as deployedLiveTest } from '../live/helpers/deployedLiveTest';
import { approvedSurfaceFailures } from '../live/helpers/rwtJourney';
import { goToApp } from './helpers';

const INJECTION = 'a test/mock injection surface is present';
const GUARD_KEYS = /__E2E|__MOCK|__MSW|TEST_MODE/i;

// A committed route as the app marks it: both readiness attributes and visible shell text.
const PAGE = `<!doctype html>
<html data-app-ready="true" data-app-visible-ready="true"><head><title>SpeakSharp</title></head>
<body><div id="root"><main>Sign up</main></div></body></html>`;

let server: Server;
let url = '';

test.beforeAll(async () => {
    server = createServer((_req, reply) => { reply.writeHead(200, { 'content-type': 'text/html' }); reply.end(PAGE); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    const address = server.address();
    url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/auth/signup`;
});

test.afterAll(async () => {
    await new Promise<void>((res) => server.close(() => res()));
});

const guardKeys = (page: import('@playwright/test').Page) =>
    page.evaluate((source) => Object.keys(window).filter((k) => new RegExp(source, 'i').test(k)), GUARD_KEYS.source);

test.describe('RWT Production fixture — the surface guard judges the page a real user gets', () => {
    test('the RWT fixture injects no test/mock key, so the guard does not refuse the surface', async ({ page }) => {
        await goToApp(page, url);
        expect(await guardKeys(page), 'no window key matches the guard').toEqual([]);
        expect(await approvedSurfaceFailures(page)).not.toContain(INJECTION);
    });

    test('CASUALTY: a matching key on the RWT fixture page is still refused — the guard stays strict', async ({ page }) => {
        await page.addInitScript(() => { (window as unknown as { __MOCK_BACKEND__?: boolean }).__MOCK_BACKEND__ = true; });
        await goToApp(page, url);
        expect(await approvedSurfaceFailures(page)).toContain(INJECTION);
    });
});

deployedLiveTest.describe('the non-RWT deployed fixture keeps its MSW flag (the rehearsal-1 self-trip)', () => {
    deployedLiveTest('CASUALTY: deployedLiveTest sets __E2E_CONTEXT__, which the RWT guard refuses', async ({ page }) => {
        await goToApp(page, url);
        expect(await guardKeys(page)).toEqual(['__E2E_CONTEXT__']);
        expect(await approvedSurfaceFailures(page)).toContain(INJECTION);
    });
});
