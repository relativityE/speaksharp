import type { Page, BrowserContext } from '@playwright/test';
import { test, expect } from './helpers/deployedLiveTest';

/**
 * #1043 BOUNDED DIAGNOSIS (single attempt): why does the cross-origin Supabase Edge Function call
 * `check-usage-limit` never respond under cross-origin isolation, when it returns HTTP 200 on the
 * non-isolated production lane?
 *
 * Method — one deployed preview, three COEP modes, identical authenticated flow:
 *   - the navigation response's COOP/COEP headers are rewritten IN-TEST (route.fulfill), so all three
 *     modes are measured against the SAME deployment. No deployment, Edge Function, shared CORS contract,
 *     or production configuration is changed by this diagnosis.
 *   - Chromium's exact failure classification is read via CDP `Network.loadingFailed`
 *     (blockedReason + corsErrorStatus), which is the only place the real reason is exposed —
 *     Playwright's `requestfailed` collapses everything to a generic errorText.
 *
 * Emits COI_DIAGNOSIS_EVIDENCE only. Asserts nothing about product behaviour; it exists to select the
 * smallest evidence-supported correction. Header NAMES only — never values.
 */

const BASE_URL = process.env.BASE_URL;

type CoepMode = 'none' | 'credentialless' | 'require-corp';

type FailureRecord = {
  url: string;
  type: string;
  errorText: string;
  blockedReason: string | null;
  corsErrorStatus: Record<string, unknown> | null;
};

type ModeResult = {
  mode: CoepMode;
  crossOriginIsolated: boolean;
  typeofSAB: string;
  entitlementStatus: number | null;
  entitlementCorsHeaderNames: string[];
  entitlementFailures: FailureRecord[];
  allBlockedFailures: FailureRecord[];
  error?: string;
};

/** Read the true failure classification from CDP; Playwright's errorText is not specific enough. */
async function attachCdpFailureCapture(page: Page, sink: FailureRecord[]) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const byId = new Map<string, { url: string; type: string }>();
  cdp.on('Network.requestWillBeSent', (e) => {
    const ev = e as unknown as { requestId: string; request: { url: string }; type?: string };
    byId.set(ev.requestId, { url: ev.request.url, type: ev.type ?? 'Other' });
  });
  cdp.on('Network.loadingFailed', (e) => {
    const ev = e as unknown as {
      requestId: string; errorText: string; blockedReason?: string;
      corsErrorStatus?: Record<string, unknown>; type?: string;
    };
    const meta = byId.get(ev.requestId);
    sink.push({
      url: meta?.url ?? '(unknown)',
      type: ev.type ?? meta?.type ?? 'Other',
      errorText: ev.errorText,
      blockedReason: ev.blockedReason ?? null,
      corsErrorStatus: ev.corsErrorStatus ?? null,
    });
  });
  return cdp;
}

/** Force a specific COOP/COEP mode on the top-level navigation of the tested host. */
async function forceCoepMode(context: BrowserContext, host: string, mode: CoepMode) {
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  await context.route(
    (url) => { try { return url.host === host; } catch { return false; } },
    async (route) => {
      const req = route.request();
      const extra: Record<string, string> = bypass
        ? { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'samesitenone' }
        : {};
      const response = await route.fetch({ headers: { ...req.headers(), ...extra } });
      // Only the top-level document carries the isolation policy.
      if (req.resourceType() !== 'document') { await route.fulfill({ response }); return; }
      const headers = { ...response.headers() };
      delete headers['cross-origin-opener-policy'];
      delete headers['cross-origin-embedder-policy'];
      if (mode !== 'none') {
        headers['cross-origin-opener-policy'] = 'same-origin';
        headers['cross-origin-embedder-policy'] = mode;
      }
      await route.fulfill({ response, headers });
    },
  );
}

async function runMode(context: BrowserContext, mode: CoepMode, email: string, password: string): Promise<ModeResult> {
  const page = await context.newPage();
  const failures: FailureRecord[] = [];
  await attachCdpFailureCapture(page, failures);

  let entitlementStatus: number | null = null;
  let entitlementCorsHeaderNames: string[] = [];
  page.on('response', (res) => {
    if (!/check-usage-limit/i.test(res.url())) return;
    entitlementStatus = res.status();
    entitlementCorsHeaderNames = Object.keys(res.headers())
      .filter((n) => /^access-control-|^cross-origin-/i.test(n));
  });

  try {
    await page.goto('/auth/signin', { waitUntil: 'load', timeout: 120_000 });
    await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('email-input').fill(email);
    await page.getByTestId('password-input').fill(password);
    await page.getByTestId('sign-in-submit').click();
    await expect(page).toHaveURL(/\/(session|practice|analytics)/, { timeout: 60_000 });
    // Give the entitlement call time to resolve or fail, WITHOUT navigating away.
    await page.waitForTimeout(20_000);
  } catch (e) {
    const ctxErr = (e as Error).message;
    const ctx = await page.evaluate(() => ({ crossOriginIsolated, typeofSAB: typeof SharedArrayBuffer })).catch(() => ({ crossOriginIsolated: false, typeofSAB: 'unknown' }));
    await page.close();
    return {
      mode, ...ctx, entitlementStatus, entitlementCorsHeaderNames,
      entitlementFailures: failures.filter((f) => /check-usage-limit/i.test(f.url)),
      allBlockedFailures: failures.filter((f) => f.blockedReason || f.corsErrorStatus),
      error: ctxErr,
    };
  }

  const ctx = await page.evaluate(() => ({ crossOriginIsolated, typeofSAB: typeof SharedArrayBuffer }));
  await page.close();
  return {
    mode, ...ctx, entitlementStatus, entitlementCorsHeaderNames,
    entitlementFailures: failures.filter((f) => /check-usage-limit/i.test(f.url)),
    allBlockedFailures: failures.filter((f) => f.blockedReason || f.corsErrorStatus),
  };
}

test.describe('#1043 COEP preflight diagnosis @live', () => {
  test.skip(!BASE_URL, 'BASE_URL (deployed preview) is required.');

  test('classify check-usage-limit failure across none / credentialless / require-corp', async ({ browser }, testInfo) => {
    test.setTimeout(600_000);
    const email = process.env.FREE_TEST_EMAIL;
    const password = process.env.FREE_TEST_PASSWORD;
    if (!email || !password) throw new Error('FREE_TEST_EMAIL and FREE_TEST_PASSWORD are required for this diagnosis');
    const host = new URL(BASE_URL!).host;

    const results: ModeResult[] = [];
    for (const mode of ['none', 'credentialless', 'require-corp'] as CoepMode[]) {
      const context = await browser.newContext({ baseURL: BASE_URL });
      await context.addInitScript(() => {
        (window as unknown as { __E2E_CONTEXT__?: boolean }).__E2E_CONTEXT__ = true;
      });
      await forceCoepMode(context, host, mode);
      results.push(await runMode(context, mode, email, password));
      await context.close();
    }

    const evidence = { capturedAt: new Date().toISOString(), host, results };
    await testInfo.attach('coi-preflight-diagnosis.json', {
      body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
    });
    console.log(`COI_DIAGNOSIS_EVIDENCE ${JSON.stringify(evidence)}`);

    // Diagnostic only: it must produce data for all three modes, and asserts nothing about the product.
    expect(results).toHaveLength(3);
  });
});
