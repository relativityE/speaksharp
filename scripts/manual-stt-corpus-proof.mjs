import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  buildSandboxProcessControlEpermArtifact,
  isSandboxProcessControlEperm,
} from './sandbox-eperm-evidence.mjs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env'), override: false });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env.local'), override: true });

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const AUTH_MODE = process.env.STT_AUTH || 'existing';
const EMAIL = process.env.PRO_TEST_EMAIL
  ?? process.env.E2E_PRO_EMAIL
  ?? process.env.FREE_TEST_EMAIL
  ?? process.env.E2E_FREE_EMAIL
  ?? process.env.BASIC_TEST_EMAIL
  ?? process.env.TEST_USER_EMAIL;
const PASSWORD = process.env.PRO_TEST_PASSWORD
  ?? process.env.E2E_PRO_PASSWORD
  ?? process.env.FREE_TEST_PASSWORD
  ?? process.env.E2E_FREE_PASSWORD
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
const AFPLAY_RETRIES = Number(process.env.STT_AFPLAY_RETRIES || 2);
const PRIVATE_SETUP_CLICK_DELAY_MS = Number(process.env.STT_PRIVATE_SETUP_CLICK_DELAY_MS || 0);
const PRIVATE_SETUP_USER_CONSENT_REQUIRED = process.env.PRIVATE_SETUP_USER_CONSENT_REQUIRED === 'true';
const HEADLESS = process.env.HEADLESS === 'true';
const MAX_WER = process.env.STT_MAX_WER == null ? null : Number(process.env.STT_MAX_WER);
const SIGNUP_EMAIL = process.env.STT_SIGNUP_EMAIL || `stt-corpus-${Date.now()}@speaksharp.app`;
const SIGNUP_PASSWORD = process.env.STT_SIGNUP_PASSWORD || `SttCorpus${Date.now()}!Aa9`;
const CLEAR_PRIVATE_CACHE = process.env.STT_CLEAR_PRIVATE_CACHE === 'true';
const PRIVATE_ENGINE = process.env.STT_PRIVATE_ENGINE || '';
const PRIVATE_MIC_CONSTRAINTS = (process.env.STT_PRIVATE_MIC_CONSTRAINTS || '').trim();
const PRIVATE_VAD = (process.env.STT_PRIVATE_VAD || '').trim();
const PRIVATE_MODEL = (process.env.STT_PRIVATE_MODEL || '').trim();
const PRIVATE_RESAMPLER = (process.env.STT_PRIVATE_RESAMPLER || '').trim();
const CUSTOM_WORD = (process.env.STT_CUSTOM_WORD || '').trim().toLowerCase();
const NATIVE_CONTINUOUS = process.env.STT_NATIVE_CONTINUOUS || '';
const NATIVE_INTERIM_RESULTS = process.env.STT_NATIVE_INTERIM_RESULTS || '';
const NATIVE_MAX_ALTERNATIVES = process.env.STT_NATIVE_MAX_ALTERNATIVES || '';
const USE_FAKE_AUDIO_CAPTURE = process.env.STT_USE_FAKE_AUDIO_CAPTURE === 'true';
const FAKE_AUDIO_FILE = process.env.STT_FAKE_AUDIO_FILE || '';
const INJECT_MIC_AUDIO = process.env.STT_INJECT_MIC_AUDIO === 'true';
const DISABLE_WEBGPU = process.env.STT_DISABLE_WEBGPU === 'true';
const INCLUDE_AUDIO_DATA_URL = process.env.STT_INCLUDE_AUDIO_DATA_URL === 'true';
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
    ...(authMode !== 'real' ? [`auth_${authMode}`] : []),
    ...(mockAuth ? ['mock_auth_detected'] : []),
  ];

  return {
    url: `${url.origin}/session`,
    port: Number.isFinite(port) ? port : null,
    authMode,
    mockAuth,
    releaseProofEligible: invalidReasons.length === 0,
    cdpSameTab: true,
    invalidReasons,
  };
}

