/**
 * #1045 deployed Progress journey — proves the LIVE Progress loop on the deployed app against the REAL
 * backend (no mocks). Rewritten after a review finding: the prior version used
 * `verifyCredentialsAndInjectSession` → `setupE2EManifest`, which installs a MOCKED `window.supabase`
 * and an injected `__E2E_DEPS__.fetchUsageLimit`. That made `check-usage-limit` a mock, so the seeded
 * PRODUCTION Private-sample entitlement was never consumed and Private read DISABLED — a harness defect,
 * NOT a production entitlement defect. It also serialized the account's live auth session into the
 * Playwright trace.
 *
 * This version follows the sanctioned live pattern (tests/live/stt-switching-contract.live.spec.ts):
 *   - `deployedLiveTest` fixture (real deployed backend; MSW off; NO mocked supabase),
 *   - REAL UI sign-in via /auth/signin (no session injection → no token in the trace),
 *   - seed the Private sample on the MAINTAINED Free account via the service-role `user_profiles` path
 *     BEFORE sign-in (NO account creation),
 *   - PROVE a real `check-usage-limit` network response returned `private_sample_available: true` with
 *     sufficient remaining allowance,
 *   - POLL Private availability (it resolves only after the usage-limit fetch), never a single read,
 *   - ASSERT the mock surfaces (`__E2E_DEPS__`, mocked supabase) are ABSENT,
 *   - restore the shared account to a NON-entitled sample state in afterEach so a failure can never
 *     leave a live free-Private sample on the shared account.
 *
 * The Private sample is ONE-SHOT (availability flips off once a session consumes it), so the two-session
 * loop re-seeds via the same service-role path between sessions. This is a harness precondition for
 * exercising the Progress MECHANICS on the deployed app; it is not a claim about the sample business rule.
 *
 * NOTE: this spec is authored but must NOT be run until a corrected run is separately authorized.
 */
import { type Page } from '@playwright/test';
import { test, expect } from './helpers/deployedLiveTest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AUDIO_ARGS, selectBenchmarkMode, preparePrivateModelIfPrompted } from './helpers/benchmark-utils';
import { HARVARD_BENCHMARK_LONG_AUDIO } from './helpers/audio-fixtures';

const BASE_URL = process.env.BASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// MAINTAINED reusable Free account (GitHub-injected). No account is created by this spec.
const EMAIL = process.env.FREE_TEST_EMAIL ?? process.env.BASIC_TEST_EMAIL ?? '';
const PASSWORD = process.env.FREE_TEST_PASSWORD ?? process.env.BASIC_TEST_PASSWORD ?? '';
const RECORD_MS = Number(process.env.PROGRESS_RECORD_MS ?? 45_000); // long enough for an eligible clarity sample
const RECORD_SECONDS = Math.ceil(RECORD_MS / 1000);
const EXPECTED_RELEASE_SHA = (process.env.EXPECTED_RELEASE_SHA ?? '').trim();

test.describe.configure({ mode: 'serial', retries: 0 });

test.use({
  permissions: ['microphone'],
  baseURL: BASE_URL,
  viewport: { width: 1280, height: 800 },
  launchOptions: {
    // Private (Whisper) transcribes the fake-file audio directly, so recordings carry real speech
    // (non-speech would be discarded and no session would persist).
    args: [...AUDIO_ARGS, `--use-file-for-fake-audio-capture=${HARVARD_BENCHMARK_LONG_AUDIO}`],
  },
});

/** Fresh, UNUSED 5-minute Private sample on the maintained Free account (service-role; sanctioned path). */
async function seedUnusedSample(admin: SupabaseClient, uid: string): Promise<void> {
  const { error } = await admin.from('user_profiles').upsert({
    id: uid,
    subscription_status: 'free',
    private_sample_limit_seconds: 300,
    private_sample_seconds_used: 0,
    private_sample_completed_at: null,
    private_sample_session_id: null,
  }, { onConflict: 'id' });
  if (error) throw new Error(`seed sample failed: ${error.message}`);
}

/**
 * Restore the SHARED account to a NON-entitled sample state (consumed → `private_sample_available=false`)
 * so a failure or a completed run never leaves a live free-Private sample on the reusable account.
 */
async function clearSampleEntitlement(admin: SupabaseClient, uid: string): Promise<void> {
  await admin.from('user_profiles').upsert({
    id: uid,
    subscription_status: 'free',
    private_sample_limit_seconds: 300,
    private_sample_seconds_used: 300,
    private_sample_completed_at: '2024-01-01T00:05:00.000Z',
    private_sample_session_id: null,
  }, { onConflict: 'id' }).then(({ error }) => { if (error) console.warn(`[journey] clearSampleEntitlement: ${error.message}`); });
}

