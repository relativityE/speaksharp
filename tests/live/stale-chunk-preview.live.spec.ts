import type { APIResponse, Page } from '@playwright/test';
import { test, expect } from './helpers/deployedLiveTest';

/**
 * REAL Vercel preview proof for the stale-chunk P0, run through the approved CI-secret bypass path
 * (rc-gates → VERCEL_AUTOMATION_BYPASS_SECRET). Exercises Vercel's ACTUAL edge routing + header
 * application (NOT the local emulator, NOT the browser service worker) and the deployed release wiring.
 *
 * Bypass plumbing: `deployedLiveTest` injects `x-vercel-protection-bypass` via `context.route`, which only
 * covers browser-originated requests — NOT Node-side `page.request.*`. So this spec attaches the bypass
 * header EXPLICITLY to every `page.request.*` call (header-only automation bypass, redirects followed; an
 * `…/sso-api` landing means the bypass did not apply → surfaced as a hard BLOCKER, not a silent pass).
 *
 * Every check uses expect.soft so ALL results are collected + reported before the test fails on any one.
 *
 * BASE_URL must be the PR's exact-head preview; EXPECTED_RELEASE (or GITHUB_SHA) is the deployed commit SHA.
 */

const BASE = (process.env.BASE_URL || '').replace(/\/$/, '');
const EXPECTED_SHA = (process.env.EXPECTED_RELEASE || process.env.GITHUB_SHA || '').trim();
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const FREE_EMAIL = process.env.FREE_TEST_EMAIL || '';
const FREE_PASSWORD = process.env.FREE_TEST_PASSWORD || '';

const H: Record<string, string> = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {};
const edge = (page: Page, path: string) => page.request.get(`${BASE}${path}`, { headers: H });

const landedOnSso = (res: APIResponse, body = ''): boolean =>
  /\/sso-api|vercel\.com\/sso|Authentication Required/i.test(`${res.url()} ${body.slice(0, 600)}`);

/** Longest max-age (seconds) present in a Cache-Control value, or 0. */
const maxAge = (cc: string): number => Math.max(0, ...[...cc.matchAll(/max-age=(\d+)/gi)].map((m) => Number(m[1])));

const ONE_DAY = 86_400;
const report = (label: string, res: APIResponse) =>
  console.log(`[preview] ${label} ${res.url()} → ${res.status()} ct="${res.headers()['content-type'] || ''}" cc="${res.headers()['cache-control'] || ''}" x-vercel-cache="${res.headers()['x-vercel-cache'] || ''}"`);

const entryFromIndex = (html: string): string | undefined =>
  html.match(/<script[^>]+type="module"[^>]+src="(\/assets\/main-[A-Za-z0-9._-]+\.js)"/)?.[1]
  ?? html.match(/(\/assets\/main-[A-Za-z0-9._-]+\.js)/)?.[1];

