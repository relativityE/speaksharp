import { test, expect } from './helpers/deployedLiveTest';

/**
 * REAL Vercel preview proof for the stale-chunk P0 (routing + release-SHA), run through the approved
 * CI-secret bypass path (rc-gates → VERCEL_AUTOMATION_BYPASS_SECRET, host-scoped in deployedLiveTest).
 * Exercises Vercel's ACTUAL routing + header application (NOT the local emulator). BASE_URL must be the
 * PR's preview; EXPECTED_RELEASE (or GITHUB_SHA) is the exact deployed commit SHA.
 */

const BASE = (process.env.BASE_URL || '').replace(/\/$/, '');
const EXPECTED_SHA = (process.env.EXPECTED_RELEASE || process.env.GITHUB_SHA || '').trim();

test.describe('Stale-chunk P0 — real Vercel preview routing + release', () => {
  test.beforeAll(() => {
    test.skip(!BASE || !/vercel\.app$/.test(new URL(BASE).host), 'Requires a Vercel preview BASE_URL.');
  });

  test('routing: valid JS 200; missing assets/models 404 (not HTML, not immutable); app routes SPA; /api unchanged', async ({ page }) => {
    // A real, existing hashed asset from the served index.html.
    const html = await (await page.request.get(`${BASE}/`)).text();
    const existingJs = html.match(/\/assets\/[A-Za-z0-9._-]+\.js/)?.[0];
    expect(existingJs, 'index.html references a hashed /assets/*.js').toBeTruthy();

    const okJs = await page.request.get(`${BASE}${existingJs}`);
    expect(okJs.status(), 'existing JS → 200').toBe(200);
    expect(okJs.headers()['content-type'] || '', 'existing JS is JavaScript').toMatch(/application\/javascript|text\/javascript/);

    const missJs = await page.request.get(`${BASE}/assets/does-not-exist-xyz.js`);
    expect(missJs.status(), 'missing /assets/*.js → 404').toBe(404);
    expect(missJs.headers()['content-type'] || '', 'missing JS is NOT html').not.toContain('text/html');
    expect(missJs.headers()['cache-control'] || '', 'missing JS not 1y-immutable').not.toContain('immutable');

    const missModel = await page.request.get(`${BASE}/models/does-not-exist-xyz.onnx`);
    expect(missModel.status(), 'missing /models/* → 404').toBe(404);
    expect(missModel.headers()['content-type'] || '', 'missing model is NOT html (no SPA)').not.toContain('text/html');
    expect(missModel.headers()['cache-control'] || '', 'missing model not immutable').not.toContain('immutable');

    for (const route of ['/practice', '/session', '/analytics/7e7aca2c-c192-4a80-8976-df5637859164']) {
      const r = await page.request.get(`${BASE}${route}`);
      expect(r.status(), `${route} → SPA 200`).toBe(200);
      expect(r.headers()['content-type'] || '', `${route} serves the SPA document`).toContain('text/html');
    }

    // /api/* is NOT rewritten to the SPA (behavior unchanged): a missing function path must not return
    // the app's index HTML.
    const api = await page.request.get(`${BASE}/api/__nonexistent__`);
    expect(api.headers()['content-type'] || '', '/api is not the SPA index').not.toContain('text/html');
  });

  test('release: window.__APP_RELEASE__ + runtime config equal the deployed SHA; SHA absent from JS chunks; private-dropin valid', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const release = await page.evaluate(() => (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__);
    const cfgRelease = await page.evaluate(() => window.__APP_RUNTIME_CONFIG__?.release);
    expect(release, 'window.__APP_RELEASE__ present (inline release script ran → not CSP-blocked)').toBeTruthy();
    expect(cfgRelease, 'runtime config release matches the injected global').toBe(release);
    if (EXPECTED_SHA) {
      expect(release, 'release equals the exact deployed head SHA').toBe(EXPECTED_SHA);
      expect(cfgRelease).toBe(EXPECTED_SHA);
    }

    // The SHA must NOT be baked into any JS chunk (that would rotate hashes every commit).
    const html = await (await page.request.get(`${BASE}/`)).text();
    const jsUrls = [...html.matchAll(/\/assets\/[A-Za-z0-9._-]+\.js/g)].map((m) => m[0]);
    expect(jsUrls.length).toBeGreaterThan(0);
    for (const u of jsUrls.slice(0, 6)) {
      const body = await (await page.request.get(`${BASE}${u}`)).text();
      expect(body.includes(release!), `${u} must NOT embed the release SHA`).toBe(false);
    }

    // private-dropin entry remains valid.
    const dropin = await page.request.get(`${BASE}/private-dropin.html`);
    expect(dropin.status(), '/private-dropin.html → 200').toBe(200);
    expect(dropin.headers()['content-type'] || '').toContain('text/html');
  });
});