async function resolveUidByEmail(admin: SupabaseClient, email: string): Promise<string> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`resolveUid: ${error.message}`);
    const users = (data?.users ?? []) as Array<{ id: string; email?: string | null }>;
    const hit = users.find((u) => (u.email ?? '').toLowerCase() === target);
    if (hit) return hit.id;
    if (users.length < 200) break;
  }
  throw new Error(`resolveUid: maintained Free account not found: ${email}`);
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/auth/signin');
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(password);
  await page.getByTestId('sign-in-submit').click();
  await page.waitForURL((url) => !url.pathname.includes('/auth/signin'), { timeout: 45_000 });
  await page.goto('/session');
}

/**
 * Select Private once its entitlement gate resolves. Availability resolves only after the usage-limit
 * fetch returns, so poll — opening the menu, reading the option, then CLOSING it each attempt so the next
 * attempt's open never toggles it shut (the double-open race that broke the first corrected run). Once
 * proven enabled + closed, select via the sanctioned `selectBenchmarkMode` (opens fresh and clicks).
 */
async function selectPrivate(page: Page): Promise<void> {
  const modeSelect = page.getByTestId('stt-mode-select');
  await expect(modeSelect).toBeVisible({ timeout: 20_000 });
  await expect(async () => {
    await modeSelect.click();
    const option = page.getByTestId('stt-mode-private');
    await expect(option).toBeVisible({ timeout: 3_000 });
    const disabled = await option.evaluate((el) => {
      const h = el as HTMLElement;
      return h.getAttribute('aria-disabled') === 'true' || h.hasAttribute('disabled') || h.hasAttribute('data-disabled');
    });
    await page.keyboard.press('Escape').catch(() => undefined);
    expect(disabled, 'Private should be available after entitlement resolves').toBe(false);
  }).toPass({ timeout: 25_000, intervals: [1_000, 2_000, 3_000] });
  await selectBenchmarkMode(page, 'private');
}

async function readReleaseSha(page: Page): Promise<string> {
  const sha = await page.evaluate(() => {
    const w = window as unknown as { __APP_RELEASE__?: string; __APP_RUNTIME_CONFIG__?: { release?: string } };
    return w.__APP_RELEASE__ ?? w.__APP_RUNTIME_CONFIG__?.release ?? null;
  });
  expect(sha ?? '', `deployed release must be a 40-char SHA, got: ${sha}`).toMatch(/^[0-9a-f]{40}$/i);
  return sha as string;
}

/** Prove the page is on the REAL backend, not a mock: no injected deps, no mocked supabase client. */
async function assertNoMockSurfaces(page: Page): Promise<void> {
  const surfaces = await page.evaluate(() => {
    const w = window as unknown as { __E2E_DEPS__?: unknown; supabase?: { __isMock__?: boolean; __mock__?: boolean } };
    return {
      e2eDeps: Boolean(w.__E2E_DEPS__),
      supabaseMocked: Boolean(w.supabase && (w.supabase.__isMock__ || w.supabase.__mock__)),
    };
  });
  expect(surfaces.e2eDeps, 'mock injection __E2E_DEPS__ must be ABSENT (real backend)').toBe(false);
  expect(surfaces.supabaseMocked, 'window.supabase must NOT be a mock (real backend)').toBe(false);
}

type EntitlementBody = { private_sample_available?: boolean; private_sample_seconds_remaining?: number } & Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Records one eligible Private session and returns the EXACT id the app persisted — read from the
 * `data-session-persisted-id` forensic anchor the app stamps on save, NOT "the newest session for the
 * account" (which could be a concurrent test's row). Waits for the anchor to appear and, when a prior id
 * is given, to ADVANCE past it, so session 2 is provably distinct from session 1.
 */
