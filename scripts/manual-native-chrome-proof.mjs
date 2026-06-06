import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const EMAIL = process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL;
const PASSWORD = process.env.PRO_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD;
const SIGNUP_EMAIL = process.env.NATIVE_PROOF_EMAIL || `native-proof-${Date.now()}@example.com`;
const SIGNUP_PASSWORD = process.env.NATIVE_PROOF_PASSWORD || `NativeProof${Date.now()}!`;
const OUT = process.env.NATIVE_PROOF_OUT || '/private/tmp/native-chrome-proof.json';
const SPOKEN_SENTENCE = process.env.NATIVE_PROOF_SPOKEN_SENTENCE || 'Native Chrome microphone proof. The quick brown fox reads clear speech for SpeakSharp release validation.';
const SPOKEN_CHUNKS = process.env.NATIVE_PROOF_SPOKEN_CHUNKS
  ? JSON.parse(process.env.NATIVE_PROOF_SPOKEN_CHUNKS)
  : null;
const EXPECTED_SCRIPT = Array.isArray(SPOKEN_CHUNKS) && SPOKEN_CHUNKS.length > 0
  ? SPOKEN_CHUNKS.map((chunk) => String(chunk)).join(' ')
  : SPOKEN_SENTENCE;
const AUDIO_FILE = process.env.NATIVE_PROOF_AUDIO_FILE ? path.resolve(process.env.NATIVE_PROOF_AUDIO_FILE) : '';
const USE_FAKE_AUDIO_CAPTURE = process.env.NATIVE_PROOF_FAKE_AUDIO_CAPTURE === 'true';
const SESSION_QUERY = process.env.NATIVE_PROOF_SESSION_QUERY || '';
const WAIT_FOR_RESTART_AFTER_CHUNK_INDEX = process.env.NATIVE_PROOF_WAIT_FOR_RESTART_AFTER_CHUNK_INDEX == null
  ? -1
  : Number(process.env.NATIVE_PROOF_WAIT_FOR_RESTART_AFTER_CHUNK_INDEX);
const WAIT_FOR_RESTART_TIMEOUT_MS = Number(process.env.NATIVE_PROOF_WAIT_FOR_RESTART_TIMEOUT_MS || 25_000);
const MANUAL_SPEAK_MS = Number(process.env.NATIVE_PROOF_MANUAL_SPEAK_MS || 0);
const NATIVE_AUDIO_READY_TIMEOUT_MS = Number(process.env.NATIVE_AUDIO_READY_TIMEOUT_MS || 12_000);
const NATIVE_AUDIO_READY_GRACE_MS = Number(process.env.NATIVE_AUDIO_READY_GRACE_MS || 300);
const POST_AUDIO_WAIT_MS = Number(process.env.NATIVE_PROOF_POST_AUDIO_WAIT_MS || (AUDIO_FILE ? 500 : 8_000));
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

function buildEnvironmentProof(baseUrl) {
  const url = new URL(baseUrl);
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const hostname = url.hostname;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  const mockAuth = (
    process.env.VITE_AUTH_MODE === 'mock' ||
    process.env.VITE_USE_MOCK_AUTH === 'true' ||
    /mock\.supabase\.co/i.test(SUPABASE_URL) ||
    /^mock_/i.test(SUPABASE_ANON_KEY)
  );
  const authMode = mockAuth ? 'mock' : 'real';
  const invalidReasons = [
    ...(!isLocalhost ? ['not_localhost'] : []),
    ...(port !== 5174 ? [`port_${Number.isFinite(port) ? port : 'unknown'}_not_5174`] : []),
    ...(!SUPABASE_URL ? ['missing_supabase_url'] : []),
    ...(!SUPABASE_ANON_KEY ? ['missing_supabase_anon_key'] : []),
    ...(authMode !== 'real' ? [`auth_${authMode}`] : []),
    ...(mockAuth ? ['mock_auth_detected'] : []),
    ...(USE_FAKE_AUDIO_CAPTURE ? ['fake_audio_capture'] : []),
  ];

  return {
    url: `${url.origin}/session`,
    port: Number.isFinite(port) ? port : null,
    authMode,
    mockAuth,
    supabaseUrlPresent: Boolean(SUPABASE_URL),
    supabaseAnonKeyPresent: Boolean(SUPABASE_ANON_KEY),
    releaseProofEligible: invalidReasons.length === 0,
    cdpSameTab: true,
    invalidReasons,
  };
}

