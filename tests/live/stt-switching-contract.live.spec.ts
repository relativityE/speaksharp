import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFile } from 'fs/promises';
import * as path from 'path';
import {
  AUDIO_ARGS,
  assertPreStartMode,
  collectBenchmarkPreconditionSnapshot,
  preparePrivateModelIfPrompted,
  selectBenchmarkMode,
} from './helpers/benchmark-utils';
import { HARVARD_BENCHMARK_LONG_AUDIO } from './helpers/audio-fixtures';

const BASE_URL = process.env.BASE_URL;
const E2E_PRO_EMAIL = process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL;
const E2E_PRO_PASSWORD = process.env.PRO_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RUN_ID = Date.now();
const LIVE_TEST_PASSWORD = `SpeakSharp-Live-${RUN_ID}!`;

const TRANSCRIPT_PATTERN = /\b(stale|beer|pepper|beef|swan|park|twister|wild|puppy|quick|brown|fox)\b/i;
const PLACEHOLDER_TRANSCRIPT_PATTERN = /\b(words appear here|listening)\b/i;
const MIN_SAVEABLE_RECORDING_MS = 7_000;

// Self-hosted Whisper model assets (Git-LFS, served from our own origin under /models/). C3 serves
// these straight from local disk so the metadata-separation contract exercises the REAL engine and
// REAL saved-session metadata WITHOUT the 180MB network download — the proven flake trigger. The
// real network download path is proven separately in tests/live/private-cache.live.spec.ts.
const LOCAL_MODELS_DIR = path.resolve(process.cwd(), 'frontend/public/models');
const MODEL_CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.onnx': 'application/octet-stream',
  '.onnx_data': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
};

type SttMode = 'native' | 'cloud' | 'private';
type CreatedUser = { id: string; email: string };

type SessionRow = {
  id: string;
  created_at: string;
  engine: string | null;
  status: string | null;
  transcript: string | null;
  duration: number | null;
  model_name: string | null;
  engine_version: string | null;
  device_type: string | null;
};

type RuntimeDiag = {
  consoleErrors: string[];
  pageErrors: string[];
  closed: boolean;
  crashed: boolean;
};

const runtimeDiagByPage = new WeakMap<Page, RuntimeDiag>();

test.describe.configure({ mode: 'serial', retries: 0 });

test.use({
  permissions: ['microphone'],
  baseURL: BASE_URL,
  launchOptions: {
    args: [
      ...AUDIO_ARGS,
      '--disable-gpu',
      '--disable-webgpu',
      `--use-file-for-fake-audio-capture=${HARVARD_BENCHMARK_LONG_AUDIO}`,
    ],
  },
});

