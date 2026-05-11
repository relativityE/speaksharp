import { test, expect, type Page } from '@playwright/test';
import { AUDIO_ARGS, collectBenchmarkPreconditionSnapshot, selectBenchmarkMode } from './helpers/benchmark-utils';
import { HARVARD_BENCHMARK_LONG_AUDIO } from './helpers/audio-fixtures';
import { HARVARD_FULL } from '../fixtures/stt-isomorphic/harvard-sentences';

const BASE_URL = process.env.BASE_URL;
const E2E_PRO_EMAIL = process.env.E2E_PRO_EMAIL;
const E2E_PRO_PASSWORD = process.env.E2E_PRO_PASSWORD;
const TRANSCRIPT_PATTERN = /\b(stale|beer|pepper|beef|swan|park|twister|wild|puppy|quick|brown|fox)\b/i;
const PLACEHOLDER_TRANSCRIPT_PATTERN = /\b(words appear here|listening)\b/i;
const ASSEMBLYAI_CONCURRENCY_PATTERN = /too many concurrent sessions/i;
const CLOUD_WER_THRESHOLD = 0.08;
const MIN_WER_WORDS = 24;
const MIN_RECORDING_MS = 7_000;

test.describe.configure({ mode: 'serial', retries: 0 });

test.use({
  permissions: ['microphone'],
  baseURL: BASE_URL,
  launchOptions: {
    args: [
      ...AUDIO_ARGS,
      `--use-file-for-fake-audio-capture=${HARVARD_BENCHMARK_LONG_AUDIO}`,
    ],
  },
});

test.afterEach(async ({ page }) => {
  await stopCloudRecordingAndWaitForDisconnect(page);
});

test('Pro Cloud live STT can transcribe, save, and show analytics history', async ({ page }) => {
  test.skip(!BASE_URL || !E2E_PRO_EMAIL || !E2E_PRO_PASSWORD, 'BASE_URL and E2E Pro credentials are required.');

  const cloudConsoleEvents: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/CloudAssemblyAI|assemblyai-token|TranscriptionService|SpeechRuntime|WebSocket|transcript/i.test(text)) {
      cloudConsoleEvents.push(text);
      console.log(`[browser:${message.type()}] ${text}`);
    }
  });

  await signInAsPro(page);
  await expect(page).toHaveURL(/\/session/, { timeout: 30_000 });
  await expect(page.getByTestId('pro-badge')).toBeVisible({ timeout: 20_000 });

  await selectCloudMode(page);
  await recordCloudSessionUntilTranscript(page, cloudConsoleEvents);

  await page.goto('/analytics');
  await page.locator('html[data-app-ready="true"]').waitFor({ timeout: 45_000 });
  await expect(page.getByTestId(/^session-history-item-/).first()).toBeVisible({ timeout: 45_000 });
});

async function signInAsPro(page: Page) {
  await page.goto('/auth/signin');
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('email-input').fill(E2E_PRO_EMAIL!);
  await page.getByTestId('password-input').fill(E2E_PRO_PASSWORD!);
  await page.getByTestId('sign-in-submit').click();
}

async function selectCloudMode(page: Page) {
  await selectBenchmarkMode(page, 'cloud');
}

async function recordCloudSessionUntilTranscript(page: Page, cloudConsoleEvents: string[]) {
  const startStopButton = page.getByTestId('session-start-stop-button');
  await expect(startStopButton).toBeVisible({ timeout: 30_000 });
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

  await page.waitForTimeout(Math.max(0, MIN_RECORDING_MS - (Date.now() - recordingStartedAt)));

  const transcriptContainer = page.getByTestId('transcript-container');
  const transcript = await waitForLiveFixtureTranscript(page, transcriptContainer, cloudConsoleEvents);
  const werEvidence = calculateFixtureWerEvidence(transcript);
  console.log(`LIVE_CLOUD_WER_EVIDENCE ${JSON.stringify(werEvidence)}`);
  expect(werEvidence.wordCount, `Cloud transcript too short for WER proof: "${transcript}"`).toBeGreaterThanOrEqual(MIN_WER_WORDS);
  expect(werEvidence.wer, `Cloud WER must be < ${(CLOUD_WER_THRESHOLD * 100).toFixed(0)}%. Transcript="${transcript}"`).toBeLessThan(CLOUD_WER_THRESHOLD);

  await startStopButton.click();
  await expect(startStopButton).toHaveAttribute('data-recording', 'false', { timeout: 45_000 });
  await waitForCloudDisconnected(page);
  await expect(page.getByTestId('status-message-text')).toContainText(/Session saved/i, { timeout: 45_000 });
}

