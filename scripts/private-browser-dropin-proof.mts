import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateWordErrorRate } from '../frontend/src/lib/wer';
import { HARVARD_SENTENCES } from '../tests/fixtures/stt-isomorphic/harvard-sentences';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5174';
const FIXTURE_ID = process.env.FIXTURE_ID || 'h1_1';
const HEADLESS = process.env.HEADLESS === 'true';
// Engine under test in the AUTHLESS drop-in. DROPIN_ENGINE=v4 + DROPIN_VARIANT=base_q4|distil_q4
// proves v4 WebGPU value WITHOUT app auth (headed Chrome on a real GPU auto-selects WebGPU).
const DROPIN_ENGINE = process.env.DROPIN_ENGINE === 'v4' ? 'v4' : 'v2';
const DROPIN_VARIANT = process.env.DROPIN_VARIANT === 'distil_q4' ? 'distil_q4' : 'base_q4';
const PLAYBACK_GRACE_MS = Number(process.env.PLAYBACK_GRACE_MS || 750);
const POST_PLAYBACK_WAIT_MS = Number(process.env.POST_PLAYBACK_WAIT_MS || 1500);
const OUT = process.env.OUT || `/private/tmp/speaksharp-private-browser-dropin-${FIXTURE_ID}-${Date.now()}.json`;
const fixtureList = FIXTURE_ID === 'all'
  ? HARVARD_SENTENCES
  : HARVARD_SENTENCES.filter((item) => item.id === FIXTURE_ID);

if (fixtureList.length === 0) {
  throw new Error(`Unknown FIXTURE_ID ${FIXTURE_ID}`);
}

function compact(value: string): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

async function playFixture(audioPath: string): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Private browser drop-in proof currently uses macOS afplay and must run on darwin.');
  }
  await execFileAsync('/usr/bin/afplay', [audioPath], { timeout: 45_000 });
}

type DropInState = {
  status?: string;
  sampleRate?: number | null;
  capturedSamples?: number;
  capturedSeconds?: number;
  modelReady?: boolean;
  recording?: boolean;
  events?: unknown[];
};

const evidence: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  fixture: FIXTURE_ID,
  dropinEngine: DROPIN_ENGINE,
  dropinVariant: DROPIN_ENGINE === 'v4' ? DROPIN_VARIANT : 'v2-base',
  microphonePath: 'real browser getUserMedia with afplay through the physical speaker/mic path',
  comparator: `browser-dropin-${DROPIN_ENGINE === 'v4' ? 'transformersjs-v4-' + DROPIN_VARIANT : 'transformers-js-v2'}-engine-only-no-session-controller-store-save`,
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
  const context = await browser.newContext({
    permissions: ['microphone'],
    viewport: { width: 1200, height: 800 },
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    const text = message.text();
    if (/PRIVATE_DROPIN|Transformers|PRIVATE_DIAG|error|failed|warning/i.test(text)) {
      (evidence.consoleEvents as Array<Record<string, string>>).push({ type: message.type(), text });
    }
  });
  page.on('pageerror', (error) => {
    (evidence.pageErrors as string[]).push(error.message);
  });
  page.on('requestfailed', (request) => {
    (evidence.failedRequests as Array<Record<string, string | undefined>>).push({
      url: request.url(),
      errorText: request.failure()?.errorText,
    });
  });

  await page.goto(`${BASE_URL}/private-dropin.html?engine=${DROPIN_ENGINE}&variant=${DROPIN_VARIANT}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__PRIVATE_DROPIN__), null, { timeout: 30_000 });

  await page.evaluate(() => window.__PRIVATE_DROPIN__!.initModel());
  for (const fixture of fixtureList) {
    const audioPath = path.resolve(__dirname, `../tests/fixtures/stt-isomorphic/audio/${fixture.id}.wav`);
    await page.evaluate(() => window.__PRIVATE_DROPIN__!.startCapture());
    await page.waitForTimeout(PLAYBACK_GRACE_MS);
    await playFixture(audioPath);
    await page.waitForTimeout(POST_PLAYBACK_WAIT_MS);
    const transcript = await page.evaluate(() => window.__PRIVATE_DROPIN__!.stopAndTranscribe());
    const state = await page.evaluate(() => window.__PRIVATE_DROPIN__) as DropInState;
    const wer = calculateWordErrorRate(fixture.transcript, transcript);
    const normalizedTranscript = compact(transcript).toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    const result = {
      fixture: fixture.id,
      truth: fixture.transcript,
      audioPath,
      firstTextMs: null,
      transcript,
      normalizedTranscript,
      wordCount: normalizedTranscript ? normalizedTranscript.split(/\s+/).length : 0,
      wer,
      accuracyPct: Number(((1 - wer) * 100).toFixed(2)),
      dropInState: {
        status: state.status,
        sampleRate: state.sampleRate,
        capturedSamples: state.capturedSamples,
        capturedSeconds: state.capturedSeconds,
        modelReady: state.modelReady,
        recording: state.recording,
        events: state.events,
      },
    };
    (evidence.results as Array<typeof result>).push(result);
    console.log(`PRIVATE_BROWSER_DROPIN_ROW ${JSON.stringify({
      fixture: fixture.id,
      wer: result.wer,
      accuracyPct: result.accuracyPct,
      transcript: result.transcript,
    })}`);
  }

  const rows = evidence.results as Array<{ wer: number }>;
  const averageWer = rows.reduce((sum, row) => sum + row.wer, 0) / rows.length;
  evidence.finishedAt = new Date().toISOString();
  evidence.averageWer = averageWer;
  evidence.averageAccuracyPct = Number(((1 - averageWer) * 100).toFixed(2));

  console.log(`PRIVATE_BROWSER_DROPIN_RESULT ${JSON.stringify({
    fixture: FIXTURE_ID,
    rows: rows.length,
    averageWer: evidence.averageWer,
    averageAccuracyPct: evidence.averageAccuracyPct,
    out: OUT,
  })}`);
} finally {
  await browser.close();
}

await writeFile(OUT, JSON.stringify(evidence, null, 2));
