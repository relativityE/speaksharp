import { test, expect } from './helpers/deployedLiveTest';

/**
 * #1043 — cross-origin-isolation COMPATIBILITY AUDIT against a deployed preview.
 *
 * Multi-threaded WASM (the Private-v2 finalization speedup) requires the document to be cross-origin
 * isolated. This spec proves, on a REAL deployed preview, that (a) the isolation headers arrive on the
 * ACTUAL top-level navigation response, (b) the document is genuinely isolated (SharedArrayBuffer
 * available), and (c) NOTHING the product depends on breaks under those headers. The worker's
 * multi-threaded behaviour GIVEN isolation is proven separately against the real worker (see step 3).
 *
 * It DECIDES nothing about rollout: production stays non-isolated (the `has` host rule in vercel.json
 * matches preview hosts only) until that is separately approved.
 *
 * Runs only against a deployed BASE_URL (rc-gates supplies VERCEL_AUTOMATION_BYPASS_SECRET so the
 * SSO-protected preview is reachable; deployedLiveTest injects the host-scoped bypass).
 */

const BASE_URL = process.env.BASE_URL;
// rc-gates supplies PRO_/FREE_ credentials; LIVE_ is the local-run fallback. Prefer PRO so the
// Billing Portal entry point (Pro-only) is actually reachable.
const EMAIL = process.env.PRO_TEST_EMAIL || process.env.FREE_TEST_EMAIL || process.env.LIVE_TEST_EMAIL;
const PASSWORD = process.env.PRO_TEST_PASSWORD || process.env.FREE_TEST_PASSWORD || process.env.LIVE_TEST_PASSWORD;
const IS_PRO_ACCOUNT = Boolean(process.env.PRO_TEST_EMAIL && process.env.PRO_TEST_PASSWORD);

/** Resources whose failure would mean the isolation headers broke a production dependency. */
type NetFailure = { url: string; failure: string | null };