function compact(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function stripTranscriptChrome(text) {
  return compact(String(text ?? '')
    .replace(/\bDraft transcript\b/gi, ' ')
    .replace(/Text may change before the final transcript is saved\./gi, ' ')
    .replace(/Processing speech locally(?:…|\.\.\.)?/gi, ' ')
    .replace(/Finalizing local transcript(?:…|\.\.\.)?/gi, ' ')
    .replace(/Your final transcript will appear here when local processing finishes\./gi, ' ')
    .replace(/Listening locally(?:…|\.\.\.)?/gi, ' ')
    .replace(/\bListening(?:…|\.\.\.)/gi, ' ')
    .replace(/Start recording and your words will appear here\./gi, ' ')
    .replace(/No speech was detected[^.]*\./gi, ' '));
}

async function readVisibleTranscript(page) {
  const transcriptOnly = await page.evaluate(() => {
    const container = document.querySelector('[data-testid="transcript-container"]');
    if (!container) return '';
    const clone = container.cloneNode(true);
    clone.querySelectorAll([
      '[data-testid="live-transcript-trust-banner"]',
      '[data-testid="live-transcript-finalizing"]',
      '[data-testid="live-transcript-finalizing-empty"]',
    ].join(',')).forEach((node) => node.remove());
    return clone.textContent ?? '';
  }).catch(() => '');
  return stripTranscriptChrome(transcriptOnly);
}

function isPlaceholderTranscript(text) {
  return /\b(words appear here|listening|start speaking|no speech was detected|session complete)\b/i.test(compact(text));
}

function firstMeaningfulTranscript(...values) {
  return values.map(compact).find((value) => value && !isPlaceholderTranscript(value)) || '';
}

async function readAuthoritativeSaveCandidate(page) {
  return page.evaluate(() => window.__SPEECH_RUNTIME_DEBUG__?.().saveCandidate || null)
    .catch(() => null);
}

async function readTranscriptTrustState(page) {
  return page.evaluate(() => {
    const compact = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const stripTranscriptChrome = (text) => compact(String(text ?? '')
      .replace(/\bDraft transcript\b/gi, ' ')
      .replace(/Text may change before the final transcript is saved\./gi, ' ')
      .replace(/Processing speech locally(?:…|\.\.\.)?/gi, ' ')
      .replace(/Finalizing local transcript(?:…|\.\.\.)?/gi, ' ')
      .replace(/Your final transcript will appear here when local processing finishes\./gi, ' ')
      .replace(/Listening locally(?:…|\.\.\.)?/gi, ' ')
      .replace(/\bListening(?:…|\.\.\.)/gi, ' ')
      .replace(/Start recording and your words will appear here\./gi, ' ')
      .replace(/No speech was detected[^.]*\./gi, ' '));
    const transcriptOnly = (container) => {
      if (!container) return '';
      const clone = container.cloneNode(true);
      clone.querySelectorAll([
        '[data-testid="live-transcript-trust-banner"]',
        '[data-testid="live-transcript-finalizing"]',
        '[data-testid="live-transcript-finalizing-empty"]',
      ].join(',')).forEach((node) => node.remove());
      return stripTranscriptChrome(clone.textContent ?? '');
    };
    const transcriptContainer = document.querySelector('[data-testid="transcript-container"]');
    const trustBanner = document.querySelector('[data-testid="live-transcript-trust-banner"]');
    const finalizingBanner = document.querySelector('[data-testid="live-transcript-finalizing"]');
    const currentLine = document.querySelector('[data-testid="live-transcript-current-line"]');

    return {
      at: Date.now(),
      perfMs: Number(performance.now().toFixed(1)),
      transcriptState: transcriptContainer?.getAttribute('data-transcript-state') ?? null,
      trustBannerVisible: Boolean(trustBanner),
      trustBannerText: compact(trustBanner?.textContent),
      trustBannerMode: trustBanner?.getAttribute('data-transcript-trust') ?? null,
      finalizingVisible: Boolean(finalizingBanner),
      finalizingText: compact(finalizingBanner?.textContent),
      currentLineVisible: Boolean(currentLine),
      currentLineDraft: currentLine?.getAttribute('data-transcript-draft') ?? null,
      currentLineText: compact(currentLine?.textContent).slice(0, 240),
      rawTranscriptPreview: compact(transcriptContainer?.textContent).slice(0, 240),
      transcriptPreview: transcriptOnly(transcriptContainer).slice(0, 240),
    };
  }).catch(() => null);
}

function normalizeForDuplicateScan(text) {
  return compact(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, '');
}

function words(text) {
  return normalizeForDuplicateScan(text).split(/\s+/).filter(Boolean);
}

function extractSessionDetailTranscript(bodyText) {
  const body = compact(bodyText);
  if (!body) return '';
  const recordedWithIndex = body.indexOf('Recorded with');
  const suggestionsIndex = body.indexOf('AI-Powered Suggestions');
  if (recordedWithIndex === -1 || suggestionsIndex === -1 || suggestionsIndex <= recordedWithIndex) {
    return '';
  }

  const between = body.slice(recordedWithIndex, suggestionsIndex);
  const modeMatch = between.match(/Recorded with(.+?)(Native Browser|Private|Cloud|AssemblyAI|Browser|Whisper|web-speech-api|browser\))/i);
  const afterMode = modeMatch ? between.slice(modeMatch.index + modeMatch[0].length) : between.replace(/^Recorded with\s*/i, '');
  return compact(afterMode);
}

