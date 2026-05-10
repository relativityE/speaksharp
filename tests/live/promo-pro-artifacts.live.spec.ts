import { test, expect, type Page, type Response, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { AUDIO_ARGS, collectBenchmarkPreconditionSnapshot } from './helpers/benchmark-utils';
import { HARVARD_BENCHMARK_LONG_AUDIO } from './helpers/audio-fixtures';

const BASE_URL = process.env.BASE_URL;
const PROMO_CODE = process.env.PROMO_CODE;
const RUN_ID = Date.now();
const TEST_EMAIL = `promo-pro-artifacts-${RUN_ID}@example.com`;
const TEST_PASSWORD = `SpeakSharp-${RUN_ID}!`;
const TRANSCRIPT_PATTERN = /\b(stale|beer|pepper|beef|swan|park|twister|wild|puppy|quick|brown|fox)\b/i;
const PLACEHOLDER_TRANSCRIPT_PATTERN = /\b(words appear here|listening)\b/i;

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

test.describe.serial('Deployed promo Pro artifact path @live', () => {
  test.beforeAll(() => {
    test.skip(!BASE_URL, 'BASE_URL is required for deployed-only promo Pro artifact validation.');
    test.skip(!PROMO_CODE, 'PROMO_CODE is required for deployed-only promo Pro artifact validation.');

    let parsedBaseUrl: URL;
    try {
      parsedBaseUrl = new URL(BASE_URL!);
    } catch {
      test.skip(true, `BASE_URL must be a valid deployed URL; received ${BASE_URL}.`);
      return;
    }

    test.skip(
      ['localhost', '127.0.0.1', '::1'].includes(parsedBaseUrl.hostname),
      `BASE_URL must target a deployed environment; received ${BASE_URL}.`
    );
  });

  test('fresh promo signup can record, save, analyze, request AI feedback, and export PDF', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __PRIVATE_TRANSCRIPT_TRACE__?: boolean }).__PRIVATE_TRANSCRIPT_TRACE__ = true;
    });
    page.on('console', (message) => {
      const text = message.text();
      if (/\[PRIVATE_TRACE\]|PrivateWhisper|TranscriptionService|TRANSCRIPT_PULSE|SpeechRuntime|Supabase DB/i.test(text)) {
        console.log(`[browser:${message.type()}] ${text}`);
      }
    });

    await signUpWithPromo(page, TEST_EMAIL, TEST_PASSWORD, PROMO_CODE!);

    await expect(page).toHaveURL(/\/session/, { timeout: 30_000 });
    await expect(page.getByTestId('nav-sign-out-button')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('pro-badge')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('stt-mode-select')).toHaveAttribute('data-state', 'private', { timeout: 30_000 });

    await ensurePrivateModeSelected(page);
    await recordPrivateSessionUntilTranscript(page);

    await page.goto('/analytics');
    await expect(page).toHaveURL(/\/analytics/, { timeout: 20_000 });

    const savedSession = page.getByTestId(/^session-history-item-/).first();
    await expect(savedSession, 'fresh promo user should have one saved session visible in history').toBeVisible({ timeout: 45_000 });

    await expect(page.getByText(/Pro Plan Active/i)).toBeVisible({ timeout: 20_000 });
    const detailHref = await savedSession.evaluate((element) => {
      const self = element instanceof HTMLAnchorElement ? element : null;
      const nested = element.querySelector<HTMLAnchorElement>('a[href^="/analytics/"]');
      return self?.getAttribute('href') ?? nested?.getAttribute('href') ?? null;
    });
    expect(detailHref, 'saved session should expose an analytics detail link').toBeTruthy();

    await page.goto(detailHref!);
    await expect(page).toHaveURL(/\/analytics\/[^/]+$/, { timeout: 20_000 });
    await expect(page.getByTestId('ai-suggestions-card')).toBeVisible({ timeout: 20_000 });
    await assertAiSuggestionsUsable(page);
    await assertPdfExport(page, test.info());
  });
});

