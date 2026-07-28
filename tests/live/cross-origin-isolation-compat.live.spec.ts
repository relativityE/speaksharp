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

type NetFailure = { url: string; failure: string | null };
const blockedFailures = (fails: NetFailure[], re: RegExp) =>
  fails.filter((f) => re.test(f.url) && /ERR_BLOCKED_BY_RESPONSE|CORP|COEP|ERR_FAILED/i.test(f.failure ?? ''));

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/auth/signin', { waitUntil: 'load', timeout: 120_000 });
  // Fail fast with a clear message if the auth form never renders, instead of a 5-minute locator.fill
  // timeout that hides WHY (a wrong route previously cost ~10 minutes and reported only "locator.fill").
  await expect(page.getByTestId('auth-form'), 'sign-in form must render at /auth/signin').toBeVisible({ timeout: 45_000 });
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(password);
  await page.getByTestId('sign-in-submit').click();
  await expect(page, 'signed in under isolation').toHaveURL(/\/(session|practice|analytics)/, { timeout: 60_000 });
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
    page.on('requestfailed', (r) => netFailures.push({ url: r.url(), failure: r.failure()?.errorText ?? null }));

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
    page.on('requestfailed', (r) => netFailures.push({ url: r.url(), failure: r.failure()?.errorText ?? null }));

    await signIn(page, email, password);
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

    const supabaseBlocked = blockedFailures(netFailures, /supabase|stripe/i);
    expect(supabaseBlocked, `Supabase/Stripe calls blocked under isolation: ${JSON.stringify(supabaseBlocked)}`).toEqual([]);

    await page.getByTestId('nav-sign-out-button').click();
    await expect(page.getByTestId('nav-sign-out-button'), 'FREE signed out').toBeHidden({ timeout: 45_000 });

    // Evidence records ACCOUNT CLASS ONLY — never credentials.
    const ev = {
      accountClass: 'free',
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
  });

  test('PRO account under the Beta-50 billing freeze: login, reload, closed Portal state, logout', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const { email, password } = requireCredentials('PRO');

    const netFailures: NetFailure[] = [];
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    page.on('requestfailed', (r) => netFailures.push({ url: r.url(), failure: r.failure()?.errorText ?? null }));

    await signIn(page, email, password);
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

    const supabaseBlocked = blockedFailures(netFailures, /supabase|stripe/i);
    expect(supabaseBlocked, `Supabase/Stripe calls blocked under isolation: ${JSON.stringify(supabaseBlocked)}`).toEqual([]);

    await page.getByTestId('nav-sign-out-button').click();
    await expect(page.getByTestId('nav-sign-out-button'), 'PRO signed out').toBeHidden({ timeout: 45_000 });

    const ev = {
      accountClass: 'pro',
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
  });
});
