import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { AUDIO_ARGS, collectBenchmarkPreconditionSnapshot, selectBenchmarkMode, waitForBenchmarkSaveCandidate } from './helpers/benchmark-utils';
import { FILLER_CONV_01_AUDIO } from './helpers/audio-fixtures';

const BASE_URL = process.env.BASE_URL;

// This spec MUST mint a fresh account (it tests the first-time experience), so — unlike the reuse
// specs — it cleans up after itself so first-time-tester-* never accumulates. Requires the live
// service-role key (already provided to the live workflows).
const cleanupAdmin = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

async function deleteTesterByEmail(email: string): Promise<void> {
  if (!cleanupAdmin || !email) return;
  try {
    for (let pageNum = 1; pageNum <= 50; pageNum++) {
      const { data } = await cleanupAdmin.auth.admin.listUsers({ page: pageNum, perPage: 200 });
      const users = data?.users ?? [];
      const match = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (match) { await cleanupAdmin.auth.admin.deleteUser(match.id); return; }
      if (users.length < 200) return;
    }
  } catch (err) {
    console.warn(`FIRST_TIME_TESTER_CLEANUP_WARN could not delete ${email}: ${(err as Error)?.message ?? err}`);
  }
}

test.use({
  permissions: ['microphone'],
  baseURL: BASE_URL,
  launchOptions: {
    args: [
      ...AUDIO_ARGS,
      '--disable-gpu',
      '--disable-webgpu',
      `--use-file-for-fake-audio-capture=${FILLER_CONV_01_AUDIO}`,
    ],
  },
});

