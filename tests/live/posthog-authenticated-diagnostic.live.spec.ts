import { test, expect } from './helpers/deployedLiveTest';

/**
 * CONTENT-FREE authenticated PostHog diagnostic — REFINED (incident root cause).
 *
 * No window.posthog (the app is module-scoped). Uses the app's own sanitized probes
 * (__SS_ANALYTICS_IDENTITY__, __SS_PRIVATE_SAMPLE_EVENTS__) to prove the PRODUCT invoked capture,
 * and separates CAPTURE endpoints (/e/, /i/v0/e/, /batch/) from CONFIG endpoints (/flags, /decide)
 * so a 200 on /flags is never mistaken for capture evidence. Produces an independent boundary table
 * per path. Then queries the PostHog Query API (Node side, protected key) by event name + bounded
 * window to see which landed. NO audio, NO saved session, NO report.
 *
 * CLASSIFICATION (corrected per independent review): account_identified is a DIRECT / send_instantly
 * capture — AnalyticsBuffer.identify() bypasses the queue and calls posthog.capture(..., {
 * send_instantly: true }); it is NOT a buffered event. private_sample_selected is also direct via
 * emitPrivateSample(). Classification C (product invoked capture → NO capture request emitted →
 * absent from project 207400) is PROVEN for these DIRECT paths. The BUFFERED session_saved path
 * (AnalyticsBuffer.push → scheduleFlush → send → capture) is NOT proven here and remains OPEN — it
 * needs the dedicated buffer send-boundary probe. The "buffered UI event" observation below only
 * evidences /flags|/decide activity and does NOT prove a buffered capture attempt.
 */

const EMAIL = process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL;
const PASSWORD = process.env.PRO_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD;
const NONCE = `gha-${process.env.GITHUB_RUN_ID ?? 'local'}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`;
const PH_KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const PH_PROJECT = process.env.POSTHOG_PROJECT_ID;
const PH_API = (process.env.POSTHOG_API_HOST ?? 'https://us.posthog.com').replace(/\/$/, '');

function h(s: string | null | undefined): string | null {
  if (!s) return null;
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0;
  return 'h' + x.toString(16);
}

type Req = { kind: 'capture' | 'config' | 'other'; path: string; method: string; status: number | null; failure: string | null; at: number };

function classify(path: string): Req['kind'] {
  if (/\/(e|batch)\/?$|\/i\/v0\/e/i.test(path)) return 'capture';
  if (/\/(flags|decide)\/?/i.test(path)) return 'config';
  return 'other';
}

