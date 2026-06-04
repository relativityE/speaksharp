import { test, expect, type Page, type TestInfo } from '@playwright/test';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { calculateWordErrorRate } from '../../frontend/src/lib/wer';
import { AUDIO_ARGS, collectBenchmarkPreconditionSnapshot, preparePrivateModelIfPrompted, selectBenchmarkMode, waitForBenchmarkSaveCandidate } from './helpers/benchmark-utils';
import { WASHINGTON_01 } from '../fixtures/stt-isomorphic/washington-speeches';

const BASE_URL = process.env.BASE_URL;
const WASHINGTON_AUDIO = fileURLToPath(new URL('../fixtures/stt-isomorphic/audio/washington_01.wav', import.meta.url));
const AUDIO_COMPLETION_MARGIN_MS = 3_000;

test.use({
  permissions: ['microphone'],
  baseURL: BASE_URL,
  launchOptions: {
    args: [
      ...AUDIO_ARGS,
      '--disable-gpu',
      '--disable-webgpu',
      `--use-file-for-fake-audio-capture=${WASHINGTON_AUDIO}`,
    ],
  },
});

test.describe('Private long-form timing branch proof @live', () => {
  test.beforeEach(() => {
    test.skip(!BASE_URL, 'BASE_URL is required so this proof can target the intended app.');
  });

  test('captures __PRIVATE_TIMING__ on washington_01 65.8s speech', async ({ page }, testInfo) => {
    test.setTimeout(420_000);

    await enablePrivateLiveHooks(page);
    const account = makeTesterAccount();
    await signUp(page, account.email, account.password);

    await expect(page).toHaveURL(/\/session/, { timeout: 45_000 });
    await expect(page.getByTestId('pro-badge')).toBeVisible({ timeout: 20_000 });
    await selectBenchmarkMode(page, 'private');
    await preparePrivateModelIfPrompted(page, 180_000);

    const beforeStart = await collectBenchmarkPreconditionSnapshot(page, 'private-longform-before-start');
    const startStopButton = page.getByTestId('session-start-stop-button');
    await expect(startStopButton).toBeVisible({ timeout: 30_000 });
    await expect(startStopButton).toBeEnabled({ timeout: 60_000 });

    await startStopButton.click();
    const recordingStartedAt = Date.now();
    await expect(startStopButton).toHaveAttribute('data-recording', 'true', { timeout: 60_000 });

    const firstVisibleText = await waitForNonPlaceholderTranscript(page);
    const elapsedSinceStartMs = Date.now() - recordingStartedAt;
    await page.waitForTimeout(Math.max(
      0,
      WASHINGTON_01.metadata.durationSec * 1000 + AUDIO_COMPLETION_MARGIN_MS - elapsedSinceStartMs,
    ));

    const visibleAtStop = await readTranscriptText(page);
    await startStopButton.click();
    await expect(startStopButton).toHaveAttribute('data-recording', 'false', { timeout: 90_000 });
    const saveCandidate = await waitForBenchmarkSaveCandidate(page, 'private-longform-washington', 120_000);
    const diagnostics = await readDiagnostics(page);
    const afterStop = await collectBenchmarkPreconditionSnapshot(page, 'private-longform-after-stop');

    const selectedForSave = saveCandidate.selectedForSave ?? '';
    const normalizedTruth = normalizeForWer(WASHINGTON_01.transcript);
    const normalizedSelected = normalizeForWer(selectedForSave);
    const wer = calculateWordErrorRate(normalizedTruth, normalizedSelected);
    const accuracyPct = Number(((1 - wer) * 100).toFixed(2));
    const privateTiming = diagnostics.privateTiming as PrivateTiming | null;
    const finalizeDecodeMs = typeof privateTiming?.finalizeDecodeMs === 'number'
      ? privateTiming.finalizeDecodeMs
      : null;
    const utteranceSeconds = typeof privateTiming?.utteranceSeconds === 'number'
      ? privateTiming.utteranceSeconds
      : null;
    const rtf = finalizeDecodeMs != null && utteranceSeconds && utteranceSeconds > 0
      ? Number((finalizeDecodeMs / (utteranceSeconds * 1000)).toFixed(4))
      : null;

    const evidence = {
      capturedAt: new Date().toISOString(),
      fixture: WASHINGTON_01.id,
      fixtureAudio: WASHINGTON_AUDIO,
      expectedDurationSec: WASHINGTON_01.metadata.durationSec,
      expectedWords: WASHINGTON_01.metadata.words,
      accountEmail: account.email,
      beforeStart,
      firstVisibleText,
      visibleAtStop,
      afterStop,
      saveCandidate,
      privateTiming,
      rtf,
      stopPredecodeBreakdown: diagnostics.stopPredecodeBreakdown,
      privateTimelineTail: diagnostics.privateTimelineTail,
      transcriptTextOnly: diagnostics.transcriptTextOnly,
      selectedForSave,
      normalizedSelectedWordCount: normalizedSelected.split(/\s+/).filter(Boolean).length,
      normalizedTruthWordCount: normalizedTruth.split(/\s+/).filter(Boolean).length,
      wer: Number(wer.toFixed(4)),
      accuracyPct,
    };

    await attachJson(testInfo, 'private-longform-washington-timing.json', evidence);
    console.log(`PRIVATE_LONGFORM_TIMING_EVIDENCE ${JSON.stringify(evidence)}`);

    expect(privateTiming, 'window.__PRIVATE_TIMING__ must be present after Stop').toBeTruthy();
    expect(finalizeDecodeMs, 'finalizeDecodeMs must be numeric').not.toBeNull();
    expect(saveCandidate.selectedForSaveLength ?? 0, 'saveCandidate selected text must exist').toBeGreaterThan(0);
  });
});