async function recordEligiblePrivateSession(page: Page, previousId: string | null): Promise<string> {
  // Reload /session so the (re-)seeded entitlement is refetched fresh for THIS session, then select
  // Private once its gate resolves.
  await page.goto('/session');
  await page.waitForSelector('[data-testid="stt-mode-select"]', { timeout: 30_000 });
  await selectPrivate(page);

  // Load the Private model to start-ready (auto-loads from /models/ on the deployed origin).
  await preparePrivateModelIfPrompted(page, 180_000);

  const startStop = page.getByTestId('session-start-stop-button');
  await expect(startStop, 'record: start/stop present').toBeEnabled({ timeout: 60_000 });
  await startStop.click();
  await expect(startStop, 'record: RECORDING engaged (Private)').toHaveAttribute('data-recording', 'true', { timeout: 240_000 });
  await page.waitForTimeout(RECORD_MS);
  await startStop.click();
  await expect(startStop, 'record: finalize completes').toHaveAttribute('data-recording', 'false', { timeout: 240_000 });
  await expect(page.getByTestId('status-message-text'), 'record: session saved').toContainText(/Session saved/i, { timeout: 240_000 });

  let sessionId = '';
  await expect(async () => {
    sessionId = (await page.evaluate(() => document.documentElement.getAttribute('data-session-persisted-id'))) ?? '';
    expect(sessionId, 'app must stamp data-session-persisted-id after save').toMatch(UUID_RE);
    if (previousId) expect(sessionId, 'the persisted session id must advance for this recording').not.toBe(previousId);
  }).toPass({ timeout: 30_000, intervals: [1_000, 2_000, 3_000] });
  return sessionId;
}