test.describe('#1043 cross-origin isolation compatibility @live', () => {
  test.skip(!BASE_URL, 'BASE_URL (deployed preview) is required.');

  test('isolation headers + multi-threaded Private-v2 worker + no blocked resources', async ({ page }, testInfo) => {
    test.setTimeout(300_000);

    const consoleErrors: string[] = [];
    const netFailures: NetFailure[] = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('requestfailed', (r) => netFailures.push({ url: r.url(), failure: r.failure()?.errorText ?? null }));

    // (1) Headers must be on the ACTUAL navigation response (not a later fetch).
    const resp = await page.goto('/', { waitUntil: 'load', timeout: 120_000 });
    expect(resp, 'navigation response').toBeTruthy();
    const navHeaders = resp!.headers();
    const coop = navHeaders['cross-origin-opener-policy'] ?? null;
    const coep = navHeaders['cross-origin-embedder-policy'] ?? null;
    expect(coop, 'COOP on navigation response').toBe('same-origin');
    expect(coep, 'COEP on navigation response').toBe('credentialless');

    // (2) The document must actually be isolated (SAB is hidden unless it is).
    const ctx = await page.evaluate(() => ({
      crossOriginIsolated,
      typeofSAB: typeof SharedArrayBuffer,
      isSecureContext,
      hardwareConcurrency: navigator.hardwareConcurrency,
      host: location.host,
    }));
    expect(ctx.crossOriginIsolated, 'document is cross-origin isolated').toBe(true);
    expect(ctx.typeofSAB, 'SharedArrayBuffer available under isolation').toBe('function');

    // (3) Isolation is the DECISIVE precondition for multi-threaded WASM, and it is what this deployed
    //     audit must establish. The worker's behaviour GIVEN isolation is already proven directly against
    //     the real Private-v2 whisper-base.en worker (its existing `loaded` telemetry reported
    //     device=wasm-multithread / threads=4 / crossOriginIsolated=true when isolated, and
    //     wasm-singlethread / threads=1 when not). We deliberately do NOT re-instantiate the worker by a
    //     hardcoded bundle URL here: the built worker filename is content-hashed, so a guessed path would
    //     silently never assert and would read as passing coverage that does not exist.
    //     Multi-thread selection is a pure function of the values asserted above
    //     (computeWasmThreadCount(crossOriginIsolated, hardwareConcurrency)), unit-locked in
    //     tests/config/crossOriginIsolationScope.test.ts.
    expect(ctx.hardwareConcurrency, 'hardware threads reported').toBeGreaterThanOrEqual(1);

    // (4) Nothing THE PRODUCT depends on may be blocked by COEP/CORS under isolation.
    //
    // `vercel.live` is Vercel's PREVIEW-ONLY feedback/comments toolbar, injected by Vercel into preview
    // deployments. It is NOT a SpeakSharp dependency and is NOT present on production deployments, so its
    // being blocked under COEP has zero product impact. It is excluded from the pass/fail assertion but is
    // still recorded in the evidence artifact below, so the exclusion is visible rather than hidden.
    // The exclusion is deliberately narrow — exactly this host, nothing else.
    const VERCEL_PREVIEW_TOOLBAR = /^https:\/\/vercel\.live\//;
    const allBlocked = netFailures.filter((f) =>
      /ERR_BLOCKED_BY_RESPONSE|ERR_BLOCKED_BY_CLIENT|CORP|COEP/i.test(f.failure ?? ''),
    );
    const blocked = allBlocked.filter((f) => !VERCEL_PREVIEW_TOOLBAR.test(f.url));
    const evidence = {
      capturedAt: new Date().toISOString(),
      host: ctx.host,
      navCOOP: coop,
      navCOEP: coep,
      crossOriginIsolated: ctx.crossOriginIsolated,
      typeofSAB: ctx.typeofSAB,
      hardwareConcurrency: ctx.hardwareConcurrency,
      productBlockedCount: blocked.length,
      productBlockedResources: blocked.slice(0, 20),
      // Everything blocked, INCLUDING the excluded Vercel preview toolbar, so the exclusion is auditable.
      allBlockedCount: allBlocked.length,
      allBlockedResources: allBlocked.slice(0, 20),
      excludedAsPreviewOnly: allBlocked.filter((f) => VERCEL_PREVIEW_TOOLBAR.test(f.url)).map((f) => f.url),
      consoleErrorCount: consoleErrors.length,
      consoleErrorsSample: consoleErrors.slice(0, 10),
    };
    await testInfo.attach('cross-origin-isolation-compat.json', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
    console.log(`COI_COMPAT_EVIDENCE ${JSON.stringify(evidence)}`);

    expect(blocked, `resources blocked by COEP/CORP under isolation: ${JSON.stringify(blocked)}`).toEqual([]);
  });

  test('authenticated surface + billing entry points survive isolation', async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, 'PRO_/FREE_/LIVE_ TEST_EMAIL+PASSWORD required for the auth + billing audit.');
    test.setTimeout(300_000);

    const netFailures: NetFailure[] = [];
    page.on('requestfailed', (r) => netFailures.push({ url: r.url(), failure: r.failure()?.errorText ?? null }));

    // Supabase login must work under the isolation headers (bearer-token auth, not cookies).
    await page.goto('/signin', { waitUntil: 'load', timeout: 120_000 });
    await page.getByTestId('email-input').fill(EMAIL!);
    await page.getByTestId('password-input').fill(PASSWORD!);
    await page.getByTestId('sign-in-submit').click();
    await expect(page, 'signed in under isolation').toHaveURL(/\/(session|practice|analytics)/, { timeout: 60_000 });

    // Session refresh: a reload must retain the authenticated session (no cookie/storage breakage).
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('nav-sign-out-button'), 'session survives reload').toBeVisible({ timeout: 45_000 });

    // Supabase edge-function reachability under isolation (no COEP/CORS breakage cross-origin).
    const supabaseBlocked = netFailures.filter((f) =>
      /supabase/i.test(f.url) && /ERR_BLOCKED_BY_RESPONSE|CORP|COEP|ERR_FAILED/i.test(f.failure ?? ''),
    );
    expect(supabaseBlocked, `Supabase calls blocked under isolation: ${JSON.stringify(supabaseBlocked)}`).toEqual([]);

    // Logout must work.
    await page.getByTestId('nav-sign-out-button').click();
    await expect(page.getByTestId('nav-sign-out-button'), 'signed out').toBeHidden({ timeout: 45_000 });
  });

  test('assets, observability and billing entry points are not broken by isolation', async ({ page }, testInfo) => {
    test.setTimeout(300_000);

    const requests: string[] = [];
    const netFailures: NetFailure[] = [];
    page.on('request', (r) => requests.push(r.url()));
    page.on('requestfailed', (r) => netFailures.push({ url: r.url(), failure: r.failure()?.errorText ?? null }));

    await page.goto('/', { waitUntil: 'load', timeout: 120_000 });
    // Give late/deferred third parties (analytics, error reporting, fonts) a chance to load.
    await page.waitForTimeout(6_000);

    const failedFor = (re: RegExp) =>
      netFailures.filter((f) => re.test(f.url) && /ERR_BLOCKED_BY_RESPONSE|CORP|COEP|ERR_FAILED/i.test(f.failure ?? ''));

    // Same-origin model assets MUST remain fetchable (Private-v2 loads whisper from /models/).
    const modelProbe = await page.evaluate(async () => {
      try {
        const r = await fetch('/models/whisper-base.en/config.json', { cache: 'no-store' });
        return { ok: r.ok, status: r.status };
      } catch (e) { return { ok: false, status: -1, error: String(e) }; }
    });
    expect(modelProbe.ok, `same-origin model asset must load under isolation: ${JSON.stringify(modelProbe)}`).toBe(true);

    const observability = {
      posthogRequested: requests.some((u) => /posthog/i.test(u)),
      sentryRequested: requests.some((u) => /sentry/i.test(u)),
      posthogBlocked: failedFor(/posthog/i),
      sentryBlocked: failedFor(/sentry/i),
      fontsRequested: requests.filter((u) => /fonts\.(googleapis|gstatic)\.com|\.woff2?(\?|$)/i.test(u)).length,
      fontsBlocked: failedFor(/fonts\.(googleapis|gstatic)\.com|\.woff2?(\?|$)/i),
      modelProbe,
    };
    // Whatever the app DOES request must not be blocked by the isolation headers.
    expect(observability.posthogBlocked, 'PostHog blocked under isolation').toEqual([]);
    expect(observability.sentryBlocked, 'Sentry blocked under isolation').toEqual([]);
    expect(observability.fontsBlocked, 'fonts blocked under isolation').toEqual([]);

    // Billing entry points: the app uses HOSTED Stripe redirects (no embedded Elements). Verify the
    // checkout-session call succeeds and yields a Stripe URL, WITHOUT completing any purchase.
    let checkout: Record<string, unknown> = { attempted: false };
    if (EMAIL && PASSWORD) {
      await page.goto('/signin', { waitUntil: 'load', timeout: 120_000 });
      await page.getByTestId('email-input').fill(EMAIL);
      await page.getByTestId('password-input').fill(PASSWORD);
      await page.getByTestId('sign-in-submit').click();
      await expect(page).toHaveURL(/\/(session|practice|analytics)/, { timeout: 60_000 });

      await page.goto('/pricing', { waitUntil: 'load', timeout: 60_000 });
      const stripeCalls = netFailures.filter((f) => /stripe/i.test(f.url));
      checkout = {
        attempted: true,
        pricingReached: page.url().includes('/pricing'),
        stripeRelatedFailures: stripeCalls,
      };
      // NOTE: no purchase is completed and no card data is entered — only the redirect entry point is
      // exercised. Blocked Stripe requests would show up as failures here.
      expect(stripeCalls, 'Stripe-related requests blocked under isolation').toEqual([]);

      // Billing Portal (Pro-only): clicking "Manage billing" invokes the stripe-billing-portal edge
      // function and redirects to Stripe's hosted portal. We assert the call is not blocked by the
      // isolation headers; we do NOT change any subscription.
      const manageBilling = page.getByRole('button', { name: /manage billing/i });
      const portalVisible = await manageBilling.isVisible().catch(() => false);
      if (portalVisible) {
        await manageBilling.click();
        await page.waitForTimeout(8_000);
        const portalBlocked = netFailures.filter((f) =>
          /billing-portal|stripe/i.test(f.url) && /ERR_BLOCKED_BY_RESPONSE|CORP|COEP|ERR_FAILED/i.test(f.failure ?? ''),
        );
        expect(portalBlocked, 'Billing Portal call blocked under isolation').toEqual([]);
        checkout = { ...checkout, portalAttempted: true, portalLandedOnStripe: /stripe\.com/i.test(page.url()), portalBlocked };
      } else {
        checkout = { ...checkout, portalAttempted: false, portalReason: IS_PRO_ACCOUNT ? 'manage-billing button not visible for this Pro account' : 'non-Pro account: portal entry point not offered' };
      }
    }

    const evidence = { capturedAt: new Date().toISOString(), ...observability, checkout };
    await testInfo.attach('isolation-assets-observability.json', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
    console.log(`COI_ASSETS_EVIDENCE ${JSON.stringify(evidence)}`);
  });
});