test.describe('First-time tester Private sample path @live', () => {
  // Same-run cleanup: delete whatever fresh account this run created, pass or fail (never accumulate).
  let createdFirstTimeEmail: string | null = null;
  test.afterEach(async () => {
    if (createdFirstTimeEmail) {
      await deleteTesterByEmail(createdFirstTimeEmail);
      createdFirstTimeEmail = null;
    }
  });

  test('new tester signs up Browser-first, intentionally starts Private sample, records, saves, and keeps Browser fallback', async ({ page }) => {
    test.skip(!BASE_URL, 'BASE_URL is required.');
    test.setTimeout(360_000);

    await page.addInitScript(() => {
      const win = window as unknown as {
        __E2E_CONTEXT__?: boolean
        REAL_WHISPER_TEST?: boolean
        __FORCE_TRANSFORMERS_JS__?: boolean
        __STT_LOAD_TIMEOUT__?: number
        __RC_GATE_EVENTS__?: Array<{ event: string, payload: Record<string, unknown>, timestamp: number }>
        __SS_E2E__?: {
          isActive: boolean
          pushEvent?: (event: string, payload: Record<string, unknown>) => void
        }
      };

      win.__E2E_CONTEXT__ = true;
      win.REAL_WHISPER_TEST = true;
      win.__FORCE_TRANSFORMERS_JS__ = true;
      win.__STT_LOAD_TIMEOUT__ = 180000;
      win.__RC_GATE_EVENTS__ = [];
      win.__SS_E2E__ = {
        ...(win.__SS_E2E__ ?? {}),
        isActive: true,
        pushEvent(event, payload) {
          win.__RC_GATE_EVENTS__?.push({ event, payload, timestamp: Date.now() });
        },
      };
    });

    const hardFailures: string[] = [];
    page.on('pageerror', (error) => {
      hardFailures.push(`[pageerror] ${error.message}`);
    });
    page.on('console', (message) => {
      const text = message.text();
      if (/ModelManager|TransformersJS|PrivateWhisper|SpeechRuntime|recording_start_failed|TranscriptionService|Session saved|user_goals/i.test(text)) {
        console.log(`[browser:${message.type()}] ${text}`);
      }
      if (
        message.type() === 'error' &&
        /GlobalHardGate|ENGINE_ALREADY_TERMINATED|Transcription Error|Strategy NOT AVAILABLE|recording_start_failed/i.test(text)
      ) {
        hardFailures.push(`[console:${message.type()}] ${text}`);
      }
    });

    await test.step('Open current production signup page', async () => {
      console.log('FIRST_TIME_TESTER_STEP open_signup');
      await page.goto('/auth/signup');
      await expect(page.getByRole('heading', { name: /create account|create an account/i })).toBeVisible({ timeout: 20_000 });
    });

    await clearPrivateModelStorage(page);
    console.log('FIRST_TIME_TESTER_STEP cleared_private_model_storage');

    const unique = `${Date.now()}-${process.env.GITHUB_RUN_ID ?? 'local'}`;
    const email = `first-time-tester-${unique}@speaksharp.app`;
    const password = `SpeakSharpSample-${unique}!`;
    createdFirstTimeEmail = email; // register for afterEach cleanup so it never accumulates

    await test.step('Create a fresh tester account with Browser-first and Private sample copy visible', async () => {
      console.log('FIRST_TIME_TESTER_STEP signup_start');
      await expect(page.getByText(/Start free with instant Browser transcription/i)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/try one Private sample session/i)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/record up to 5 minutes/i)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/60-minute Pro trial|trial countdown|daily limit|monthly limit|practice quota|Pro quota/i)).toHaveCount(0);
      await page.getByTestId('email-input').fill(email);
      await page.getByTestId('password-input').fill(password);
      await page.getByTestId('sign-up-submit').click();
      console.log('FIRST_TIME_TESTER_STEP signup_submitted');
    });

    await test.step('Land in session Browser-first, then intentionally choose Private sample', async () => {
      await expect(page).toHaveURL(/\/session/, { timeout: 45_000 });
      await expect(page.getByTestId('stt-mode-select')).toContainText(/Browser/i, { timeout: 20_000 });
      await expect(page.getByTestId('first-run-setup-private')).toHaveText(/Try one Private sample session/i, { timeout: 20_000 });
      await selectBenchmarkMode(page, 'private');
      await expect(page.getByTestId('live-session-header')).toContainText(/Private sample: up to 5 minutes|Record up to 5 minutes/i, { timeout: 20_000 });
      console.log('FIRST_TIME_TESTER_STEP session_private_selected');
    });

    let firstUseReady: FirstUseSnapshot;
    let warmupEvidence: WarmupEvidence;
    await test.step('Prepare uncached Private model with visible status feedback', async () => {
      await preparePrivateModelIfPrompted(page);
      firstUseReady = await getFirstUseSnapshot(page);
      warmupEvidence = await getWarmupEvidence(page);
      console.log(`FIRST_TIME_TESTER_STEP private_ready ${JSON.stringify(firstUseReady)}`);
      console.log(`FIRST_TIME_TESTER_STEP private_warmup ${JSON.stringify(warmupEvidence)}`);
      expect(isPrivateReadySnapshot(firstUseReady), JSON.stringify(firstUseReady)).toBe(true);
      expect(warmupEvidence!.privateWarmupBeforeStart, JSON.stringify(warmupEvidence)).toBe(true);
    });

    let recordingEvidence: RecordingEvidence;
    await test.step('Start, verify live transcript/fillers, and stop recording after Private setup', async () => {
      recordingEvidence = await startAndStopPrivateRecording(page);
      console.log('FIRST_TIME_TESTER_STEP recording_start_stop_done');
    });

    await test.step('Confirm Browser transcription remains available after Private sample recording', async () => {
      await selectBenchmarkMode(page, 'native');
      await expect(page.getByTestId('stt-mode-select')).toContainText(/Browser/i, { timeout: 20_000 });
      console.log('FIRST_TIME_TESTER_STEP browser_fallback_available');
    });

    let historyEvidence: HistoryEvidence;
    await test.step('Confirm saved session appears in History and opens', async () => {
      historyEvidence = await confirmHistoryOpens(page);
      console.log(`FIRST_TIME_TESTER_STEP history_open_done ${JSON.stringify(historyEvidence)}`);
    });

    const afterRecording = await getFirstUseSnapshot(page);
    console.log(`LIVE_FIRST_TIME_TESTER_PRIVATE_TRIAL_EVIDENCE ${JSON.stringify({
      email,
      firstUseReady: firstUseReady!,
      warmupEvidence: warmupEvidence!,
      recordingEvidence: recordingEvidence!,
      historyEvidence: historyEvidence!,
      afterRecording,
      hardFailures,
      url: page.url(),
    })}`);

    expect(hardFailures, hardFailures.join('\n')).toEqual([]);
    expect(afterRecording.runtimeState, JSON.stringify(afterRecording)).not.toBe('FAILED_VISIBLE');
    expect(afterRecording.statusText, JSON.stringify(afterRecording)).not.toMatch(/could not start|blocked|didn't detect enough speech/i);
    expect(recordingEvidence!.transcriptText, JSON.stringify(recordingEvidence!)).not.toMatch(/words appear here|listening|no speech/i);
    expect(recordingEvidence!.transcriptAcceptance.finalTranscriptPreserved, JSON.stringify(recordingEvidence!.transcriptAcceptance)).toBe(true);
    expect(recordingEvidence!.transcriptAcceptance.visibleFinalMatchesSave, JSON.stringify(recordingEvidence!.transcriptAcceptance)).toBe(true);
    expect(recordingEvidence!.transcriptAcceptance.visibleLoopContained, JSON.stringify(recordingEvidence!.transcriptAcceptance)).toBe(true);
    expect(historyEvidence!.historyItemVisible, JSON.stringify(historyEvidence!)).toBe(true);
    expect(historyEvidence!.openedUrl, JSON.stringify(historyEvidence!)).toContain('/analytics/');
  });
});

