import { test, expect, type Page, type Response, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { AUDIO_ARGS, collectBenchmarkPreconditionSnapshot, selectBenchmarkMode } from './helpers/benchmark-utils';
import { HARVARD_BENCHMARK_LONG_AUDIO } from './helpers/audio-fixtures';

const BASE_URL = process.env.BASE_URL;
const E2E_PRO_EMAIL = process.env.E2E_PRO_EMAIL;
const E2E_PRO_PASSWORD = process.env.E2E_PRO_PASSWORD;
const MODES = ['private', 'cloud', 'native'] as const;
const TRANSCRIPT_PATTERN = /\b(stale|beer|pepper|beef|swan|park|twister|wild|puppy|quick|brown|fox)\b/i;
const PLACEHOLDER_TRANSCRIPT_PATTERN = /\b(words appear here|listening)\b/i;
const ASSEMBLYAI_CONCURRENCY_PATTERN = /too many concurrent sessions/i;
const MIN_SAVEABLE_RECORDING_MS = 5_000;

type SttMode = typeof MODES[number];

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
  await stopRecordingAndWaitForSettled(page);
});

test.describe.serial('Pro STT artifact path matrix @live', () => {
  test.beforeAll(() => {
    test.skip(!BASE_URL || !E2E_PRO_EMAIL || !E2E_PRO_PASSWORD, 'BASE_URL and E2E Pro credentials are required.');
  });

  for (const mode of MODES) {
    test(`Pro ${mode} records fixture transcript, saves, opens analytics, gets AI feedback, and exports PDF`, async ({ page }, testInfo) => {
      const consoleEvents = attachSttConsoleTrace(page, mode);

      await signInAsPro(page);
      await expect(page).toHaveURL(/\/session/, { timeout: 30_000 });
      await expect(page.getByTestId('pro-badge')).toBeVisible({ timeout: 30_000 });
      await selectBenchmarkMode(page, mode);

      const transcript = await recordUntilFixtureTranscript(page, mode, consoleEvents);
      const detailHref = await openLatestAnalyticsDetail(page);
      await assertAiSuggestionsUsable(page);
      const pdfEvidence = await assertPdfExport(page, testInfo);

      console.log(`LIVE_PRO_STT_ARTIFACT_EVIDENCE ${JSON.stringify({
        mode,
        detailHref,
        transcriptPreview: transcript.slice(0, 180),
        transcriptLength: transcript.length,
        pdf: pdfEvidence,
      })}`);
    });
  }
});

async function signInAsPro(page: Page) {
  await page.goto('/auth/signin');
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('email-input').fill(E2E_PRO_EMAIL!);
  await page.getByTestId('password-input').fill(E2E_PRO_PASSWORD!);
  await page.getByTestId('sign-in-submit').click();
}

function attachSttConsoleTrace(page: Page, mode: SttMode) {
  const events: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    const tracePattern = mode === 'cloud'
      ? /CloudAssemblyAI|assemblyai-token|TranscriptionService|SpeechRuntime|WebSocket|transcript/i
      : /PrivateWhisper|SpeechRecognition|TranscriptionService|SpeechRuntime|TRANSCRIPT_PULSE|transcript/i;

    if (tracePattern.test(text)) {
      events.push(text);
      console.log(`[browser:${message.type()}] ${text}`);
    }
  });
  return events;
}

async function recordUntilFixtureTranscript(page: Page, mode: SttMode, consoleEvents: string[]) {
  if (mode === 'private') {
    await preparePrivateModelIfPrompted(page);
  }

  const startStopButton = page.getByTestId('session-start-stop-button');
  await expect(startStopButton).toBeVisible({ timeout: 30_000 });
  await expect(startStopButton).toBeEnabled({ timeout: 90_000 });

  const tokenResponsePromise = mode === 'cloud'
    ? page.waitForResponse((response) =>
      response.url().includes('/functions/v1/assemblyai-token') &&
      response.request().method() === 'POST'
    )
    : null;

  await startStopButton.click();
  const recordingStartedAt = Date.now();

  if (tokenResponsePromise) {
    const tokenResponse = await tokenResponsePromise;
    expect(tokenResponse.status(), `assemblyai-token response: ${await tokenResponse.text().catch(() => '')}`).toBe(200);
  }

  await expect(startStopButton).toHaveAttribute('data-recording', 'true', { timeout: 45_000 });

  const transcriptContainer = page.getByTestId('transcript-container');
  const transcript = await waitForLiveFixtureTranscript(page, mode, transcriptContainer, consoleEvents);

  // Product save policy requires at least five seconds of recording before save.
  await page.waitForTimeout(Math.max(0, MIN_SAVEABLE_RECORDING_MS - (Date.now() - recordingStartedAt)));

  await startStopButton.click();
  await expect(startStopButton).toHaveAttribute('data-recording', 'false', { timeout: 45_000 });
  await waitForRecordingSettled(page, mode);
  await expect(page.getByTestId('status-message-text')).toContainText(/Session saved/i, { timeout: 45_000 });

  return transcript;
}