async function waitForLiveFixtureTranscript(
  page: Page,
  transcriptContainer: ReturnType<Page['getByTestId']>,
  cloudConsoleEvents: string[]
): Promise<string> {
  let lastText = '';
  try {
    await expect(async () => {
      const text = normalizeTranscript(await transcriptContainer.textContent());
      lastText = text;

      expect(text, 'Cloud recording must surface real live-audio fixture transcript text.').toMatch(TRANSCRIPT_PATTERN);
      expect(isPlaceholderOnlyTranscript(text), `Placeholder transcript text is not valid evidence: "${text}"`).toBe(false);
      expect(normalizeWords(text).length, `Cloud recording must produce enough words for WER proof: "${text}"`).toBeGreaterThanOrEqual(MIN_WER_WORDS);
    }).toPass({ timeout: 90_000 });
    return lastText;
  } catch (error) {
    const snapshot = await collectBenchmarkPreconditionSnapshot(page, 'cloud-live-transcript-timeout');
    const providerConcurrencyEvent = cloudConsoleEvents.find((entry) => ASSEMBLYAI_CONCURRENCY_PATTERN.test(entry));
    if (providerConcurrencyEvent) {
      throw new Error(
        `AssemblyAI provider new-session rate limit: received "Too many concurrent sessions". ` +
        `This classifies the live Cloud failure as provider/account concurrency unless it reproduces after a 5-10 minute cooldown with only this Cloud smoke running. ` +
        `Do not treat this as transcript correctness evidence; preserve teardown and rerun one Cloud smoke after cooldown.\n` +
        `Provider event: ${providerConcurrencyEvent}\n${JSON.stringify(snapshot, null, 2)}`
      );
    }
    throw new Error(`Cloud live transcript did not appear before timeout. Last transcript="${lastText}"\n${JSON.stringify(snapshot, null, 2)}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

async function stopCloudRecordingAndWaitForDisconnect(page: Page) {
  if (page.isClosed()) return;

  const startStopButton = page.getByTestId('session-start-stop-button');
  const buttonVisible = await startStopButton.isVisible({ timeout: 3_000 }).catch(() => false);
  if (buttonVisible && (await startStopButton.getAttribute('data-recording').catch(() => null)) === 'true') {
    await startStopButton.click({ timeout: 5_000 }).catch(() => undefined);
    await expect(startStopButton).toHaveAttribute('data-recording', 'false', { timeout: 15_000 }).catch(() => undefined);
  }

  await waitForCloudDisconnected(page);
  await page.waitForTimeout(3_000);
}

async function waitForCloudDisconnected(page: Page) {
  if (page.isClosed()) return;

  const closedConsolePromise = page.waitForEvent('console', {
    predicate: (message) => /\[CloudAssemblyAI\] WebSocket closed/i.test(message.text()),
    timeout: 10_000,
  }).catch(() => null);

  const runtimeSettledPromise = page.waitForFunction(() => {
    const root = document.documentElement;
    const state = root.getAttribute('data-runtime-state');
    const recording = document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording');
    return recording !== 'true' && ['READY', 'IDLE', 'TERMINATED', 'FAILED', 'FAILED_VISIBLE'].includes(state ?? '');
  }, { timeout: 10_000 }).catch(() => null);

  await Promise.race([closedConsolePromise, runtimeSettledPromise]);
}

function normalizeTranscript(text: string | null) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function isPlaceholderOnlyTranscript(text: string) {
  return PLACEHOLDER_TRANSCRIPT_PATTERN.test(text) && !TRANSCRIPT_PATTERN.test(text);
}

function calculateFixtureWerEvidence(transcript: string) {
  const hypothesisWords = normalizeWords(transcript);
  const repeatedReferenceWords = normalizeWords(Array.from({ length: 8 }, () => HARVARD_FULL).join(' '));
  const windowSize = hypothesisWords.length;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestStart = 0;

  for (let start = 0; start <= repeatedReferenceWords.length - windowSize; start++) {
    const referenceWindow = repeatedReferenceWords.slice(start, start + windowSize);
    const distance = levenshteinDistance(referenceWindow, hypothesisWords);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestStart = start;
    }
  }

  return {
    fixture: 'harvard_benchmark_16k_loop_120s.wav',
    truth: 'HARVARD_FULL repeated',
    threshold: CLOUD_WER_THRESHOLD,
    wordCount: hypothesisWords.length,
    wer: windowSize === 0 ? 1 : bestDistance / windowSize,
    editDistance: bestDistance,
    referenceWindowStart: bestStart,
    transcript: hypothesisWords.join(' '),
    referenceWindow: repeatedReferenceWords.slice(bestStart, bestStart + windowSize).join(' '),
  };
}

function normalizeWords(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function levenshteinDistance(referenceWords: string[], hypothesisWords: string[]) {
  const dp = new Int32Array(hypothesisWords.length + 1);
  for (let j = 0; j <= hypothesisWords.length; j++) dp[j] = j;

  for (let i = 1; i <= referenceWords.length; i++) {
    let previousDiagonal = dp[0];
    dp[0] = i;

    for (let j = 1; j <= hypothesisWords.length; j++) {
      const previousAbove = dp[j];
      const cost = referenceWords[i - 1] === hypothesisWords[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        previousDiagonal + cost
      );
      previousDiagonal = previousAbove;
    }
  }

  return dp[hypothesisWords.length];
}