test.describe.serial('Live STT switching contract @live', () => {
  let admin: SupabaseClient;
  const createdUsers: CreatedUser[] = [];

  test.beforeAll(() => {
    test.skip(!BASE_URL, 'BASE_URL is required.');
    test.skip(!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY, 'Supabase service role is required for session metadata readback.');
    admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  test.afterAll(async () => {
    await Promise.allSettled(
      createdUsers.map((user) => admin.auth.admin.deleteUser(user.id))
    );
  });

  test.afterEach(async ({ page }) => {
    await stopRecordingIfNeeded(page);
  });

  // Post-#85 Free-user entitlement contract (private_sample_entitlement):
  //   Free + unused sample  → Private ENABLED,  Cloud disabled
  //   Free + exhausted sample → Private DISABLED, Cloud disabled
  // (check_usage_limit: private_sample_available = tier<>'pro' AND completed_at IS NULL
  //  AND used < limit AND session_id IS NULL.)
  test('Free user with an UNUSED Private sample: Private enabled, Cloud disabled', async ({ page }) => {
    const freeSampleUser = await createLiveUser(admin, `stt-switching-free-sample-${RUN_ID}@example.com`, {
      subscription_status: 'free',
      trial_started_at: '2024-01-01T00:00:00.000Z',
      trial_expires_at: '2024-01-01T01:00:00.000Z',
      daily_usage_seconds: 0,
      native_usage_seconds: 0,
      cloud_usage_seconds: 0,
      // Unused 5-min Private sample → private_sample_available = true.
      private_sample_limit_seconds: 300,
      private_sample_seconds_used: 0,
      private_sample_completed_at: null,
      private_sample_session_id: null,
      stripe_subscription_id: null,
      subscription_id: null,
    });
    createdUsers.push(freeSampleUser);

    await signIn(page, freeSampleUser.email, LIVE_TEST_PASSWORD);
    await expect(page).toHaveURL(/\/session/, { timeout: 30_000 });
    await expect(page.getByTestId('pro-badge')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('nav-upgrade-button')).not.toBeVisible({ timeout: 10_000 });

    const modeSelect = page.getByTestId('stt-mode-select');
    await expect(modeSelect).toBeVisible({ timeout: 20_000 });
    await expect(modeSelect).toHaveAttribute('data-state', 'native', { timeout: 20_000 });

    await modeSelect.click();
    await expect(page.getByTestId('stt-mode-native')).toBeVisible({ timeout: 10_000 });
    // The sample makes Private available; the gate resolves after the usage-limit fetch, so poll.
    await expectModeEnabled(page, 'private');
    // Cloud is always Pro-only → disabled for Free.
    await expectProModeDisabled(page, 'cloud');
    await page.keyboard.press('Escape');

    const snapshot = await collectBenchmarkPreconditionSnapshot(page, 'free-unused-sample-contract');
    console.log(`LIVE_STT_SWITCHING_FREE_SAMPLE_ENABLED_EVIDENCE ${JSON.stringify({
      selectedMode: snapshot.ui?.modeSelectState,
      proBadgeVisible: false,
      privateModeDisabled: false,
      cloudModeDisabled: true,
      runtimeState: snapshot.root?.runtimeState,
    })}`);
  });

  test('Free user with an EXHAUSTED Private sample: Private disabled, Cloud disabled', async ({ page }) => {
    const exhaustedSampleUser = await createLiveUser(admin, `stt-switching-free-exhausted-${RUN_ID}@example.com`, {
      subscription_status: 'free',
      trial_started_at: '2024-01-01T00:00:00.000Z',
      trial_expires_at: '2024-01-01T01:00:00.000Z',
      daily_usage_seconds: 0,
      native_usage_seconds: 0,
      cloud_usage_seconds: 0,
      // Sample consumed: used == limit AND completed_at set → private_sample_available = false.
      private_sample_limit_seconds: 300,
      private_sample_seconds_used: 300,
      private_sample_completed_at: '2024-01-01T00:05:00.000Z',
      private_sample_session_id: null,
      stripe_subscription_id: null,
      subscription_id: null,
    });
    createdUsers.push(exhaustedSampleUser);

    await signIn(page, exhaustedSampleUser.email, LIVE_TEST_PASSWORD);
    await expect(page).toHaveURL(/\/session/, { timeout: 30_000 });
    await expect(page.getByTestId('pro-badge')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('nav-upgrade-button')).not.toBeVisible({ timeout: 10_000 });

    const modeSelect = page.getByTestId('stt-mode-select');
    await expect(modeSelect).toBeVisible({ timeout: 20_000 });
    await expect(modeSelect).toHaveAttribute('data-state', 'native', { timeout: 20_000 });

    await modeSelect.click();
    await expect(page.getByTestId('stt-mode-native')).toBeVisible({ timeout: 10_000 });
    // Sample is spent → Private locks again for Free; Cloud stays Pro-only.
    await expectModeDisabledEventually(page, 'private');
    await expectProModeDisabled(page, 'cloud');
    await page.keyboard.press('Escape');

    const snapshot = await collectBenchmarkPreconditionSnapshot(page, 'free-exhausted-sample-contract');
    console.log(`LIVE_STT_SWITCHING_FREE_SAMPLE_EXHAUSTED_EVIDENCE ${JSON.stringify({
      selectedMode: snapshot.ui?.modeSelectState,
      proBadgeVisible: false,
      privateModeDisabled: true,
      cloudModeDisabled: true,
      runtimeState: snapshot.root?.runtimeState,
    })}`);
  });

  // Pro contracts split out of the former all-in-one :169 test. Each proves ONE thing so a
  // `page closed during wait` failure is actionable instead of un-triageable. serviceWorkers:'block'
  // is required by C3 so its /models/** route interception isn't shadowed by frontend/public/sw.js;
  // it is harmless for C1/C2 (sw.js only mediates model caching, never app delivery).
  test.describe('Pro STT switching contracts', () => {
    test.use({ serviceWorkers: 'block' });

    test.afterEach(async ({ page }, testInfo) => {
      if (testInfo.status !== testInfo.expectedStatus) {
        await attachCloseDiagnostics(page, testInfo).catch(() => undefined);
      }
    });

    test('Pro idle switching across Cloud, Native, and Private is available', async ({ page }) => {
      test.skip(!E2E_PRO_EMAIL || !E2E_PRO_PASSWORD, 'Pro test credentials are required.');
      test.setTimeout(120_000);
      installRuntimeDiagnostics(page);

      await signIn(page, E2E_PRO_EMAIL!, E2E_PRO_PASSWORD!);
      await expect(page).toHaveURL(/\/session/, { timeout: 30_000 });
      await expect(page.getByTestId('pro-badge')).toBeVisible({ timeout: 20_000 });

      await assertIdleModeSwitch(page, 'cloud');
      await assertIdleModeSwitch(page, 'native');
      // Private availability does not require the model to be downloaded here — that is C0
      // (private-cache.live.spec.ts). Allow the download-required state.
      await assertIdleModeSwitch(page, 'private', { allowDownloadRequired: true });

      console.log(`LIVE_STT_SWITCHING_IDLE_AVAILABILITY_EVIDENCE ${JSON.stringify({
        idleSwitching: ['cloud', 'native', 'private'],
      })}`);
    });

    test('Pro cannot switch STT mode while a Cloud recording is active', async ({ page }) => {
      test.skip(!E2E_PRO_EMAIL || !E2E_PRO_PASSWORD, 'Pro test credentials are required.');
      test.setTimeout(180_000);
      installRuntimeDiagnostics(page);

      await signIn(page, E2E_PRO_EMAIL!, E2E_PRO_PASSWORD!);
      await expect(page).toHaveURL(/\/session/, { timeout: 30_000 });
      await expect(page.getByTestId('pro-badge')).toBeVisible({ timeout: 20_000 });

      await selectBenchmarkMode(page, 'cloud');
      await assertPreStartMode(page, 'cloud');
      // recordCloudSession asserts the mode-select stays locked while data-recording === 'true'.
      await recordCloudSession(page, { assertSwitchLock: true });
    });

    test('Cloud and Private saved sessions persist separate engine metadata', async ({ page }) => {
      test.skip(!E2E_PRO_EMAIL || !E2E_PRO_PASSWORD, 'Pro test credentials are required.');
      test.setTimeout(300_000);
      installRuntimeDiagnostics(page);

      // Lighter Private path: fulfill the /models/ fetch with the APP-SHIPPED model bytes
      // (frontend/public/models/whisper-base.en, the same assets the app hosts at {origin}/models/),
      // fed into the REAL engine load path. This does NOT reuse browser Cache Storage/IndexedDB from a
      // prior download (Playwright gives each test a fresh context anyway) — the real first-run
      // download + browser-cache path is proven separately by private-cache.live.spec.ts. The
      // served/missed counters are logged so the live run self-reports whether interception fired
      // (if `missed` is non-empty, the model still hit the network and the SW block / glob needs a fix).
      const modelRouting = await routeServeLocalModelBytes(page);

      await page.addInitScript(() => {
        window.__E2E_CONTEXT__ = true;
        window.REAL_WHISPER_TEST = true;
        window.__FORCE_TRANSFORMERS_JS__ = true;
        window.__STT_LOAD_TIMEOUT__ = 180000;
      });

      page.on('console', (message) => {
        const text = message.text();
        if (/CloudAssemblyAI|assemblyai-token|PrivateWhisper|TransformersJS|ModelManager|SpeechRuntime|transcript/i.test(text)) {
          console.log(`[browser:${message.type()}] ${text}`);
        }
      });

      await signIn(page, E2E_PRO_EMAIL!, E2E_PRO_PASSWORD!);
      await expect(page).toHaveURL(/\/session/, { timeout: 30_000 });
      await expect(page.getByTestId('pro-badge')).toBeVisible({ timeout: 20_000 });
      const userId = await getSignedInUserId(page);
      const startedAt = new Date().toISOString();

      // Cloud session first (no model needed) and fully completed BEFORE Private setup begins, so the
      // model load can never race a Cloud save in the same tab (the documented :169 page-death cause).
      await selectBenchmarkMode(page, 'cloud');
      await assertPreStartMode(page, 'cloud');
      const cloudTranscript = await recordCloudSession(page, { assertSwitchLock: false });
      const cloudSessions = await waitForCompletedSession(admin, userId, startedAt, 'cloud');

      // Private session second, on the locally-served model (real engine, no network download).
      await selectBenchmarkMode(page, 'private');
      await preparePrivateModelIfNeeded(page);
      await assertPreStartMode(page, 'private');
      const privateTranscript = await recordPrivateSession(page);
      const privateSessions = await waitForCompletedSession(admin, userId, startedAt, 'private');

      const evidence = {
        privateModelAssetsServedFromLocal: modelRouting.served.length,
        privateModelAssetsMissedLocal: modelRouting.missed,
        cloud: summarizeSessionEvidence(cloudSessions[0], cloudTranscript),
        private: summarizeSessionEvidence(privateSessions[0], privateTranscript),
        distinctSessionIds: cloudSessions[0]?.id !== privateSessions[0]?.id,
      };
      console.log(`LIVE_STT_SWITCHING_METADATA_SEPARATION_EVIDENCE ${JSON.stringify(evidence)}`);

      expect(evidence.distinctSessionIds, JSON.stringify(evidence)).toBe(true);
      expect(cloudSessions[0]?.engine, JSON.stringify(evidence)).toBe('cloud');
      expect(privateSessions[0]?.engine, JSON.stringify(evidence)).toBe('private');
      // Metadata correctness: the saved Private session carries a resolved durable engine_version arm
      // (private_v2:<model> / private_v4:<model>), not the unresolved 'transformers-js' default.
      expect(privateSessions[0]?.engine_version, JSON.stringify(evidence)).toMatch(/^private_v(2|4):/);
    });
  });
});

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/auth/signin');
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(password);
  await page.getByTestId('sign-in-submit').click();
}

async function createLiveUser(
  admin: SupabaseClient,
  email: string,
  profile: Record<string, unknown>
): Promise<CreatedUser> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: LIVE_TEST_PASSWORD,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw new Error(`Failed to create ${email}: ${error?.message ?? 'no user returned'}`);
  }

  const { error: profileError } = await admin.from('user_profiles').upsert({
    id: data.user.id,
    ...profile,
  }, { onConflict: 'id' });

  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
    throw new Error(`Failed to seed profile for ${email}: ${profileError.message}`);
  }

  return { id: data.user.id, email };
}

