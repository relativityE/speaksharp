/**
 * Release review of 1816ec61 (P2): navigating to a model file whose bytes are an HTML document must never render or run
 * it on the application origin. Each local serving path (Vite preview and Vite dev from the real config, and the E2E
 * server's real app) serves the same fixture; the browser must either download the file or show it as text/data, and
 * the inline script must not run. Response headers, and production's vercel.json, are covered in
 * tests/evidence/__tests__/modelAssetServing.test.ts.
 */
import { test, expect, type Page } from '@playwright/test';
import { MODEL_FIXTURE_FILES, startModelAssetServers, type ModelAssetServers } from '../evidence/fixtures/model-serving/modelAssetServers';

const DOCUMENT_TYPES = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml)/i;

let running: ModelAssetServers;
test.beforeAll(async () => { running = await startModelAssetServers(); });
test.afterAll(async () => { await running?.close(); });

// No app, login or MSW context is involved: each test opens a raw model-file URL on a bare server, so a direct
// navigation is the behaviour under test.
async function navigate(tab: Page, url: string) {
    let executedInDialog = false;
    tab.on('dialog', dialog => { executedInDialog = true; void dialog.dismiss(); });
    try {
        await tab.goto(url, { waitUntil: 'load' });
    } catch (error) {
        // An opaque type is handed to the download manager instead of being rendered.
        if (/Download is starting/i.test(String(error))) return { rendered: false as const };
        throw error;
    }
    const state = await tab.evaluate(() => ({
        contentType: document.contentType,
        title: document.title,
        executed: (window as unknown as { __modelAssetExecuted?: number }).__modelAssetExecuted === 1,
        scripts: document.scripts.length,
    }));
    return { rendered: true as const, executedInDialog, ...state };
}

for (const serverName of ['vite preview', 'vite dev', 'E2E server']) {
    test.describe(`${serverName}: navigating to a model file never runs it as a document`, () => {
        for (const name of Object.keys(MODEL_FIXTURE_FILES)) {
            test(name, async ({ page }) => {
                const origin = running.servers.find(server => server.name === serverName)!.origin;
                const result = await navigate(page, `${origin}/models/${name}`);
                if (!result.rendered) return;
                expect(result.contentType).not.toMatch(DOCUMENT_TYPES);
                expect(result.executed).toBe(false);
                expect(result.executedInDialog).toBe(false);
                expect(result.title).not.toBe('EXECUTED');
                expect(result.scripts).toBe(0);
            });
        }
    });
}
