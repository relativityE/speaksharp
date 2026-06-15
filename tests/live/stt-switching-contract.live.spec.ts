import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  AUDIO_ARGS,
  assertPreStartMode,
  collectBenchmarkPreconditionSnapshot,
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

  test('Pro idle switching, in-recording lockout, and separate Cloud/Private session metadata', async ({ page }) => {
    test.skip(!E2E_PRO_EMAIL || !E2E_PRO_PASSWORD, 'Pro test credentials are required.');

    test.setTimeout(420_000);
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

    await assertIdleModeSwitch(page, 'cloud');
    await assertIdleModeSwitch(page, 'native');
    await assertIdleModeSwitch(page, 'private', { allowDownloadRequired: true });

    const privateSetup = await startPrivateSetupIfPrompted(page);
    await selectBenchmarkMode(page, 'cloud');
    await assertPreStartMode(page, 'cloud');
    const cloudTranscript = await recordCloudWithSwitchAttempt(page);
    const cloudSessions = await waitForCompletedSession(admin, userId, startedAt, 'cloud');

    await selectBenchmarkMode(page, 'private');
    await preparePrivateModelIfNeeded(page);
    await assertPreStartMode(page, 'private');
    const privateTranscript = await recordPrivateSession(page);
    const privateSessions = await waitForCompletedSession(admin, userId, startedAt, 'private');

    const evidence = {
      idleSwitching: ['cloud', 'native', 'private'],
      privateSetup,
      cloud: summarizeSessionEvidence(cloudSessions[0], cloudTranscript),
      private: summarizeSessionEvidence(privateSessions[0], privateTranscript),
      distinctSessionIds: cloudSessions[0]?.id !== privateSessions[0]?.id,
    };
    console.log(`LIVE_STT_SWITCHING_PRO_ENGINE_INTEGRITY_EVIDENCE ${JSON.stringify(evidence)}`);

    expect(evidence.distinctSessionIds, JSON.stringify(evidence)).toBe(true);
    expect(cloudSessions[0]?.engine, JSON.stringify(evidence)).toBe('cloud');
    expect(privateSessions[0]?.engine, JSON.stringify(evidence)).toBe('private');
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

async function startPrivateSetupIfPrompted(page: Page) {
  const downloadButton = page.locator('[data-testid="download-model-button"], [data-testid="download-model-button-inline"]').first();
  const visible = await downloadButton.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!visible) {
    const snapshot = await collectBenchmarkPreconditionSnapshot(page, 'private-setup-not-required');
    return {
      promptVisible: false,
      modelStatus: snapshot.root?.modelStatus,
      runtimeState: snapshot.root?.runtimeState,
      note: 'Private model was already available or warming up.',
    };
  }

  if (process.env.PRIVATE_SETUP_USER_CONSENT_REQUIRED === 'true') {
    const snapshot = await collectBenchmarkPreconditionSnapshot(page, 'private-setup-user-consent-required');
    throw new Error(
      `INVALID_SETUP setup.model_provider USER_CONSENT_REQUIRED private-setup-download-visible\n` +
      `Private model setup requires an explicit user click; this proof must not auto-download.\n` +
      `${JSON.stringify(snapshot, null, 2)}`
    );
  }

  await downloadButton.click();
  await page.waitForFunction(() => {
    const root = document.documentElement;
    return ['downloading', 'loading', 'ready'].includes(root.getAttribute('data-model-status') ?? '') ||
      /download|loading|preparing|ready/i.test(document.body.innerText);
  }, { timeout: 20_000 });

  const snapshot = await collectBenchmarkPreconditionSnapshot(page, 'private-setup-started');
  return {
    promptVisible: true,
    modelStatus: snapshot.root?.modelStatus,
    runtimeState: snapshot.root?.runtimeState,
    statusText: await page.getByTestId('status-message-text').textContent().catch(() => null),
  };
}

async function preparePrivateModelIfNeeded(page: Page) {
  const downloadButton = page.locator('[data-testid="download-model-button"], [data-testid="download-model-button-inline"]').first();
  const startStopButton = page.getByTestId('session-start-stop-button');
  let downloadClicked = false;

  try {
    await expect(async () => {
      const modelStatus = await page.evaluate(() => document.documentElement.getAttribute('data-model-status'));
      const startEnabled = await startStopButton.isEnabled().catch(() => false);

      if (startEnabled || modelStatus === 'ready') {
        return;
      }

      if (!downloadClicked && await downloadButton.isVisible({ timeout: 500 }).catch(() => false)) {
        if (process.env.PRIVATE_SETUP_USER_CONSENT_REQUIRED === 'true') {
          const snapshot = await collectBenchmarkPreconditionSnapshot(page, 'private-setup-user-consent-required');
          throw new Error(
            `INVALID_SETUP setup.model_provider USER_CONSENT_REQUIRED private-setup-download-visible\n` +
            `Private model setup requires an explicit user click; this proof must not auto-download.\n` +
            `${JSON.stringify(snapshot, null, 2)}`
          );
        }
        downloadClicked = true;
        await downloadButton.click();
      }

      expect({ modelStatus, startEnabled }, 'Private model must be ready or Start must be enabled').toMatchObject({
        modelStatus: 'ready',
      });
    }).toPass({ timeout: 180_000, intervals: [1_000, 2_000, 5_000] });
  } catch (error) {
    const snapshot = await collectBenchmarkPreconditionSnapshot(page, 'private-model-setup-timeout');
    throw new Error(`Private model setup did not reach start-ready state\n${JSON.stringify(snapshot, null, 2)}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

async function recordCloudWithSwitchAttempt(page: Page) {
  const startStopButton = page.getByTestId('session-start-stop-button');
  await expect(startStopButton).toBeEnabled({ timeout: 60_000 });

  const tokenResponsePromise = page.waitForResponse((response) =>
    response.url().includes('/functions/v1/assemblyai-token') &&
    response.request().method() === 'POST'
  );

  await startStopButton.click();
  const recordingStartedAt = Date.now();
  const tokenResponse = await tokenResponsePromise;
  expect(tokenResponse.status(), `assemblyai-token response: ${await tokenResponse.text().catch(() => '')}`).toBe(200);
  await expect(startStopButton).toHaveAttribute('data-recording', 'true', { timeout: 45_000 });

  await assertModeSwitchBlockedWhileRecording(page, 'cloud');
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
  const recordingStartedAt = Date.now();
  await expect(startStopButton).toHaveAttribute('data-recording', 'true', { timeout: 45_000 });
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
  await page.waitForTimeout(500);
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
        const saveCandidate = (window as unknown as {
          __SPEECH_RUNTIME_DEBUG__?: () => { saveCandidate?: { selectedForSave?: string | null } | null };
        }).__SPEECH_RUNTIME_DEBUG__?.().saveCandidate?.selectedForSave ?? '';

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

async function waitForSaveableRecordingDuration(page: Page, recordingStartedAt: number) {
  const minimumSeconds = Math.ceil(MIN_SAVEABLE_RECORDING_MS / 1000);
  await page.waitForTimeout(Math.max(0, MIN_SAVEABLE_RECORDING_MS - (Date.now() - recordingStartedAt)));

  await page.waitForFunction((minSeconds) => {
    const storeApi = (window as unknown as {
      __SESSION_STORE_API__?: { getState?: () => { elapsedTime?: number } };
    }).__SESSION_STORE_API__;
    const elapsedTime = storeApi?.getState?.().elapsedTime;
    return typeof elapsedTime === 'number' && elapsedTime >= minSeconds;
  }, minimumSeconds, { timeout: 15_000 }).catch(async () => {
    await page.waitForTimeout(5_000);
  });
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

async function waitForRecordingSettled(page: Page) {
  await page.waitForFunction(() => {
    const root = document.documentElement;
    const state = root.getAttribute('data-runtime-state');
    const recording = document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording');
    return recording !== 'true' && ['READY', 'IDLE', 'TERMINATED', 'FAILED', 'FAILED_VISIBLE'].includes(state ?? '');
  }, { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(2_000);
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
