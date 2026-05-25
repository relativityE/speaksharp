import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env.test'), override: false });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env'), override: false });

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4173';
const EMAIL = process.env.PRO_TEST_EMAIL
  ?? process.env.E2E_PRO_EMAIL
  ?? process.env.BASIC_TEST_EMAIL
  ?? process.env.TEST_USER_EMAIL;
const PASSWORD = process.env.PRO_TEST_PASSWORD
  ?? process.env.E2E_PRO_PASSWORD
  ?? process.env.BASIC_TEST_PASSWORD
  ?? process.env.TEST_USER_PASSWORD;
const OUT = process.env.STT_CORPUS_OUT || `/private/tmp/speaksharp-stt-corpus-${Date.now()}.json`;
const MODE_LIST = (process.env.STT_MODES || 'native,private,cloud')
  .split(',')
  .map((mode) => mode.trim())
  .filter(Boolean);
const FIXTURE_LIST = (process.env.STT_FIXTURES || 'h1_1')
  .split(',')
  .map((fixture) => fixture.trim())
  .filter(Boolean);
const PLAYBACK_GRACE_MS = Number(process.env.STT_PLAYBACK_GRACE_MS || 800);
const POST_PLAYBACK_WAIT_MS = Number(process.env.STT_POST_PLAYBACK_WAIT_MS || 10_000);
const FIRST_TEXT_TIMEOUT_MS = Number(process.env.STT_FIRST_TEXT_TIMEOUT_MS || 20_000);
const HEADLESS = process.env.HEADLESS === 'true';
const MAX_WER = process.env.STT_MAX_WER == null ? null : Number(process.env.STT_MAX_WER);

