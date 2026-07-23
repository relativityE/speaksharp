import type { APIResponse, Page } from '@playwright/test';
import { test, expect } from './helpers/deployedLiveTest';

/**
 * REAL Vercel preview proof for the stale-chunk P0 (routing + release-SHA), run through the approved
 * CI-secret bypass path (rc-gates → VERCEL_AUTOMATION_BYPASS_SECRET). Exercises Vercel's ACTUAL edge
 * routing + header application (NOT the local emulator, NOT the browser service worker).
 *
 * Bypass plumbing: `deployedLiveTest` injects `x-vercel-protection-bypass` via `context.route`, which
 * ONLY covers browser-originated requests — NOT Node-side `page.request.*`. So this spec attaches the
 * bypass header EXPLICITLY to every `page.request.*` call. We use HEADER-ONLY automation bypass (no
 * `x-vercel-set-bypass-cookie` — that variant makes Vercel answer with a 307 cookie-planting redirect,
 * which a prior revision then mis-read as "inaccessible"). Redirects ARE followed; if the bypass secret
 * is absent/invalid the request lands on `…/sso-api`, which we detect and FAIL as an explicit BLOCKER
 * ("verify VERCEL_AUTOMATION_BYPASS_SECRET") rather than silently degrading.
 *
 * BASE_URL must be the PR's preview; EXPECTED_RELEASE (or GITHUB_SHA) is the exact deployed commit SHA.
 */

const BASE = (process.env.BASE_URL || '').replace(/\/$/, '');
const EXPECTED_SHA = (process.env.EXPECTED_RELEASE || process.env.GITHUB_SHA || '').trim();
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';

// Header-only automation bypass, attached to every Node-side page.request call.
const H: Record<string, string> = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {};

const edge = (page: Page, path: string) => page.request.get(`${BASE}${path}`, { headers: H });

/** True when a response ended up on Vercel's SSO challenge (bypass not honored → preview inaccessible). */
const landedOnSso = (res: APIResponse, body = ''): boolean =>
  /\/sso-api|vercel\.com\/sso|Authentication Required/i.test(`${res.url()} ${body.slice(0, 600)}`);

test.describe('Stale-chunk P0 — real Vercel preview routing + release', () => {
  test.beforeAll(() => {
    test.skip(!BASE || !/vercel\.app$/.test(new URL(BASE).host), 'Requires a Vercel preview BASE_URL.');
    // The bypass secret is the ONLY approved way into a protected preview; without it, stop (blocker).
    expect(BYPASS, 'VERCEL_AUTOMATION_BYPASS_SECRET must be present to reach a protected preview (blocker if empty)').toBeTruthy();
  });

  test('routing: valid JS 200; missing assets/models 404 (not HTML, not immutable); app routes SPA; /api unchanged', async ({ page }) => {
    // Reachability: header-only bypass should serve the app directly. If it lands on /sso-api the bypass
    // secret is not honored → preview INACCESSIBLE via the approved path (a hard blocker, not a routing bug).
    const root = await edge(page, '/');
    const rootBody = await root.text();
    expect(landedOnSso(root, rootBody),
      `preview INACCESSIBLE via bypass — landed on ${root.url()} (BLOCKER: verify VERCEL_AUTOMATION_BYPASS_SECRET)`).toBe(false);
    expect(root.status(), 'preview / → 200 via bypass').toBe(200);

    const existingJs = rootBody.match(/\/assets\/[A-Za-z0-9._-]+\.js/)?.[0];
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
    // Navigate through the browser (deployedLiveTest's context.route injects the bypass header on the
    // navigation + its redirects) so the INLINE release script executes in a real browser — proving it is
    // NOT CSP-blocked. If we end up on the SSO page, that is the same bypass blocker as above.
    const nav = await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const pageUrl = page.url();
    expect(/\/sso-api|vercel\.com\/sso/i.test(pageUrl),
      `preview navigation landed on SSO (${pageUrl}, status ${nav?.status()}) — BLOCKER: verify VERCEL_AUTOMATION_BYPASS_SECRET`).toBe(false);

    const release = await page.evaluate(() => (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__);
    const cfgRelease = await page.evaluate(() => window.__APP_RUNTIME_CONFIG__?.release);
    expect(release, `window.__APP_RELEASE__ present (inline release script ran → not CSP-blocked); page=${pageUrl}`).toBeTruthy();
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
