import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { AUDIO_ARGS, collectBenchmarkPreconditionSnapshot, selectBenchmarkMode } from './helpers/benchmark-utils';
import { FILLER_CONV_01_AUDIO } from './helpers/audio-fixtures';

const BASE_URL = process.env.BASE_URL;
const TESTER_B_TRUTH = 'Um. Basically, we should literally like, wait.';
const EXPECTED_TRUTH_WORDS = ['um', 'basically', 'literally', 'like', 'wait'];
const PRIVATE_REQUIRED_WORDS = ['um', 'basically', 'literally', 'like'];
const EXPECTED_FILLERS = ['um', 'basically', 'literally', 'like'];
const PLACEHOLDER_PATTERN = /\b(words appear here|listening|session complete|no speech was detected)\b/i;

type SttMode = 'private' | 'native';

test.describe.configure({ retries: 0 });

test.use({
  permissions: ['microphone'],
  baseURL: BASE_URL,
  launchOptions: {
    args: [
      ...AUDIO_ARGS,
      '--disable-gpu',
      '--disable-webgpu',
      `--use-file-for-fake-audio-capture=${FILLER_CONV_01_AUDIO}`,
    ],
  },
});

test.describe('Tester B no-cost STT gate with known audio @live', () => {
  test.beforeEach(() => {
    test.skip(!BASE_URL, 'BASE_URL is required so this gate can target the intended app.');
  });

  test.afterEach(async ({ page }) => {
    await stopRecordingIfNeeded(page);
  });

  test('Private STT transcribes conv_01 audio and detects fillers', async ({ page }, testInfo) => {
    test.setTimeout(360_000);
    const consoleEvents = attachBrowserEvidence(page);

    await enableNoCostTesterHooks(page, { enablePrivate: true });
    const { email, password } = makeTesterAccount('private');
    await signUp(page, email, password);

    await expect(page).toHaveURL(/\/session/, { timeout: 45_000 });
    await expect(page.getByTestId('pro-badge')).toBeVisible({ timeout: 20_000 });
    await selectBenchmarkMode(page, 'private');
    await preparePrivateModelIfPrompted(page);

    const evidence = await recordKnownAudioSession(page, 'private');
    await writeEvidence(testInfo, 'private', evidence, consoleEvents);

    expectPrivateFixtureTranscript(evidence);
    expectKnownFixtureFillers(evidence, 'private');
  });

  test('Native Browser STT transcribes conv_01 audio and detects fillers', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const consoleEvents = attachBrowserEvidence(page);

    await enableNoCostTesterHooks(page);
    const { email, password } = makeTesterAccount('native');
    await signUp(page, email, password);
    await expect(page).toHaveURL(/\/session/, { timeout: 45_000 });
    await selectBenchmarkMode(page, 'native');

    const evidence = await recordKnownAudioSession(page, 'native');
    await writeEvidence(testInfo, 'native', evidence, consoleEvents);

    expectNativeFixtureTranscript(evidence);
    expectKnownFixtureFillers(evidence, 'native');
  });
});

async function enableNoCostTesterHooks(page: Page, options: { enablePrivate?: boolean } = {}) {
  await page.addInitScript(() => {
    const win = window as Window & {
      __E2E_CONTEXT__?: boolean;
      REAL_WHISPER_TEST?: boolean;
      __FORCE_TRANSFORMERS_JS__?: boolean;
      __STT_LOAD_TIMEOUT__?: number;
      __E2E_DEPS__?: Record<string, unknown>;
    };

    win.__E2E_CONTEXT__ = true;
    win.__E2E_DEPS__ = {
      ...win.__E2E_DEPS__,
      fetchUsageLimit: async () => ({
        can_start: true,
        daily_remaining: 3600,
        daily_limit: 3600,
        monthly_remaining: 3600,
        monthly_limit: 3600,
        remaining_seconds: 3600,
        subscription_status: 'pro',
        is_pro: true,
        streak_count: 0,
        trial_active: true,
      }),
    };
  });

  if (options.enablePrivate) {
    await page.addInitScript(() => {
      window.REAL_WHISPER_TEST = true;
      window.__FORCE_TRANSFORMERS_JS__ = true;
      window.__STT_LOAD_TIMEOUT__ = 180000;
    });
  }
}

function makeTesterAccount(label: SttMode) {
  const unique = `${Date.now()}-${process.env.GITHUB_RUN_ID ?? 'local'}`;
  return {
    email: `tester-b-${label}-${unique}@speaksharp.app`,
    password: `SpeakSharpTesterB-${unique}!`,
  };
}

async function signUp(page: Page, accountEmail: string, accountPassword: string) {
  await page.goto('/auth/signup');
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('email-input').fill(accountEmail);
  await page.getByTestId('password-input').fill(accountPassword);
  await page.getByTestId('sign-up-submit').click();
}

async function preparePrivateModelIfPrompted(page: Page) {
  const downloadButton = page.getByTestId('download-model-button');
  if (await downloadButton.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await downloadButton.click();
  }

  await page.waitForFunction(() => {
    const root = document.documentElement;
    return (
      root.getAttribute('data-stt-ready') === 'true' ||
      root.getAttribute('data-runtime-state') === 'READY' ||
      root.getAttribute('data-model-status') === 'ready'
    );
  }, { timeout: 180_000 });
}

