import { test, expect, type Page } from '@playwright/test';
import { AUDIO_ARGS, collectBenchmarkPreconditionSnapshot, selectBenchmarkMode } from './helpers/benchmark-utils';
import { HARVARD_BENCHMARK_LONG_AUDIO } from './helpers/audio-fixtures';

const BASE_URL = process.env.BASE_URL;
const E2E_PRO_EMAIL = process.env.E2E_PRO_EMAIL;
const E2E_PRO_PASSWORD = process.env.E2E_PRO_PASSWORD;
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

test('Pro Cloud live STT can transcribe, save, and show analytics history', async ({ page }) => {
  test.skip(!BASE_URL || !E2E_PRO_EMAIL || !E2E_PRO_PASSWORD, 'BASE_URL and E2E Pro credentials are required.');

  page.on('console', (message) => {
    const text = message.text();
    if (/CloudAssemblyAI|assemblyai-token|TranscriptionService|SpeechRuntime|WebSocket|transcript/i.test(text)) {
      console.log(`[browser:${message.type()}] ${text}`);
    }
  });

  await signInAsPro(page);
  await expect(page).toHaveURL(/\/session/, { timeout: 30_000 });
  await expect(page.getByTestId('pro-badge')).toBeVisible({ timeout: 20_000 });

  await selectCloudMode(page);
  await recordCloudSessionUntilTranscript(page);

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

async function recordCloudSessionUntilTranscript(page: Page) {
  const startStopButton = page.getByTestId('session-start-stop-button');
  await expect(startStopButton).toBeVisible({ timeout: 30_000 });
  await expect(startStopButton).toBeEnabled({ timeout: 60_000 });

  const tokenResponsePromise = page.waitForResponse((response) =>
    response.url().includes('/functions/v1/assemblyai-token') &&
    response.request().method() === 'POST'
  );

  await startStopButton.click();
  const tokenResponse = await tokenResponsePromise;
  expect(tokenResponse.status(), `assemblyai-token response: ${await tokenResponse.text().catch(() => '')}`).toBe(200);
  await expect(startStopButton).toHaveAttribute('data-recording', 'true', { timeout: 45_000 });

  const transcriptContainer = page.getByTestId('transcript-container');
  await waitForLiveFixtureTranscript(page, transcriptContainer);

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

      expect(text, 'Cloud recording must surface real live-audio fixture transcript text.').toMatch(TRANSCRIPT_PATTERN);
      expect(isPlaceholderOnlyTranscript(text), `Placeholder transcript text is not valid evidence: "${text}"`).toBe(false);
    }).toPass({ timeout: 90_000 });
  } catch (error) {
    const snapshot = await collectBenchmarkPreconditionSnapshot(page, 'cloud-live-transcript-timeout');
    throw new Error(`Cloud live transcript did not appear before timeout. Last transcript="${lastText}"\n${JSON.stringify(snapshot, null, 2)}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeTranscript(text: string | null) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function isPlaceholderOnlyTranscript(text: string) {
  return PLACEHOLDER_TRANSCRIPT_PATTERN.test(text) && !TRANSCRIPT_PATTERN.test(text);
}
