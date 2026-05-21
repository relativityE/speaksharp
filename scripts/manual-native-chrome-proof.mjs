import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.BASE_URL || 'https://speaksharp-public.vercel.app';
const EMAIL = process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL;
const PASSWORD = process.env.PRO_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD;
const SIGNUP_EMAIL = process.env.NATIVE_PROOF_EMAIL || `native-proof-${Date.now()}@example.com`;
const SIGNUP_PASSWORD = process.env.NATIVE_PROOF_PASSWORD || `NativeProof${Date.now()}!`;
const OUT = process.env.NATIVE_PROOF_OUT || '/private/tmp/native-chrome-proof.json';
const SPOKEN_SENTENCE = 'Native Chrome microphone proof. The quick brown fox reads clear speech for SpeakSharp release validation.';

function compact(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

async function selectMode(page, mode) {
  const select = page.getByTestId('stt-mode-select');
  await select.waitFor({ state: 'visible', timeout: 30_000 });
  for (let attempt = 0; attempt < 8; attempt++) {
    await select.click({ force: true });
    const option = page.getByTestId(`stt-mode-${mode}`);
    if (await option.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await option.click({ force: true });
      await page.waitForTimeout(750);
      if ((await select.getAttribute('data-state')) === mode) return;
    }
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(1_000);
  }
  throw new Error(`Could not select STT mode ${mode}; final state=${await select.getAttribute('data-state')}`);
}

async function speakSentence() {
  if (process.platform !== 'darwin') return { attempted: false, reason: 'non-darwin' };
  const chunks = [
    SPOKEN_SENTENCE,
    'Again, this is Native Chrome browser speech recognition using the real microphone path.',
  ];

  for (const chunk of chunks) {
    await execFileAsync('/usr/bin/say', ['-v', 'Samantha', '-r', '165', chunk], { timeout: 30_000 });
  }
  return { attempted: true, sentence: SPOKEN_SENTENCE };
}

const evidence = {
  baseUrl: BASE_URL,
  browser: 'Google Chrome via Playwright channel=chrome, headed',
  microphonePath: 'real browser getUserMedia, no fake audio flags',
  spokenSentence: SPOKEN_SENTENCE,
  startedAt: new Date().toISOString(),
  login: false,
  signup: false,
  proofEmail: EMAIL ?? SIGNUP_EMAIL,
  modeSelected: false,
  recordingStarted: false,
  transcriptVisible: false,
  transcriptMatchesScript: false,
  saved: false,
  historyVisible: false,
  analyticsVisible: false,
  blockers: [],
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--disable-blink-features=AutomationControlled',
  ],
});

try {
  const context = await browser.newContext({
    permissions: ['microphone'],
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();

  page.on('console', (message) => {
    const text = message.text();
    if (/SpeechRecognition|Transcription|Session saved|microphone|error|failed/i.test(text)) {
      console.log(`[browser:${message.type()}] ${text}`);
    }
  });

  if (!EMAIL || !PASSWORD) {
    await page.goto(`${BASE_URL}/auth/signup`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('email-input').fill(SIGNUP_EMAIL);
    await page.getByTestId('password-input').fill(SIGNUP_PASSWORD);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/auth/v1/signup') || response.url().includes('/auth/v1/token'), { timeout: 45_000 }).catch(() => null),
      page.getByTestId('sign-up-submit').click(),
    ]);
    await page.waitForURL(/\/session/, { timeout: 60_000 });
    evidence.signup = true;
    evidence.login = true;
  } else {
    await page.goto(`${BASE_URL}/auth/signin`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('email-input').fill(EMAIL);
    await page.getByTestId('password-input').fill(PASSWORD);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/auth/v1/token') && response.request().method() === 'POST', { timeout: 30_000 }),
      page.getByTestId('sign-in-submit').click(),
    ]);
    evidence.login = true;
  }

  await page.goto(`${BASE_URL}/session`, { waitUntil: 'domcontentloaded' });
  await page.locator('html[data-app-ready="true"]').waitFor({ timeout: 60_000 });
  evidence.profileTextBeforeNative = compact(await page.locator('[data-testid="pro-badge"], [data-testid="nav-upgrade-button"]').first().textContent().catch(() => ''));
  await selectMode(page, 'native');
  evidence.modeSelected = (await page.getByTestId('stt-mode-select').getAttribute('data-state')) === 'native';

  const startButton = page.getByTestId('session-start-stop-button');
  await startButton.click();
  await startButton.waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording') === 'true', null, { timeout: 45_000 });
  evidence.recordingStarted = true;

  evidence.audioPlayback = await speakSentence();
  await page.waitForTimeout(8_000);

  const transcriptText = compact(await page.getByTestId('transcript-container').textContent().catch(() => ''));
  evidence.transcriptSample = transcriptText.slice(0, 500);
  evidence.transcriptLength = transcriptText.length;
  evidence.transcriptVisible = transcriptText.length >= 12 && !/\b(listening|words appear here|start speaking)\b/i.test(transcriptText);
  evidence.transcriptMatchesScript = /\b(native|chrome|microphone|speech|speaksharp|proof|quick|brown|release|validation)\b/i.test(transcriptText);

  await startButton.click();
  await page.waitForFunction(() => document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording') === 'false', null, { timeout: 60_000 }).catch((error) => {
    evidence.blockers.push(`stop did not settle: ${error.message}`);
  });
  await page.waitForTimeout(3_000);
  evidence.saved = await page.locator('html[data-session-persisted="true"]').isVisible().catch(() => false);

  await page.goto(`${BASE_URL}/analytics`, { waitUntil: 'domcontentloaded' });
  await page.locator('html[data-app-ready="true"]').waitFor({ timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  const historyItem = page.getByTestId(/^session-history-item-/).first();
  evidence.historyVisible = await historyItem.isVisible({ timeout: 20_000 }).catch(() => false);
  evidence.analyticsBodySample = compact(await page.locator('body').textContent()).slice(0, 1000);
  if (evidence.historyVisible) {
    await historyItem.click();
    await page.waitForTimeout(3_000);
  }
  evidence.analyticsVisible = /analytics|words per minute|wpm|clarity|filler|session/i.test(compact(await page.locator('body').textContent()));
  evidence.finalUrl = page.url();

  if (!evidence.transcriptVisible) evidence.blockers.push('No non-placeholder live Native transcript from real Chrome/mic path.');
  if (!evidence.saved) evidence.blockers.push('Native session did not expose saved-session marker.');
  if (!evidence.historyVisible) evidence.blockers.push('Native session history item was not visible.');
  if (!evidence.analyticsVisible) evidence.blockers.push('Native analytics detail/context was not visible.');
} catch (error) {
  evidence.blockers.push(error instanceof Error ? error.message : String(error));
} finally {
  evidence.completedAt = new Date().toISOString();
  evidence.pass = evidence.blockers.length === 0;
  await writeFile(OUT, JSON.stringify(evidence, null, 2));
  console.log(`NATIVE_CHROME_MIC_EVIDENCE ${JSON.stringify(evidence)}`);
  await browser.close().catch(() => undefined);
}

if (!evidence.pass) {
  process.exitCode = 1;
}
