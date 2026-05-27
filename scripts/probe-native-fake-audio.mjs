import { chromium } from 'playwright';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4173';
const AUDIO_FILE = path.resolve(process.env.AUDIO_FILE || 'tests/fixtures/stt-isomorphic/audio/h1_1.wav');
const OUT = process.env.OUT || '/private/tmp/speaksharp-native-fake-audio-probe.json';
const EXPECTED = process.env.EXPECTED || 'stale smell old beer lingers';
const EMAIL = process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL ?? process.env.FREE_TEST_EMAIL ?? process.env.E2E_FREE_EMAIL ?? process.env.BASIC_TEST_EMAIL;
const PASSWORD = process.env.PRO_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD ?? process.env.FREE_TEST_PASSWORD ?? process.env.E2E_FREE_PASSWORD ?? process.env.BASIC_TEST_PASSWORD;

function compact(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

async function selectMode(page, mode) {
  const select = page.getByTestId('stt-mode-select');
  await select.waitFor({ state: 'visible', timeout: 30_000 });

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await select.click({ force: true });
    const option = page.getByTestId(`stt-mode-${mode}`);
    if (await option.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await option.click({ force: true });
      await page.waitForTimeout(500);
      if ((await select.getAttribute('data-state')) === mode) return;
    }
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(500);
  }

  throw new Error(`Could not select ${mode}; current=${await select.getAttribute('data-state')}`);
}

async function maybeSignUp(page) {
  if (EMAIL && PASSWORD) {
    await page.goto(`${BASE_URL}/auth/signin`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('email-input').fill(EMAIL);
    await page.getByTestId('password-input').fill(PASSWORD);
    await page.getByTestId('sign-in-submit').click();
    await page.waitForURL(/\/session/, { timeout: 60_000 });
    return;
  }

  await page.goto(`${BASE_URL}/auth/signup`, { waitUntil: 'domcontentloaded' });
  await page.locator('html[data-app-ready="true"]').waitFor({ timeout: 60_000 }).catch(() => undefined);

  const emailInput = page.getByTestId('email-input');
  if (!(await emailInput.isVisible({ timeout: 5_000 }).catch(() => false))) {
    await page.goto(`${BASE_URL}/session`, { waitUntil: 'domcontentloaded' });
    return;
  }

  const unique = Date.now();
  await emailInput.fill(`native-fake-${unique}@speaksharp.app`);
  await page.getByTestId('password-input').fill(`NativeFake${unique}!Aa9`);
  await page.getByTestId('sign-up-submit').click();
  await page.waitForURL(/\/session/, { timeout: 60_000 });
}

const evidence = {
  baseUrl: BASE_URL,
  audioFile: AUDIO_FILE,
  expected: EXPECTED,
  startedAt: new Date().toISOString(),
  consoleEvents: [],
  pageErrors: [],
  failedRequests: [],
  transcript: '',
  transcriptMatchesExpected: false,
  nativeTrace: [],
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${AUDIO_FILE}`,
    '--autoplay-policy=no-user-gesture-required',
    '--disable-features=WebRtcHideLocalIpsWithMdns',
  ],
});

let page;

try {
  const context = await browser.newContext({ permissions: ['microphone'] });
  page = await context.newPage();

  page.on('console', (message) => {
    const text = message.text();
    if (/Native|SpeechRecognition|Transcription|recording|failed|error/i.test(text)) {
      evidence.consoleEvents.push({ type: message.type(), text });
    }
  });
  page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
  page.on('requestfailed', (request) => evidence.failedRequests.push({
    url: request.url(),
    errorText: request.failure()?.errorText,
  }));

  await maybeSignUp(page);
  await page.goto(`${BASE_URL}/session`, { waitUntil: 'domcontentloaded' });
  await page.locator('html[data-app-ready="true"]').waitFor({ timeout: 60_000 });
  await selectMode(page, 'native');

  await page.evaluate(() => {
    window.__NATIVE_BROWSER_TRACE__ = [];
  });

  const button = page.getByTestId('session-start-stop-button');
  await button.click();
  await page.waitForFunction(() => document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording') === 'true', null, { timeout: 45_000 });
  await page.waitForTimeout(20_000);

  evidence.transcript = compact(await page.getByTestId('transcript-container').textContent().catch(() => ''));
  evidence.nativeTrace = await page.evaluate(() => window.__NATIVE_BROWSER_TRACE__ || []);
  evidence.transcriptMatchesExpected = EXPECTED
    .split(/\s+/)
    .filter(Boolean)
    .some((word) => new RegExp(`\\b${word}\\b`, 'i').test(evidence.transcript));

  await button.click().catch(() => undefined);
  await page.waitForTimeout(2_000);
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error);
  evidence.currentUrl = page?.url?.();
  evidence.bodyText = page
    ? compact(await page.locator('body').textContent().catch(() => '')).slice(0, 1200)
    : '';
} finally {
  evidence.completedAt = new Date().toISOString();
  await writeFile(OUT, JSON.stringify(evidence, null, 2));
  console.log(`NATIVE_FAKE_AUDIO_PROBE ${JSON.stringify(evidence)}`);
  await browser.close().catch(() => undefined);
}

if (!evidence.transcriptMatchesExpected) {
  process.exitCode = 1;
}