test.describe('Stale-chunk P0 — real Vercel preview routing + release + lazy-chunk SHA audit', () => {
  test.beforeAll(() => {
    test.skip(!BASE || !/vercel\.app$/.test(new URL(BASE).host), 'Requires a Vercel preview BASE_URL.');
    expect(BYPASS, 'VERCEL_AUTOMATION_BYPASS_SECRET must be present to reach a protected preview (blocker if empty)').toBeTruthy();
  });

  test('routing: valid JS 200/JS body; missing assets+models 404 (not HTML, not immutable, no long max-age); app routes SPA; /api not SPA', async ({ page }) => {
    const root = await edge(page, '/');
    const rootBody = await root.text();
    expect(landedOnSso(root, rootBody), `preview INACCESSIBLE via bypass — landed on ${root.url()} (BLOCKER: verify VERCEL_AUTOMATION_BYPASS_SECRET)`).toBe(false);
    report('GET /', root);

    const existingJs = rootBody.match(/\/assets\/[A-Za-z0-9._-]+\.js/)?.[0];
    expect(existingJs, 'index.html references a hashed /assets/*.js').toBeTruthy();

    // Valid JS: 200, JavaScript content-type, body is JS (not the SPA index HTML).
    const okJs = await edge(page, existingJs!);
    const okBody = await okJs.text();
    report('valid JS', okJs);
    expect.soft(okJs.status(), 'existing JS → 200').toBe(200);
    expect.soft(okJs.headers()['content-type'] || '', 'existing JS is JavaScript').toMatch(/application\/javascript|text\/javascript/);
    expect.soft(okBody.slice(0, 200).toLowerCase(), 'existing JS body is JS, not index.html').not.toContain('<!doctype html');

    // Missing asset + model: 404, NOT html, NOT immutable, NO long (≥1 day) browser max-age.
    for (const [label, path] of [['missing JS', '/assets/does-not-exist-xyz.js'], ['missing model', '/models/does-not-exist-xyz.onnx']] as const) {
      const miss = await edge(page, path);
      report(label, miss);
      const cc = miss.headers()['cache-control'] || '';
      expect.soft(miss.status(), `${label} → 404`).toBe(404);
      expect.soft(miss.headers()['content-type'] || '', `${label} is NOT html (no SPA fallback)`).not.toContain('text/html');
      expect.soft(cc, `${label} must NOT be immutable`).not.toContain('immutable');
      expect.soft(maxAge(cc), `${label} must NOT have a ≥1-day browser max-age`).toBeLessThan(ONE_DAY);
    }

    // App routes serve the SPA document.
    for (const route of ['/practice', '/session', '/analytics/7e7aca2c-c192-4a80-8976-df5637859164']) {
      const r = await edge(page, route);
      report(`route ${route}`, r);
      expect.soft(r.status(), `${route} → SPA 200`).toBe(200);
      expect.soft(r.headers()['content-type'] || '', `${route} serves the SPA document`).toContain('text/html');
    }

    // /api/* is NOT rewritten to the SPA index.
    const api = await edge(page, '/api/__nonexistent__');
    report('GET /api/__nonexistent__', api);
    expect.soft(api.headers()['content-type'] || '', '/api is not the SPA index HTML').not.toContain('text/html');
  });

  test('release: window.__APP_RELEASE__ + runtime config equal the deployed SHA; index.html carries the SHA', async ({ page }) => {
    const nav = await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const pageUrl = page.url();
    expect(/\/sso-api|vercel\.com\/sso/i.test(pageUrl), `preview navigation landed on SSO (${pageUrl}, status ${nav?.status()}) — BLOCKER: verify VERCEL_AUTOMATION_BYPASS_SECRET`).toBe(false);

    const release = await page.evaluate(() => (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__);
    const cfgRelease = await page.evaluate(() => window.__APP_RUNTIME_CONFIG__?.release);
    console.log(`[preview] window.__APP_RELEASE__="${release}" __APP_RUNTIME_CONFIG__.release="${cfgRelease}" EXPECTED_SHA="${EXPECTED_SHA}"`);
    expect.soft(release, 'window.__APP_RELEASE__ present (inline release script ran → not CSP-blocked)').toBeTruthy();
    expect.soft(cfgRelease, 'runtime config release matches the injected global').toBe(release);
    if (EXPECTED_SHA) {
      expect.soft(release, 'release equals the exact deployed head SHA').toBe(EXPECTED_SHA);
      expect.soft(cfgRelease, 'runtime config release equals the exact deployed head SHA').toBe(EXPECTED_SHA);
    }

    // index.html is regenerated every deploy and MAY carry the SHA (the inline release script).
    const html = await (await edge(page, '/')).text();
    expect.soft(release ? html.includes(release) : false, 'index.html contains the release SHA (inline script)').toBe(true);
  });

  test('lazy-chunk SHA audit: the deploy SHA appears ONLY in the eager entry (main-*); every other chunk an open tab loads is SHA-free', async ({ page }) => {
    expect(FREE_EMAIL && FREE_PASSWORD, 'FREE_TEST_EMAIL/PASSWORD required to load auth-gated route chunks (blocker if absent)').toBeTruthy();

    // Capture EVERY /assets/*.js the browser fetches across the journey (initial graph + lazy route chunks).
    const loadedJs = new Set<string>();
    page.on('response', (res) => {
      try { const p = new URL(res.url()).pathname; if (/^\/assets\/.+\.js$/.test(p)) loadedJs.add(p); } catch { /* ignore */ }
    });

    // Boot + sign in with the FREE account (real backend on the preview).
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const html = await (await edge(page, '/')).text();
    const entry = entryFromIndex(html);
    expect(entry, 'index.html has a main-* entry chunk').toBeTruthy();

    await page.goto(`${BASE}/auth/signin`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('email-input').fill(FREE_EMAIL);
    await page.getByTestId('password-input').fill(FREE_PASSWORD);
    await page.getByTestId('sign-in-submit').click();
    await page.waitForURL(/\/(practice|session|analytics)/, { timeout: 60_000 });

    // Visit every protected + public lazy route so an "already-open tab could request later" chunk is loaded:
    // SessionPage, TranscriptionProvider, AnalyticsPage, STTEngine, PracticePage, plus public route chunks.
    for (const route of ['/practice', '/session', '/analytics', '/pricing', '/terms', '/privacy']) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' }).catch(() => { /* keep auditing whatever loaded */ });
    }

    // Include the eager modulepreload graph referenced by index.html as well.
    for (const m of html.matchAll(/(?:href|src)="(\/assets\/[A-Za-z0-9._-]+\.js)"/g)) loadedJs.add(m[1]);

    const chunks = [...loadedJs].sort();
    console.log(`[preview] entry=${entry} ; audited ${chunks.length} JS chunks:\n  ${chunks.join('\n  ')}`);
    expect(chunks.length, 'captured a meaningful set of JS chunks').toBeGreaterThan(5);
    // The key auth-gated lazy chunks must actually be in the audited set (proves we exercised them).
    for (const name of ['SessionPage', 'TranscriptionProvider', 'AnalyticsPage']) {
      expect.soft(chunks.some((c) => c.includes(`/${name}-`)), `audited the ${name} lazy chunk`).toBe(true);
    }

    const release = await page.evaluate(() => (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__);
    expect(release, 'release SHA resolved for the audit').toBeTruthy();

    const withSha: string[] = [];
    for (const path of chunks) {
      const body = await (await edge(page, path)).text();
      if (body.includes(release!)) withSha.push(path);
    }
    console.log(`[preview] chunks embedding the release SHA: ${withSha.length ? withSha.join(', ') : 'NONE'}`);

    // Invariant: ONLY the eager entry (main-*) may carry the SHA (Sentry release). Every OTHER chunk —
    // eager vendor AND every lazy route/runtime chunk — MUST be SHA-free (so it never rotates per deploy).
    const offenders = withSha.filter((p) => p !== entry && !/\/main-/.test(p));
    expect(offenders, `these NON-entry chunks must NOT embed the deploy SHA: ${offenders.join(', ') || '(none)'}`).toEqual([]);
  });
});
