import type { Page } from '@playwright/test';
import { test, expect } from './helpers/deployedLiveTest';

/**
 * REAL Vercel preview proof for the stale-chunk P0 (routing + release-SHA), run through the approved
 * CI-secret bypass path (rc-gates → VERCEL_AUTOMATION_BYPASS_SECRET). Exercises Vercel's ACTUAL edge
 * routing + header application (NOT the local emulator, NOT the browser service worker).
 *
 * Bypass plumbing (the earlier failure): `deployedLiveTest` injects the bypass via `context.route`, which
 * ONLY covers browser-originated requests — NOT Node-side `page.request.*`. So this spec:
 *   - attaches `x-vercel-protection-bypass` EXPLICITLY to every `page.request.*` call (raw edge routing,
 *     no service worker, no browser CSP), and
 *   - seeds the bypass COOKIE first (via a header'd request whose Set-Cookie lands in the shared context
 *     jar) so the browser `page.goto` used to prove the inline release script executes is also authorized.
 * A 302→/sso-api (bypass absent/invalid) makes the first assertion FAIL with a "preview inaccessible"
 * BLOCKER message rather than silently degrading.
 *
 * BASE_URL must be the PR's preview; EXPECTED_RELEASE (or GITHUB_SHA) is the exact deployed commit SHA.
 */

const BASE = (process.env.BASE_URL || '').replace(/\/$/, '');
const EXPECTED_SHA = (process.env.EXPECTED_RELEASE || process.env.GITHUB_SHA || '').trim();
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';

// Bypass header for raw page.request calls (Node-side; NOT covered by deployedLiveTest's context.route).
const H: Record<string, string> = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {};
// Same, plus ask Vercel to persist the bypass COOKIE into the shared context jar so page.goto is authorized.
const H_SEED: Record<string, string> = BYPASS
  ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'samesitenone' }
  : {};

/** Raw edge GET with the bypass header and NO redirect-following, so we observe Vercel's real response
 * (a 302 to /sso-api means the bypass did not apply → preview inaccessible, surfaced as a hard failure). */
const edge = (page: Page, path: string, headers: Record<string, string> = H) =>
  page.request.get(`${BASE}${path}`, { headers, maxRedirects: 0 });

test.describe('Stale-chunk P0 — real Vercel preview routing + release', () => {
  test.beforeAll(() => {
    test.skip(!BASE || !/vercel\.app$/.test(new URL(BASE).host), 'Requires a Vercel preview BASE_URL.');
  });

  test('routing: valid JS 200; missing assets/models 404 (not HTML, not immutable); app routes SPA; /api unchanged', async ({ page }) => {
    // Seed the bypass cookie + prove the preview is reachable (a 302 here = bypass not applied = BLOCKER).
    const root = await edge(page, '/', H_SEED);
    expect(root.status(), 'preview reachable via bypass (not a 302 to /sso-api) — else preview INACCESSIBLE (blocker)').toBe(200);

    const html = await root.text();
    const existingJs = html.match(/\/assets\/[A-Za-z0-9._-]+\.js/)?.[0];
    expect(existingJs, 'index.html references a hashed /assets/*.js').toBeTruthy();

    const okJs = await edge(page, existingJs!);
    expect(okJs.status(), 'existing JS → 200').toBe(200);
    expect(okJs.headers()['content-type'] || '', 'existing JS is JavaScript').toMatch(/application\/javascript|text\/javascript/);

    const missJs = await edge(page, '/assets/does-not-exist-xyz.js');
    expect(missJs.status(), 'missing /assets/*.js → 404 (never SPA HTML)').toBe(404);
    expect(missJs.headers()['content-type'] || '', 'missing JS is NOT html').not.toContain('text/html');
    expect(missJs.headers()['cache-control'] || '', 'missing JS not 1y-immutable').not.toContain('immutable');

    const missModel = await edge(page, '/models/does-not-exist-xyz.onnx');
    expect(missModel.status(), 'missing /models/* → 404').toBe(404);
    expect(missModel.headers()['content-type'] || '', 'missing model is NOT html (no SPA)').not.toContain('text/html');
    expect(missModel.headers()['cache-control'] || '', 'missing model not immutable').not.toContain('immutable');

    for (const route of ['/practice', '/session', '/analytics/7e7aca2c-c192-4a80-8976-df5637859164']) {
      const r = await edge(page, route);
      expect(r.status(), `${route} → SPA 200`).toBe(200);
      expect(r.headers()['content-type'] || '', `${route} serves the SPA document`).toContain('text/html');
    }

    // /api/* is NOT rewritten to the SPA (behavior unchanged): a missing function path must not return
    // the app's index HTML.
    const api = await edge(page, '/api/__nonexistent__');
    expect(api.headers()['content-type'] || '', '/api is not the SPA index').not.toContain('text/html');
  });

  test('release: window.__APP_RELEASE__ + runtime config equal the deployed SHA; SHA absent from JS chunks; private-dropin valid', async ({ page }) => {
    // Seed the bypass cookie (header'd request → Set-Cookie into the shared jar) so the browser navigation
    // below is authorized, then navigate for real so the INLINE release script runs (proves not CSP-blocked).
    await edge(page, '/', H_SEED);
    const nav = await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    expect(nav?.status() ?? 0, 'preview navigable via bypass — else inaccessible (blocker)').toBeLessThan(400);

    const release = await page.evaluate(() => (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__);
    const cfgRelease = await page.evaluate(() => window.__APP_RUNTIME_CONFIG__?.release);
    expect(release, 'window.__APP_RELEASE__ present (inline release script ran → not CSP-blocked)').toBeTruthy();
    expect(cfgRelease, 'runtime config release matches the injected global').toBe(release);
    if (EXPECTED_SHA) {
      expect(release, 'release equals the exact deployed head SHA').toBe(EXPECTED_SHA);
      expect(cfgRelease).toBe(EXPECTED_SHA);
    }

    // The SHA must NOT be baked into any JS chunk (that would rotate hashes every commit).
    const html = await (await edge(page, '/')).text();
    const jsUrls = [...html.matchAll(/\/assets\/[A-Za-z0-9._-]+\.js/g)].map((m) => m[0]);
    expect(jsUrls.length).toBeGreaterThan(0);
    for (const u of jsUrls.slice(0, 6)) {
      const body = await (await edge(page, u)).text();
      expect(body.includes(release!), `${u} must NOT embed the release SHA`).toBe(false);
    }

    // private-dropin entry remains valid.
    const dropin = await edge(page, '/private-dropin.html');
    expect(dropin.status(), '/private-dropin.html → 200').toBe(200);
    expect(dropin.headers()['content-type'] || '').toContain('text/html');
  });
});