function compact(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function normalizeForWer(text) {
  return compact(text)
    .toLowerCase()
    .replace(/[^\w\s']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text) {
  return normalizeForWer(text).split(/\s+/).filter(Boolean);
}

function calculateWordErrorRate(reference, hypothesis) {
  const ref = words(reference);
  const hyp = words(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;

  const dp = Array.from({ length: ref.length + 1 }, () => Array(hyp.length + 1).fill(0));
  for (let i = 0; i <= ref.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= hyp.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= ref.length; i += 1) {
    for (let j = 1; j <= hyp.length; j += 1) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[ref.length][hyp.length] / ref.length;
}

async function loadHarvardFixtures() {
  const sourcePath = path.resolve('tests/fixtures/stt-isomorphic/harvard-sentences.ts');
  const source = await readFile(sourcePath, 'utf8');
  const matches = [...source.matchAll(/\{\s*id:\s*'([^']+)'\s*,\s*transcript:\s*"([^"]+)"\s*\}/g)];
  if (matches.length === 0) {
    throw new Error(`No Harvard fixtures parsed from ${sourcePath}`);
  }

  const byId = new Map();
  for (const [, id, transcript] of matches) {
    byId.set(id, {
      id,
      transcript,
      audioPath: path.resolve(`tests/fixtures/stt-isomorphic/audio/${id}.wav`),
    });
  }

  return FIXTURE_LIST.map((id) => {
    const fixture = byId.get(id);
    if (!fixture) throw new Error(`Unknown STT fixture "${id}". Known: ${[...byId.keys()].join(', ')}`);
    return fixture;
  });
}

async function signIn(page) {
  if (!EMAIL || !PASSWORD) {
    throw new Error('A test login is required for STT corpus proof. Set PRO_TEST_EMAIL/PRO_TEST_PASSWORD, E2E_PRO_EMAIL/E2E_PRO_PASSWORD, or BASIC_TEST_EMAIL/BASIC_TEST_PASSWORD.');
  }

  await page.goto(`${BASE_URL}/auth/signin`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('email-input').fill(EMAIL);
  await page.getByTestId('password-input').fill(PASSWORD);
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/auth/v1/token') && response.request().method() === 'POST', { timeout: 45_000 }),
    page.getByTestId('sign-in-submit').click(),
  ]);
  await page.waitForURL(/\/session/, { timeout: 60_000 });
}

async function selectMode(page, mode) {
  const select = page.getByTestId('stt-mode-select');
  await select.waitFor({ state: 'visible', timeout: 45_000 });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await select.click({ force: true });
    const option = page.getByTestId(`stt-mode-${mode}`);
    if (await option.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await option.click({ force: true });
      await page.waitForTimeout(750);
      if ((await select.getAttribute('data-state')) === mode) return;
    }
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(750);
  }

  throw new Error(`Could not select STT mode "${mode}"; final state=${await select.getAttribute('data-state')}`);
}

async function waitForNativeReady(page) {
  await page.waitForFunction(
    () => {
      const trace = window.__NATIVE_BROWSER_TRACE__ || [];
      return trace.some((entry) => entry.event === 'onaudiostart' || entry.event === 'onspeechstart' || entry.event === 'acoustic_ready');
    },
    null,
    { timeout: 12_000 },
  ).catch(() => undefined);
}

async function readTranscript(page) {
  return compact(await page.getByTestId('transcript-container').textContent().catch(() => ''));
}

function isPlaceholderTranscript(text) {
  return !text || /\b(listening|words appear here|start speaking)\b/i.test(text);
}

async function waitForFirstText(page, startedAt) {
  const deadline = Date.now() + FIRST_TEXT_TIMEOUT_MS;
  let lastText = '';

  while (Date.now() < deadline) {
    const text = await readTranscript(page);
    lastText = text;
    if (!isPlaceholderTranscript(text) && words(text).length > 0) {
      return {
        timestampMs: Date.now() - startedAt,
        text,
      };
    }
    await page.waitForTimeout(250);
  }

  return {
    timestampMs: null,
    text: lastText,
  };
}

async function playFixture(audioPath) {
  if (process.platform !== 'darwin') {
    throw new Error('Real-mic STT corpus proof currently uses macOS afplay and must run on darwin.');
  }
  await execFileAsync('/usr/bin/afplay', [audioPath], { timeout: 45_000 });
}

async function runFixture(page, mode, fixture) {
  await page.goto(`${BASE_URL}/session`, { waitUntil: 'domcontentloaded' });
  await page.locator('html[data-app-ready="true"]').waitFor({ timeout: 60_000 });
  await selectMode(page, mode);

  await page.evaluate(() => {
    window.__NATIVE_BROWSER_TRACE__ = [];
    window.__PRIVATE_TRANSCRIPT_TRACE__ = true;
    window.__NATIVE_PARALLEL_CAPTURE_TRACE__ = true;
  });

  const startButton = page.getByTestId('session-start-stop-button');
  await startButton.click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording') === 'true',
    null,
    { timeout: 60_000 },
  );

  const startedAt = Date.now();
  if (mode === 'native') await waitForNativeReady(page);
  await page.waitForTimeout(PLAYBACK_GRACE_MS);

  const firstTextPromise = waitForFirstText(page, startedAt);
  await playFixture(fixture.audioPath);
  const firstText = await firstTextPromise;
  await page.waitForTimeout(POST_PLAYBACK_WAIT_MS);

  const transcript = await readTranscript(page);
  await startButton.click().catch(() => undefined);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording') === 'false',
    null,
    { timeout: 60_000 },
  ).catch(() => undefined);
  await page.waitForTimeout(2_000);

  const normalizedTranscript = normalizeForWer(transcript);
  const wer = calculateWordErrorRate(fixture.transcript, transcript);
  const result = {
    mode,
    fixture: fixture.id,
    audioPath: fixture.audioPath,
    truth: fixture.transcript,
    transcript,
    normalizedTranscript,
    wordCount: words(transcript).length,
    wer,
    accuracyPct: Number(((1 - wer) * 100).toFixed(2)),
    firstText,
    sessionPersisted: await page.locator('html[data-session-persisted="true"]').isVisible().catch(() => false),
    nativeTrace: mode === 'native' ? await page.evaluate(() => window.__NATIVE_BROWSER_TRACE__ || []) : undefined,
    privateTrace: mode === 'private' ? await page.evaluate(() => window.__PRIVATE_INFERENCE_TRACE__ || window.__PRIVATE_TRANSCRIPT_TRACE__ || []) : undefined,
  };

  await page.goto(`${BASE_URL}/analytics`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await page.locator('html[data-app-ready="true"]').waitFor({ timeout: 30_000 }).catch(() => undefined);
  result.historyVisible = await page.getByTestId(/^session-history-item-/).first().isVisible({ timeout: 15_000 }).catch(() => false);
  result.analyticsBodySample = compact(await page.locator('body').textContent().catch(() => '')).slice(0, 1000);
  result.truthWordsHeard = words(fixture.transcript).filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(result.normalizedTranscript));
  result.inputLikelyContaminated = result.wordCount > 0 && result.truthWordsHeard.length === 0;
  result.journeyPass = Boolean(result.sessionPersisted && result.historyVisible && result.firstText.timestampMs != null);
  result.meetsWerThreshold = MAX_WER == null ? null : result.wer <= MAX_WER;
  result.verdict = result.inputLikelyContaminated
    ? 'input-contaminated-or-fixture-not-captured'
    : result.journeyPass
      ? 'journey-completed'
      : 'journey-incomplete';

  return result;
}

const evidence = {
  baseUrl: BASE_URL,
  modes: MODE_LIST,
  fixtures: FIXTURE_LIST,
  maxWer: MAX_WER,
  microphonePath: 'real browser getUserMedia with afplay through the physical speaker/mic path',
  startedAt: new Date().toISOString(),
  consoleEvents: [],
  pageErrors: [],
  failedRequests: [],
  results: [],
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: HEADLESS,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--disable-blink-features=AutomationControlled',
  ],
});

