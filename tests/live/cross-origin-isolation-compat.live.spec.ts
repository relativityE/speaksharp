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

  test('FREE account: login, reload persistence, Checkout redirect + safe return, logout', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const { email, password } = requireCredentials('FREE');

    const netFailures: NetFailure[] = [];
    page.on('requestfailed', (r) => netFailures.push({ url: r.url(), failure: r.failure()?.errorText ?? null }));

    await signIn(page, email, password);

    // Session must survive a reload (no cookie/storage breakage under credentialless).
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('nav-sign-out-button'), 'FREE session survives reload').toBeVisible({ timeout: 45_000 });

    // Checkout entry point: click the upgrade CTA; the app calls the stripe-checkout edge function and
    // performs a TOP-LEVEL redirect to Stripe's hosted Checkout. NO purchase is completed and NO card
    // data is entered — we only prove the redirect happens and the app is safe to return to.
    await page.goto('/pricing', { waitUntil: 'load', timeout: 60_000 });
    const upgrade = page.getByRole('button', { name: /upgrade|go pro|start pro|subscribe/i }).first();
    await expect(upgrade, 'FREE account is offered a Checkout CTA').toBeVisible({ timeout: 45_000 });
    // Visiting /pricing is NOT proof. Require the stripe-checkout EDGE FUNCTION request to be observed,
    // triggered by clicking the real control; only then is checkoutAttempted true.
    const checkoutCall = page.waitForRequest((r) => /stripe-checkout/i.test(r.url()), { timeout: 60_000 });
    await upgrade.click();
    const checkoutRequest = await checkoutCall;
    const checkoutAttempted = Boolean(checkoutRequest);
    expect(checkoutAttempted, 'stripe-checkout edge function must be invoked by the Checkout control').toBe(true);
    // Stripe hosted checkout is a cross-origin top-level navigation.
    await page.waitForURL(/checkout\.stripe\.com|stripe\.com/i, { timeout: 90_000 });
    const reachedStripe = /stripe\.com/i.test(page.url());
    expect(reachedStripe, `Checkout must redirect to Stripe (got ${page.url()})`).toBe(true);

    // SAFE RETURN: navigate back to the app and confirm it still loads and the session is intact.
    await page.goto('/', { waitUntil: 'load', timeout: 90_000 });
    await expect(page.getByTestId('nav-sign-out-button'), 'session intact after returning from Stripe').toBeVisible({ timeout: 45_000 });

    const stripeBlocked = blockedFailures(netFailures, /stripe|supabase/i);
    expect(stripeBlocked, `Checkout/Supabase calls blocked under isolation: ${JSON.stringify(stripeBlocked)}`).toEqual([]);

    // Logout must work.
    await page.getByTestId('nav-sign-out-button').click();
    await expect(page.getByTestId('nav-sign-out-button'), 'FREE signed out').toBeHidden({ timeout: 45_000 });

    // Evidence records ACCOUNT CLASS ONLY — never the email/password.
    const ev = { accountClass: 'free', checkoutAttempted, reachedStripe, purchaseCompleted: false, blocked: stripeBlocked, capturedAt: new Date().toISOString() };
    await testInfo.attach('coi-free-checkout.json', { body: JSON.stringify(ev, null, 2), contentType: 'application/json' });
    console.log(`COI_FREE_CHECKOUT_EVIDENCE ${JSON.stringify(ev)}`);
  });

  test('PRO account: login, reload persistence, Billing Portal redirect + safe return, logout', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const { email, password } = requireCredentials('PRO');

    const netFailures: NetFailure[] = [];
    page.on('requestfailed', (r) => netFailures.push({ url: r.url(), failure: r.failure()?.errorText ?? null }));

    await signIn(page, email, password);

    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('nav-sign-out-button'), 'PRO session survives reload').toBeVisible({ timeout: 45_000 });

    // Billing Portal: invokes the stripe-billing-portal edge function and redirects to Stripe's hosted
    // portal. NO subscription is changed — we only prove the redirect happens and return is safe.
    await page.goto('/pricing', { waitUntil: 'load', timeout: 60_000 });
    const manageBilling = page.getByRole('button', { name: /manage billing/i });
    // Absent CTA is a FAILURE for the designated Pro account — never an optional unattempted path.
    await expect(manageBilling, 'PRO account must be offered the Billing Portal CTA').toBeVisible({ timeout: 45_000 });
    const portalCall = page.waitForRequest((r) => /stripe-billing-portal/i.test(r.url()), { timeout: 60_000 });
    await manageBilling.click();
    const portalRequest = await portalCall;
    const portalAttempted = Boolean(portalRequest);
    expect(portalAttempted, 'stripe-billing-portal edge function must be invoked by Manage billing').toBe(true);
    await page.waitForURL(/billing\.stripe\.com|stripe\.com/i, { timeout: 90_000 });
    const reachedPortal = /stripe\.com/i.test(page.url());
    expect(reachedPortal, `Billing Portal must redirect to Stripe (got ${page.url()})`).toBe(true);

    // SAFE RETURN.
    await page.goto('/', { waitUntil: 'load', timeout: 90_000 });
    await expect(page.getByTestId('nav-sign-out-button'), 'session intact after returning from Portal').toBeVisible({ timeout: 45_000 });

    const portalBlocked = blockedFailures(netFailures, /stripe|billing-portal|supabase/i);
    expect(portalBlocked, `Portal/Supabase calls blocked under isolation: ${JSON.stringify(portalBlocked)}`).toEqual([]);

    await page.getByTestId('nav-sign-out-button').click();
    await expect(page.getByTestId('nav-sign-out-button'), 'PRO signed out').toBeHidden({ timeout: 45_000 });

    // Evidence records ACCOUNT CLASS ONLY — never the email/password.
    const ev = { accountClass: 'pro', portalAttempted, reachedPortal, subscriptionChanged: false, blocked: portalBlocked, capturedAt: new Date().toISOString() };
    await testInfo.attach('coi-pro-portal.json', { body: JSON.stringify(ev, null, 2), contentType: 'application/json' });
    console.log(`COI_PRO_PORTAL_EVIDENCE ${JSON.stringify(ev)}`);
  });
});