async function readSessionDetailTranscript(page) {
  const byTestId = compact(await page.getByTestId('session-detail-transcript').textContent().catch(() => ''));
  if (byTestId) return byTestId;
  const body = compact(await page.locator('body').textContent().catch(() => ''));
  return extractSessionDetailTranscript(body);
}

function transcriptEvidenceInBody(bodyText, transcript) {
  const bodyWords = new Set(words(bodyText));
  const transcriptWords = words(transcript);
  const uniqueTranscriptWords = [...new Set(transcriptWords)];
  const matchedWords = uniqueTranscriptWords.filter((word) => bodyWords.has(word));
  const matchRatio = uniqueTranscriptWords.length > 0 ? matchedWords.length / uniqueTranscriptWords.length : 0;

  return {
    bodyLength: compact(bodyText).length,
    uniqueTranscriptWordCount: uniqueTranscriptWords.length,
    matchedUniqueTranscriptWordCount: matchedWords.length,
    matchedUniqueTranscriptWords: matchedWords.slice(0, 20),
    matchRatio: Number(matchRatio.toFixed(4)),
    containsAtLeastHalfUniqueTranscriptWords: uniqueTranscriptWords.length > 0 && matchRatio >= 0.5,
  };
}

function repeatedFourWordSequence(text) {
  const transcriptWords = words(text);
  const seen = new Map();
  for (let index = 0; index <= transcriptWords.length - 4; index += 1) {
    const phrase = transcriptWords.slice(index, index + 4).join(' ');
    const prior = seen.get(phrase);
    if (prior != null && index - prior >= 4) return phrase;
    if (prior == null) seen.set(phrase, index);
  }
  return '';
}

function extractNativeTraceSummary(trace) {
  const entries = Array.isArray(trace) ? trace : [];
  const firstResult = entries.find((entry) => entry.event === 'onresult_raw');
  const finalResults = entries.filter((entry) => entry.event === 'onresult_raw'
    && Array.isArray(entry.rawResults)
    && entry.rawResults.some((result) => result?.isFinal));
  const lastFinalResult = finalResults.at(-1);
  const storeUpdates = entries.filter((entry) => entry.event === 'store_apply_final' || entry.event === 'store_apply_partial');
  const lastStoreUpdate = storeUpdates.at(-1);
  const promoted = entries.find((entry) => /promot/i.test(entry.event || ''));
  const stopEvents = entries.filter((entry) => /stop/i.test(entry.event || ''));

  const postStopFinal = lastFinalResult?.rawResults
    ?.filter((result) => result?.isFinal)
    ?.map((result) => result.transcript || '')
    ?.join(' ') || '';

  return {
    firstResultMs: firstResult?.t ?? null,
    firstResultText: compact(firstResult?.rawResults?.map((result) => result.transcript || '').join(' ') || ''),
    finalResultCount: finalResults.length,
    postStopFinal: compact(postStopFinal),
    lastStoreTranscript: compact(lastStoreUpdate?.final || lastStoreUpdate?.partial || lastStoreUpdate?.currentTranscript || ''),
    promotedTranscript: compact(promoted?.transcript || promoted?.text || ''),
    stopEventCount: stopEvents.length,
    resultEventCount: entries.filter((entry) => entry.event === 'onresult_raw').length,
  };
}