function isPrivateReadySnapshot(snapshot: FirstUseSnapshot) {
  return snapshot.sttReady === 'true' ||
    snapshot.runtimeState === 'RECORDING' ||
    snapshot.modelStatus === 'ready';
}

async function clearPrivateModelStorage(page: Page) {
  await page.evaluate(async () => {
    if ('caches' in window) {
      for (const name of await caches.keys()) {
        if (/transformers|whisper|model/i.test(name)) {
          await caches.delete(name);
        }
      }
    }

    if ('indexedDB' in window && 'databases' in indexedDB) {
      const databases = await indexedDB.databases();
      await Promise.all(databases
        .map((database) => database.name)
        .filter((name): name is string => Boolean(name) && /transformers|whisper|model/i.test(name))
        .map((name) => new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        })));
    }
  });
}

async function preparePrivateModelIfPrompted(page: Page) {
  const downloadButton = page.locator('[data-testid="download-model-button"], [data-testid="download-model-button-inline"]').first();
  if (await downloadButton.isVisible({ timeout: 10_000 }).catch(() => false)) {
    if (process.env.PRIVATE_SETUP_USER_CONSENT_REQUIRED === 'true') {
      const snapshot = await collectBenchmarkPreconditionSnapshot(page, 'private-setup-user-consent-required');
      throw new Error(
        `INVALID_SETUP setup.model_provider USER_CONSENT_REQUIRED private-setup-download-visible\n` +
        `Private model setup requires an explicit user click; this human proof must not auto-download.\n` +
        `${JSON.stringify(snapshot, null, 2)}`
      );
    }
    await downloadButton.click();
  }

  await waitForPrivateReady(page);
}

async function waitForPrivateReady(page: Page) {
  await page.waitForFunction(() => {
    const root = document.documentElement;
    const runtimeState = root.getAttribute('data-runtime-state');
    const sttReady = root.getAttribute('data-stt-ready');
    const modelStatus = root.getAttribute('data-model-status');

    return (
      sttReady === 'true' ||
      runtimeState === 'RECORDING' ||
      modelStatus === 'ready'
    );
  }, { timeout: 180_000 });
}

type RecordingEvidence = {
  transcriptText: string
  fillerText: string
  fillerCount: number
  saved: boolean
  beforeStop: Awaited<ReturnType<typeof collectBenchmarkPreconditionSnapshot>>
  afterStop: Awaited<ReturnType<typeof collectBenchmarkPreconditionSnapshot>>
  saveCandidate: Awaited<ReturnType<typeof waitForBenchmarkSaveCandidate>>
  postStopTranscriptText: string
  transcriptAcceptance: TranscriptAcceptanceEvidence
}