async function signUpWithPromo(page: Page, email: string, password: string, promoCode: string) {
  const promoResponsePromise = page.waitForResponse((response) =>
    response.url().includes('/functions/v1/apply-promo') &&
    response.request().method() === 'POST'
  );

  await page.goto('/auth/signup');
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('plan-pro-option').click();
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(password);
  await page.getByText(/Have a promo code/i).click();
  await page.getByTestId('promo-code-input').fill(promoCode);
  await page.getByTestId('sign-up-submit').click();

  const promoResponse = await promoResponsePromise;
  expect(promoResponse.status(), `apply-promo status for ${email}`).toBe(200);

  const body = await promoResponse.json() as { success?: boolean; proFeatureMinutes?: number };
  expect(body.success, JSON.stringify(body)).toBe(true);
  expect(body.proFeatureMinutes, JSON.stringify(body)).toBeGreaterThan(0);
}

async function ensurePrivateModeSelected(page: Page) {
  const modeSelect = page.getByTestId('stt-mode-select');
  await expect(modeSelect).toBeVisible({ timeout: 20_000 });

  if ((await modeSelect.getAttribute('data-state')) === 'private') {
    return;
  }

  await modeSelect.click();
  await page.getByTestId('stt-mode-private').click();
  await expect(modeSelect).toHaveAttribute('data-state', 'private', { timeout: 15_000 });
}

async function recordPrivateSessionUntilTranscript(page: Page) {
  await preparePrivateModelIfPrompted(page);

  const startStopButton = page.getByTestId('session-start-stop-button');
  await expect(startStopButton).toBeVisible({ timeout: 30_000 });
  await expect(startStopButton).toBeEnabled({ timeout: 90_000 });

  await startStopButton.click();
  await expect(startStopButton).toHaveAttribute('data-recording', 'true', { timeout: 45_000 });

  const transcriptContainer = page.getByTestId('transcript-container');
  await waitForLiveFixtureTranscript(page, transcriptContainer);

  await page.waitForTimeout(1_000);
  await startStopButton.click();
  await expect(startStopButton).toHaveAttribute('data-recording', 'false', { timeout: 45_000 });
  await expect(page.getByTestId('status-message-text')).toContainText(/Session saved/i, { timeout: 45_000 });
}

async function waitForLiveFixtureTranscript(page: Page, transcriptContainer: ReturnType<Page['getByTestId']>) {
  let lastText = '';
  try {
    await expect(async () => {
      const text = normalizeTranscript(await transcriptContainer.textContent());
      lastText = text;

      expect(
        text,
        'Private recording must surface real live-audio fixture transcript text before save/history assertions.'
      ).toMatch(TRANSCRIPT_PATTERN);

      expect(
        isPlaceholderOnlyTranscript(text),
        `Placeholder transcript text is not valid evidence: "${text}"`
      ).toBe(false);
    }).toPass({ timeout: 90_000 });
  } catch (error) {
    const snapshot = await collectBenchmarkPreconditionSnapshot(page, 'private-live-transcript-timeout');
    throw new Error(`Private live transcript did not appear before timeout. Last transcript="${lastText}"\n${JSON.stringify(snapshot, null, 2)}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeTranscript(text: string | null) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function isPlaceholderOnlyTranscript(text: string) {
  return PLACEHOLDER_TRANSCRIPT_PATTERN.test(text) && !TRANSCRIPT_PATTERN.test(text);
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
  expect(pdfText).toMatch(/swan dive|park truck|pepper|twister|quick brown fox/i);

  console.log(`LIVE_PDF_EXPORT_EVIDENCE ${JSON.stringify({
    filename: downloadedFileName,
    artifact: artifactPath,
    textIncludesTranscript: /swan dive|park truck|pepper|twister|quick brown fox/i.test(pdfText),
    textLength: pdfText.length,
  })}`);
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