// Serve the committed self-hosted /models/ bytes from local disk. Returns live-updating served/missed
// asset lists so the test can prove (in its evidence log) that the Private model was satisfied from
// local disk and never hit the network. Requires the enclosing describe to set serviceWorkers:'block'
// — otherwise frontend/public/sw.js intercepts the fetch first and this route never fires.
async function routeServeLocalModelBytes(page: Page) {
  const served: string[] = [];
  const missed: string[] = [];

  await page.route('**/models/**', async (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^.*\/models\//, '');
    const filePath = path.join(LOCAL_MODELS_DIR, rel);

    // Refuse to serve anything resolving outside the models dir, and fall through to the real
    // origin for any asset we do not have cached locally (keeps the test correct if the model
    // layout changes) — recording the miss so it surfaces in diagnostics.
    if (!filePath.startsWith(LOCAL_MODELS_DIR + path.sep)) {
      missed.push(rel);
      await route.continue();
      return;
    }

    try {
      const body = await readFile(filePath);
      served.push(rel);
      await route.fulfill({
        status: 200,
        contentType: MODEL_CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
        headers: {
          'cache-control': 'no-store',
          // The app is cross-origin isolated (COEP require-corp); fulfilled sub-resources need a CORP
          // header or they are blocked from the worker context.
          'cross-origin-resource-policy': 'cross-origin',
        },
        body,
      });
    } catch {
      missed.push(rel);
      await route.continue();
    }
  });

  return { served, missed };
}

