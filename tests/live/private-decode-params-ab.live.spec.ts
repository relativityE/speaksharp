import { test, expect, type Page, type TestInfo } from '@playwright/test';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { calculateWordErrorRate } from '../../frontend/src/lib/wer';
import { AUDIO_ARGS, preparePrivateModelIfPrompted, selectBenchmarkMode, waitForBenchmarkSaveCandidate } from './helpers/benchmark-utils';
import { HARVARD_SENTENCES } from '../fixtures/stt-isomorphic/harvard-sentences';
import { WASHINGTON_01 } from '../fixtures/stt-isomorphic/washington-speeches';

type DecodeVariant = {
  id: string;
  description: string;
  decodeOptions: Record<string, unknown> | null;
};

type DecodeFixture = {
  id: string;
  transcript: string;
  audioPath: string;
  durationSec: number;
};

const AUDIO_COMPLETION_MARGIN_MS = 3_000;
const requestedFixture = process.env.PRIVATE_DECODE_AB_FIXTURE ?? 'h1_6';
const requestedVariants = (process.env.PRIVATE_DECODE_AB_VARIANTS ?? 'baseline,anti_hallucination')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const VARIANTS: DecodeVariant[] = [
  {
    id: 'baseline',
    description: 'Current app worker defaults',
    decodeOptions: null,
  },
  {
    id: 'anti_hallucination',
    description: 'Reversible Whisper decode controls for repetition/substitution A/B',
    decodeOptions: {
      return_timestamps: true,
      condition_on_previous_text: false,
      compression_ratio_threshold: 2.4,
      no_repeat_ngram_size: 3,
      temperature: [0, 0.2, 0.4],
    },
  },
];

const FIXTURES: DecodeFixture[] = [
  ...HARVARD_SENTENCES
    .filter((fixture) => ['h1_2', 'h1_6', 'h1_8', 'h1_10'].includes(fixture.id))
    .map((fixture) => {
      const audioPath = fileURLToPath(new URL(`../fixtures/stt-isomorphic/audio/${fixture.id}.wav`, import.meta.url));
      return {
        id: fixture.id,
        transcript: fixture.transcript,
        audioPath,
        durationSec: readPcm16WavDurationSec(audioPath),
      };
    }),
  {
    id: WASHINGTON_01.id,
    transcript: WASHINGTON_01.transcript,
    audioPath: fileURLToPath(new URL(`../fixtures/stt-isomorphic/audio/${WASHINGTON_01.audio}`, import.meta.url)),
    durationSec: WASHINGTON_01.metadata.durationSec,
  },
];

const fixture = FIXTURES.find((item) => item.id === requestedFixture);

if (!fixture) {
  throw new Error(`Unknown PRIVATE_DECODE_AB_FIXTURE=${requestedFixture}`);
}

test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: [
      ...AUDIO_ARGS,
      '--disable-gpu',
      '--disable-webgpu',
      '--disable-blink-features=AutomationControlled',
      `--use-file-for-fake-audio-capture=${fixture.audioPath}`,
    ],
  },
});

test.describe(`Private decode-parameter A/B — ${fixture.id}`, () => {
  for (const variant of VARIANTS.filter((item) => requestedVariants.includes(item.id))) {
    test(`${variant.id}`, async ({ page }, testInfo) => {
      test.setTimeout(Math.max(240_000, Math.ceil(fixture.durationSec * 1000) + 180_000));

      await enablePrivateProofHooks(page, variant.decodeOptions);
      const account = makeTesterAccount(`${fixture.id}-${variant.id}`);
      await signUp(page, account.email, account.password);

      await expect(page).toHaveURL(/\/session/, { timeout: 45_000 });
      await selectBenchmarkMode(page, 'private');
      await preparePrivateModelIfPrompted(page, 180_000);

      const startStopButton = page.getByTestId('session-start-stop-button');
      await expect(startStopButton).toBeEnabled({ timeout: 60_000 });

      await startStopButton.click();
      const recordingStartedAt = Date.now();
      await expect(startStopButton).toHaveAttribute('data-recording', 'true', { timeout: 60_000 });

      await page.waitForTimeout(Math.max(
        0,
        fixture.durationSec * 1000 + AUDIO_COMPLETION_MARGIN_MS - (Date.now() - recordingStartedAt),
      ));

      const visibleAtStop = await readTranscriptText(page);
      await startStopButton.click();
      await expect(startStopButton).toHaveAttribute('data-recording', 'false', { timeout: 120_000 });
      const saveCandidate = await waitForBenchmarkSaveCandidate(page, `private-decode-ab-${fixture.id}-${variant.id}`, 120_000);
      const diagnostics = await readDiagnostics(page);

      const selectedForSave = saveCandidate.selectedForSave ?? '';
      const wer = calculateWordErrorRate(normalizeForWer(fixture.transcript), normalizeForWer(selectedForSave));
      const accuracyPct = Number(((1 - wer) * 100).toFixed(2));
      const evidence = {
        capturedAt: new Date().toISOString(),
        task: 'private_decode_parameter_ab',
        fixture: fixture.id,
        fixtureAudio: fixture.audioPath,
        fixtureDurationSec: fixture.durationSec,
        variant: variant.id,
        variantDescription: variant.description,
        decodeOptions: variant.decodeOptions,
        visibleAtStop,
        saveCandidate,
        selectedForSave,
        wer: Number(wer.toFixed(4)),
        accuracyPct,
        privateTiming: diagnostics.privateTiming,
        privateTimelineTail: diagnostics.privateTimelineTail,
        transcriptTextOnly: diagnostics.transcriptTextOnly,
      };

      await attachJson(testInfo, `private-decode-ab-${fixture.id}-${variant.id}.json`, evidence);
      console.log(`PRIVATE_DECODE_AB_EVIDENCE ${JSON.stringify(evidence)}`);

      expect(saveCandidate.selectedForSaveLength ?? 0, JSON.stringify(evidence)).toBeGreaterThan(0);
    });
  }
});