test.describe.serial('#1045 deployed Progress journey @live', () => {
  let admin: SupabaseClient;
  let uid: string;
  // Capture the REAL check-usage-limit responses so we can prove the entitlement source is production.
  const entitlementBodies: EntitlementBody[] = [];

  test.beforeAll(async () => {
    test.skip(!BASE_URL, 'BASE_URL required');
    test.skip(!SUPABASE_URL || !SERVICE_ROLE || !EMAIL || !PASSWORD, 'GitHub-injected Supabase + maintained Free creds required');
    expect(EXPECTED_RELEASE_SHA, 'EXPECTED_RELEASE_SHA must be the exact reviewed 40-character product SHA')
      .toMatch(/^[0-9a-f]{40}$/);
    admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });
    uid = await resolveUidByEmail(admin, EMAIL);
  });

  // Restoration: never leave a live free-Private sample on the shared account, pass or fail.
  test.afterEach(async () => {
    if (admin && uid) await clearSampleEntitlement(admin, uid);
  });

  test('record → Progress panel → accept → next session resolves outcome', async ({ page }) => {
    test.setTimeout(15 * 60 * 1000);

    // Capture check-usage-limit response bodies for the entitlement proof (step 4).
    const isEnt = (url: string) => /usage[-_]?limit|check[-_]?usage|entitlement/i.test(url);
    const forbiddenCloudRequests: string[] = [];
    const forbiddenCloudSockets: string[] = [];
    page.on('request', (request) => {
      if (/assemblyai|cloud[-_/]?token|transcription\/token/i.test(request.url())) {
        forbiddenCloudRequests.push(request.url());
      }
    });
    page.on('websocket', (socket) => {
      if (/assemblyai|cloud|transcri/i.test(socket.url())) forbiddenCloudSockets.push(socket.url());
    });
    page.on('response', async (response) => {
      if (!isEnt(response.url())) return;
      try { entitlementBodies.push(await response.json() as EntitlementBody); } catch { /* non-JSON */ }
    });

    // ── Seed BEFORE sign-in (service-role; maintained account; no account creation) ──
    await seedUnusedSample(admin, uid);
    const { data: prof } = await admin.from('user_profiles')
      .select('private_sample_seconds_used, private_sample_completed_at, private_sample_session_id, private_sample_limit_seconds')
      .eq('id', uid).maybeSingle();
    const p = prof as Record<string, unknown> | null;
    expect(p?.private_sample_completed_at, 'preflight: sample unused (completed_at null)').toBeNull();
    expect(p?.private_sample_session_id, 'preflight: sample unused (session_id null)').toBeNull();
    expect(Number(p?.private_sample_limit_seconds) - Number(p?.private_sample_seconds_used),
      'preflight: allowance covers a session').toBeGreaterThanOrEqual(RECORD_SECONDS);

    // ── Real UI sign-in (no session injection) ──
    await signIn(page, EMAIL, PASSWORD);
    await expect(page).toHaveURL(/\/session/, { timeout: 30_000 });

    // ── Deployed SHA + no-mock proof ──
    const deployedSha = await readReleaseSha(page);
    if (EXPECTED_RELEASE_SHA) expect(deployedSha, `deployed ${deployedSha} != expected ${EXPECTED_RELEASE_SHA}`).toBe(EXPECTED_RELEASE_SHA);
    await assertNoMockSurfaces(page);
    console.log(`[journey] deployed_sha=${deployedSha} uid=${uid}`);

    // ── Entitlement proof: a REAL check-usage-limit response (fired on load) resolved the sample
    //    available. No dropdown needed — the network capture alone proves the real backend. ──
    await expect(async () => {
      expect(entitlementBodies.some((b) => b.private_sample_available === true),
        'check-usage-limit must report private_sample_available:true (real backend)').toBe(true);
    }).toPass({ timeout: 20_000, intervals: [1_000, 2_000, 3_000] });
    const withRemaining = entitlementBodies.find((b) => typeof b.private_sample_seconds_remaining === 'number');
    if (withRemaining) {
      expect(Number(withRemaining.private_sample_seconds_remaining),
        'check-usage-limit remaining allowance must cover a session').toBeGreaterThanOrEqual(RECORD_SECONDS);
    }
    console.log(`[journey] entitlement=${JSON.stringify(entitlementBodies[entitlementBodies.length - 1])}`);

    // ── Gate 1 — first eligible Private session ──
    const s1 = await recordEligiblePrivateSession(page, null);
    console.log(`[journey] session1=${s1}`);

    // ── Gate 2 — Session-review renders the Progress panel ──
    await page.goto(`/analytics/${s1}`);
    await expect(page.getByTestId('progress-panel'), 'gate 2: Progress panel renders').toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('progress-direction')).toBeVisible();
    await expect(page.getByTestId('progress-what-worked')).toBeVisible();
    await expect(page.getByTestId('progress-practice-next')).toBeVisible();
    const accept = page.getByTestId('progress-accept');
    await expect(accept, 'gate 2: Practice this next action present').toBeVisible();

    // ── Gate 3 — accept records an attempt + enters the next practice ──
    await accept.click();
    await expect(page).toHaveURL(/\/session/, { timeout: 20_000 });

    // Re-seed the one-shot sample so session 2 can also use Private (sanctioned service-role path).
    await seedUnusedSample(admin, uid);

    // ── Gate 4 — second eligible session resolves the attempt (server-derived outcome) ──
    const s2 = await recordEligiblePrivateSession(page, s1);
    expect(s2, 'session 2 must be a distinct persisted session').not.toBe(s1);
    console.log(`[journey] session2=${s2}`);

    // ── Verify persisted rows (service-role; sanitized) ──
    const { data: evalRow } = await admin.from('session_progress_evaluations')
      .select('session_id, eligible, clarity_raw, cohort_key').eq('session_id', s1).maybeSingle();
    expect((evalRow as { eligible?: boolean } | null)?.eligible, 'session 1 evaluation must be eligible').toBe(true);
    const { data: rec } = await admin.from('progress_recommendations')
      .select('id, target_metric, source_metric_value').eq('source_session_id', s1).maybeSingle();
    const recId = (rec as { id?: string } | null)?.id;
    expect(recId, 'recommendation persisted for session 1').toBeTruthy();

    let attempt: {
      lifecycle: string;
      outcome: string | null;
      practice_session_id: string | null;
      next_comparable_session_id: string | null;
    } | null = null;
    for (let i = 0; i < 12 && !attempt; i++) {
      const { data } = await admin.from('progress_recommendation_attempts')
        .select('lifecycle, outcome, practice_session_id, next_comparable_session_id, accepted_at, recommendation_id')
        .eq('recommendation_id', recId!).order('accepted_at', { ascending: false }).limit(1);
      const row = data?.[0] as typeof attempt | undefined;
      if (row && row.lifecycle !== 'pending') attempt = row;
      else await page.waitForTimeout(3_000);
    }
    console.log(`[journey] evaluation=eligible recommendation=${recId} attempt=${JSON.stringify(attempt)}`);
    expect(attempt, 'gate 4: attempt resolved to a terminal lifecycle').not.toBeNull();
    expect(['completed', 'not_comparable']).toContain(attempt!.lifecycle);
    expect(['moved', 'did_not_move', 'not_comparable']).toContain(attempt!.outcome);
    expect(attempt!.practice_session_id, 'attempt must bind the exact distinct saved successor').toBe(s2);
    expect(attempt!.practice_session_id).not.toBe(s1);
    if (attempt!.lifecycle === 'completed') {
      expect(attempt!.next_comparable_session_id, 'completed comparison must use that same successor').toBe(s2);
    }
    expect(forbiddenCloudRequests, 'Private U3 journey must make zero Cloud token/provider requests').toEqual([]);
    expect(forbiddenCloudSockets, 'Private U3 journey must open zero Cloud/provider WebSockets').toEqual([]);
    console.log(`[journey] zero_cloud=${JSON.stringify({ requests: forbiddenCloudRequests.length, websockets: forbiddenCloudSockets.length })}`);
  });
});