async function queryPostHog(events: string[], sinceIso: string, distinctId: string | null) {
  if (!PH_KEY || !PH_PROJECT) return { runnable: false };
  const evList = events.map((e) => `'${e}'`).join(',');
  const sql = `SELECT event, count() AS n, max(timestamp) AS last FROM events WHERE event IN (${evList}) AND timestamp >= '${sinceIso}' ${distinctId ? `AND distinct_id = '${distinctId}'` : ''} GROUP BY event`;
  const res = await fetch(`${PH_API}/api/projects/${encodeURIComponent(PH_PROJECT)}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PH_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query: sql } }),
  });
  const ok = res.ok;
  const body = ok ? await res.json().catch(() => null) : null;
  // body.results = [[event, n, last], ...] — event names + counts only (no PII).
  const found: Record<string, number> = {};
  for (const row of (body?.results ?? [])) found[String(row[0])] = Number(row[1]);
  return { runnable: true, status: res.status, found };
}

test('content-free authenticated PostHog diagnostic (refined; no recording, no report)', async ({ page }) => {
  test.setTimeout(150_000);
  if (!EMAIL || !PASSWORD) throw new Error('POSTHOG_DIAG_NOT_RUNNABLE: PRO_TEST_EMAIL/PRO_TEST_PASSWORD required');

  const reqs: Req[] = [];
  const record = (path: string, method: string, status: number | null, failure: string | null) => {
    reqs.push({ kind: classify(path), path: path.replace(/\?.*$/, ''), method, status, failure, at: Date.now() });
  };
  page.on('request', (r) => { if (/posthog\.com/i.test(r.url())) { try { record(new URL(r.url()).pathname, r.method(), null, null); } catch { /* ignore */ } } });
  page.on('requestfailed', (r) => { if (/posthog\.com/i.test(r.url())) { const last = reqs[reqs.length - 1]; if (last && last.status === null) last.failure = r.failure()?.errorText ?? 'failed'; } });
  page.on('response', (r) => { if (/posthog\.com/i.test(r.url())) { const last = reqs.slice().reverse().find((x) => x.status === null && x.path === new URL(r.url()).pathname.replace(/\?.*$/, '')); if (last) last.status = r.status(); } });

  const captureStats = (sinceAt: number) => {
    const win = reqs.filter((x) => x.at >= sinceAt);
    const cap = win.filter((x) => x.kind === 'capture');
    const cfg = win.filter((x) => x.kind === 'config');
    return {
      capture_requests: cap.length,
      capture_statuses: cap.map((x) => x.status),
      capture_failures: cap.map((x) => x.failure).filter(Boolean),
      config_requests: cfg.length,
      config_statuses: cfg.map((x) => x.status),
    };
  };

  const readProbes = () => page.evaluate(() => {
    const w = window as unknown as {
      __SS_ANALYTICS_IDENTITY__?: { identifyCalls?: number; accountIdentifiedAttempts?: number; accountIdentifiedSendInstantly?: boolean; lastAccountIdentifiedError?: string | null };
      __SS_PRIVATE_SAMPLE_EVENTS__?: Array<{ event: string }>;
      __APP_RUNTIME_CONFIG__?: { release?: string };
    };
    // opt-out marker: report key names + a best-effort classification, never raw values.
    const optKeys: string[] = [];
    let optedOut: boolean | 'unknown' = 'unknown';
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        if (/opt_in_out|opt-out|posthog/i.test(k)) {
          optKeys.push(k.replace(/phc_[A-Za-z0-9]+/,'phc_***'));
          if (/opt_in_out/i.test(k)) { const v = localStorage.getItem(k); optedOut = v === '0'; }
        }
      }
    } catch { /* ignore */ }
    return {
      identity: w.__SS_ANALYTICS_IDENTITY__ ?? null,
      privateEvents: (w.__SS_PRIVATE_SAMPLE_EVENTS__ ?? []).map((e) => e.event),
      release: w.__APP_RUNTIME_CONFIG__?.release ?? null,
      optOutKeys: optKeys,
      optedOut,
    };
  });

  // ---- B. sign in ----
  await page.goto('/auth/signin');
  await page.waitForSelector('[data-testid="auth-form"]', { timeout: 20_000 });
  await page.getByTestId('email-input').fill(EMAIL);
  await page.getByTestId('password-input').fill(PASSWORD);
  const loginResp = page.waitForResponse((r) => r.url().includes('/auth/v1/token') && r.request().method() === 'POST', { timeout: 30_000 });
  const tLogin = Date.now();
  await page.getByTestId('sign-in-submit').click();
  const authenticated = (await loginResp).ok();

  // ---- C/D. land authenticated → identity probe + account_identified boundary ----
  await page.goto('/session');
  await page.locator('html[data-app-visible-ready="true"]').waitFor({ timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const afterAuth = await readProbes();
  const accountIdentifiedBoundary = { product_invoked: (afterAuth.identity?.accountIdentifiedAttempts ?? 0) >= 1, ...captureStats(tLogin) };

  // ---- E/F/G. Select Private (no recording) → private_sample_selected (direct path) ----
  const tPrivate = Date.now();
  await page.getByTestId('stt-mode-select').click().catch(() => {});
  await page.getByTestId('stt-mode-private').click().catch(() => {});
  await page.waitForTimeout(3000);
  const afterPrivate = await readProbes();
  const privateSelectedBoundary = { product_invoked: afterPrivate.privateEvents.includes('private_sample_selected'), ...captureStats(tPrivate) };

  // ---- H. navigate to /analytics (no recording). NOTE: this only evidences /flags|/decide activity;
  // it does NOT exercise AnalyticsBuffer.push → scheduleFlush → send → capture, so it does NOT prove
  // the buffered path. The buffered session_saved cause stays OPEN until a dedicated buffer probe. ----
  const tNav = Date.now();
  await page.goto('/analytics');
  await page.waitForTimeout(3000);
  const navigationConfigOnly = { note: 'config-only; NOT a buffered capture proof', ...captureStats(tNav) };

  // ---- J. query PostHog (Node side, protected key) ----
  const sinceIso = new Date(tLogin - 60_000).toISOString().replace('T', ' ').replace('Z', '');
  const distinctRaw = await page.evaluate(() => {
    const w = window as unknown as { __SS_ANALYTICS_IDENTITY__?: Record<string, unknown> };
    return (w.__SS_ANALYTICS_IDENTITY__ as { distinctId?: string })?.distinctId ?? null;
  }).catch(() => null);
  const phQuery = await queryPostHog(
    ['account_identified', 'private_sample_selected', 'session_live_coaching_card_viewed', 'conversion_cta_viewed'],
    sinceIso, distinctRaw,
  );

  const evidence = {
    nonce: NONCE, release_sha: afterAuth.release, deployed_sha: afterAuth.release,
    provenance: { data_origin: 'automated_test', cohort_id: 'internal_diagnostics', test_run_id: NONCE, test_suite: 'posthog_authenticated_diagnostic', environment: 'production', content_free: true },
    authenticated,
    identity_probe: {
      identifyCalls: afterAuth.identity?.identifyCalls ?? null,
      accountIdentifiedAttempts: afterAuth.identity?.accountIdentifiedAttempts ?? null,
      accountIdentifiedSendInstantly: afterAuth.identity?.accountIdentifiedSendInstantly ?? null,
      lastAccountIdentifiedError: afterAuth.identity?.lastAccountIdentifiedError ?? null,
    },
    opt_out: { keys: afterPrivate.optOutKeys, opted_out: afterPrivate.optedOut },
    distinct_hash: h(distinctRaw),
    boundaries: {
      account_identified: accountIdentifiedBoundary,
      private_sample_selected: privateSelectedBoundary,
      // NOT a buffered-capture boundary — /analytics nav only touches config endpoints. Buffered
      // session_saved cause stays OPEN; see header note.
      analytics_nav_config_only: navigationConfigOnly,
    },
    posthog_query: phQuery,
  };
  console.log(`POSTHOG_DIAG_EVIDENCE ${JSON.stringify(evidence)}`);

  expect(authenticated, 'diagnostic account must authenticate').toBeTruthy();
});