function compact(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

const TRANSCRIPT_CONTAINER_SELECTOR = '[data-testid="transcript-container"]';
const TRANSCRIPT_CHROME_SELECTOR = [
  '[data-testid="live-transcript-trust-banner"]',
  '[data-testid="live-transcript-finalizing"]',
  '[data-testid="live-transcript-finalizing-empty"]',
].join(',');

function stripTranscriptChrome(text) {
  return compact(String(text || '')
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

async function getPcmWavDurationMs(audioPath) {
  const wav = await readFile(audioPath);
  const channels = wav.readUInt16LE(22);
  const sampleRate = wav.readUInt32LE(24);
  const bitsPerSample = wav.readUInt16LE(34);
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const chunkId = wav.toString('ascii', offset, offset + 4);
    const chunkSize = wav.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
      return Math.ceil((chunkSize / bytesPerSecond) * 1000);
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return 0;
}

async function installInjectedMicAudio(page, audioPath) {
  const wav = await readFile(audioPath);
  const audioBase64 = wav.toString('base64');
  await page.addInitScript(({ audioBase64: injectedAudioBase64 }) => {
    const state = {
      installedAt: Date.now(),
      getUserMediaCalls: 0,
      startedAt: null,
      endedAt: null,
      error: null,
      route: 'page-getUserMedia-injected-wav',
    };
    Object.defineProperty(window, '__STT_INJECTED_MIC_AUDIO__', {
      configurable: true,
      value: state,
    });

    const originalGetUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (!originalGetUserMedia) {
      state.error = 'getUserMedia_unavailable';
      return;
    }

    navigator.mediaDevices.getUserMedia = async (constraints) => {
      state.getUserMediaCalls += 1;
      if (!constraints || !constraints.audio) {
        return originalGetUserMedia(constraints);
      }
      try {
        const binary = atob(injectedAudioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioContextCtor({ sampleRate: 16000 });
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }
        const decoded = await audioContext.decodeAudioData(bytes.buffer.slice(0));
        const destination = audioContext.createMediaStreamDestination();
        const source = audioContext.createBufferSource();
        source.buffer = decoded;
        source.connect(destination);
        source.onended = () => {
          state.endedAt = Date.now();
        };
        source.start(0);
        state.startedAt = Date.now();
        state.durationMs = Math.round(decoded.duration * 1000);
        state.sampleRate = decoded.sampleRate;
        state.channels = decoded.numberOfChannels;
        return destination.stream;
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    };
  }, { audioBase64 });
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

function buildWerMetric(reference, transcript) {
  const text = compact(transcript);
  const wer = calculateWordErrorRate(reference, text);
  return {
    transcript: text,
    normalizedTranscript: normalizeForWer(text),
    wordCount: words(text).length,
    wer,
    accuracyPct: Number(((1 - wer) * 100).toFixed(2)),
  };
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

async function loadFixtures() {
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
      type: 'harvard',
    });
  }

  const fillerSourcePath = path.resolve('tests/fixtures/stt-isomorphic/filler-sentences.ts');
  const fillerSource = await readFile(fillerSourcePath, 'utf8');
  const fillerBlocks = [...fillerSource.matchAll(/\{\s*id:\s*"([^"]+)"[\s\S]*?audio:\s*"([^"]+)"[\s\S]*?transcript:\s*"([^"]+)"[\s\S]*?expectedFillers:\s*\{([\s\S]*?)\}\s*\}/g)];
  for (const [, id, audio, transcript, fillerBlock] of fillerBlocks) {
    const expectedFillers = Object.fromEntries(
      [...fillerBlock.matchAll(/"([^"]+)":\s*(\d+)/g)].map(([, filler, count]) => [filler, Number(count)]),
    );
    byId.set(id, {
      id,
      transcript,
      audioPath: path.resolve(`tests/fixtures/stt-isomorphic/audio/${audio}`),
      type: 'filler',
      expectedFillers,
    });
  }

  const washingtonSourcePath = path.resolve('tests/fixtures/stt-isomorphic/washington-speeches.ts');
  const washingtonSource = await readFile(washingtonSourcePath, 'utf8').catch(() => '');
  const washingtonBlocks = [...washingtonSource.matchAll(/id:\s*'([^']+)'[\s\S]*?audio:\s*'([^']+)'[\s\S]*?transcript:\s*\[([\s\S]*?)\]\.join\(' '\)/g)];
  for (const [, id, audio, transcriptBlock] of washingtonBlocks) {
    const transcript = [...transcriptBlock.matchAll(/'((?:\\'|[^'])*)'/g)]
      .map(([, line]) => line.replace(/\\'/g, "'"))
      .join(' ');
    byId.set(id, {
      id,
      transcript,
      audioPath: path.resolve(`tests/fixtures/stt-isomorphic/audio/${audio}`),
      type: 'long-form',
    });
  }

  return FIXTURE_LIST.map((id) => {
    const fixture = byId.get(id);
    if (!fixture) throw new Error(`Unknown STT fixture "${id}". Known: ${[...byId.keys()].join(', ')}`);
    return fixture;
  });
}

async function signIn(page) {
  if (AUTH_MODE === 'fresh') {
    await page.goto(`${BASE_URL}/auth/signup`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('email-input').fill(SIGNUP_EMAIL);
    await page.getByTestId('password-input').fill(SIGNUP_PASSWORD);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/auth/v1/signup') || response.url().includes('/auth/v1/token'), { timeout: 60_000 }).catch(() => null),
      page.getByTestId('sign-up-submit').click(),
    ]);
    await page.waitForURL(/\/session/, { timeout: 60_000 });
    evidence.auth = {
      mode: 'fresh',
      email: SIGNUP_EMAIL,
      password: SIGNUP_PASSWORD,
    };
    return;
  }

  if (!EMAIL || !PASSWORD) {
    throw new Error('A test login is required for STT corpus proof. Set PRO_TEST_EMAIL/PRO_TEST_PASSWORD, E2E_PRO_EMAIL/E2E_PRO_PASSWORD, or FREE_TEST_EMAIL/FREE_TEST_PASSWORD. BASIC_TEST_* remains a legacy alias.');
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

async function clearPrivateModelStorage(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const deletedCaches = [];
    if ('caches' in window) {
      for (const name of await caches.keys()) {
        if (/transformers|whisper|model/i.test(name)) {
          await caches.delete(name);
          deletedCaches.push(name);
        }
      }
    }

    const deletedDatabases = [];
    if ('indexedDB' in window) {
      for (const dbName of ['models', 'transformers-cache', 'whisper-models']) {
        await new Promise((resolve) => {
          const request = indexedDB.deleteDatabase(dbName);
          request.onsuccess = () => {
            deletedDatabases.push(dbName);
            resolve(undefined);
          };
          request.onerror = () => resolve(undefined);
          request.onblocked = () => resolve(undefined);
        });
      }
    }

    localStorage.removeItem('speaksharp.private.engine');

    return {
      deletedCaches,
      deletedDatabases,
    };
  });
  evidence.privateCacheReset = result;
  console.log(`STT_PRIVATE_CACHE_RESET ${JSON.stringify(result)}`);
}

const DEFAULT_FILLER_WORDS = [
  'um',
  'uh',
  'like',
  'basically',
  'literally',
  'well',
  'you know',
  'i mean',
];

function countFillerOccurrences(transcript, fillers) {
  const normalized = normalizeForWer(transcript);
  return Object.fromEntries(fillers.map((filler) => {
    const escaped = filler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const matches = normalized.match(new RegExp(`\\b${escaped}\\b`, 'gi'));
    return [filler, matches?.length ?? 0];
  }));
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

async function assertModePreflight(page, mode) {
  const select = page.getByTestId('stt-mode-select');
  await select.waitFor({ state: 'visible', timeout: 45_000 });
  const preflight = await page.evaluate((targetMode) => {
    const root = document.documentElement;
    const selectNode = document.querySelector('[data-testid="stt-mode-select"]');
    const option = document.querySelector(`[data-testid="stt-mode-${targetMode}"]`);
    return {
      targetMode,
      currentMode: selectNode?.getAttribute('data-state') ?? null,
      userTier: root.getAttribute('data-user-tier'),
      profileReady: root.getAttribute('data-profile-ready'),
      privateOptionInDom: Boolean(option),
      privateOptionVisible: option ? getComputedStyle(option).display !== 'none' : false,
      privateOptionDisabled: option?.getAttribute('aria-disabled') ?? option?.getAttribute('data-disabled') ?? null,
      bodySample: document.body?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 500) ?? '',
    };
  }, mode);
  await markPhase(page, 'mode_preflight', preflight);

  if (mode === 'private' && preflight.currentMode !== 'private' && !preflight.privateOptionInDom) {
    const error = new Error('INVALID_PRECONDITION private mode is not available for this account/session');
    error.invalidForSttEvidence = true;
    error.invalidReason = 'private_mode_not_available';
    error.preflight = preflight;
    throw error;
  }
  return preflight;
}

async function readCustomWordCount(page, word) {
  const normalizedWord = word.toLowerCase();
  return page.evaluate((targetWord) => {
    const rows = [...document.querySelectorAll('[data-testid="filler-badge"]')];
    for (const row of rows) {
      const text = row.textContent || '';
      const normalizedText = text.toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ').trim();
      if (!new RegExp(`(^|\\s)${targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|\\d|$)`, 'i').test(normalizedText)) continue;
      const countEl = row.querySelector('[data-testid="filler-badge-count"]');
      const count = Number((countEl?.textContent || '').trim());
      return {
        visible: true,
        count: Number.isFinite(count) ? count : null,
        text: text.replace(/\s+/g, ' ').trim(),
      };
    }
    return { visible: false, count: null, text: '' };
  }, normalizedWord);
}

async function ensureCustomWordThroughUi(page, word) {
  if (!word) return null;

  const addButton = page.getByTestId('add-custom-word-button');
  await addButton.scrollIntoViewIfNeeded();
  await addButton.click();

  const dialog = page.locator('[role="dialog"]').first();
  const input = page.getByTestId('user-filler-words-input');
  await input.waitFor({ state: 'visible', timeout: 10_000 });

  const existingBadge = dialog.getByTestId('filler-word-badge').filter({ hasText: new RegExp(`^${word}$`, 'i') }).first();
  const existedBefore = await existingBadge.isVisible().catch(() => false);
  if (existedBefore) {
    const removeButton = dialog.getByRole('button', { name: new RegExp(`remove ${word}`, 'i') });
    await removeButton.click();
    await existingBadge.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
  }

  await input.fill(word);
  await page.getByTestId('user-filler-words-add-button').click();
  await input.waitFor({ state: 'hidden', timeout: 15_000 }).catch(async () => {
    await input.waitFor({ state: 'visible', timeout: 1_000 });
    await page.getByTestId('filler-word-badge').filter({ hasText: new RegExp(`^${word}$`, 'i') }).first().waitFor({ state: 'visible', timeout: 5_000 });
  });
  await page.keyboard.press('Escape').catch(() => undefined);

  return {
    word,
    addedViaUi: true,
    existedBefore,
    beforeRecording: await readCustomWordCount(page, word),
  };
}

async function getPrivateReadinessSnapshot(page) {
  return page.evaluate(async () => {
    const root = document.documentElement;
    const downloadButton = document.querySelector('[data-testid="status-download-model-button"], [data-testid="download-model-button"], [data-testid="download-model-button-inline"]');
    const setupPanel = document.querySelector('[data-testid="private-setup-panel"]');
    const statusNode = document.querySelector('[data-testid="status-message-text"], [data-testid="stt-status"], [data-testid="session-status"], [data-testid="stt-status-label"]');
    const cacheNames = 'caches' in window ? await caches.keys() : [];
    let transformerCacheKeyCount = 0;
    const transformerCacheName = cacheNames.find((name) => /transformers/i.test(name)) ?? null;
    if (transformerCacheName) {
      transformerCacheKeyCount = (await (await caches.open(transformerCacheName)).keys()).length;
    }

    return {
      modelStatus: root.getAttribute('data-model-status'),
      runtimeState: root.getAttribute('data-runtime-state'),
      sttReady: root.getAttribute('data-stt-ready'),
      statusText: statusNode?.textContent?.trim() ?? '',
      downloadVisible: Boolean(downloadButton && getComputedStyle(downloadButton).display !== 'none'),
      downloadButtonText: downloadButton?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      setupPanelText: setupPanel?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      transformerCacheName,
      transformerCacheKeyCount,
    };
  });
}

function isPrivateReadySnapshot(snapshot) {
  return Boolean(
    snapshot &&
    !snapshot.downloadVisible &&
    snapshot.modelStatus === 'ready'
  );
}

async function preparePrivateModel(page) {
  const before = await getPrivateReadinessSnapshot(page);
  await markPhase(page, 'private_model_readiness_before', before);

  const downloadButton = page.locator('[data-testid="status-download-model-button"], [data-testid="download-model-button"], [data-testid="download-model-button-inline"]').first();
  if (await downloadButton.isVisible({ timeout: 10_000 }).catch(() => false)) {
    if (PRIVATE_SETUP_USER_CONSENT_REQUIRED) {
      const readiness = await getPrivateReadinessSnapshot(page);
      await markPhase(page, 'private_model_download_user_consent_required', readiness);
      throw new Error(
        `INVALID_SETUP setup.model_provider USER_CONSENT_REQUIRED private-setup-download-visible\n` +
        `Private model setup requires an explicit user click; this proof must not auto-download.\n` +
        `${JSON.stringify(readiness, null, 2)}`
      );
    }
    if (PRIVATE_SETUP_CLICK_DELAY_MS > 0) {
      await markPhase(page, 'private_model_download_visible_hold', {
        holdMs: PRIVATE_SETUP_CLICK_DELAY_MS,
        readiness: await getPrivateReadinessSnapshot(page),
      });
      await page.waitForTimeout(PRIVATE_SETUP_CLICK_DELAY_MS);
    }
    await markPhase(page, 'private_model_download_click', await getPrivateReadinessSnapshot(page));
    await downloadButton.click();
  }

  await page.waitForFunction(() => {
    const root = document.documentElement;
    const downloadButton = document.querySelector('[data-testid="status-download-model-button"], [data-testid="download-model-button"], [data-testid="download-model-button-inline"]');
    const downloadVisible = Boolean(downloadButton && getComputedStyle(downloadButton).display !== 'none');
    return !downloadVisible && root.getAttribute('data-model-status') === 'ready';
  }, null, { timeout: 180_000 });

  const after = await getPrivateReadinessSnapshot(page);
  await markPhase(page, 'private_model_readiness_after', after);
  if (!isPrivateReadySnapshot(after)) {
    throw new Error(`Private model is not ready before recording: ${JSON.stringify(after)}`);
  }
  return { before, after };
}

async function clickStartStopButton(page, phase) {
  const button = page.getByTestId('session-start-stop-button');
  try {
    await button.click({ timeout: 5_000 });
    return { method: 'playwright-click' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markPhase(page, `${phase}_playwright_click_failed`, { message });
    const postClickState = await page.evaluate(() => ({
      recording: document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording') ?? null,
      runtimeState: document.documentElement.getAttribute('data-runtime-state'),
      modelStatus: document.documentElement.getAttribute('data-model-status'),
      disabled: (document.querySelector('[data-testid="session-start-stop-button"]') instanceof HTMLButtonElement)
        ? document.querySelector('[data-testid="session-start-stop-button"]')?.disabled
        : null,
    }));
    await markPhase(page, `${phase}_post_click_state`, postClickState);
    if (phase === 'click_start' && ['INITIATING', 'ENGINE_INITIALIZING', 'RECORDING'].includes(postClickState.runtimeState)) {
      return { method: 'playwright-click-transition-observed', originalError: message, postClickState };
    }
    if (phase === 'click_stop' && (postClickState.recording === 'false' || ['READY', 'IDLE'].includes(postClickState.runtimeState))) {
      return { method: 'playwright-click-transition-observed', originalError: message, postClickState };
    }
    const fallback = await page.evaluate(() => {
      const button = document.querySelector('[data-testid="session-start-stop-button"]');
      if (!(button instanceof HTMLButtonElement)) {
        return { clicked: false, reason: 'button_not_found' };
      }
      if (button.disabled) {
        return { clicked: false, reason: 'button_disabled' };
      }
      button.click();
      return { clicked: true };
    });
    await markPhase(page, `${phase}_dom_click_fallback`, fallback);
    if (!fallback.clicked) {
      throw new Error(`Could not click session start/stop button for ${phase}: ${JSON.stringify(fallback)}; original=${message}`);
    }
    return { method: 'dom-click-fallback', originalError: message };
  }
}

async function waitForNativeReady(page) {
  const ready = await page.waitForFunction(
    () => {
      const trace = window.__NATIVE_BROWSER_TRACE__ || [];
      return trace.some((entry) => entry.event === 'onaudiostart' || entry.event === 'onspeechstart' || entry.event === 'acoustic_ready');
    },
    null,
    { timeout: 12_000 },
  ).catch(() => undefined);
  return Boolean(ready);
}

async function waitForRecordingGoSignal(page, mode) {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording') === 'true',
    null,
    { timeout: 60_000 },
  );

  if (mode === 'native') {
    await markPhase(page, 'wait_native_ready_start');
    const nativeReady = await waitForNativeReady(page);
    await markPhase(page, nativeReady ? 'wait_native_ready_done' : 'wait_native_ready_timeout');
    if (!nativeReady) {
      throw new Error('Native mic go signal did not arrive before fixture playback.');
    }
  }

  if (mode === 'private') {
    const ready = await getPrivateReadinessSnapshot(page);
    await markPhase(page, 'private_go_signal_check', ready);
    if (!isPrivateReadySnapshot(ready)) {
      throw new Error(`Private go signal denied; model not ready at recording start: ${JSON.stringify(ready)}`);
    }
  }
}

async function readTranscript(page) {
  const transcriptOnly = await page.evaluate(({ containerSelector, chromeSelector }) => {
    const container = document.querySelector(containerSelector);
    if (!container) return '';
    const clone = container.cloneNode(true);
    clone.querySelectorAll(chromeSelector).forEach((node) => node.remove());
    return clone.textContent ?? '';
  }, {
    containerSelector: TRANSCRIPT_CONTAINER_SELECTOR,
    chromeSelector: TRANSCRIPT_CHROME_SELECTOR,
  }).catch(() => '');
  return stripTranscriptChrome(transcriptOnly);
}

async function readSessionDetailTranscript(page) {
  const byTestId = compact(await page.getByTestId('session-detail-transcript').textContent().catch(() => ''));
  if (byTestId) return byTestId;
  const body = compact(await page.locator('body').textContent().catch(() => ''));
  return extractSessionDetailTranscript(body);
}

function isPlaceholderTranscript(text) {
  return !text || /\b(listening|words appear here|start speaking)\b/i.test(text);
}

async function waitForFirstText(page, startedAt) {
  const deadline = Date.now() + FIRST_TEXT_TIMEOUT_MS;
  let lastText = '';

  while (Date.now() < deadline) {
    let text = '';
    try {
      text = await readTranscript(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Target page, context or browser has been closed/i.test(message)) {
        return {
          timestampMs: null,
          text: lastText,
          error: 'browser_closed_while_waiting_for_first_text',
          errorMessage: message,
        };
      }
      throw error;
    }
    lastText = text;
    if (!isPlaceholderTranscript(text) && words(text).length > 0) {
      return {
        timestampMs: Date.now() - startedAt,
        text,
      };
    }
    try {
      await page.waitForTimeout(250);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Target page, context or browser has been closed/i.test(message)) {
        return {
          timestampMs: null,
          text: lastText,
          error: 'browser_closed_while_waiting_for_first_text',
          errorMessage: message,
        };
      }
      throw error;
    }
  }

  return {
    timestampMs: null,
    text: lastText,
  };
}

async function playFixture(audioPath) {
  if (INJECT_MIC_AUDIO) {
    const durationMs = await getPcmWavDurationMs(audioPath);
    await new Promise(resolve => setTimeout(resolve, durationMs + PLAYBACK_GRACE_MS));
    return { source: 'page-getUserMedia-injected-wav', audioPath, durationMs };
  }
  if (USE_FAKE_AUDIO_CAPTURE) {
    return { source: 'chrome-fake-audio-capture', audioPath: FAKE_AUDIO_FILE || audioPath };
  }
  if (process.platform !== 'darwin') {
    throw new Error('Real-mic STT corpus proof currently uses macOS afplay and must run on darwin.');
  }
  let lastError;
  for (let attempt = 1; attempt <= AFPLAY_RETRIES + 1; attempt += 1) {
    try {
      await execFileAsync('/usr/bin/afplay', [audioPath], { timeout: 45_000 });
      return { source: 'afplay-physical-speaker-mic', audioPath, attempt };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/AudioQueueStart failed/i.test(message) || attempt > AFPLAY_RETRIES) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 750 * attempt));
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  const playbackError = new Error(`fixture_playback_failed: ${message}`);
  playbackError.cause = lastError;
  playbackError.playbackFailure = {
    source: 'afplay-physical-speaker-mic',
    audioPath,
    attempts: AFPLAY_RETRIES + 1,
    reason: /AudioQueueStart failed/i.test(message) ? 'afplay_audio_queue_start_failed' : 'afplay_failed',
    message,
  };
  throw playbackError;
}

async function markPhase(page, phase, detail = {}) {
  const stamped = {
    phase,
    t: Date.now(),
    detail,
  };
  await page.evaluate((entry) => {
    const compact = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const stripTranscriptChrome = (text) => compact(String(text || '')
      .replace(/\bDraft transcript\b/gi, ' ')
      .replace(/Text may change before the final transcript is saved\./gi, ' ')
      .replace(/Processing speech locally(?:…|\.\.\.)?/gi, ' ')
      .replace(/Finalizing local transcript(?:…|\.\.\.)?/gi, ' ')
      .replace(/Your final transcript will appear here when local processing finishes\./gi, ' ')
      .replace(/Listening locally(?:…|\.\.\.)?/gi, ' ')
      .replace(/\bListening(?:…|\.\.\.)/gi, ' ')
      .replace(/Start recording and your words will appear here\./gi, ' ')
      .replace(/No speech was detected[^.]*\./gi, ' '));
    const extractTranscriptOnly = () => {
      const container = document.querySelector('[data-testid="transcript-container"]');
      if (!container) return null;
      const clone = container.cloneNode(true);
      clone.querySelectorAll([
        '[data-testid="live-transcript-trust-banner"]',
        '[data-testid="live-transcript-finalizing"]',
        '[data-testid="live-transcript-finalizing-empty"]',
      ].join(',')).forEach((node) => node.remove());
      return stripTranscriptChrome(clone.textContent ?? '');
    };
    const transcriptContainer = document.querySelector('[data-testid="transcript-container"]');
    window.__STT_CORPUS_PHASES__ = window.__STT_CORPUS_PHASES__ ?? [];
    const statusNode = document.querySelector('[data-testid="status-message-text"], [data-testid="stt-status"], [data-testid="session-status"], [data-testid="stt-status-label"]');
    window.__STT_CORPUS_PHASES__.push({
      ...entry,
      perfNow: Number(performance.now().toFixed(1)),
      recording: document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording') ?? null,
      rawTranscript: transcriptContainer?.textContent ?? null,
      transcript: extractTranscriptOnly(),
      transcriptState: transcriptContainer?.getAttribute('data-transcript-state') ?? null,
      draftVisible: Boolean(document.querySelector('[data-transcript-draft="true"]')),
      finalizingVisible: Boolean(document.querySelector('[data-testid="live-transcript-finalizing"]')),
      draftText: document.querySelector('[data-testid="live-transcript-current-line"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      statusText: statusNode?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      runtimeState: document.documentElement.getAttribute('data-runtime-state'),
      sessionPersisted: document.documentElement.getAttribute('data-session-persisted'),
    });
  }, stamped).catch(() => undefined);
}

async function readUiStatusSnapshot(page) {
  return page.evaluate(() => {
    const compact = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const stripTranscriptChrome = (text) => compact(String(text || '')
      .replace(/\bDraft transcript\b/gi, ' ')
      .replace(/Text may change before the final transcript is saved\./gi, ' ')
      .replace(/Processing speech locally(?:…|\.\.\.)?/gi, ' ')
      .replace(/Finalizing local transcript(?:…|\.\.\.)?/gi, ' ')
      .replace(/Your final transcript will appear here when local processing finishes\./gi, ' ')
      .replace(/Listening locally(?:…|\.\.\.)?/gi, ' ')
      .replace(/\bListening(?:…|\.\.\.)/gi, ' ')
      .replace(/Start recording and your words will appear here\./gi, ' ')
      .replace(/No speech was detected[^.]*\./gi, ' '));
    const extractTranscriptOnly = (container) => {
      if (!container) return null;
      const clone = container.cloneNode(true);
      clone.querySelectorAll([
        '[data-testid="live-transcript-trust-banner"]',
        '[data-testid="live-transcript-finalizing"]',
        '[data-testid="live-transcript-finalizing-empty"]',
      ].join(',')).forEach((node) => node.remove());
      return stripTranscriptChrome(clone.textContent ?? '');
    };
    const statusNode = document.querySelector('[data-testid="status-message-text"], [data-testid="stt-status"], [data-testid="session-status"], [data-testid="stt-status-label"]');
    const transcriptContainer = document.querySelector('[data-testid="transcript-container"]');
    return {
      perfNow: Number(performance.now().toFixed(1)),
      recording: document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording') ?? null,
      runtimeState: document.documentElement.getAttribute('data-runtime-state'),
      rawTranscript: transcriptContainer?.textContent ?? null,
      transcript: extractTranscriptOnly(transcriptContainer),
      transcriptState: transcriptContainer?.getAttribute('data-transcript-state') ?? null,
      draftVisible: Boolean(document.querySelector('[data-transcript-draft="true"]')),
      finalizingVisible: Boolean(document.querySelector('[data-testid="live-transcript-finalizing"]')),
      draftText: document.querySelector('[data-testid="live-transcript-current-line"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      statusText: statusNode?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    };
  }).catch(() => null);
}

async function observeStopStatus(page, startedAt, maxMs = 10_000) {
  const snapshots = [];
  while (Date.now() - startedAt < maxMs) {
    const snapshot = await readUiStatusSnapshot(page);
    if (snapshot) snapshots.push({ t: Date.now(), ...snapshot });
    if (snapshot?.recording === 'false') break;
    await page.waitForTimeout(250);
  }
  return snapshots;
}

async function collectTraceSnapshot(page, mode) {
  return page.evaluate(({ currentMode, includeAudioDataUrl }) => ({
    phases: window.__STT_CORPUS_PHASES__ ?? [],
    speechRuntimeDebug: typeof window.__SPEECH_RUNTIME_DEBUG__ === 'function'
      ? window.__SPEECH_RUNTIME_DEBUG__()
      : null,
    // Single source of truth: PrivateSTT publishes the resolved decision to this
    // stable global and keeps it after Stop. (The old chain read
    // window.__TRANSCRIPTION_SERVICE__.strategy.getRuntimePath(), but that global
    // is the controller — no .strategy — so it always resolved to null.)
    privateRuntimePath: currentMode === 'private'
      ? window.__PRIVATE_STT_RUNTIME_DEBUG__ ?? null
      : undefined,
    privateEngineVariant: currentMode === 'private'
      ? document.body?.getAttribute('data-engine-variant') ?? null
      : undefined,
    privateMicConstraintsDebug: currentMode === 'private'
      ? window.__PRIVATE_MIC_CONSTRAINTS_DEBUG__ ?? null
      : undefined,
    privateVadTelemetry: currentMode === 'private'
      ? window.__PRIVATE_VAD_TELEMETRY__ ?? null
      : undefined,
    privateModelTelemetry: currentMode === 'private'
      ? window.__PRIVATE_MODEL_TELEMETRY__ ?? null
      : undefined,
    privateResamplerTelemetry: currentMode === 'private'
      ? window.__PRIVATE_RESAMPLER_TELEMETRY__ ?? null
      : undefined,
    transcriptLifecycleTrace: window.__SS_TRANSCRIPT_TRACE__ ?? [],
    nativeTrace: currentMode === 'native' ? window.__NATIVE_BROWSER_TRACE__ ?? [] : undefined,
    nativeParallelCapture: currentMode === 'native' ? (window.__NATIVE_PARALLEL_CAPTURE__ ?? []).map((capture) => ({
      createdAt: capture.createdAt,
      samples: capture.samples,
      durationSec: capture.durationSec,
      sampleRate: capture.sampleRate,
      rms: capture.rms,
      peak: capture.peak,
      startedAt: capture.startedAt,
      endedAt: capture.endedAt,
      speechStartMs: capture.speechStartMs,
      speechEndMs: capture.speechEndMs,
      speechDurationMs: capture.speechDurationMs,
      segmentCount: capture.segmentCount,
      speechSegments: capture.speechSegments,
      wavDataUrlBytes: capture.wavDataUrl?.length ?? 0,
      ...(includeAudioDataUrl ? { wavDataUrl: capture.wavDataUrl ?? null } : {}),
    })) : undefined,
    privateTrace: currentMode === 'private' ? window.__PRIVATE_STT_TIMELINE__ ?? [] : undefined,
    privateAudioChunks: currentMode === 'private' ? (window.__PRIVATE_INFERENCE_AUDIO_CHUNKS__ ?? []).map((chunk) => ({
      samples: chunk.samples,
      durationSec: chunk.durationSec,
      rms: chunk.rms,
      peak: chunk.peak,
      transcript: chunk.transcript,
      rejectedReason: chunk.rejectedReason,
      wavDataUrlBytes: chunk.wavDataUrl?.length ?? 0,
      ...(includeAudioDataUrl ? { wavDataUrl: chunk.wavDataUrl ?? null } : {}),
    })) : undefined,
    privateUtteranceAudioChunks: currentMode === 'private' ? (window.__PRIVATE_UTTERANCE_AUDIO_CHUNKS__ ?? []).map((chunk) => ({
      createdAt: chunk.createdAt,
      samples: chunk.samples,
      durationSec: chunk.durationSec,
      rms: chunk.rms,
      peak: chunk.peak,
      speechStartOffsetMs: chunk.speechStartOffsetMs,
      retainedPrerollSamples: chunk.retainedPrerollSamples,
      wavDataUrlBytes: chunk.wavDataUrl?.length ?? 0,
      ...(includeAudioDataUrl ? { wavDataUrl: chunk.wavDataUrl ?? null } : {}),
    })) : undefined,
    transcriptUiState: (() => {
      const transcriptContainer = document.querySelector('[data-testid="transcript-container"]');
      const compact = (text) => (text || '').replace(/\s+/g, ' ').trim();
      const stripTranscriptChrome = (text) => compact(String(text || '')
        .replace(/\bDraft transcript\b/gi, ' ')
        .replace(/Text may change before the final transcript is saved\./gi, ' ')
        .replace(/Processing speech locally(?:…|\.\.\.)?/gi, ' ')
        .replace(/Finalizing local transcript(?:…|\.\.\.)?/gi, ' ')
        .replace(/Your final transcript will appear here when local processing finishes\./gi, ' ')
        .replace(/Listening locally(?:…|\.\.\.)?/gi, ' ')
        .replace(/\bListening(?:…|\.\.\.)/gi, ' ')
        .replace(/Start recording and your words will appear here\./gi, ' ')
        .replace(/No speech was detected[^.]*\./gi, ' '));
      const extractTranscriptOnly = () => {
        if (!transcriptContainer) return null;
        const clone = transcriptContainer.cloneNode(true);
        clone.querySelectorAll([
          '[data-testid="live-transcript-trust-banner"]',
          '[data-testid="live-transcript-finalizing"]',
          '[data-testid="live-transcript-finalizing-empty"]',
        ].join(',')).forEach((node) => node.remove());
        return stripTranscriptChrome(clone.textContent ?? '');
      };
      return {
        state: transcriptContainer?.getAttribute('data-transcript-state') ?? null,
        rawTranscript: transcriptContainer?.textContent ?? null,
        transcript: extractTranscriptOnly(),
        draftVisible: Boolean(document.querySelector('[data-transcript-draft="true"]')),
        finalizingVisible: Boolean(document.querySelector('[data-testid="live-transcript-finalizing"]')),
        draftText: document.querySelector('[data-testid="live-transcript-current-line"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      };
    })(),
  }), { currentMode: mode, includeAudioDataUrl: INCLUDE_AUDIO_DATA_URL }).catch(() => ({}));
}

async function collectPrivateRuntimeSnapshot(page) {
  return page.evaluate(() => ({
    speechRuntimeDebug: typeof window.__SPEECH_RUNTIME_DEBUG__ === 'function'
      ? window.__SPEECH_RUNTIME_DEBUG__()
      : null,
    runtimePath: window.__PRIVATE_STT_RUNTIME_DEBUG__ ?? null,
    engineVariant: document.body?.getAttribute('data-engine-variant') ?? null,
  })).catch(() => ({}));
}

function traceTextLength(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  for (const key of ['textLength', 'selectedLength', 'visibleAtStopLength', 'transcriptLength', 'finalLength', 'partialLength', 'committedLength']) {
    const value = entry[key];
    if (typeof value === 'number' && value > 0) return value;
  }
  for (const key of ['preview', 'text', 'selected', 'transcript', 'partial', 'committed']) {
    const value = entry[key];
    if (typeof value === 'string' && value.trim()) return value.trim().length;
  }
  return 0;
}

function hasTraceText(trace, stage) {
  return trace.some((entry) => entry.stage === stage && traceTextLength(entry) > 0);
}

function latestTraceStage(trace, stage) {
  return [...trace].reverse().find((entry) => entry.stage === stage) ?? null;
}

function summarizeTranscriptLifecycle(trace = []) {
  const stageCounts = trace.reduce((counts, entry) => {
    const stage = entry?.stage ?? 'unknown';
    counts[stage] = (counts[stage] ?? 0) + 1;
    return counts;
  }, {});
  const stopEvent = latestTraceStage(trace, 'lifecycle:stop');
  const saveEvent = latestTraceStage(trace, 'save:candidate');
  const boundaryOrder = [
    ['engine_emits_text', 'engine:emit'],
    ['service_normalized_event', 'service:receive'],
    ['controller_updates_lifecycle', 'controller:receive'],
    ['store_updates', 'store:update'],
    ['ui_visible_before_stop', 'ui:visible'],
    ['stop_called', 'lifecycle:stop'],
    ['save_candidate_selected', 'save:candidate'],
  ];
  const boundaryStatus = Object.fromEntries(
    boundaryOrder.map(([key, stage]) => [key, hasTraceText(trace, stage) || (stage === 'lifecycle:stop' && Boolean(stopEvent))]),
  );
  const firstBrokenBoundary = boundaryOrder.find(([key]) => !boundaryStatus[key])?.[0] ?? null;

  return {
    traceEventCount: trace.length,
    stageCounts,
    boundaryStatus,
    firstBrokenBoundary,
    stopSelectedSource: typeof saveEvent?.reason === 'string' ? saveEvent.reason : null,
    stopSelectedTranscriptLength: typeof saveEvent?.selectedLength === 'number' ? saveEvent.selectedLength : null,
    visibleTranscriptAtStopLength: typeof stopEvent?.visibleAtStopLength === 'number' ? stopEvent.visibleAtStopLength : null,
    stopPreview: typeof stopEvent?.preview === 'string' ? stopEvent.preview : null,
    saveCandidatePreview: typeof saveEvent?.preview === 'string' ? saveEvent.preview : null,
    saveCandidateSelectedTranscript: typeof saveEvent?.selected === 'string'
      ? saveEvent.selected
      : (typeof saveEvent?.preview === 'string' ? saveEvent.preview : null),
  };
}

function transcriptEvidenceInBody(bodyText, transcript) {
  const bodyWords = new Set(words(bodyText));
  const transcriptWords = words(transcript);
  const uniqueTranscriptWords = [...new Set(transcriptWords)];
  const matchedWords = uniqueTranscriptWords.filter((word) => bodyWords.has(word));
  return {
    bodyLength: compact(bodyText).length,
    uniqueTranscriptWordCount: uniqueTranscriptWords.length,
    matchedUniqueTranscriptWordCount: matchedWords.length,
    matchedUniqueTranscriptWords: matchedWords.slice(0, 20),
    containsAtLeastHalfUniqueTranscriptWords: uniqueTranscriptWords.length > 0 && matchedWords.length / uniqueTranscriptWords.length >= 0.5,
  };
}

async function readSupabaseAuthFromBrowser(page) {
  return page.evaluate(() => {
    for (const [key, rawValue] of Object.entries(localStorage)) {
      if (!/^sb-.*-auth-token$/.test(key) || typeof rawValue !== 'string') continue;
      try {
        const parsed = JSON.parse(rawValue);
        const userId = parsed?.user?.id ?? parsed?.currentSession?.user?.id ?? null;
        const accessToken = parsed?.access_token ?? parsed?.currentSession?.access_token ?? null;
        if (userId && accessToken) {
          return { storageKey: key, userId, accessToken };
        }
      } catch {
        // Keep scanning other localStorage keys.
      }
    }
    return null;
  }).catch(() => null);
}

async function fetchLatestSavedSessions(page) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return { skipped: true, reason: 'missing_supabase_url_or_anon_key' };
    }
    if (/mock\.supabase\.co/i.test(SUPABASE_URL) || /^mock_/i.test(SUPABASE_ANON_KEY)) {
      return { skipped: true, reason: 'mock_supabase_env_for_direct_query' };
    }
    const auth = await readSupabaseAuthFromBrowser(page);
    if (!auth) {
      return { skipped: true, reason: 'missing_browser_supabase_auth' };
    }

    const url = new URL(`${SUPABASE_URL}/rest/v1/sessions`);
    url.searchParams.set('select', 'id,user_id,status,transcript,created_at,engine,total_words');
    url.searchParams.set('user_id', `eq.${auth.userId}`);
    url.searchParams.set('or', '(status.is.null,status.eq.completed)');
    url.searchParams.set('order', 'created_at.desc');
    url.searchParams.set('limit', '5');

    const fetched = await page.evaluate(async ({ requestUrl, anonKey, accessToken }) => {
      const response = await fetch(requestUrl, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const bodyText = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        bodyText,
      };
    }, {
      requestUrl: url.toString(),
      anonKey: SUPABASE_ANON_KEY,
      accessToken: auth.accessToken,
    });
    let rows = null;
    try {
      rows = JSON.parse(fetched.bodyText);
    } catch {
      rows = null;
    }

    return {
      skipped: false,
      ok: fetched.ok,
      status: fetched.status,
      userId: auth.userId,
      rowCount: Array.isArray(rows) ? rows.length : null,
      latest: Array.isArray(rows) && rows[0] ? {
        id: rows[0].id,
        status: rows[0].status,
        engine: rows[0].engine,
        total_words: rows[0].total_words,
        transcriptLength: typeof rows[0].transcript === 'string' ? rows[0].transcript.length : null,
        transcriptPreview: typeof rows[0].transcript === 'string' ? rows[0].transcript.slice(0, 120) : null,
        created_at: rows[0].created_at,
      } : null,
      errorBody: fetched.ok ? undefined : compact(fetched.bodyText).slice(0, 500),
    };
  } catch (error) {
    return {
      skipped: false,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runFixture(page, mode, fixture) {
  const sessionUrl = new URL('/session', BASE_URL);
  if (mode === 'private' && PRIVATE_ENGINE) {
    sessionUrl.searchParams.set('privateEngine', PRIVATE_ENGINE);
  }
  if (mode === 'private' && PRIVATE_MIC_CONSTRAINTS) {
    sessionUrl.searchParams.set('privateMicConstraints', PRIVATE_MIC_CONSTRAINTS);
  }
  if (mode === 'private' && PRIVATE_VAD) {
    sessionUrl.searchParams.set('privateVad', PRIVATE_VAD);
  }
  if (mode === 'private' && PRIVATE_MODEL) {
    sessionUrl.searchParams.set('privateModel', PRIVATE_MODEL);
  }
  if (mode === 'private' && PRIVATE_RESAMPLER) {
    sessionUrl.searchParams.set('privateResampler', PRIVATE_RESAMPLER);
  }
  if (mode === 'native') {
    if (NATIVE_CONTINUOUS) {
      sessionUrl.searchParams.set('nativeContinuous', NATIVE_CONTINUOUS);
    }
    if (NATIVE_INTERIM_RESULTS) {
      sessionUrl.searchParams.set('nativeInterimResults', NATIVE_INTERIM_RESULTS);
    }
    if (NATIVE_MAX_ALTERNATIVES) {
      sessionUrl.searchParams.set('nativeMaxAlternatives', NATIVE_MAX_ALTERNATIVES);
    }
  }
  if (INJECT_MIC_AUDIO && mode !== 'native') {
    await installInjectedMicAudio(page, fixture.audioPath);
  }
  if (mode === 'private' && PRIVATE_MODEL) {
    await page.addInitScript((model) => {
      window.__PRIVATE_MODEL__ = model;
    }, PRIVATE_MODEL);
  }
  await page.goto(sessionUrl.toString(), { waitUntil: 'domcontentloaded' });
  await page.locator('html[data-app-visible-ready="true"]').waitFor({ timeout: 60_000 });
  await assertModePreflight(page, mode);
  await selectMode(page, mode);

  await page.evaluate(() => {
    window.__STT_CORPUS_PHASES__ = [];
    window.__SS_TRANSCRIPT_TRACE__ = [];
    window.__SS_TRANSCRIPT_TRACE_SEQ__ = 0;
    window.__NATIVE_BROWSER_TRACE__ = [];
    window.__PRIVATE_TRANSCRIPT_TRACE__ = true;
    window.__NATIVE_PARALLEL_CAPTURE_TRACE__ = true;
    window.__NATIVE_PARALLEL_CAPTURE__ = [];
    window.__PRIVATE_INFERENCE_AUDIO_CHUNKS__ = [];
    window.__PRIVATE_UTTERANCE_AUDIO_CHUNKS__ = [];
  });
  await markPhase(page, 'ready_to_start', { mode, fixture: fixture.id });
  const customWordEvidence = CUSTOM_WORD ? await ensureCustomWordThroughUi(page, CUSTOM_WORD) : undefined;
  if (customWordEvidence) {
    await markPhase(page, 'custom_word_added_via_ui', customWordEvidence);
  }
  const privateReadiness = mode === 'private' ? await preparePrivateModel(page) : undefined;

  const startButton = page.getByTestId('session-start-stop-button');
  await markPhase(page, 'click_start');
  const startClick = await clickStartStopButton(page, 'click_start');
  await markPhase(page, 'click_start_done', startClick);
  await waitForRecordingGoSignal(page, mode);
  const privateRuntimeDuringRecording = mode === 'private'
    ? await collectPrivateRuntimeSnapshot(page)
    : undefined;
  await markPhase(page, 'recording_attribute_true');

  const startedAt = Date.now();
  await page.waitForTimeout(PLAYBACK_GRACE_MS);
  await markPhase(page, 'playback_grace_done', { playbackGraceMs: PLAYBACK_GRACE_MS });

  const firstTextPromise = waitForFirstText(page, startedAt);
  await markPhase(page, 'afplay_start', { audioPath: fixture.audioPath });
  const playbackResult = await playFixture(fixture.audioPath);
  await markPhase(page, 'afplay_end', { audioPath: fixture.audioPath, playbackResult });
  const firstText = await firstTextPromise;
  await markPhase(page, 'first_text_observed', firstText);
  await page.waitForTimeout(POST_PLAYBACK_WAIT_MS);
  await markPhase(page, 'post_playback_wait_done', { postPlaybackWaitMs: POST_PLAYBACK_WAIT_MS });

  const visibleAtStopTranscript = await readTranscript(page);
  const liveCustomWord = CUSTOM_WORD ? await readCustomWordCount(page, CUSTOM_WORD) : undefined;
  if (liveCustomWord) {
    await markPhase(page, 'custom_word_live_count', { word: CUSTOM_WORD, ...liveCustomWord });
  }
  await markPhase(page, 'click_stop', { transcript: visibleAtStopTranscript });
  const stopClick = await clickStartStopButton(page, 'click_stop').catch((error) => ({
    method: 'failed',
    error: error instanceof Error ? error.message : String(error),
  }));
  await markPhase(page, 'click_stop_done', stopClick);
  const stopStatusSnapshots = await observeStopStatus(page, Date.now());
  await page.waitForFunction(
    () => document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording') === 'false',
    null,
    { timeout: 60_000 },
  ).catch(() => undefined);
  await markPhase(page, 'recording_attribute_false');
  await page.waitForTimeout(2_000);
  await markPhase(page, 'after_stop_settle');
  const postStopTranscript = await readTranscript(page);

  const traceSnapshot = await collectTraceSnapshot(page, mode);
  const transcriptLifecycleSummary = summarizeTranscriptLifecycle(traceSnapshot.transcriptLifecycleTrace);
  const debugSelectedForSave = traceSnapshot.speechRuntimeDebug?.saveCandidate?.selectedForSave;
  const selectedForSaveTranscript = compact(typeof debugSelectedForSave === 'string' ? debugSelectedForSave : '')
    || transcriptLifecycleSummary.saveCandidateSelectedTranscript
    || postStopTranscript
    || visibleAtStopTranscript;
  const visibleAtStopMetric = buildWerMetric(fixture.transcript, visibleAtStopTranscript);
  const postStopMetric = buildWerMetric(fixture.transcript, postStopTranscript);
  const selectedForSaveMetric = buildWerMetric(fixture.transcript, selectedForSaveTranscript);

  const result = {
    mode,
    fixture: fixture.id,
    fixtureType: fixture.type,
    audioPath: fixture.audioPath,
    truth: fixture.transcript,
    expectedFillers: fixture.expectedFillers,
    transcript: postStopTranscript,
    visibleAtStopTranscript,
    postStopTranscript,
    selectedForSaveTranscript,
    normalizedTranscript: postStopMetric.normalizedTranscript,
    wordCount: postStopMetric.wordCount,
    wer: postStopMetric.wer,
    accuracyPct: postStopMetric.accuracyPct,
    visibleAtStopWer: visibleAtStopMetric.wer,
    visibleAtStopAccuracyPct: visibleAtStopMetric.accuracyPct,
    postStopWer: postStopMetric.wer,
    postStopAccuracyPct: postStopMetric.accuracyPct,
    selectedForSaveWer: selectedForSaveMetric.wer,
    selectedForSaveAccuracyPct: selectedForSaveMetric.accuracyPct,
    firstText,
    sessionPersisted: await page.locator('html[data-session-persisted="true"]').isVisible().catch(() => false),
    customWord: customWordEvidence ? {
      ...customWordEvidence,
      liveAfterTranscript: liveCustomWord,
      transcriptContainsWord: new RegExp(`\\b${CUSTOM_WORD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(postStopTranscript),
    } : undefined,
    privateReadiness,
    phases: traceSnapshot.phases,
    nativeTrace: traceSnapshot.nativeTrace,
    nativeParallelCapture: traceSnapshot.nativeParallelCapture,
    privateTrace: traceSnapshot.privateTrace,
    privateAudioChunks: traceSnapshot.privateAudioChunks,
    privateUtteranceAudioChunks: traceSnapshot.privateUtteranceAudioChunks,
    privateEngineVariant: traceSnapshot.privateEngineVariant,
    privateMicConstraintsDebug: traceSnapshot.privateMicConstraintsDebug,
    transcriptUiState: traceSnapshot.transcriptUiState,
    stopStatusSnapshots,
    transcriptLifecycleTrace: traceSnapshot.transcriptLifecycleTrace,
    transcriptLifecycleSummary,
    traceStageCounts: transcriptLifecycleSummary.stageCounts,
    traceBoundaryStatus: transcriptLifecycleSummary.boundaryStatus,
    firstBrokenBoundary: transcriptLifecycleSummary.firstBrokenBoundary,
    stopSelectedSource: transcriptLifecycleSummary.stopSelectedSource,
    stopSelectedTranscriptLength: transcriptLifecycleSummary.stopSelectedTranscriptLength,
    visibleTranscriptAtStopLength: transcriptLifecycleSummary.visibleTranscriptAtStopLength,
    savePayloadTranscriptLength: transcriptLifecycleSummary.stopSelectedTranscriptLength,
    speechRuntimeDebug: traceSnapshot.speechRuntimeDebug,
    privateRuntimeDuringRecording,
    privateVadTelemetry: traceSnapshot.privateVadTelemetry,
    privateModelTelemetry: traceSnapshot.privateModelTelemetry,
    privateResamplerTelemetry: traceSnapshot.privateResamplerTelemetry,
    privateRuntimePath: privateRuntimeDuringRecording?.runtimePath ?? traceSnapshot.privateRuntimePath,
    privateRuntime: (privateRuntimeDuringRecording?.runtimePath ?? traceSnapshot.privateRuntimePath)?.runtime ?? null,
    privateProvider: (privateRuntimeDuringRecording?.runtimePath ?? traceSnapshot.privateRuntimePath)?.provider ?? null,
    privateWebgpuAvailable: (privateRuntimeDuringRecording?.runtimePath ?? traceSnapshot.privateRuntimePath)?.webgpuAvailable ?? null,
    privateTurboCached: (privateRuntimeDuringRecording?.runtimePath ?? traceSnapshot.privateRuntimePath)?.turboCached ?? null,
    privateCrossOriginIsolated: (privateRuntimeDuringRecording?.runtimePath ?? traceSnapshot.privateRuntimePath)?.crossOriginIsolated ?? null,
    privateWasmThreadCount: (privateRuntimeDuringRecording?.runtimePath ?? traceSnapshot.privateRuntimePath)?.wasmThreadCount ?? null,
    privateCloudFallbackAttempted: (privateRuntimeDuringRecording?.runtimePath ?? traceSnapshot.privateRuntimePath)?.cloudFallbackAttempted ?? null,
  };

  await page.goto(`${BASE_URL}/analytics`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await page.locator('html[data-app-visible-ready="true"]').waitFor({ timeout: 30_000 }).catch(() => undefined);
  await page.waitForFunction(() => {
    if (document.querySelector('[data-testid^="session-history-item-"]')) return true;
    if (document.querySelector('[data-testid="app-error"]')) return true;
    if (document.querySelector('[data-testid="app-loading"]')) return false;
    const body = document.body?.textContent ?? '';
    return /No sessions yet|Error Loading Analytics|Session Not Found/i.test(body);
  }, null, { timeout: 45_000 }).catch(() => undefined);
  const rawHistoryVisible = await page.getByTestId(/^session-history-item-/).first().isVisible({ timeout: 15_000 }).catch(() => false);
  result.historyVisible = Boolean(result.sessionPersisted && rawHistoryVisible);
  const detailButton = page.getByTestId(/^open-session-detail-/).first();
  const rawDetailVisible = await detailButton.isVisible({ timeout: 5_000 }).catch(() => false);
  const analyticsBody = compact(await page.locator('body').textContent().catch(() => ''));
  result.analyticsBodySample = analyticsBody.slice(0, 1000);
  result.analyticsTranscriptEvidence = transcriptEvidenceInBody(analyticsBody, selectedForSaveTranscript);
  result.directSavedSessionQuery = await fetchLatestSavedSessions(page);
  result.detailVisible = false;
  if (result.sessionPersisted && rawDetailVisible) {
    await detailButton.click().catch(() => undefined);
    await page.waitForTimeout(750);
    const detailBody = compact(await page.locator('body').textContent().catch(() => ''));
    const detailTranscript = await readSessionDetailTranscript(page);
    result.detailBodySample = detailBody.slice(0, 1000);
    result.detailTranscript = detailTranscript;
    const detailMetric = buildWerMetric(fixture.transcript, detailTranscript);
    result.detailWer = detailMetric.wer;
    result.detailAccuracyPct = detailMetric.accuracyPct;
    result.detailTranscriptEvidence = transcriptEvidenceInBody(detailTranscript, selectedForSaveTranscript);
    result.detailVisible = Boolean(
      detailTranscript &&
      result.detailTranscriptEvidence.containsAtLeastHalfUniqueTranscriptWords
    );
  }
  result.savedTranscriptLength = result.sessionPersisted ? result.savePayloadTranscriptLength : null;
  const truthWords = words(fixture.transcript);
  const uniqueTruthWords = [...new Set(truthWords)];
  const normalizedTranscriptWordSet = new Set(words(result.normalizedTranscript));
  result.truthWordsHeard = uniqueTruthWords.filter((word) => normalizedTranscriptWordSet.has(word));
  result.truthWordRecall = uniqueTruthWords.length > 0
    ? Number((result.truthWordsHeard.length / uniqueTruthWords.length).toFixed(4))
    : null;
  result.inputLikelyContaminated = result.wordCount > 0 && (
    result.truthWordsHeard.length === 0 ||
    (
      result.wordCount > truthWords.length * 2 &&
      result.truthWordRecall !== null &&
      result.truthWordRecall < 0.35
    )
  );
  if (mode === 'native' && USE_FAKE_AUDIO_CAPTURE) {
    result.inputLikelyContaminated = true;
    result.invalidForWer = true;
    result.invalidReason = 'native_webspeech_fake_audio_capture_invalid';
    result.invalidDetails = 'Chrome Web Speech is server-side live recognition; Playwright fake-audio capture starts at browser launch, loops the file, ignores per-fixture playback timing, and is not a valid WER route for Native.';
  }
  if (fixture.expectedFillers) {
    const expectedKeys = Object.keys(fixture.expectedFillers);
    result.observedFillers = countFillerOccurrences(selectedForSaveTranscript, [...new Set([...expectedKeys, ...DEFAULT_FILLER_WORDS])]);
    result.fillerPass = expectedKeys.every((filler) => result.observedFillers[filler] === fixture.expectedFillers[filler]);
  }
  result.journeyPass = Boolean(result.sessionPersisted && result.historyVisible && result.detailVisible && result.firstText.timestampMs != null);
  result.processingSpeechLocallyShown = Array.isArray(result.phases)
    ? result.phases.some((phase) => /Processing speech locally/i.test(phase.statusText || ''))
      || (Array.isArray(result.stopStatusSnapshots) && result.stopStatusSnapshots.some((snapshot) => /Processing speech locally/i.test(snapshot.statusText || '')))
    : false;
  const stopStartPhase = Array.isArray(result.phases) ? result.phases.find((phase) => phase.phase === 'click_stop') : null;
  const stopCompletePhase = Array.isArray(result.phases) ? result.phases.find((phase) => phase.phase === 'stop_force_processing_complete') : null;
  const afterStopSettlePhase = Array.isArray(result.phases) ? result.phases.find((phase) => phase.phase === 'after_stop_settle') : null;
  const stopPrivateComplete = Array.isArray(result.privateTrace)
    ? [...result.privateTrace].reverse().find((event) => event.event === 'stop_force_processing_complete')
    : null;
  result.stopFinalizationMs = stopPrivateComplete?.epochMs && stopStartPhase?.t
    ? stopPrivateComplete.epochMs - stopStartPhase.t
    : (afterStopSettlePhase?.t && stopStartPhase?.t ? afterStopSettlePhase.t - stopStartPhase.t : null);
  result.meetsWerThreshold = MAX_WER == null ? null : result.wer <= MAX_WER;
  result.verdict = result.invalidForWer
    ? result.invalidReason
    : result.inputLikelyContaminated
    ? 'input-contaminated-or-fixture-not-captured'
    : result.fillerPass === false
      ? 'filler-count-mismatch'
    : result.journeyPass
      ? 'journey-completed'
      : 'journey-incomplete';

  return result;
}

const evidence = {
  baseUrl: BASE_URL,
  environmentProof: buildEnvironmentProof(BASE_URL),
  modes: MODE_LIST,
  fixtures: FIXTURE_LIST,
  maxWer: MAX_WER,
  clearPrivateCache: CLEAR_PRIVATE_CACHE,
  privateEngine: PRIVATE_ENGINE || 'default',
  privateMicConstraints: PRIVATE_MIC_CONSTRAINTS || 'default-product',
  privateVad: PRIVATE_VAD || 'default-rms',
  privateModel: PRIVATE_MODEL || 'default-whisper-tiny.en',
  privateResampler: PRIVATE_RESAMPLER || 'default-box',
  nativeConfig: {
    continuous: NATIVE_CONTINUOUS || 'default',
    interimResults: NATIVE_INTERIM_RESULTS || 'default',
    maxAlternatives: NATIVE_MAX_ALTERNATIVES || 'default',
  },
  fakeAudioCapture: USE_FAKE_AUDIO_CAPTURE ? {
    enabled: true,
    file: FAKE_AUDIO_FILE || null,
    validForNativeWebSpeechWer: false,
    invalidReason: 'Chrome Web Speech uses Google server-side live recognition; Playwright fake-audio capture is not a valid WER route for Native because the file stream is launch-time, looped, and not paced to recognition start.',
  } : {
    enabled: false,
  },
  injectedMicAudio: {
    enabled: INJECT_MIC_AUDIO,
    validForNativeWebSpeechWer: false,
    route: INJECT_MIC_AUDIO ? 'page getUserMedia override; WAV starts when the app requests mic input' : null,
  },
  webgpuDisabledForRun: DISABLE_WEBGPU,
  customWord: CUSTOM_WORD || null,
  microphonePath: INJECT_MIC_AUDIO
    ? 'page getUserMedia override with per-fixture WAV injected at mic request time'
    : 'real browser getUserMedia with afplay through the physical speaker/mic path',
  auth: {
    mode: AUTH_MODE,
    email: AUTH_MODE === 'fresh' ? SIGNUP_EMAIL : EMAIL,
  },
  startedAt: new Date().toISOString(),
  consoleEvents: [],
  pageErrors: [],
  failedRequests: [],
  results: [],
};

if (!evidence.environmentProof.releaseProofEligible) {
  evidence.blockers = [
    `INVALID_SETUP setup.env RELEASE_PROOF_INELIGIBLE manual-stt-corpus-proof ` +
    `Manual STT corpus proof must run on localhost:5174 with real auth. ` +
    `localhost:5173, .env.test/mock auth, deployed URLs, and wrong CDP tabs are invalid evidence.`,
  ];
  evidence.completedAt = new Date().toISOString();
  evidence.pass = false;
  await writeFile(OUT, JSON.stringify(evidence, null, 2));
  console.error(`STT_CORPUS_EVIDENCE ${JSON.stringify(evidence)}`);
  process.exit(1);
}

let browser = null;
try {
  browser = await chromium.launch({
    channel: 'chrome',
    headless: HEADLESS,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--disable-blink-features=AutomationControlled',
      ...(DISABLE_WEBGPU ? [
        '--disable-webgpu',
        '--disable-features=Vulkan,WebGPU',
      ] : []),
      ...(USE_FAKE_AUDIO_CAPTURE ? [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${FAKE_AUDIO_FILE}`,
      ] : []),
    ],
  });
} catch (error) {
  if (isSandboxProcessControlEperm(error)) {
    Object.assign(evidence, buildSandboxProcessControlEpermArtifact({
      error,
      command: 'chromium.launch',
    }), {
      completedAt: new Date().toISOString(),
      runnerPass: false,
      gatePass: false,
      pass: false,
    });
    await writeFile(OUT, JSON.stringify(evidence, null, 2));
    console.log(`STT_CORPUS_EVIDENCE ${JSON.stringify({
      out: OUT,
      runnerPass: false,
      gatePass: false,
      resultCount: evidence.results.length,
      invalidReason: evidence.reason,
    })}`);
    process.exit(78);
  }
  throw error;
}

try {
  const fixtures = await loadFixtures();
  const context = await browser.newContext({
    permissions: ['microphone'],
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();

  page.on('console', (message) => {
    const text = message.text();
    if (/STT|Speech|Transcription|AssemblyAI|Native|Private|Cloud|recording|error|failed|warning|UserFiller|filler|vocabulary|user_filler_words|Supabase/i.test(text)) {
      evidence.consoleEvents.push({ type: message.type(), text });
    }
  });
  page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
  page.on('requestfailed', (request) => evidence.failedRequests.push({
    url: request.url(),
    errorText: request.failure()?.errorText,
  }));
  page.on('response', async (response) => {
    if (!/user_filler_words/i.test(response.url()) || response.status() < 400) return;
    evidence.failedRequests.push({
      url: response.url(),
      status: response.status(),
      body: compact(await response.text().catch(() => '')).slice(0, 500),
    });
  });

  if (CLEAR_PRIVATE_CACHE) {
    await clearPrivateModelStorage(page);
  }

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
          playbackFailure: error?.playbackFailure,
          invalidForSttEvidence: Boolean(error?.playbackFailure || error?.invalidForSttEvidence),
          invalidReason: error?.invalidReason ?? (error?.playbackFailure ? error.playbackFailure.reason : undefined),
          preflight: error?.preflight,
          currentUrl: page.url(),
          bodyText: compact(await page.locator('body').textContent().catch(() => '')).slice(0, 1200),
        });
      }
    }
  }
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error);
} finally {
  const closeError = browser
    ? await browser.close().then(() => null).catch((error) => error)
    : null;
  if (closeError && isSandboxProcessControlEperm(closeError)) {
    Object.assign(evidence, buildSandboxProcessControlEpermArtifact({
      error: closeError,
      command: 'browser.close',
    }));
  } else if (closeError) {
    evidence.browserCloseWarning = closeError instanceof Error ? closeError.message : String(closeError);
  }

  evidence.completedAt = new Date().toISOString();
  evidence.runnerPass = evidence.sandboxEperm === true
    ? false
    : evidence.results.length > 0 && evidence.results.every((result) => !result.error);
  evidence.gatePass = evidence.runnerPass && evidence.results.every((result) => (
    result.journeyPass === true &&
    result.inputLikelyContaminated !== true &&
    result.fillerPass !== false &&
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
    invalidReason: evidence.reason,
  })}`);
}

if (!evidence.pass) {
  process.exitCode = evidence.sandboxEperm === true ? 78 : 1;
}
