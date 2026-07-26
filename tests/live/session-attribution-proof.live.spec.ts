import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AUDIO_ARGS, assertPreStartMode, selectBenchmarkMode } from './helpers/benchmark-utils';
import { HARVARD_BENCHMARK_LONG_AUDIO } from './helpers/audio-fixtures';

/**
 * #1033 / #1055 — LIVE production attribution proof.
 *
 * The merged unit + PGlite tests prove the attribution runtime and the DB contract in isolation. THIS
 * test closes the remaining gap the Product Owner identified: no existing live test asserts that the
 * DEPLOYED app writes `sessions.attribution_status`. It drives a real authenticated Pro recording
 * against production, then reads back ONLY the created row's attribution fields through the Supabase
 * service-role API (no direct DB password required) and asserts the lifecycle landed correctly.
 *
 * Safety / scope (per PO directive):
 *  - Uses the reusable PRO test account (PRO_TEST_EMAIL/PASSWORD); NEVER deletes or mutates that account.
 *  - Reads ONLY the exact created session id and the required attribution columns — no transcript text,
 *    no credentials, no unrelated rows are printed.
 *  - Legacy behaviour proven by a content-free existence COUNT of `legacy_unknown` rows.
 *  - Does NOT force an attribution failure / failed save / unverified state in production (those paths
 *    stay covered by the merged integration tests unless separately authorized fault injection is given).
 *  - Cleans up ONLY the single synthetic session this proof creates, scoped by id + owner.
 */

const BASE_URL = process.env.BASE_URL;
const PRO_EMAIL = process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL;
const PRO_PASSWORD = process.env.PRO_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// The producing engine under proof. Cloud is the Pro-representative path and returns a complete
// producer tuple, so a successful recording resolves to `verified` with a coherent identity.
const MODE = 'cloud' as const;
const TRANSCRIPT_PATTERN = /\b(stale|beer|pepper|beef|swan|park|twister|wild|puppy|quick|brown|fox)\b/i;
const MIN_SAVEABLE_RECORDING_MS = 7_000;
const SESSION_FIELDS = 'id, attribution_status, engine, engine_version, model_name, device_type, idempotency_key, user_id, created_at';

interface SessionRow {
  id: string;
  attribution_status: string;
  engine: string | null;
  engine_version: string | null;
  model_name: string | null;
  device_type: string | null;
  idempotency_key: string | null;
  user_id: string;
  created_at: string;
}

test.describe.configure({ mode: 'serial', retries: 0 });

test.use({
  permissions: ['microphone'],
  baseURL: BASE_URL,
  launchOptions: { args: [...AUDIO_ARGS, `--use-file-for-fake-audio-capture=${HARVARD_BENCHMARK_LONG_AUDIO}`] },
});

const nonBlank = (v: string | null): v is string => typeof v === 'string' && v.trim().length > 0;
const short = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;

