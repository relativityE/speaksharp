import { test, expect } from './helpers/deployedLiveTest';

/**
 * CONTENT-FREE authenticated PostHog diagnostic (incident root cause).
 *
 * Signs into the DEPLOYED production app with the existing PRO_TEST_* diagnostic credentials, then
 * measures — WITHOUT recording audio, creating a session, or submitting a report — exactly which
 * stage of the PostHog client path succeeds or fails for a POST-AUTH capture:
 *   1. production page + PostHog SDK init state (pre- and post-auth)
 *   2. authentication success
 *   3. distinct id before/after auth (hashed only)
 *   4. capture() invoked
 *   5. ingest request emitted (host + status + blocked reason)
 *   6. opt-out/consent state
 *
 * It fires ONE content-free event tagged with a unique nonce + provenance so the event can be found
 * (by nonce) via the PostHog Query API afterward and associated with the authenticated identity.
 * NO tester account, NO recording, NO report prose. All logged evidence is booleans/status/hashes.
 */

const EMAIL = process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL;
const PASSWORD = process.env.PRO_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD;
const NONCE = `gha-${process.env.GITHUB_RUN_ID ?? 'local'}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`;

// Non-crypto short hash for identity transitions — never logs a raw distinct id.
function h(s: string | null | undefined): string | null {
  if (!s) return null;
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0;
  return 'h' + x.toString(16);
}

test('content-free authenticated PostHog diagnostic (no recording, no report)', async ({ page }) => {
  test.setTimeout(120_000);
  if (!EMAIL || !PASSWORD) {
    throw new Error('POSTHOG_DIAG_NOT_RUNNABLE: PRO_TEST_EMAIL/PRO_TEST_PASSWORD required');
  }

  // Observe every PostHog ingest attempt (host + status), independent of app code.
  const ingest: Array<{ host: string; status: number | null; failure: string | null }> = [];
  page.on('request', (req) => {
    if (/posthog\.com/i.test(req.url())) {
      // record host only (never the body/query which could carry a token)
      try { ingest.push({ host: new URL(req.url()).host, status: null, failure: null }); } catch { /* ignore */ }
    }
  });
  page.on('requestfailed', (req) => {
    if (/posthog\.com/i.test(req.url())) {
      const last = ingest[ingest.length - 1];
      const failure = req.failure()?.errorText ?? 'failed';
      if (last && last.status === null) last.failure = failure;
      else { try { ingest.push({ host: new URL(req.url()).host, status: null, failure }); } catch { /* ignore */ } }
    }
  });
  page.on('response', (res) => {
    if (/posthog\.com/i.test(res.url())) {
      const last = ingest[ingest.length - 1];
      if (last && last.status === null) last.status = res.status();
      else { try { ingest.push({ host: new URL(res.url()).host, status: res.status(), failure: null }); } catch { /* ignore */ } }
    }
  });

  const readSdk = () => page.evaluate(() => {
    const p = (window as unknown as { posthog?: { __loaded?: boolean; config?: { token?: string; api_host?: string }; has_opted_out_capturing?: () => boolean; get_distinct_id?: () => string; capture?: (e: string, props?: Record<string, unknown>) => void } }).posthog;
    return {
      present: !!p,
      loaded: !!(p && p.__loaded),
      hasToken: !!(p && p.config && p.config.token),
      apiHost: p && p.config ? p.config.api_host : null,
      optedOut: p && typeof p.has_opted_out_capturing === 'function' ? p.has_opted_out_capturing() : null,
      distinctId: p && typeof p.get_distinct_id === 'function' ? p.get_distinct_id() : null,
      release: (window as unknown as { __APP_RUNTIME_CONFIG__?: { release?: string } }).__APP_RUNTIME_CONFIG__?.release ?? null,
    };
  });

  // ---- pre-auth ----
  await page.goto('/');
  await page.waitForLoadState('networkidle').catch(() => {});
  const pre = await readSdk();

  // ---- authenticate (PRO_TEST_*), content-free ----
  await page.goto('/auth/signin');
  await page.waitForSelector('[data-testid="auth-form"]', { timeout: 20_000 });
  await page.getByTestId('email-input').fill(EMAIL);
  await page.getByTestId('password-input').fill(PASSWORD);
  const loginResp = page.waitForResponse(
    (r) => r.url().includes('/auth/v1/token') && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await page.getByTestId('sign-in-submit').click();
  const login = await loginResp;
  const authenticated = login.ok();

  // Land on an authenticated route so the app's post-auth bootstrap (init + identify) runs.
  await page.goto('/analytics');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);
  const post = await readSdk();

  // ---- fire ONE content-free diagnostic capture with the nonce + provenance ----
  const ingestBefore = ingest.length;
  const captured = await page.evaluate((args) => {
    const p = (window as unknown as { posthog?: { __loaded?: boolean; config?: { token?: string; api_host?: string }; has_opted_out_capturing?: () => boolean; get_distinct_id?: () => string; capture?: (e: string, props?: Record<string, unknown>) => void } }).posthog;
    if (!p || typeof p.capture !== 'function') return { invoked: false };
    p.capture('diagnostic_probe', {
      data_origin: 'automated_test',
      cohort_id: 'internal_diagnostics',
      test_run_id: args.nonce,
      test_suite: 'posthog_authenticated_diagnostic',
      environment: 'production',
      release_sha: args.release,
      content_free: true,
    });
    return { invoked: true };
  }, { nonce: NONCE, release: post.release });

  // Give the SDK a moment to flush the ingest request.
  await page.waitForTimeout(4000).catch(() => {});

  const evidence = {
    nonce: NONCE,
    release_sha: post.release,
    authenticated,
    sdk_pre_auth: { present: pre.present, loaded: pre.loaded, hasToken: pre.hasToken },
    sdk_post_auth: { present: post.present, loaded: post.loaded, hasToken: post.hasToken, apiHost: post.apiHost, optedOut: post.optedOut },
    distinct_pre_hash: h(pre.distinctId),
    distinct_post_hash: h(post.distinctId),
    distinct_changed_on_auth: h(pre.distinctId) !== h(post.distinctId),
    capture_invoked: captured.invoked,
    ingest_attempts_total: ingest.length,
    ingest_attempts_after_capture: ingest.length - ingestBefore,
    ingest_last: ingest[ingest.length - 1] ?? null,
  };
  console.log(`POSTHOG_DIAG_EVIDENCE ${JSON.stringify(evidence)}`);

  // The suite's PURPOSE is to produce evidence; it should not hard-fail on the very defect it
  // diagnoses. Only assert the run itself was valid (authenticated + evidence emitted).
  expect(authenticated, 'diagnostic account must authenticate').toBeTruthy();
  expect(evidence.nonce).toContain('gha-');
});