async function waitForLiveFixtureTranscript(
  page: Page,
  mode: SttMode,
  transcriptContainer: ReturnType<Page['getByTestId']>,
  consoleEvents: string[]
): Promise<string> {
  let lastText = '';
  try {
    await expect(async () => {
      const text = normalizeTranscript(await transcriptContainer.textContent());
      lastText = text;

      expect(text, `${mode} recording must surface real live-audio fixture transcript text before artifact assertions.`).toMatch(TRANSCRIPT_PATTERN);
      expect(isPlaceholderOnlyTranscript(text), `Placeholder transcript text is not valid evidence: "${text}"`).toBe(false);
    }).toPass({ timeout: 120_000 });

    return lastText;
  } catch (error) {
    const snapshot = await collectBenchmarkPreconditionSnapshot(page, `${mode}-artifact-transcript-timeout`);
    const providerConcurrencyEvent = consoleEvents.find((entry) => ASSEMBLYAI_CONCURRENCY_PATTERN.test(entry));
    if (mode === 'cloud' && providerConcurrencyEvent) {
      throw new Error(
        `AssemblyAI provider new-session rate limit: received "Too many concurrent sessions". ` +
        `Classify this as provider/account concurrency unless it reproduces after a 5-10 minute cooldown with only this Cloud proof running.\n` +
        `Provider event: ${providerConcurrencyEvent}\n${JSON.stringify(snapshot, null, 2)}`
      );
    }

    throw new Error(`${mode} live transcript did not appear before timeout. Last transcript="${lastText}"\n${JSON.stringify(snapshot, null, 2)}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

async function openLatestAnalyticsDetail(page: Page) {
  await page.goto('/analytics');
  await page.locator('html[data-app-ready="true"]').waitFor({ timeout: 45_000 });

  const savedSession = page.getByTestId(/^session-history-item-/).first();
  await expect(savedSession, 'latest saved session should be visible in history').toBeVisible({ timeout: 45_000 });

  const detailHref = await savedSession.evaluate((element) => {
    const self = element instanceof HTMLAnchorElement ? element : null;
    const nested = element.querySelector<HTMLAnchorElement>('a[href^="/analytics/"]');
    return self?.getAttribute('href') ?? nested?.getAttribute('href') ?? null;
  });
  expect(detailHref, 'saved session should expose an analytics detail link').toBeTruthy();

  await page.goto(detailHref!);
  await expect(page).toHaveURL(/\/analytics\/[^/]+$/, { timeout: 20_000 });
  await expect(page.getByTestId('ai-suggestions-card')).toBeVisible({ timeout: 20_000 });

  return detailHref!;
}

async function assertAiSuggestionsUsable(page: Page) {
  const suggestionsCard = page.getByTestId('ai-suggestions-card');
  const getSuggestionsButton = suggestionsCard.getByRole('button', { name: /get suggestions/i });
  await expect(getSuggestionsButton).toBeEnabled({ timeout: 20_000 });

  const suggestionsResponsePromise = page.waitForResponse((response) =>
    response.url().includes('/functions/v1/get-ai-suggestions') &&
    response.request().method() === 'POST'
  );

  await getSuggestionsButton.click();
  const suggestionsResponse = await suggestionsResponsePromise;
  await expectNonErrorResponse(suggestionsResponse, 'get-ai-suggestions');
  await expect(suggestionsCard.getByText(/^Error$/)).not.toBeVisible({ timeout: 10_000 });
}

async function expectNonErrorResponse(response: Response, label: string) {
  const responseBody = await response.text().catch(() => '');
  console.log(`${label.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_LIVE_RESPONSE ${JSON.stringify({
    url: response.url(),
    status: response.status(),
    body: responseBody.slice(0, 1000),
  })}`);

  expect(response.status(), `${label} should not return a server error: ${responseBody}`).toBeLessThan(500);

  if (response.ok()) {
    const body = responseBody ? JSON.parse(responseBody) as { error?: unknown } : null;
    expect(body?.error, `${label} response body should not include an error`).toBeFalsy();
  }
}

async function assertPdfExport(page: Page, testInfo: TestInfo) {
  const pdfButton = page.getByRole('button', { name: /pdf|export|download/i }).first();
  await expect(pdfButton).toBeVisible({ timeout: 20_000 });

  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });

  await pdfButton.click();
  const download = await downloadPromise;
  const downloadedFileName = download.suggestedFilename();
  expect(downloadedFileName).toMatch(/^session_\d{8}_[A-Za-z0-9_]+\.pdf$/);

  const artifactPath = testInfo.outputPath(downloadedFileName);
  await download.saveAs(artifactPath);
  await testInfo.attach('session-pdf', { path: artifactPath, contentType: 'application/pdf' });

  const pdfText = await extractPdfText(artifactPath);
  expect(pdfText).toContain('SpeakSharp Session Report');
  expect(pdfText).toContain('Transcript');
  expect(pdfText).toMatch(/swan dive|park truck|pepper|twister|quick brown fox|stale smell|old beer/i);

  const evidence = {
    filename: downloadedFileName,
    artifact: artifactPath,
    textIncludesTranscript: /swan dive|park truck|pepper|twister|quick brown fox|stale smell|old beer/i.test(pdfText),
    textLength: pdfText.length,
  };
  console.log(`LIVE_PDF_EXPORT_EVIDENCE ${JSON.stringify(evidence)}`);
  return evidence;
}

async function preparePrivateModelIfPrompted(page: Page) {
  const downloadButton = page.getByTestId('download-model-button');
  if (await downloadButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await downloadButton.click();
  }

  await page.waitForFunction(() => {
    const root = document.documentElement;
    const runtimeState = root.getAttribute('data-runtime-state');
    const sttReady = root.getAttribute('data-stt-ready');
    const modelStatus = root.getAttribute('data-model-status');

    return (
      sttReady === 'true' ||
      runtimeState === 'READY' ||
      runtimeState === 'RECORDING' ||
      modelStatus === 'ready'
    );
  }, { timeout: 120_000 });
}

async function stopRecordingAndWaitForSettled(page: Page) {
  if (page.isClosed()) return;

  const startStopButton = page.getByTestId('session-start-stop-button');
  const buttonVisible = await startStopButton.isVisible({ timeout: 3_000 }).catch(() => false);
  const mode = await page.getByTestId('stt-mode-select').getAttribute('data-state').catch(() => null) as SttMode | null;

  if (buttonVisible && (await startStopButton.getAttribute('data-recording').catch(() => null)) === 'true') {
    await startStopButton.click({ timeout: 5_000 }).catch(() => undefined);
    await expect(startStopButton).toHaveAttribute('data-recording', 'false', { timeout: 15_000 }).catch(() => undefined);
  }

  await waitForRecordingSettled(page, mode ?? 'native');
}

async function waitForRecordingSettled(page: Page, mode: SttMode) {
  if (page.isClosed()) return;

  const runtimeSettledPromise = page.waitForFunction(() => {
    const root = document.documentElement;
    const state = root.getAttribute('data-runtime-state');
    const recording = document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording');
    return recording !== 'true' && ['READY', 'IDLE', 'TERMINATED', 'FAILED', 'FAILED_VISIBLE'].includes(state ?? '');
  }, { timeout: 15_000 }).catch(() => null);

  if (mode !== 'cloud') {
    await runtimeSettledPromise;
    return;
  }

  const closedConsolePromise = page.waitForEvent('console', {
    predicate: (message) => /\[CloudAssemblyAI\] WebSocket closed/i.test(message.text()),
    timeout: 15_000,
  }).catch(() => null);

  await Promise.race([closedConsolePromise, runtimeSettledPromise]);
  await page.waitForTimeout(3_000);
}

async function extractPdfText(path: string) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = await readFile(path);
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
  const pageTexts = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
    const page = await pdf.getPage(index + 1);
    const textContent = await page.getTextContent();
    return textContent.items
      .map((item) => ('str' in item ? (item as { str: string }).str : ''))
      .join(' ');
  }));

  return pageTexts.join('\n').trim();
}

function normalizeTranscript(text: string | null) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function isPlaceholderOnlyTranscript(text: string) {
  return PLACEHOLDER_TRANSCRIPT_PATTERN.test(text) && !TRANSCRIPT_PATTERN.test(text);
}