async function recordKnownAudioSession(page: Page, mode: SttMode) {
  const before = await collectBenchmarkPreconditionSnapshot(page, `${mode}-before-start`);
  const startStopButton = page.getByTestId('session-start-stop-button');
  await expect(startStopButton).toBeVisible({ timeout: 30_000 });
  await expect(startStopButton).toBeEnabled({ timeout: 60_000 });

  await startStopButton.click();
  await expect(startStopButton).toHaveAttribute('data-recording', 'true', { timeout: 60_000 });

  const liveTranscript = await waitForTranscriptWords(page, mode);
  await startStopButton.click();
  await expect(startStopButton).toHaveAttribute('data-recording', 'false', { timeout: 60_000 });

  const afterStopTranscript = normalizeTranscript(await page.getByTestId('transcript-container').textContent());
  const fillerText = normalizeTranscript(await page.getByTestId('filler-words-list').textContent());
  const after = await collectBenchmarkPreconditionSnapshot(page, `${mode}-after-stop`);

  return {
    mode,
    fixture: FILLER_CONV_01_AUDIO,
    truth: TESTER_B_TRUTH,
    before,
    liveTranscript,
    afterStopTranscript,
    fillerText,
    after,
  };
}

async function waitForTranscriptWords(page: Page, mode: SttMode) {
  let lastText = '';
  try {
    await expect(async () => {
      lastText = normalizeTranscript(await page.getByTestId('transcript-container').textContent());
      expect(lastText, `${mode} transcript must not be placeholder-only`).not.toMatch(PLACEHOLDER_PATTERN);
      const words = normalizeWords(lastText);
      const requiredWords = mode === 'private' ? PRIVATE_REQUIRED_WORDS : EXPECTED_TRUTH_WORDS;
      const found = requiredWords.filter((word) => words.includes(word));
      expect(found, `${mode} transcript must contain the required conv_01 words before stop: "${lastText}"`).toEqual(requiredWords);
    }).toPass({ timeout: mode === 'private' ? 120_000 : 60_000, intervals: [1_000, 2_000, 5_000] });
    return lastText;
  } catch (error) {
    const snapshot = await collectBenchmarkPreconditionSnapshot(page, `${mode}-transcript-timeout`);
    throw new Error(`${mode} did not produce live transcript for conv_01.wav. Last transcript="${lastText}"\n${JSON.stringify(snapshot, null, 2)}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

function expectPrivateFixtureTranscript(evidence: Awaited<ReturnType<typeof recordKnownAudioSession>>) {
  const transcript = `${evidence.liveTranscript} ${evidence.afterStopTranscript}`;
  const words = normalizeWords(transcript);
  const found = PRIVATE_REQUIRED_WORDS.filter((word) => words.includes(word));

  expect(found, `private transcript should capture the core conv_01 filler words. Transcript="${transcript}"`).toEqual(PRIVATE_REQUIRED_WORDS);

  const fullTruthFound = EXPECTED_TRUTH_WORDS.filter((word) => words.includes(word));
  if (fullTruthFound.length !== EXPECTED_TRUTH_WORDS.length) {
    console.warn(`PRIVATE_STT_KNOWN_ACCURACY_LIMITATION expected=${JSON.stringify(EXPECTED_TRUTH_WORDS)} found=${JSON.stringify(fullTruthFound)} transcript=${JSON.stringify(transcript)}`);
  }
}

function expectNativeFixtureTranscript(evidence: Awaited<ReturnType<typeof recordKnownAudioSession>>) {
  const transcript = `${evidence.liveTranscript} ${evidence.afterStopTranscript}`;
  const words = normalizeWords(transcript);
  const found = EXPECTED_TRUTH_WORDS.filter((word) => words.includes(word));

  expect(found, `native transcript should match conv_01 truth. Transcript="${transcript}"`).toEqual(EXPECTED_TRUTH_WORDS);
}

function expectKnownFixtureFillers(evidence: Awaited<ReturnType<typeof recordKnownAudioSession>>, mode: SttMode) {
  const fillerWords = normalizeWords(evidence.fillerText);
  const found = EXPECTED_FILLERS.filter((word) => fillerWords.includes(word));

  expect(found, `${mode} filler card should include conv_01 fillers. Filler UI="${evidence.fillerText}"`).toEqual(EXPECTED_FILLERS);
}

function attachBrowserEvidence(page: Page) {
  const events: Array<{ type: string; text: string }> = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/CloudAssemblyAI|ModelManager|TransformersJS|PrivateWhisper|SpeechRuntime|TranscriptionService|recording|transcript|Native/i.test(text)) {
      events.push({ type: message.type(), text });
      console.log(`[browser:${message.type()}] ${text}`);
    }
  });
  page.on('pageerror', (error) => {
    events.push({ type: 'pageerror', text: error.message });
    console.log(`[browser:pageerror] ${error.message}`);
  });
  return events;
}

async function writeEvidence(
  testInfo: TestInfo,
  mode: SttMode,
  evidence: Awaited<ReturnType<typeof recordKnownAudioSession>>,
  consoleEvents: Array<{ type: string; text: string }>
) {
  const body = JSON.stringify({ evidence, consoleEvents }, null, 2);
  await testInfo.attach(`tester-b-${mode}-stt-evidence.json`, {
    body,
    contentType: 'application/json',
  });
  console.log(`TESTER_B_${mode.toUpperCase()}_STT_EVIDENCE ${body}`);
}

async function stopRecordingIfNeeded(page: Page) {
  if (page.isClosed()) return;
  const startStopButton = page.getByTestId('session-start-stop-button');
  const visible = await startStopButton.isVisible({ timeout: 2_000 }).catch(() => false);
  if (visible && (await startStopButton.getAttribute('data-recording').catch(() => null)) === 'true') {
    await startStopButton.click({ timeout: 5_000 }).catch(() => undefined);
    await expect(startStopButton).toHaveAttribute('data-recording', 'false', { timeout: 20_000 }).catch(() => undefined);
  }
}

function normalizeTranscript(text: string | null) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeWords(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => word === 'uhm' || word === 'umm' ? 'um' : word)
    .filter(Boolean);
}