try {
  const fixtures = await loadHarvardFixtures();
  const context = await browser.newContext({
    permissions: ['microphone'],
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();

  page.on('console', (message) => {
    const text = message.text();
    if (/STT|Speech|Transcription|AssemblyAI|Native|Private|Cloud|recording|error|failed|warning/i.test(text)) {
      evidence.consoleEvents.push({ type: message.type(), text });
    }
  });
  page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
  page.on('requestfailed', (request) => evidence.failedRequests.push({
    url: request.url(),
    errorText: request.failure()?.errorText,
  }));

  await signIn(page);

  for (const mode of MODE_LIST) {
    for (const fixture of fixtures) {
      try {
        const result = await runFixture(page, mode, fixture);
        evidence.results.push(result);
        console.log(`STT_CORPUS_RESULT ${JSON.stringify({
          mode,
          fixture: fixture.id,
          wer: result.wer,
          accuracyPct: result.accuracyPct,
          firstTextMs: result.firstText.timestampMs,
          transcript: result.transcript.slice(0, 160),
        })}`);
      } catch (error) {
        evidence.results.push({
          mode,
          fixture: fixture.id,
          error: error instanceof Error ? error.message : String(error),
          currentUrl: page.url(),
          bodyText: compact(await page.locator('body').textContent().catch(() => '')).slice(0, 1200),
        });
      }
    }
  }
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error);
} finally {
  evidence.completedAt = new Date().toISOString();
  evidence.runnerPass = evidence.results.length > 0 && evidence.results.every((result) => !result.error);
  evidence.gatePass = evidence.runnerPass && evidence.results.every((result) => (
    result.journeyPass === true &&
    result.inputLikelyContaminated !== true &&
    (MAX_WER == null || result.meetsWerThreshold === true)
  ));
  evidence.pass = evidence.gatePass;
  await writeFile(OUT, JSON.stringify(evidence, null, 2));
  console.log(`STT_CORPUS_EVIDENCE ${JSON.stringify({
    out: OUT,
    runnerPass: evidence.runnerPass,
    gatePass: evidence.gatePass,
    resultCount: evidence.results.length,
    maxWer: MAX_WER,
  })}`);
  await browser.close().catch(() => undefined);
}

if (!evidence.pass) {
  process.exitCode = 1;
}