function summarizeParallelCapture(captures, nativeTrace) {
  const capture = Array.isArray(captures) ? captures.at(-1) : null;
  if (!capture) return null;

  // P1: carry segment-level speech fields from the raw `parallel_capture_saved`
  // trace event into the summary so the report does not have to dig into the trace.
  const trace = Array.isArray(nativeTrace) ? nativeTrace : [];
  const savedEvent = [...trace].reverse().find((entry) => entry?.event === 'parallel_capture_saved');
  const segments = savedEvent ?? {};

  return {
    durationSec: capture.durationSec ?? null,
    sampleRate: capture.sampleRate ?? null,
    rms: capture.rms ?? null,
    peak: capture.peak ?? null,
    samples: capture.samples ?? null,
    wavBytesApprox: capture.wavBytesApprox ?? null,
    speechStartMs: segments.speechStartMs ?? null,
    speechEndMs: segments.speechEndMs ?? null,
    speechDurationMs: segments.speechDurationMs ?? null,
    segmentCount: segments.segmentCount ?? null,
    speechSegments: segments.segmentCount ?? null,
    speechWindow: (segments.speechStartMs != null && segments.speechEndMs != null)
      ? { startMs: segments.speechStartMs, endMs: segments.speechEndMs }
      : null,
    contaminationFlag: segments.contaminationFlag ?? null,
  };
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

async function speakSentence(page) {
  if (MANUAL_SPEAK_MS > 0) {
    console.log(`READY_TO_SPEAK ${JSON.stringify({ sentence: EXPECTED_SCRIPT, chunks: SPOKEN_CHUNKS, durationMs: MANUAL_SPEAK_MS })}`);
    await page.waitForTimeout(MANUAL_SPEAK_MS);
    return { attempted: true, source: 'human-mic', sentence: EXPECTED_SCRIPT, chunks: SPOKEN_CHUNKS, durationMs: MANUAL_SPEAK_MS };
  }

  if (USE_FAKE_AUDIO_CAPTURE) {
    return { attempted: false, source: 'chrome-fake-audio-capture', audioFile: AUDIO_FILE, sentence: SPOKEN_SENTENCE };
  }

  if (process.platform !== 'darwin') return { attempted: false, reason: 'non-darwin' };

  if (AUDIO_FILE) {
    await execFileAsync('/usr/bin/afplay', [AUDIO_FILE], { timeout: 45_000 });
    return { attempted: true, source: 'fixture', audioFile: AUDIO_FILE, sentence: SPOKEN_SENTENCE };
  }

  const chunks = Array.isArray(SPOKEN_CHUNKS) && SPOKEN_CHUNKS.length > 0
    ? SPOKEN_CHUNKS.map((chunk) => String(chunk))
    : [SPOKEN_SENTENCE];

  for (const [index, chunk] of chunks.entries()) {
    await execFileAsync('/usr/bin/say', ['-v', 'Samantha', '-r', '165', chunk], { timeout: 30_000 });
    if (index === WAIT_FOR_RESTART_AFTER_CHUNK_INDEX) {
      await page.waitForFunction(
        () => {
          const trace = window.__NATIVE_BROWSER_TRACE__ || [];
          return trace.some((entry) => entry.event === 'recognition_restart_invoked');
        },
        null,
        { timeout: WAIT_FOR_RESTART_TIMEOUT_MS },
      );
      await page.waitForTimeout(500);
    }
  }
  return { attempted: true, sentence: SPOKEN_SENTENCE, chunks };
}

async function waitForNativeAudioReady(page) {
  await page.waitForFunction(
    () => {
      const trace = window.__NATIVE_BROWSER_TRACE__ || [];
      return trace.some((entry) => entry.event === 'onaudiostart' || entry.event === 'onspeechstart' || entry.event === 'acoustic_ready');
    },
    null,
    { timeout: NATIVE_AUDIO_READY_TIMEOUT_MS },
  );

  const readiness = await page.evaluate(() => {
    const trace = window.__NATIVE_BROWSER_TRACE__ || [];
    const first = trace.find((entry) => entry.event === 'onaudiostart' || entry.event === 'onspeechstart' || entry.event === 'acoustic_ready');
    return first ? { event: first.event, t: first.t } : null;
  });

  await page.waitForTimeout(NATIVE_AUDIO_READY_GRACE_MS);
  return readiness;
}

const evidence = {
  baseUrl: BASE_URL,
  environmentProof: buildEnvironmentProof(BASE_URL),
  browser: 'Google Chrome via Playwright channel=chrome, headed',
  microphonePath: USE_FAKE_AUDIO_CAPTURE
    ? 'SpeakSharp app with Chrome --use-file-for-fake-audio-capture'
    : 'real browser getUserMedia, no fake audio flags',
  audioFile: AUDIO_FILE || null,
  fakeAudioCapture: USE_FAKE_AUDIO_CAPTURE,
  expectedScript: EXPECTED_SCRIPT,
  spokenSentence: EXPECTED_SCRIPT,
  spokenChunks: Array.isArray(SPOKEN_CHUNKS) ? SPOKEN_CHUNKS.map((chunk) => String(chunk)) : null,
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

if (!evidence.environmentProof.releaseProofEligible) {
  evidence.blockers.push(
    `INVALID_SETUP setup.env RELEASE_PROOF_INELIGIBLE manual-native-chrome-proof ` +
    `Manual Native release proof must run on localhost:5174 with real auth and a real microphone. ` +
    `localhost:5173, .env.test/mock auth, deployed URLs, and fake audio are invalid evidence.`
  );
  evidence.completedAt = new Date().toISOString();
  evidence.pass = false;
  await writeFile(OUT, JSON.stringify(evidence, null, 2));
  console.error(`NATIVE_CHROME_MIC_EVIDENCE ${JSON.stringify(evidence)}`);
  process.exit(1);
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--disable-blink-features=AutomationControlled',
    ...(USE_FAKE_AUDIO_CAPTURE && AUDIO_FILE ? [
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${AUDIO_FILE}`,
    ] : []),
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

  await page.goto(`${BASE_URL}/session${SESSION_QUERY}`, { waitUntil: 'domcontentloaded' });
  await page.locator('html[data-app-visible-ready="true"]').waitFor({ timeout: 60_000 });
  evidence.profileTextBeforeNative = compact(await page.locator('[data-testid="pro-badge"], [data-testid="nav-upgrade-button"]').first().textContent().catch(() => ''));
  await selectMode(page, 'native');
  evidence.modeSelected = (await page.getByTestId('stt-mode-select').getAttribute('data-state')) === 'native';

  const startButton = page.getByTestId('session-start-stop-button');
  await page.evaluate(() => {
    window.__NATIVE_BROWSER_TRACE__ = [];
    window.__NATIVE_PARALLEL_CAPTURE_TRACE__ = true;
  });
  await startButton.click();
  await startButton.waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording') === 'true', null, { timeout: 45_000 });
  evidence.recordingStarted = true;
  evidence.trustStateAtRecordingStart = await readTranscriptTrustState(page);

  evidence.nativeAudioReady = await waitForNativeAudioReady(page);
  evidence.trustStateAtAudioReady = await readTranscriptTrustState(page);
  evidence.audioPlayback = await speakSentence(page);
  await page.waitForTimeout(POST_AUDIO_WAIT_MS);

  const transcriptText = await readVisibleTranscript(page);
  evidence.trustStateAtVisibleStop = await readTranscriptTrustState(page);
  evidence.visibleAtStop = transcriptText;
  evidence.transcriptSample = transcriptText.slice(0, 500);
  evidence.transcriptLength = transcriptText.length;
  evidence.transcriptVisible = transcriptText.length >= 12 && !/\b(listening|words appear here|start speaking)\b/i.test(transcriptText);
  evidence.visibleAtStopExpectedEvidence = transcriptEvidenceInBody(transcriptText, EXPECTED_SCRIPT);
  evidence.transcriptMatchesScript = evidence.visibleAtStopExpectedEvidence.containsAtLeastHalfUniqueTranscriptWords;

  await startButton.click();
  await page.waitForFunction(() => document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording') === 'false', null, { timeout: 60_000 }).catch((error) => {
    evidence.blockers.push(`stop did not settle: ${error.message}`);
  });
  await page.waitForTimeout(3_000);
  evidence.trustStatePostStop = await readTranscriptTrustState(page);
  evidence.postStopTranscript = await readVisibleTranscript(page);
  evidence.saved = await page.locator('html[data-session-persisted="true"]').isVisible().catch(() => false);
  evidence.saveCandidate = await readAuthoritativeSaveCandidate(page);
  evidence.nativeFormatterLast = await page.evaluate(() => window.__NATIVE_FORMATTER_LAST__ || null).catch(() => null);
  evidence.nativeTrace = await page.evaluate(() => window.__NATIVE_BROWSER_TRACE__ || []);
  evidence.nativeTraceSummary = extractNativeTraceSummary(evidence.nativeTrace);
  evidence.nativeParallelCapture = await page.evaluate(() => {
    const captures = window.__NATIVE_PARALLEL_CAPTURE__ || [];
    return captures.map((capture) => ({
      createdAt: capture.createdAt,
      samples: capture.samples,
      durationSec: capture.durationSec,
      sampleRate: capture.sampleRate,
      rms: capture.rms,
      peak: capture.peak,
      wavBytesApprox: typeof capture.wavDataUrl === 'string' ? capture.wavDataUrl.length : 0,
    }));
  });
  evidence.parallelCaptureSummary = summarizeParallelCapture(evidence.nativeParallelCapture, evidence.nativeTrace);
  evidence.selectedForSave = firstMeaningfulTranscript(
    evidence.saveCandidate?.selectedForSave,
    evidence.nativeTraceSummary.lastStoreTranscript,
    evidence.postStopTranscript,
    evidence.visibleAtStop,
  );
  evidence.duplicateFullTranscript = Boolean(repeatedFourWordSequence(evidence.selectedForSave));
  evidence.repeatedFourWordSequence = repeatedFourWordSequence(evidence.selectedForSave);

  await page.goto(`${BASE_URL}/analytics`, { waitUntil: 'domcontentloaded' });
  await page.locator('html[data-app-visible-ready="true"]').waitFor({ timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  const historyItem = page.getByTestId(/^session-history-item-/).first();
  evidence.historyVisible = await historyItem.isVisible({ timeout: 20_000 }).catch(() => false);
  evidence.analyticsBodySample = compact(await page.locator('body').textContent()).slice(0, 1000);
  if (evidence.historyVisible) {
    await historyItem.click();
    await page.waitForTimeout(3_000);
  }
  const detailBody = compact(await page.locator('body').textContent());
  const detailTranscript = await readSessionDetailTranscript(page);
  evidence.detailBodySample = detailBody.slice(0, 1200);
  evidence.detailTranscript = detailTranscript;
  evidence.detailTranscriptEvidence = transcriptEvidenceInBody(detailTranscript, evidence.selectedForSave);
  evidence.detailTranscriptMatchesSelected = evidence.detailTranscriptEvidence.containsAtLeastHalfUniqueTranscriptWords;
  evidence.analyticsVisible = /analytics|words per minute|wpm|clarity|filler|session/i.test(detailBody);
  evidence.finalUrl = page.url();

  if (!evidence.transcriptVisible) evidence.blockers.push('No non-placeholder live Native transcript from real Chrome/mic path.');
  if (!evidence.trustStateAtRecordingStart?.trustBannerVisible) evidence.blockers.push('Native Draft trust banner was not visible at recording start.');
  if (!evidence.trustStateAtVisibleStop?.trustBannerVisible && evidence.trustStateAtVisibleStop?.transcriptState !== 'final') evidence.blockers.push('Native Draft trust banner was not visible while transcript was still non-final.');
  if (!evidence.saved) evidence.blockers.push('Native session did not expose saved-session marker.');
  if (!evidence.historyVisible) evidence.blockers.push('Native session history item was not visible.');
  if (!evidence.analyticsVisible) evidence.blockers.push('Native analytics detail/context was not visible.');
  if (!evidence.detailTranscriptMatchesSelected) evidence.blockers.push('Native detail transcript did not match the authoritative save candidate.');
  if (evidence.duplicateFullTranscript) evidence.blockers.push(`Native selected transcript repeats 4-word sequence: ${evidence.repeatedFourWordSequence}`);
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
