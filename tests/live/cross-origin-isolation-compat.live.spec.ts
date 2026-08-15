import type { Page } from '@playwright/test';
import { test, expect } from './helpers/deployedLiveTest';

/**
 * #1043 — cross-origin-isolation COMPATIBILITY AUDIT against a deployed preview.
 *
 * Multi-threaded WASM (the Private-v2 finalization speedup) requires the document to be cross-origin
 * isolated. This spec proves, on a REAL deployed preview, that (a) the isolation headers arrive on the
 * ACTUAL top-level navigation response, (b) the document is genuinely isolated (SharedArrayBuffer
 * available), and (c) NOTHING the product depends on breaks under those headers.
 *
 * ACCOUNT SEPARATION (deliberate): the FREE account exercises Checkout; the PRO account exercises the
 * Billing Portal. There is NO fallback between them — using one account for both paths would silently
 * skip whichever entry point that account does not offer.
 *
 * MISSING CREDENTIALS FAIL, THEY DO NOT SKIP. A previous run reported "2 passed, 1 skipped" while the
 * auth and billing legs never executed (wrong env-var names), which read as far more coverage than it was.
 *
 * It DECIDES nothing about rollout: production stays non-isolated (the `has` host rule in vercel.json
 * matches preview hosts only) until that is separately approved.
 */

const BASE_URL = process.env.BASE_URL;
/**
 * Strict per-account-class credentials. NO fallback between FREE/PRO/LIVE: one account cannot
 * stand in for another, or whichever billing entry point it is not offered would never be exercised.
 * Values are NEVER logged, attached, or echoed — only the account CLASS ('free' | 'pro') is reported.
 */
function requireCredentials(kind: 'FREE' | 'PRO'): { email: string; password: string } {
  const email = process.env[`${kind}_TEST_EMAIL`];
  const password = process.env[`${kind}_TEST_PASSWORD`];
  if (!email || !password) {
    // Names only — never values.
    throw new Error(`${kind}_TEST_EMAIL and ${kind}_TEST_PASSWORD are required for this audit`);
  }
  return { email, password };
}

type NetFailure = { url: string; failure: string | null; at: number };
const blockedFailures = (fails: NetFailure[], re: RegExp) =>
  fails.filter((f) => re.test(f.url) && /ERR_BLOCKED_BY_RESPONSE|CORP|COEP|ERR_FAILED|ERR_ABORTED/i.test(f.failure ?? ''));



/**
 * #1043 two-lane control: record everything about the entitlement edge-function call so an isolated-lane
 * failure can be classified against a non-isolated production lane. HEADER NAMES ONLY — never values,
 * so no bearer token, cookie or bypass secret can reach logs or artifacts.
 */
type UsageLimitDiag = {
  url: string;
  method: string;
  requestHeaderNames: string[];
  previewOnlyHeaderLeak: string[];
  status: number | null;
  corsResponseHeaderNames: string[];
  failure: string | null;
};

function recordUsageLimitDiagnostics(page: Page, sink: UsageLimitDiag[]): void {
  const PREVIEW_ONLY = /^x-vercel-/i;
  const isTarget = (u: string) => /check-usage-limit/i.test(u);
  const entry = (u: string, m: string, names: string[]): UsageLimitDiag => ({
    url: u, method: m, requestHeaderNames: names,
    previewOnlyHeaderLeak: names.filter((n) => PREVIEW_ONLY.test(n)),
    status: null, corsResponseHeaderNames: [], failure: null,
  });
  page.on('request', (r) => {
    if (!isTarget(r.url())) return;
    sink.push(entry(r.url(), r.method(), Object.keys(r.headers())));
  });
  page.on('response', (res) => {
    if (!isTarget(res.url())) return;
    const names = Object.keys(res.headers()).filter((n) => /^access-control-|^cross-origin-/i.test(n));
    const last = [...sink].reverse().find((d) => d.url === res.url() && d.status === null);
    if (last) { last.status = res.status(); last.corsResponseHeaderNames = names; }
  });
  page.on('requestfailed', (r) => {
    if (!isTarget(r.url())) return;
    const last = [...sink].reverse().find((d) => d.url === r.url() && d.failure === null && d.status === null);
    if (last) last.failure = r.failure()?.errorText ?? 'unknown';
  });
}

/** Navigation + isolation context for the lane being audited (host, release SHA, COOP/COEP). */
/** Timestamps of deliberate main-frame navigations, used to justify benign cancellations. */
function recordNavigations(page: Page, sink: number[]): void {
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) sink.push(Date.now()); });
}