type PrivateTiming = {
  timeToFirstProvisionalMs?: number | null;
  timeToFirstFinalMs?: number | null;
  finalizeWaitMs?: number | null;
  finalizePrepMs?: number | null;
  finalizeDecodeMs?: number | null;
  utteranceSeconds?: number | null;
  peakBufferedSeconds?: number | null;
};

async function enablePrivateLiveHooks(page: Page) {
  await page.addInitScript(() => {
    const win = window as Window & {
      __E2E_CONTEXT__?: boolean;
      REAL_WHISPER_TEST?: boolean;
      __FORCE_TRANSFORMERS_JS__?: boolean;
      __STT_LOAD_TIMEOUT__?: number;
      __E2E_DEPS__?: Record<string, unknown>;
      __PRIVATE_TRANSCRIPT_TRACE__?: boolean;
    };

    win.__E2E_CONTEXT__ = true;
    win.REAL_WHISPER_TEST = true;
    win.__FORCE_TRANSFORMERS_JS__ = true;
    win.__STT_LOAD_TIMEOUT__ = 180000;
    win.__PRIVATE_TRANSCRIPT_TRACE__ = true;
    win.__E2E_DEPS__ = {
      ...win.__E2E_DEPS__,
      fetchUsageLimit: async () => ({
        can_start: true,
        daily_remaining: 3600,
        daily_limit: 3600,
        monthly_remaining: 3600,
        monthly_limit: 3600,
        remaining_seconds: 3600,
        subscription_status: 'pro',
        is_pro: true,
        streak_count: 0,
        trial_active: true,
      }),
    };
  });
}

function makeTesterAccount() {
  const unique = `${Date.now()}-${process.env.GITHUB_RUN_ID ?? 'local'}`;
  return {
    email: `private-longform-${unique}@speaksharp.app`,
    password: `SpeakSharpLongform-${unique}!`,
  };
}

async function signUp(page: Page, accountEmail: string, accountPassword: string) {
  await page.goto('/auth/signup');
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('email-input').fill(accountEmail);
  await page.getByTestId('password-input').fill(accountPassword);
  await page.getByTestId('sign-up-submit').click();
}

async function waitForNonPlaceholderTranscript(page: Page) {
  let text = '';
  await expect(async () => {
    text = await readTranscriptText(page);
    expect(text).not.toMatch(/words appear here|listening|no speech|start recording/i);
    expect(text.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(3);
  }).toPass({ timeout: 120_000, intervals: [1_000, 2_000, 5_000] });
  return text;
}

async function readTranscriptText(page: Page) {
  return page.getByTestId('transcript-container')
    .textContent()
    .then((text) => normalizeText(text));
}

async function readDiagnostics(page: Page) {
  return page.evaluate(() => {
    const win = window as unknown as Window & {
      __PRIVATE_TIMING__?: unknown;
      __PRIVATE_STT_TIMELINE__?: Array<{ event?: string; payload?: unknown; epochMs?: number; perfMs?: number }>;
    };
    const privateTimeline = win.__PRIVATE_STT_TIMELINE__ ?? [];
    return {
      privateTiming: win.__PRIVATE_TIMING__ ?? null,
      stopPredecodeBreakdown: privateTimeline.filter((entry) => entry.event === 'stop_predecode_breakdown'),
      privateTimelineTail: privateTimeline.slice(-20),
      transcriptTextOnly: document.querySelector('[data-testid="transcript-text-only"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    };
  });
}

function normalizeText(text: string | null) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeForWer(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown) {
  const filePath = testInfo.outputPath(name);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  await testInfo.attach(name, {
    path: filePath,
    contentType: 'application/json',
  });
}