test.describe.serial('#1033 live production attribution proof @live', () => {
  let admin: SupabaseClient;
  let proUserId: string;
  let createdSessionId: string | null = null;

  test.beforeAll(async () => {
    test.skip(
      !BASE_URL || !PRO_EMAIL || !PRO_PASSWORD || !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY,
      'Requires BASE_URL, PRO_TEST_EMAIL/PASSWORD, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.',
    );
    // Resolve the Pro owner id through the NORMAL authenticated path (never admin.listUsers).
    const anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await anon.auth.signInWithPassword({ email: PRO_EMAIL!, password: PRO_PASSWORD! });
    expect(error, 'Pro sign-in must succeed via the normal auth path').toBeFalsy();
    proUserId = data.user!.id;
    admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  });

  test.afterAll(async () => {
    // Clean up ONLY the synthetic session this proof created — scoped by id AND owner. The reusable
    // Pro account itself is never deleted or otherwise mutated.
    if (createdSessionId && admin && proUserId) {
      const { error } = await admin.from('sessions').delete().eq('id', createdSessionId).eq('user_id', proUserId);
      console.log(`LIVE_ATTRIBUTION_CLEANUP ${JSON.stringify({ deletedSessionId: short(createdSessionId), scopedToOwner: true, error: error?.message ?? null })}`);
    }
  });

  test('a successful Pro recording persists attribution_status=verified with a coherent engine tuple, no duplicate', async ({ page }) => {
    // Bound the row lookup to sessions created during this run (5s clock-skew buffer). workers=1 +
    // serial → the newest session for this owner after this instant is unambiguously the one we create.
    const runStartedIso = new Date(Date.now() - 5_000).toISOString();

    // 1) Confirm we are exercising the intended deployed release.
    await page.goto('/auth/signin');
    await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
    const release = await page.evaluate(() => (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__ ?? null);
    console.log(`LIVE_ATTRIBUTION_RELEASE ${JSON.stringify({ release })}`);

    // 2) Sign in as the reusable Pro account and drive a real recording.
    await page.getByTestId('email-input').fill(PRO_EMAIL!);
    await page.getByTestId('password-input').fill(PRO_PASSWORD!);
    await page.getByTestId('sign-in-submit').click();
    // The authenticated landing is /practice (default authed home); the recording surface is /session.
    // Wait until sign-in redirects off the auth page, then navigate to the recording surface explicitly
    // (same pattern the account-wide-recording-mutex live proof uses).
    await page.waitForURL((url) => !url.pathname.includes('/auth/signin'), { timeout: 45_000 });
    await page.goto('/session');
    await page.locator('html[data-app-visible-ready="true"]').waitFor({ timeout: 60_000 });

    await selectBenchmarkMode(page, MODE);
    await assertPreStartMode(page, MODE);

    const startStop = page.getByTestId('session-start-stop-button');
    await expect(startStop).toBeEnabled({ timeout: 90_000 });
    const tokenResponse = page.waitForResponse(
      (r) => r.url().includes('/functions/v1/assemblyai-token') && r.request().method() === 'POST',
      { timeout: 45_000 },
    );
    await startStop.click();
    const startedAt = Date.now();
    expect((await tokenResponse).status(), 'assemblyai-token must be issued for the Pro cloud recording').toBe(200);
    await expect(startStop).toHaveAttribute('data-recording', 'true', { timeout: 45_000 });

    // Wait for real fixture transcript, then satisfy the app's minimum saveable duration. The save
    // policy reads the app's OWN elapsed-time store (not Playwright's wall clock), so poll that.
    await expect(page.getByTestId('transcript-container')).toContainText(TRANSCRIPT_PATTERN, { timeout: 120_000 });
    const minSeconds = Math.ceil(MIN_SAVEABLE_RECORDING_MS / 1000);
    await page.waitForTimeout(Math.max(0, MIN_SAVEABLE_RECORDING_MS - (Date.now() - startedAt)));
    await page.waitForFunction((min) => {
      const api = (window as unknown as { __SESSION_STORE_API__?: { getState?: () => { elapsedTime?: number } } }).__SESSION_STORE_API__;
      const elapsed = api?.getState?.().elapsedTime;
      return typeof elapsed === 'number' && elapsed >= min;
    }, minSeconds, { timeout: 20_000 }).catch(() => undefined);

    await startStop.click();
    await expect(startStop).toHaveAttribute('data-recording', 'false', { timeout: 45_000 });
    await expect(page.getByTestId('status-message-text'), 'the deployed app must save the session').toContainText(/Session saved/i, { timeout: 90_000 });

    // 3) Resolve the created row directly via the service-role API (no DB password, no UI-history
    //    dependency): the newest session for this Pro owner created during this run. Poll until the
    //    app's asynchronous attribution write has resolved off `pending`.
    let row: SessionRow | null = null;
    await expect.poll(async () => {
      const { data, error } = await admin
        .from('sessions')
        .select(SESSION_FIELDS)
        .eq('user_id', proUserId)
        .gte('created_at', runStartedIso)
        .order('created_at', { ascending: false })
        .limit(1);
      expect(error, 'service-role read of the created session must succeed').toBeFalsy();
      row = (data?.[0] ?? null) as SessionRow | null;
      return row?.attribution_status ?? null;
    }, { message: 'the deployed app must resolve attribution off pending', timeout: 45_000, intervals: [1_000, 2_000, 3_000, 5_000] }).toBe('verified');
    expect(row, 'a session row created by this run must exist').not.toBeNull();
    const session: SessionRow = row!;
    createdSessionId = session.id;

    // attribution reached verified (i.e. NOT left pending) …
    expect(session.attribution_status, 'a successful recording must persist attribution_status=verified').toBe('verified');
    // … with a coherent, non-fabricated engine tuple (engine matches its own version family).
    expect(nonBlank(session.engine), 'engine must be non-blank').toBe(true);
    expect(nonBlank(session.engine_version), 'engine_version must be non-blank').toBe(true);
    expect(nonBlank(session.model_name), 'model_name must be non-blank').toBe(true);
    expect(nonBlank(session.device_type), 'device_type must be non-blank').toBe(true);
    expect(session.engine, 'cloud recording must attribute to the cloud engine').toBe('cloud');

    // exactly one row for this session id (no duplicate by identity).
    const { count: idCount } = await admin
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('id', session.id)
      .eq('user_id', proUserId);
    expect(idCount, 'exactly one row must exist for the created session id').toBe(1);

    // no duplicate for the recording idempotency identity, when present.
    let idempotencyRowCount: number | null = null;
    if (nonBlank(session.idempotency_key)) {
      const { count } = await admin
        .from('sessions')
        .select('id', { count: 'exact', head: true })
        .eq('idempotency_key', session.idempotency_key)
        .eq('user_id', proUserId);
      idempotencyRowCount = count ?? null;
      expect(count, 'the recording idempotency key must map to exactly one row').toBe(1);
    }

    // 5) Legacy behaviour is live: pre-migration rows read legacy_unknown (content-free existence count).
    const { count: legacyCount, error: legacyErr } = await admin
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('attribution_status', 'legacy_unknown');
    expect(legacyErr, 'legacy_unknown existence count must succeed').toBeFalsy();
    expect((legacyCount ?? 0) > 0, 'pre-migration rows must read legacy_unknown after backfill').toBe(true);

    console.log(`LIVE_ATTRIBUTION_EVIDENCE ${JSON.stringify({
      release,
      sessionId: short(session.id),
      attribution_status: session.attribution_status,
      engineTuple: { engine: session.engine, engine_version: session.engine_version, model_name: session.model_name, device_type: session.device_type },
      rowsForSessionId: idCount,
      rowsForIdempotencyKey: idempotencyRowCount,
      legacyUnknownExists: (legacyCount ?? 0) > 0,
    })}`);
  });
});
