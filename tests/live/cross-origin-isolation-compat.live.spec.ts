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
 * Strict per-account-class credentials. NO fallback between FREE/PRO/BASIC/LIVE: one account cannot
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
 * #1043 classification: a cancelled request is benign ONLY when a deliberate main-frame navigation
 * happened just before it. The gate is NOT weakened by globally ignoring ERR_FAILED/ERR_ABORTED —
 * every such failure must be demonstrably navigation-induced, or it counts against the gate.
 */
const NAV_CANCEL_WINDOW_MS = 5_000;
function classifyFailures(fails: NetFailure[], navAtMs: number[]) {
  const benign: NetFailure[] = [];
  const real: NetFailure[] = [];
  for (const f of fails) {
    const navJustBefore = navAtMs.some((n) => f.at >= n && f.at - n <= NAV_CANCEL_WINDOW_MS);
    (navJustBefore ? benign : real).push(f);
  }
  return { benign, real };
}


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

    // WAIT-FOR-SETTLE: install the waiter BEFORE the action that triggers check-usage-limit, and let the
    // response settle BEFORE any reload/navigation/logout. Otherwise the test's own navigation cancels the
    // in-flight call and the cancellation is indistinguishable from a COEP/CORS block.
    const usageSettled = page.waitForResponse(
      (r) => /check-usage-limit/i.test(r.url()) && r.request().method() === 'POST',
      { timeout: 90_000 },
    );
    const navHeaders = await signIn(page, email, password);
    const lane = await laneContext(page, navHeaders);
    const usageResponse = await usageSettled;
    const usageStatus = usageResponse.status();
    const usageCorsHeaderNames = Object.keys(usageResponse.headers())
      .filter((n) => /^access-control-|^cross-origin-/i.test(n));
    const settledAtMs = Date.now();
    // The settled entitlement call must genuinely SUCCEED — 'request started' is not success.
    expect(usageStatus, `check-usage-limit must return 2xx (got ${usageStatus})`).toBeGreaterThanOrEqual(200);
    expect(usageStatus, `check-usage-limit must return 2xx (got ${usageStatus})`).toBeLessThan(300);
    // Nothing may have been blocked BEFORE the settle point (no navigation has occurred since sign-in).
    const preSettleBlocked = blockedFailures(netFailures.filter((f) => f.at <= settledAtMs), /supabase|stripe/i);
    expect(preSettleBlocked, `blocked before settle: ${JSON.stringify(preSettleBlocked)}`).toEqual([]);

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

    // Post-settle failures are classified: benign ONLY when a deliberate navigation immediately preceded
    // them. Anything else still counts against the gate.
    const postSettle = blockedFailures(netFailures.filter((f) => f.at > settledAtMs), /supabase|stripe/i);
    const { benign: navCancelled, real: supabaseBlocked } = classifyFailures(postSettle, navAtMs);

    // ATTACH EVIDENCE BEFORE ASSERTING so a failing lane still yields the differential data.
    const ev = {
      accountClass: 'free',
      lane,
      usageLimitSettledStatus: usageStatus,
      usageLimitCorsResponseHeaderNames: usageCorsHeaderNames,
      preSettleBlockedCount: preSettleBlocked.length,
      postSettleBenignNavCancelled: navCancelled.length,
      postSettleRealFailures: supabaseBlocked,
      usageLimitDiagnostics: usageLimitDiag,
      usageLimitPreflightObserved: usageLimitDiag.some((d) => d.method === 'OPTIONS'),
      usageLimitFailures: usageLimitDiag.filter((d) => d.failure).map((d) => d.failure),
      previewOnlyHeaderLeakDetected: usageLimitDiag.some((d) => d.previewOnlyHeaderLeak.length > 0),
      paymentsEnabled: false,
      closedCheckoutStateRendered: true,
      checkoutCtaRendered: false,
      stripeCheckoutRequests: checkoutCalls.length,
      checkoutRedirectUnderIsolation: 'UNVERIFIED_BY_DESIGN: payments disabled (Beta-50 freeze); re-audit via paid_launch=true Gate 3',
      blocked: supabaseBlocked,
      capturedAt: new Date().toISOString(),
    };
    await testInfo.attach('coi-free-closed-checkout.json', { body: JSON.stringify(ev, null, 2), contentType: 'application/json' });
    console.log(`COI_FREE_CLOSED_EVIDENCE ${JSON.stringify(ev)}`);

    expect(supabaseBlocked, `Supabase/Stripe calls blocked: ${JSON.stringify(supabaseBlocked)}`).toEqual([]);
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

    // WAIT-FOR-SETTLE: install the waiter BEFORE the action that triggers check-usage-limit, and let the
    // response settle BEFORE any reload/navigation/logout. Otherwise the test's own navigation cancels the
    // in-flight call and the cancellation is indistinguishable from a COEP/CORS block.
    const usageSettled = page.waitForResponse(
      (r) => /check-usage-limit/i.test(r.url()) && r.request().method() === 'POST',
      { timeout: 90_000 },
    );
    const navHeaders = await signIn(page, email, password);
    const lane = await laneContext(page, navHeaders);
    const usageResponse = await usageSettled;
    const usageStatus = usageResponse.status();
    const usageCorsHeaderNames = Object.keys(usageResponse.headers())
      .filter((n) => /^access-control-|^cross-origin-/i.test(n));
    const settledAtMs = Date.now();
    // The settled entitlement call must genuinely SUCCEED — 'request started' is not success.
    expect(usageStatus, `check-usage-limit must return 2xx (got ${usageStatus})`).toBeGreaterThanOrEqual(200);
    expect(usageStatus, `check-usage-limit must return 2xx (got ${usageStatus})`).toBeLessThan(300);
    // Nothing may have been blocked BEFORE the settle point (no navigation has occurred since sign-in).
    const preSettleBlocked = blockedFailures(netFailures.filter((f) => f.at <= settledAtMs), /supabase|stripe/i);
    expect(preSettleBlocked, `blocked before settle: ${JSON.stringify(preSettleBlocked)}`).toEqual([]);

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

    // Post-settle failures are classified: benign ONLY when a deliberate navigation immediately preceded
    // them. Anything else still counts against the gate.
    const postSettle = blockedFailures(netFailures.filter((f) => f.at > settledAtMs), /supabase|stripe/i);
    const { benign: navCancelled, real: supabaseBlocked } = classifyFailures(postSettle, navAtMs);

    // ATTACH EVIDENCE BEFORE ASSERTING so a failing lane still yields the differential data.
    const ev = {
      accountClass: 'pro',
      lane,
      usageLimitSettledStatus: usageStatus,
      usageLimitCorsResponseHeaderNames: usageCorsHeaderNames,
      preSettleBlockedCount: preSettleBlocked.length,
      postSettleBenignNavCancelled: navCancelled.length,
      postSettleRealFailures: supabaseBlocked,
      usageLimitDiagnostics: usageLimitDiag,
      usageLimitPreflightObserved: usageLimitDiag.some((d) => d.method === 'OPTIONS'),
      usageLimitFailures: usageLimitDiag.filter((d) => d.failure).map((d) => d.failure),
      previewOnlyHeaderLeakDetected: usageLimitDiag.some((d) => d.previewOnlyHeaderLeak.length > 0),
      paymentsEnabled: false,
      closedPortalStateRendered: true,
      portalCtaRendered: false,
      stripeBillingPortalRequests: portalCalls.length,
      portalRedirectUnderIsolation: 'UNVERIFIED_BY_DESIGN: payments disabled (Beta-50 freeze) and the test account lacks the required live subscription state; re-audit via paid_launch=true Gate 3',
      blocked: supabaseBlocked,
      capturedAt: new Date().toISOString(),
    };
    await testInfo.attach('coi-pro-closed-portal.json', { body: JSON.stringify(ev, null, 2), contentType: 'application/json' });
    console.log(`COI_PRO_CLOSED_EVIDENCE ${JSON.stringify(ev)}`);

    expect(supabaseBlocked, `Supabase/Stripe calls blocked: ${JSON.stringify(supabaseBlocked)}`).toEqual([]);
    await page.getByTestId('nav-sign-out-button').click();
    await expect(page.getByTestId('nav-sign-out-button'), 'PRO signed out').toBeHidden({ timeout: 45_000 });
  });
});