async function laneContext(page: Page, navHeaders: Record<string, string>) {
  const inPage = await page.evaluate(() => ({
    crossOriginIsolated,
    typeofSAB: typeof SharedArrayBuffer,
    host: location.host,
    releaseSha: (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__ ?? null,
  }));
  return {
    ...inPage,
    navCOOP: navHeaders['cross-origin-opener-policy'] ?? null,
    navCOEP: navHeaders['cross-origin-embedder-policy'] ?? null,
  };
}

/**
 * CDP capture of Chromium's authoritative failure classification. blockedReason is the ONLY reliable
 * COEP/CORP signal; errorText collapses COEP blocks, CORS rejections and cancellations into ERR_FAILED.
 */
type BlockRecord = { url: string; blockedReason: string | null; corsError: string | null };
async function captureBlockReasons(page: Page, sink: BlockRecord[]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const byId = new Map<string, string>();
  cdp.on('Network.requestWillBeSent', (e) => {
    const ev = e as unknown as { requestId: string; request: { url: string } };
    byId.set(ev.requestId, ev.request.url);
  });
  cdp.on('Network.loadingFailed', (e) => {
    const ev = e as unknown as { requestId: string; blockedReason?: string; corsErrorStatus?: { corsError?: string } };
    sink.push({
      url: byId.get(ev.requestId) ?? '(unknown)',
      blockedReason: ev.blockedReason ?? null,
      corsError: ev.corsErrorStatus?.corsError ?? null,
    });
  });
}

async function signIn(page: Page, email: string, password: string): Promise<Record<string, string>> {
  const nav = await page.goto('/auth/signin', { waitUntil: 'load', timeout: 120_000 });
  // Fail fast with a clear message if the auth form never renders, instead of a 5-minute locator.fill
  // timeout that hides WHY (a wrong route previously cost ~10 minutes and reported only "locator.fill").
  await expect(page.getByTestId('auth-form'), 'sign-in form must render at /auth/signin').toBeVisible({ timeout: 45_000 });
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(password);
  await page.getByTestId('sign-in-submit').click();
  await expect(page, 'signed in').toHaveURL(/\/(session|practice|analytics)/, { timeout: 60_000 });
  return nav?.headers() ?? {};
}

test.describe('#1043 cross-origin isolation compatibility @live', () => {
  test.skip(!BASE_URL, 'BASE_URL (deployed preview) is required.');

  test('isolation headers, SAB, assets and observability survive isolation', async ({ page }, testInfo) => {
    test.setTimeout(300_000);

    const consoleErrors: string[] = [];
    const netFailures: NetFailure[] = [];
    const requests: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('request', (r) => requests.push(r.url()));
    page.on('requestfailed', (r) => netFailures.push({ url: r.url(), failure: r.failure()?.errorText ?? null, at: Date.now() }));

    // (1) Headers must be on the ACTUAL navigation response (not a later fetch).
    const resp = await page.goto('/', { waitUntil: 'load', timeout: 120_000 });
    expect(resp, 'navigation response').toBeTruthy();
    const navHeaders = resp!.headers();
    expect(navHeaders['cross-origin-opener-policy'], 'COOP on navigation response').toBe('same-origin');
    expect(navHeaders['cross-origin-embedder-policy'], 'COEP on navigation response').toBe('credentialless');

    // (2) The document must actually be isolated (SAB is hidden unless it is).
    const ctx = await page.evaluate(() => ({
      crossOriginIsolated,
      typeofSAB: typeof SharedArrayBuffer,
      hardwareConcurrency: navigator.hardwareConcurrency,
      host: location.host,
    }));
    expect(ctx.crossOriginIsolated, 'document is cross-origin isolated').toBe(true);
    expect(ctx.typeofSAB, 'SharedArrayBuffer available under isolation').toBe('function');

    // Let deferred third parties (analytics, error reporting, fonts) load before auditing failures.
    await page.waitForTimeout(6_000);

    // (3) Same-origin model assets MUST remain fetchable (Private-v2 loads whisper from /models/).
    const modelProbe = await page.evaluate(async () => {
      try {
        const r = await fetch('/models/whisper-base.en/config.json', { cache: 'no-store' });
        return { ok: r.ok, status: r.status };
      } catch (e) { return { ok: false, status: -1, error: String(e) }; }
    });
    expect(modelProbe.ok, `same-origin model asset must load under isolation: ${JSON.stringify(modelProbe)}`).toBe(true);

    // (4) Observability + fonts must not be blocked by the isolation headers.
    expect(blockedFailures(netFailures, /posthog/i), 'PostHog blocked under isolation').toEqual([]);
    expect(blockedFailures(netFailures, /sentry/i), 'Sentry blocked under isolation').toEqual([]);
    expect(blockedFailures(netFailures, /fonts\.(googleapis|gstatic)\.com|\.woff2?(\?|$)/i), 'fonts blocked').toEqual([]);

    // (5) Nothing THE PRODUCT depends on may be blocked. `vercel.live` is Vercel's PREVIEW-ONLY feedback
    // toolbar — injected by Vercel into previews, absent in production, not a SpeakSharp dependency. It is
    // excluded from pass/fail but STILL recorded below, so the exclusion is auditable rather than hidden.
    const VERCEL_PREVIEW_TOOLBAR = /^https:\/\/vercel\.live\//;
    const allBlocked = netFailures.filter((f) =>
      /ERR_BLOCKED_BY_RESPONSE|ERR_BLOCKED_BY_CLIENT|CORP|COEP/i.test(f.failure ?? ''),
    );
    const blocked = allBlocked.filter((f) => !VERCEL_PREVIEW_TOOLBAR.test(f.url));

    const evidence = {
      capturedAt: new Date().toISOString(),
      host: ctx.host,
      navCOOP: navHeaders['cross-origin-opener-policy'] ?? null,
      navCOEP: navHeaders['cross-origin-embedder-policy'] ?? null,
      crossOriginIsolated: ctx.crossOriginIsolated,
      typeofSAB: ctx.typeofSAB,
      hardwareConcurrency: ctx.hardwareConcurrency,
      modelProbe,
      posthogRequested: requests.some((u) => /posthog/i.test(u)),
      sentryRequested: requests.some((u) => /sentry/i.test(u)),
      fontsRequested: requests.filter((u) => /fonts\.(googleapis|gstatic)\.com|\.woff2?(\?|$)/i.test(u)).length,
      productBlockedCount: blocked.length,
      productBlockedResources: blocked.slice(0, 20),
      allBlockedCount: allBlocked.length,
      excludedAsPreviewOnly: allBlocked.filter((f) => VERCEL_PREVIEW_TOOLBAR.test(f.url)).map((f) => f.url),
      consoleErrorCount: consoleErrors.length,
      consoleErrorsSample: consoleErrors.slice(0, 10),
    };
    await testInfo.attach('coi-isolation-assets.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    console.log(`COI_COMPAT_EVIDENCE ${JSON.stringify(evidence)}`);

    expect(blocked, `resources blocked by COEP/CORP under isolation: ${JSON.stringify(blocked)}`).toEqual([]);
  });

  test('FREE account under the Beta-50 billing freeze: login, reload, closed Checkout state, logout', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const { email, password } = requireCredentials('FREE');

    const netFailures: NetFailure[] = [];
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    page.on('requestfailed', (r) => netFailures.push({ url: r.url(), failure: r.failure()?.errorText ?? null, at: Date.now() }));
    const usageLimitDiag: UsageLimitDiag[] = [];
    recordUsageLimitDiagnostics(page, usageLimitDiag);
    const navAtMs: number[] = [];
    recordNavigations(page, navAtMs);
    const blockRecords: BlockRecord[] = [];
    await captureBlockReasons(page, blockRecords);

    // ENTITLEMENT CALL — CLASSIFIED BY THE 3-MODE CDP DIAGNOSIS (run 30411578217, one deployment):
    //   COEP none (crossOriginIsolated=false) / credentialless / require-corp
    //   -> ALL fail identically: corsError=MissingAllowOriginHeader, blockedReason=null.
    // It fails with NO isolation headers at all, so isolation is NOT the cause: the Supabase Edge Function
    // uses an exact-origin CORS allowlist holding the PRODUCTION origin but not preview origins
    // (production returns HTTP 200 for the same call). Asserting a 2xx here would demand an outcome that
    // cannot occur on ANY preview host. The gate below is Chromium's authoritative COEP/CORP blockedReason.
    const navHeaders = await signIn(page, email, password);
    const lane = await laneContext(page, navHeaders);

    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('nav-sign-out-button'), 'FREE session survives reload').toBeVisible({ timeout: 45_000 });

    // Beta-50 CONTRACT: payments are intentionally disabled (arePaymentsEnabled() === false), so the Pro
    // card renders the non-clickable beta-unavailable panel INSTEAD of a Checkout CTA. We prove that the
    // intentionally-closed billing UI still renders correctly under cross-origin isolation.
    await page.goto('/pricing', { waitUntil: 'load', timeout: 60_000 });
    await expect(page.getByTestId('pricing-pro-beta-unavailable'), 'closed-Checkout beta state renders under isolation')
      .toBeVisible({ timeout: 45_000 });
    // No Checkout CTA may be offered while payments are disabled.
    await expect(page.getByRole('button', { name: /upgrade to pro|starting checkout/i }), 'no Checkout CTA under the freeze')
      .toHaveCount(0);
    // And no checkout call may occur.
    const checkoutCalls = requests.filter((u) => /stripe-checkout/i.test(u));
    expect(checkoutCalls, 'no stripe-checkout request may occur under the freeze').toEqual([]);

    // AUTHORITATIVE COEP/CORP GATE: no PRODUCT resource may be blocked by the isolation headers.
    // vercel.live is Vercel's preview-only feedback toolbar (absent in production) and is excluded from
    // pass/fail but still recorded. Everything else counts.
    const coepBlocked = blockRecords.filter(
      (b) => /coep|corp/i.test(b.blockedReason ?? '') && !/^https:\/\/vercel\.live\//.test(b.url),
    );
    const entitlementCors = blockRecords.filter((b) => /check-usage-limit/i.test(b.url)).map((b) => b.corsError);

    // ATTACH EVIDENCE BEFORE ASSERTING so a failing lane still yields the differential data.
    const ev = {
      accountClass: 'free',
      coepBlockedProductResources: coepBlocked,
      entitlementCorsErrors: entitlementCors,
      entitlementClassification: 'preview-origin CORS allowlist (MissingAllowOriginHeader) — reproduced with COEP none/credentialless/require-corp in run 30411578217; production returns 200. NOT isolation-caused.',
      lane,
      usageLimitDiagnostics: usageLimitDiag,
      usageLimitPreflightObserved: usageLimitDiag.some((d) => d.method === 'OPTIONS'),
      usageLimitFailures: usageLimitDiag.filter((d) => d.failure).map((d) => d.failure),
      previewOnlyHeaderLeakDetected: usageLimitDiag.some((d) => d.previewOnlyHeaderLeak.length > 0),
      paymentsEnabled: false,
      closedCheckoutStateRendered: true,
      checkoutCtaRendered: false,
      stripeCheckoutRequests: checkoutCalls.length,
      checkoutRedirectUnderIsolation: 'UNVERIFIED_BY_DESIGN: payments disabled (Beta-50 freeze); re-audit via paid_launch=true Gate 3',
      allBlockRecords: blockRecords,
      capturedAt: new Date().toISOString(),
    };
    await testInfo.attach('coi-free-closed-checkout.json', { body: JSON.stringify(ev, null, 2), contentType: 'application/json' });
    console.log(`COI_FREE_CLOSED_EVIDENCE ${JSON.stringify(ev)}`);

    // GATE (not merely recorded): no PRODUCT resource may be blocked by the isolation headers on the
    // authenticated surface. Authenticated-only dependencies are exercised ONLY here, so omitting this
    // assertion would let a blocked authenticated dependency green-light the universal production headers.
    expect(coepBlocked, `product resources blocked by COEP/CORP: ${JSON.stringify(coepBlocked)}`).toEqual([]);

    await page.getByTestId('nav-sign-out-button').click();
    await expect(page.getByTestId('nav-sign-out-button'), 'FREE signed out').toBeHidden({ timeout: 45_000 });
  });

  test('PRO account under the Beta-50 billing freeze: login, reload, closed Portal state, logout', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const { email, password } = requireCredentials('PRO');

    const netFailures: NetFailure[] = [];
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    page.on('requestfailed', (r) => netFailures.push({ url: r.url(), failure: r.failure()?.errorText ?? null, at: Date.now() }));
    const usageLimitDiag: UsageLimitDiag[] = [];
    recordUsageLimitDiagnostics(page, usageLimitDiag);
    const navAtMs: number[] = [];
    recordNavigations(page, navAtMs);
    const blockRecords: BlockRecord[] = [];
    await captureBlockReasons(page, blockRecords);

    // ENTITLEMENT CALL — CLASSIFIED BY THE 3-MODE CDP DIAGNOSIS (run 30411578217, one deployment):
    //   COEP none (crossOriginIsolated=false) / credentialless / require-corp
    //   -> ALL fail identically: corsError=MissingAllowOriginHeader, blockedReason=null.
    // It fails with NO isolation headers at all, so isolation is NOT the cause: the Supabase Edge Function
    // uses an exact-origin CORS allowlist holding the PRODUCTION origin but not preview origins
    // (production returns HTTP 200 for the same call). Asserting a 2xx here would demand an outcome that
    // cannot occur on ANY preview host. The gate below is Chromium's authoritative COEP/CORP blockedReason.
    const navHeaders = await signIn(page, email, password);
    const lane = await laneContext(page, navHeaders);

    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('nav-sign-out-button'), 'PRO session survives reload').toBeVisible({ timeout: 45_000 });

    // Beta-50 CONTRACT: canOpenPortal = arePaymentsEnabled() && isPaidPro. With payments disabled the
    // Billing Portal CTA is intentionally absent and the explanatory state renders instead.
    await page.goto('/pricing', { waitUntil: 'load', timeout: 60_000 });
    await expect(
      page.getByText(/Billing management appears here for paid Pro accounts after Stripe confirms the subscription/i),
      'closed-Portal explanatory state renders under isolation',
    ).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('button', { name: /manage billing|opening billing/i }), 'no Portal CTA under the freeze')
      .toHaveCount(0);
    const portalCalls = requests.filter((u) => /stripe-billing-portal/i.test(u));
    expect(portalCalls, 'no stripe-billing-portal request may occur under the freeze').toEqual([]);

    // AUTHORITATIVE COEP/CORP GATE: no PRODUCT resource may be blocked by the isolation headers.
    // vercel.live is Vercel's preview-only feedback toolbar (absent in production) and is excluded from
    // pass/fail but still recorded. Everything else counts.
    const coepBlocked = blockRecords.filter(
      (b) => /coep|corp/i.test(b.blockedReason ?? '') && !/^https:\/\/vercel\.live\//.test(b.url),
    );
    const entitlementCors = blockRecords.filter((b) => /check-usage-limit/i.test(b.url)).map((b) => b.corsError);

    // ATTACH EVIDENCE BEFORE ASSERTING so a failing lane still yields the differential data.
    const ev = {
      accountClass: 'pro',
      coepBlockedProductResources: coepBlocked,
      entitlementCorsErrors: entitlementCors,
      entitlementClassification: 'preview-origin CORS allowlist (MissingAllowOriginHeader) — reproduced with COEP none/credentialless/require-corp in run 30411578217; production returns 200. NOT isolation-caused.',
      lane,
      usageLimitDiagnostics: usageLimitDiag,
      usageLimitPreflightObserved: usageLimitDiag.some((d) => d.method === 'OPTIONS'),
      usageLimitFailures: usageLimitDiag.filter((d) => d.failure).map((d) => d.failure),
      previewOnlyHeaderLeakDetected: usageLimitDiag.some((d) => d.previewOnlyHeaderLeak.length > 0),
      paymentsEnabled: false,
      closedPortalStateRendered: true,
      portalCtaRendered: false,
      stripeBillingPortalRequests: portalCalls.length,
      portalRedirectUnderIsolation: 'UNVERIFIED_BY_DESIGN: payments disabled (Beta-50 freeze) and the test account lacks the required live subscription state; re-audit via paid_launch=true Gate 3',
      allBlockRecords: blockRecords,
      capturedAt: new Date().toISOString(),
    };
    await testInfo.attach('coi-pro-closed-portal.json', { body: JSON.stringify(ev, null, 2), contentType: 'application/json' });
    console.log(`COI_PRO_CLOSED_EVIDENCE ${JSON.stringify(ev)}`);

    // GATE (not merely recorded): no PRODUCT resource may be blocked by the isolation headers on the
    // authenticated surface. Authenticated-only dependencies are exercised ONLY here, so omitting this
    // assertion would let a blocked authenticated dependency green-light the universal production headers.
    expect(coepBlocked, `product resources blocked by COEP/CORP: ${JSON.stringify(coepBlocked)}`).toEqual([]);

    await page.getByTestId('nav-sign-out-button').click();
    await expect(page.getByTestId('nav-sign-out-button'), 'PRO signed out').toBeHidden({ timeout: 45_000 });
  });
});