function installRuntimeDiagnostics(page: Page): RuntimeDiag {
  const diag: RuntimeDiag = { consoleErrors: [], pageErrors: [], closed: false, crashed: false };
  runtimeDiagByPage.set(page, diag);
  page.on('console', (m) => {
    if (m.type() === 'error') diag.consoleErrors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => diag.pageErrors.push(e.message.slice(0, 300)));
  page.on('crash', () => { diag.crashed = true; });
  page.on('close', () => { diag.closed = true; });
  return diag;
}

// Close diagnostics (refactor step 4): on failure, capture last mode, last telemetry events, console
// errors, and runtime/model state so a `page closed during wait` failure is actionable. Trace/video
// are already retained by playwright.live.config.ts (trace/screenshot/video: 'on').
async function attachCloseDiagnostics(page: Page, testInfo: TestInfo) {
  const diag = runtimeDiagByPage.get(page);
  let snapshot: Awaited<ReturnType<typeof collectBenchmarkPreconditionSnapshot>> | { error: string } | null = null;
  let lastTelemetryEvents: unknown = null;

  if (!page.isClosed()) {
    snapshot = await collectBenchmarkPreconditionSnapshot(page, `close-diagnostics-${testInfo.title}`)
      .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    lastTelemetryEvents = await page.evaluate(() => {
      const w = window as unknown as { __SS_PRIVATE_SAMPLE_EVENTS__?: Array<Record<string, unknown>> };
      return (w.__SS_PRIVATE_SAMPLE_EVENTS__ ?? []).slice(-5);
    }).catch(() => null);
  }

  const snapshotRoot = snapshot && 'root' in snapshot ? snapshot.root : undefined;
  const snapshotUi = snapshot && 'ui' in snapshot ? snapshot.ui : undefined;
  const payload = {
    title: testInfo.title,
    status: testInfo.status,
    pageClosed: diag?.closed ?? page.isClosed(),
    pageCrashed: diag?.crashed ?? false,
    lastModeState: snapshotUi?.modeSelectState ?? null,
    runtimeState: snapshotRoot?.runtimeState ?? null,
    modelStatus: snapshotRoot?.modelStatus ?? null,
    consoleErrors: diag?.consoleErrors ?? [],
    pageErrors: diag?.pageErrors ?? [],
    lastTelemetryEvents,
    snapshot,
  };

  await testInfo.attach('stt-switching-close-diagnostics.json', {
    body: JSON.stringify(payload, null, 2),
    contentType: 'application/json',
  });
  console.log(`LIVE_STT_SWITCHING_CLOSE_DIAGNOSTICS ${JSON.stringify({
    title: payload.title,
    status: payload.status,
    pageClosed: payload.pageClosed,
    pageCrashed: payload.pageCrashed,
    consoleErrorCount: payload.consoleErrors.length,
    lastModeState: payload.lastModeState,
    runtimeState: payload.runtimeState,
    modelStatus: payload.modelStatus,
  })}`);
}

async function isModeDisabled(page: Page, mode: 'private' | 'cloud') {
  const option = page.getByTestId(`stt-mode-${mode}`);
  await expect(option).toBeVisible({ timeout: 10_000 });
  const disabled = await option.evaluate((element) => {
    const htmlElement = element as HTMLElement;
    return (
      htmlElement.getAttribute('aria-disabled') === 'true' ||
      htmlElement.hasAttribute('disabled') ||
      htmlElement.hasAttribute('data-disabled')
    );
  });
  return disabled;
}

async function expectProModeDisabled(page: Page, mode: 'private' | 'cloud') {
  const disabled = await isModeDisabled(page, mode);
  expect(disabled, `${mode} should be unavailable for Free users`).toBe(true);
}

// The mode-availability gate (canUsePrivateStt / canUseCloudStt) resolves only after the
// usage-limit fetch returns, so poll rather than read the disabled state once.
async function expectModeEnabled(page: Page, mode: 'private' | 'cloud') {
  await expect(async () => {
    expect(await isModeDisabled(page, mode), `${mode} should be available`).toBe(false);
  }).toPass({ timeout: 20_000, intervals: [500, 1_000, 2_000] });
}

async function expectModeDisabledEventually(page: Page, mode: 'private' | 'cloud') {
  await expect(async () => {
    expect(await isModeDisabled(page, mode), `${mode} should be unavailable`).toBe(true);
  }).toPass({ timeout: 20_000, intervals: [500, 1_000, 2_000] });
}

async function assertIdleModeSwitch(page: Page, mode: SttMode, options: { allowDownloadRequired?: boolean } = {}) {
  await selectBenchmarkMode(page, mode);
  const snapshot = await collectBenchmarkPreconditionSnapshot(page, `idle-switch-${mode}`);
  expect(snapshot.ui?.modeSelectState, JSON.stringify(snapshot)).toBe(mode);
  expect(snapshot.ui?.startButtonRecording, JSON.stringify(snapshot)).not.toBe('true');

  if (!options.allowDownloadRequired) {
    expect(snapshot.root?.runtimeState, JSON.stringify(snapshot)).toMatch(/READY|IDLE/);
  }

  console.log(`LIVE_STT_IDLE_SWITCH_EVIDENCE ${JSON.stringify({
    mode,
    runtimeState: snapshot.root?.runtimeState,
    modelStatus: snapshot.root?.modelStatus,
    sttReady: snapshot.root?.sttReady,
  })}`);
}

// Bridges to the shared benchmark helper so the Private model reaches start-ready. Fed by the
// locally-served model bytes in C3, so this resolves from disk rather than a 180MB network download.
async function preparePrivateModelIfNeeded(page: Page) {
  await preparePrivateModelIfPrompted(page, 180_000);
}

async function recordCloudSession(page: Page, options: { assertSwitchLock: boolean }) {
  const startStopButton = page.getByTestId('session-start-stop-button');
  await expect(startStopButton).toBeEnabled({ timeout: 60_000 });

  const tokenResponsePromise = page.waitForResponse((response) =>
    response.url().includes('/functions/v1/assemblyai-token') &&
    response.request().method() === 'POST'
  );

  await startStopButton.click();
  const tokenResponse = await tokenResponsePromise;
  expect(tokenResponse.status(), `assemblyai-token response: ${await tokenResponse.text().catch(() => '')}`).toBe(200);
  await expect(startStopButton).toHaveAttribute('data-recording', 'true', { timeout: 45_000 });
  const recordingStartedAt = Date.now();

  if (options.assertSwitchLock) {
    await assertModeSwitchBlockedWhileRecording(page, 'cloud');
  }
  const transcript = await waitForFixtureTranscript(page, 'cloud', 120_000);
  await waitForSaveableRecordingDuration(page, recordingStartedAt);
  await startStopButton.click();
  await expect(startStopButton).toHaveAttribute('data-recording', 'false', { timeout: 45_000 });
  await expect(page.getByTestId('status-message-text')).toContainText(/Session saved/i, { timeout: 45_000 });
  await waitForRecordingSettled(page);
  return transcript;
}

async function recordPrivateSession(page: Page) {
  const startStopButton = page.getByTestId('session-start-stop-button');
  await expect(startStopButton).toBeEnabled({ timeout: 90_000 });
  await startStopButton.click();
  await expect(startStopButton).toHaveAttribute('data-recording', 'true', { timeout: 45_000 });
  const recordingStartedAt = Date.now();
  const transcript = await waitForFixtureTranscript(page, 'private', 120_000);
  await waitForSaveableRecordingDuration(page, recordingStartedAt);
  await startStopButton.click();
  await expect(startStopButton).toHaveAttribute('data-recording', 'false', { timeout: 45_000 });
  await expect(page.getByTestId('status-message-text')).toContainText(/Session saved/i, { timeout: 45_000 });
  await waitForRecordingSettled(page);
  return transcript;
}

async function assertModeSwitchBlockedWhileRecording(page: Page, activeMode: SttMode) {
  const modeSelect = page.getByTestId('stt-mode-select');
  const before = await modeSelect.getAttribute('data-state');
  const clickResult = await modeSelect.click({ timeout: 3_000 }).then(() => 'clicked').catch((error) => `blocked:${error instanceof Error ? error.message.slice(0, 120) : String(error)}`);
  // Explicit state assertions instead of a blind settle: the selector must stay on the active mode
  // and recording must stay live. toHaveAttribute polls, so a wrongful switch surfaces within 5s.
  await expect(modeSelect).toHaveAttribute('data-state', activeMode, { timeout: 5_000 });
  await expect(page.getByTestId('session-start-stop-button')).toHaveAttribute('data-recording', 'true', { timeout: 5_000 });

  console.log(`LIVE_STT_SWITCH_WHILE_RECORDING_EVIDENCE ${JSON.stringify({
    activeMode,
    before,
    clickResult,
    after: await modeSelect.getAttribute('data-state'),
    recording: await page.getByTestId('session-start-stop-button').getAttribute('data-recording'),
  })}`);
}

async function waitForFixtureTranscript(page: Page, mode: SttMode, timeout: number) {
  let lastText = '';
  let lastSurface = 'none';
  try {
    await expect(async () => {
      const surfaces = await page.evaluate(() => {
        const cleanText = document.querySelector('[data-testid="transcript-text-only"]')?.textContent ?? '';
        const visibleText = document.querySelector('[data-testid="transcript-container"]')?.textContent ?? '';
        const debug = (window as unknown as {
          __SPEECH_RUNTIME_DEBUG__?: () => {
            sessionId?: string | null;
            saveCandidate?: { sessionId?: string | null; selectedForSave?: string | null } | null;
          };
        }).__SPEECH_RUNTIME_DEBUG__?.();
        const candidate = debug?.saveCandidate ?? null;
        // Only trust the save-candidate surface when it belongs to the CURRENT session. Otherwise the
        // prior (e.g. Cloud) session's lingering candidate false-matches before THIS engine has
        // transcribed, so we stop early and the app rejects the save ("not enough speech"). The live
        // DOM surfaces above reset per session, so they are always current-session.
        const saveCandidate = candidate && candidate.sessionId === debug?.sessionId
          ? (candidate.selectedForSave ?? '')
          : '';

        return [
          { surface: 'transcript-text-only', text: cleanText },
          { surface: 'transcript-container', text: visibleText },
          { surface: 'saveCandidate.selectedForSave', text: saveCandidate },
        ];
      });
      const candidates = surfaces
        .map(({ surface, text }) => ({ surface, text: normalizeTranscript(text) }))
        .filter(({ text }) => text.length > 0);
      const matched = candidates.find(({ text }) => TRANSCRIPT_PATTERN.test(text));
      const best = matched ?? candidates[0] ?? { surface: 'none', text: '' };
      lastText = best.text;
      lastSurface = best.surface;

      expect(best.text, `${mode} must surface fixture transcript text via ${best.surface}`).toMatch(TRANSCRIPT_PATTERN);
      expect(PLACEHOLDER_TRANSCRIPT_PATTERN.test(best.text) && !TRANSCRIPT_PATTERN.test(best.text), `Placeholder-only transcript from ${best.surface}: "${best.text}"`).toBe(false);
    }).toPass({ timeout, intervals: [2_000, 5_000] });
    console.log(`LIVE_STT_FIXTURE_TRANSCRIPT_SURFACE ${JSON.stringify({ mode, surface: lastSurface, transcriptPreview: lastText.slice(0, 120) })}`);
    return lastText;
  } catch (error) {
    const snapshot = await collectBenchmarkPreconditionSnapshot(page, `${mode}-fixture-transcript-timeout`);
    throw new Error(`${mode} transcript did not appear. Last surface="${lastSurface}" Last transcript="${lastText}"\n${JSON.stringify(snapshot, null, 2)}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

// The app refuses to save a session under MIN_SESSION_DURATION_SECONDS (5s; we target 7s), gating on
// the store's elapsedTime heartbeat (useSessionLifecycle drives useSessionStore.tick while listening).
// That store value is not reliably readable on the deployed prod build — __SESSION_STORE_API__ is
// gated out (NODE_ENV !== 'production' || isE2E) and the TimerDisplay DOM (session-timer) is not
// reliably mounted in this layout. So accrue the minimum directly: poll until (a) the recording is
// STILL live and (b) the saveable minimum of wall-clock has elapsed since data-recording flipped true.
// This is not a blind waitForTimeout — every poll asserts liveness, so a dropped recording fails with
// a clear reason instead of an opaque "page closed during wait".
async function waitForSaveableRecordingDuration(page: Page, recordingStartedAt: number) {
  const minimumSeconds = Math.ceil(MIN_SAVEABLE_RECORDING_MS / 1000);
  const startStop = page.getByTestId('session-start-stop-button');
  try {
    await expect(async () => {
      expect(
        await startStop.getAttribute('data-recording'),
        'recording must stay live while accruing the saveable minimum',
      ).toBe('true');
      expect(
        Date.now() - recordingStartedAt,
        `recording must run >= ${minimumSeconds}s to be saveable`,
      ).toBeGreaterThanOrEqual(MIN_SAVEABLE_RECORDING_MS);
    }).toPass({ timeout: MIN_SAVEABLE_RECORDING_MS + 15_000, intervals: [500, 1_000] });
  } catch (error) {
    const snapshot = await collectBenchmarkPreconditionSnapshot(page, 'saveable-recording-duration-timeout');
    throw new Error(`Recording did not sustain the ${minimumSeconds}s saveable minimum\n${JSON.stringify(snapshot, null, 2)}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

async function waitForCompletedSession(
  admin: SupabaseClient,
  userId: string,
  startedAt: string,
  engine: SttMode
): Promise<SessionRow[]> {
  let lastRows: SessionRow[] = [];
  await expect(async () => {
    const { data, error } = await admin
      .from('sessions')
      .select('id, created_at, engine, status, transcript, duration, model_name, engine_version, device_type')
      .eq('user_id', userId)
      .eq('engine', engine)
      .gte('created_at', startedAt)
      .order('created_at', { ascending: false })
      .limit(3);

    if (error) throw new Error(error.message);
    lastRows = (data ?? []) as SessionRow[];
    expect(lastRows.length, `${engine} session should be saved after ${startedAt}`).toBeGreaterThan(0);
    expect(lastRows[0].status, JSON.stringify(lastRows[0])).toBe('completed');
    expect(normalizeTranscript(lastRows[0].transcript), JSON.stringify(lastRows[0])).toMatch(TRANSCRIPT_PATTERN);
  }).toPass({ timeout: 45_000, intervals: [3_000] });

  return lastRows;
}

async function getSignedInUserId(page: Page) {
  const userId = await page.evaluate(() => {
    for (const value of Object.values(localStorage)) {
      try {
        const parsed = JSON.parse(value);
        const id = parsed?.user?.id ?? parsed?.currentSession?.user?.id ?? parsed?.session?.user?.id;
        if (typeof id === 'string') return id;
      } catch {
        // Keep scanning storage entries.
      }
    }
    return null;
  });

  expect(userId, 'signed-in Supabase user id should be available in browser storage').toBeTruthy();
  return userId!;
}

async function stopRecordingIfNeeded(page: Page) {
  if (page.isClosed()) return;
  const startStopButton = page.getByTestId('session-start-stop-button');
  const visible = await startStopButton.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!visible) return;

  if ((await startStopButton.getAttribute('data-recording').catch(() => null)) === 'true') {
    await startStopButton.click({ timeout: 5_000 }).catch(() => undefined);
    await expect(startStopButton).toHaveAttribute('data-recording', 'false', { timeout: 15_000 }).catch(() => undefined);
  }
}

// Replaces the old 2s blind tail wait. Wait for the runtime to leave the recording state, then for
// the controller's explicit data-session-persisted save signal (best-effort; the "Session saved"
// status text is already asserted by the caller before this runs).
async function waitForRecordingSettled(page: Page) {
  await page.waitForFunction(() => {
    const root = document.documentElement;
    const state = root.getAttribute('data-runtime-state');
    const recording = document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording');
    return recording !== 'true' && ['READY', 'IDLE', 'TERMINATED', 'FAILED', 'FAILED_VISIBLE'].includes(state ?? '');
  }, { timeout: 20_000 }).catch(() => undefined);
  await page.waitForFunction(() => (
    document.documentElement.getAttribute('data-session-persisted') === 'true'
  ), { timeout: 15_000 }).catch(() => undefined);
}

function summarizeSessionEvidence(row: SessionRow | undefined, transcript: string) {
  return {
    id: row?.id,
    engine: row?.engine,
    status: row?.status,
    duration: row?.duration,
    transcriptPreview: transcript.slice(0, 120),
    storedTranscriptLength: row?.transcript?.length ?? 0,
    modelName: row?.model_name,
    engineVersion: row?.engine_version,
    deviceType: row?.device_type,
  };
}

function normalizeTranscript(text: string | null) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}