type TranscriptAcceptanceEvidence = {
  selectedForSave: string
  postStopTranscriptText: string
  selectedTranscriptSource: string | null
  repetitionRisk: boolean
  repetitionRiskReason: string | null
  repeatedSpanSummary: string | null
  finalTranscriptPreserved: boolean
  visibleFinalMatchesSave: boolean
  visibleLoopContained: boolean
  repeatedSpanAcceptedAsGuardrail: boolean
  policy: 'preserve_final_text_no_fuzzy_collapse'
}

type HistoryEvidence = {
  historyItemVisible: boolean
  openedUrl: string
  sessionId: string | null
}

async function startAndStopPrivateRecording(page: Page): Promise<RecordingEvidence> {
  const startStopButton = page.getByTestId('session-start-stop-button');
  await expect(startStopButton).toBeVisible({ timeout: 30_000 });
  await expect(startStopButton).toBeEnabled({ timeout: 60_000 });
  await startStopButton.click();
  await expect(startStopButton).toHaveAttribute('data-recording', 'true', { timeout: 60_000 });

  let transcriptText = '';
  await expect(async () => {
    transcriptText = await readTranscriptTextOnly(page);
    expect(transcriptText).not.toMatch(/words appear here|listening|no speech/i);
    expect(transcriptText.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(3);
  }).toPass({ timeout: 120_000, intervals: [1_000, 2_000, 5_000] });

  const beforeStop = await collectBenchmarkPreconditionSnapshot(page, 'first-time-private-before-stop');
  const fillerText = normalizeText(await page.getByTestId('filler-words-list').textContent());
  const fillerCount = Number((await page.getByTestId('filler-count-value').textContent())?.match(/\d+/)?.[0] ?? '0');

  await startStopButton.click();
  await expect(startStopButton).toHaveAttribute('data-recording', 'false', { timeout: 60_000 });
  await expect(page.locator('html[data-session-persisted="true"]')).toBeVisible({ timeout: 60_000 });
  const saveCandidate = await waitForBenchmarkSaveCandidate(page, 'first-time-private');
  const afterStop = await collectBenchmarkPreconditionSnapshot(page, 'first-time-private-after-stop');
  const postStopTranscriptText = await readTranscriptTextOnly(page);
  const transcriptAcceptance = buildTranscriptAcceptanceEvidence(saveCandidate, postStopTranscriptText);
  console.log(`FIRST_TIME_TESTER_STEP transcript_acceptance ${JSON.stringify(transcriptAcceptance)}`);

  return {
    transcriptText,
    fillerText,
    fillerCount,
    saved: true,
    beforeStop,
    afterStop,
    saveCandidate,
    postStopTranscriptText,
    transcriptAcceptance,
  };
}

async function readTranscriptTextOnly(page: Page) {
  const transcriptTextOnly = page.getByTestId('transcript-text-only');
  if (await transcriptTextOnly.isVisible({ timeout: 250 }).catch(() => false)) {
    return normalizeText(await transcriptTextOnly.textContent());
  }
  return normalizeText(await page.getByTestId('transcript-container').textContent());
}

async function confirmHistoryOpens(page: Page): Promise<HistoryEvidence> {
  await page.goto('/analytics');
  await page.locator('html[data-app-visible-ready="true"]').waitFor({ timeout: 45_000 });
  await page.reload();
  await page.locator('html[data-app-visible-ready="true"]').waitFor({ timeout: 45_000 });

  const historyItem = page.getByTestId(/^session-history-item-/).first();
  await expect(historyItem).toBeVisible({ timeout: 20_000 });

  const openLink = page.getByTestId(/^open-session-detail-/).first();
  await expect(openLink).toBeVisible({ timeout: 20_000 });
  const historyItemVisible = await openLink.isVisible().catch(() => false);
  const href = await openLink.getAttribute('href');
  await openLink.click();
  await expect(page).toHaveURL(/\/analytics\/[^/]+$/, { timeout: 20_000 });

  return {
    historyItemVisible,
    openedUrl: page.url(),
    sessionId: href?.split('/').pop() ?? null,
  };
}

type FirstUseSnapshot = {
  modelStatus: string | null
  runtimeState: string | null
  sttReady: string | null
  statusText: string
  downloadVisible: boolean
}

type WarmupEvidence = {
  privateWarmupBeforeStart: boolean
  warmupTimestamp: number | null
  startTimestamp: number | null
  events: Array<{ event: string, payload: Record<string, unknown>, timestamp: number }>
}

async function getWarmupEvidence(page: Page): Promise<WarmupEvidence> {
  return await page.evaluate(() => {
    const win = window as unknown as {
      __RC_GATE_EVENTS__?: Array<{ event: string, payload: Record<string, unknown>, timestamp: number }>
    };
    const events = win.__RC_GATE_EVENTS__ ?? [];
    const warmup = events.find((entry) =>
      entry.event === 'SESSION_LIFECYCLE_WARMUP' &&
      entry.payload?.mode === 'private'
    );
    const start = events.find((entry) => entry.event === 'SR_START_ENTER');

    return {
      privateWarmupBeforeStart: Boolean(warmup) && (!start || warmup.timestamp < start.timestamp),
      warmupTimestamp: warmup?.timestamp ?? null,
      startTimestamp: start?.timestamp ?? null,
      events,
    };
  });
}

async function getFirstUseSnapshot(page: Page): Promise<FirstUseSnapshot> {
  return await page.evaluate(() => {
    const root = document.documentElement;
    const downloadButton = document.querySelector('[data-testid="download-model-button"], [data-testid="download-model-button-inline"]');
    const statusNode = document.querySelector('[data-testid="status-message-text"], [data-testid="stt-status"], [data-testid="session-status"], [data-testid="stt-status-label"]');

    return {
      modelStatus: root.getAttribute('data-model-status'),
      runtimeState: root.getAttribute('data-runtime-state'),
      sttReady: root.getAttribute('data-stt-ready'),
      statusText: statusNode?.textContent?.trim() ?? document.body.innerText.slice(0, 500),
      downloadVisible: Boolean(downloadButton && getComputedStyle(downloadButton).display !== 'none'),
    };
  });
}

function normalizeText(text: string | null | undefined) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeForTranscriptCompare(text: string | null | undefined) {
  return normalizeText(text)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+([,.!?;:])/g, '$1');
}