async function enablePrivateProofHooks(page: Page, decodeOptions: Record<string, unknown> | null) {
  await page.addInitScript((options) => {
    const win = window as Window & {
      __E2E_CONTEXT__?: boolean;
      REAL_WHISPER_TEST?: boolean;
      __FORCE_TRANSFORMERS_JS__?: boolean;
      __STT_LOAD_TIMEOUT__?: number;
      __E2E_DEPS__?: Record<string, unknown>;
      __PRIVATE_TRANSCRIPT_TRACE__?: boolean;
      __PRIVATE_STT_DECODE_OPTIONS__?: Record<string, unknown>;
    };

    win.__E2E_CONTEXT__ = true;
    win.REAL_WHISPER_TEST = true;
    win.__FORCE_TRANSFORMERS_JS__ = true;
    win.__STT_LOAD_TIMEOUT__ = 180000;
    win.__PRIVATE_TRANSCRIPT_TRACE__ = true;
    if (options) {
      win.__PRIVATE_STT_DECODE_OPTIONS__ = options;
    }
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
  }, decodeOptions);
}

function makeTesterAccount(label: string) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}-${label}`;
  return {
    email: `private-decode-ab-${unique}@speaksharp.app`,
    password: `SpeakSharpDecodeAb-${unique}!`,
  };
}

async function signUp(page: Page, accountEmail: string, accountPassword: string) {
  await page.goto('/auth/signup');
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('email-input').fill(accountEmail);
  await page.getByTestId('password-input').fill(accountPassword);
  await page.getByTestId('sign-up-submit').click();
}

async function readTranscriptText(page: Page) {
  return page.getByTestId('transcript-container')
    .textContent()
    .then((text) => normalizeText(text));
}

async function readDiagnostics(page: Page) {
  return page.evaluate(() => {
    const win = window as unknown as Window & {
      __PRIVATE_TIMING__?: unknown;
      __PRIVATE_STT_TIMELINE__?: Array<{ event?: string; payload?: unknown; epochMs?: number; perfMs?: number }>;
    };
    const privateTimeline = win.__PRIVATE_STT_TIMELINE__ ?? [];
    return {
      privateTiming: win.__PRIVATE_TIMING__ ?? null,
      privateTimelineTail: privateTimeline.slice(-20),
      transcriptTextOnly: document.querySelector('[data-testid="transcript-text-only"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    };
  });
}

function normalizeText(text: string | null) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeForWer(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown) {
  const filePath = testInfo.outputPath(name);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  await testInfo.attach(name, {
    path: filePath,
    contentType: 'application/json',
  });
}

function readPcm16WavDurationSec(filePath: string): number {
  const buf = fs.readFileSync(filePath);
  let off = 12;
  let dataSize = 0;
  let channels = 1;
  let bits = 16;
  let sampleRate = 16_000;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const start = off + 8;
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(start + 2);
      sampleRate = buf.readUInt32LE(start + 4);
      bits = buf.readUInt16LE(start + 14);
    } else if (id === 'data') {
      dataSize = size;
      break;
    }
    off = start + size + (size % 2);
  }
  return dataSize / Math.max(1, channels * (bits / 8) * sampleRate);
}
