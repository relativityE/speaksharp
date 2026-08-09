import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';
import { TEST_IDS } from '../constants';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Per-worker port (Playwright sets TEST_WORKER_INDEX in each worker before the file loads), so parallel
// workers / --repeat-each never collide on one port.
const PORT = 4721 + Number(process.env.TEST_WORKER_INDEX ?? 0);
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * GENUINE two-build rollover. Build A and Build B are separate dist directories (built by
 * scripts/build-rollover-fixtures.js) that differ ONLY in the lazy SessionPage chunk (so its /assets URL
 * differs). A single Node server serves either build (switchable at runtime, with the corrected SPA
 * fallback: a missing /assets file → real 404). A long-lived authenticated Build-A tab crosses the
 * "deployment" (server switched to Build B) and navigates to /session; it must recover with exactly one
 * reload onto a working Build-B /session — proving the old chunk 404s, the reloaded app/assets are Build B,
 * auth is retained, no auto-record, no Oops, no loop.
 */

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const OUT = resolve(ROOT, 'test-results/rollover');

const MIME: Record<string, string> = {
  '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream', '.woff2': 'font/woff2', '.map': 'application/json',
};

const state = { root: join(OUT, 'a') };
let server: http.Server;
let manifest: { sessionPageA: string; sessionPageB: string; releaseA: string; releaseB: string };

test.use({ baseURL: BASE });
test.describe.configure({ timeout: 240_000 });

test.describe('Genuine two-build rollover (Build A tab → Build B server)', () => {
  test.beforeAll(async () => {
    if (!existsSync(join(OUT, 'manifest.json'))) {
      execSync('node scripts/build-rollover-fixtures.js', { cwd: ROOT, stdio: 'inherit' });
    }
    manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));

    // Switchable static server with the CORRECTED SPA fallback (missing /assets|/models → 404, not HTML).
    server = http.createServer((req, res) => {
      const path = (req.url || '/').split('?')[0];
      const filePath = join(state.root, path);
      if (path !== '/' && existsSync(filePath) && statSync(filePath).isFile()) {
        res.setHeader('Content-Type', MIME[extname(filePath)] || 'application/octet-stream');
        res.writeHead(200); res.end(readFileSync(filePath)); return;
      }
      if (path.startsWith('/assets/') || path.startsWith('/models/') || path.startsWith('/api/')) {
        res.writeHead(404); res.end('Not Found'); return; // corrected behavior: real 404, never index HTML
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); // SPA route → index of the CURRENT build
      res.writeHead(200); res.end(readFileSync(join(state.root, 'index.html')));
    });
    await new Promise<void>((r) => server.listen(PORT, r));
  });

  test.afterAll(async () => { await new Promise<void>((r) => server?.close(() => r())); });

  test('old Build-A tab crosses to Build B → one reload → working Build-B /session', async ({ page }) => {
    state.root = join(OUT, 'a');
    await page.addInitScript(`try { const k='__ss_full_loads'; sessionStorage.setItem(k, String((parseInt(sessionStorage.getItem(k)||'0',10))+1)); } catch {}`);

    // Boot the authenticated tab on Build A.
    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await navigateToRoute(page, '/practice');
    await expect(page.getByTestId('practice-root')).toBeVisible();
    expect(await page.evaluate(() => window.__APP_RUNTIME_CONFIG__?.release), 'tab booted on Build A').toBe(manifest.releaseA);

    // === DEPLOYMENT: switch the server to Build B (the tab keeps running Build A in memory). ===
    state.root = join(OUT, 'b');

    // Build A's SessionPage URL now returns a real 404 (never index HTML) from Build B — the exact
    // corrected server behavior the tab hits when it lazy-imports its (now-missing) chunk.
    const staleResp = await page.request.get(BASE + manifest.sessionPageA);
    expect(staleResp.status(), 'Build A chunk 404s on Build B').toBe(404);
    expect(staleResp.headers()['content-type'] || '', 'missing chunk is not HTML').not.toContain('text/html');

    await page.evaluate(() => sessionStorage.setItem('__ss_full_loads', '0'));

    // Navigate to the lazily-loaded /session — Build A requests its (now-missing) chunk → recovery.
    // #1042 PR3: the Freeform card navigates directly to /session (no intermediate overview).
    await page.getByTestId('practice-card-freeform').click();

    // Recovered onto a working /session.
    await expect(page).toHaveURL(/\/session(\?|$)/, { timeout: 30000 });
    const startStop = page.getByTestId(TEST_IDS.MIC_START);
    await expect(startStop, 'transcription interface renders').toBeVisible({ timeout: 30000 });
    await expect(startStop).toHaveAccessibleName(/start/i);                 // no auto-record
    await expect(page.getByTestId(TEST_IDS.NAV_SIGN_OUT_BUTTON)).toBeVisible(); // auth retained
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);   // no generic Oops
    await expect(page.locator('#ss-stale-chunk-recovery')).toHaveCount(0);  // no persistent overlay

    // The reloaded document + assets are Build B.
    expect(await page.evaluate(() => window.__APP_RUNTIME_CONFIG__?.release), 'reloaded app is Build B').toBe(manifest.releaseB);
    expect(await page.evaluate(() => (window as unknown as { __ROLLOVER_VARIANT__?: string }).__ROLLOVER_VARIANT__), 'Build B SessionPage chunk executed').toBe('B');
    // Exactly ONE reload; the old chunk was seen 404ing.
    expect(await page.evaluate(() => parseInt(sessionStorage.getItem('__ss_full_loads') || '0', 10)), 'exactly one reload (no loop)').toBe(1);
  });
});