function buildTranscriptAcceptanceEvidence(
  saveCandidate: Awaited<ReturnType<typeof waitForBenchmarkSaveCandidate>>,
  postStopTranscriptText: string,
): TranscriptAcceptanceEvidence {
  const selectedForSave = normalizeText(saveCandidate.selectedForSave);
  const visibleFinal = normalizeText(postStopTranscriptText);
  const selectedTranscriptSource = saveCandidate.saveCandidateReason ?? null;
  const repetitionRiskReason = saveCandidate.repetitionRiskReason ?? null;
  const visibleLoopContained = repetitionRiskReason !== 'near_whole_doubling' && repetitionRiskReason !== 'adjacent_loop';

  return {
    selectedForSave,
    postStopTranscriptText: visibleFinal,
    selectedTranscriptSource,
    repetitionRisk: saveCandidate.repetitionRisk === true,
    repetitionRiskReason,
    repeatedSpanSummary: saveCandidate.repeatedSpanSummary ?? null,
    finalTranscriptPreserved: selectedForSave.length > 0 && selectedTranscriptSource !== 'empty',
    visibleFinalMatchesSave: normalizeForTranscriptCompare(visibleFinal) === normalizeForTranscriptCompare(selectedForSave),
    visibleLoopContained,
    repeatedSpanAcceptedAsGuardrail: repetitionRiskReason === 'repeated_span',
    policy: 'preserve_final_text_no_fuzzy_collapse',
  };
}
