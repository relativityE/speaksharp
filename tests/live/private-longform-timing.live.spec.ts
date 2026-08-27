import { test, expect, type Page, type TestInfo } from '@playwright/test';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
// #1304: the CERTIFIED scorer. `frontend/src/lib/wer`'s `calculateWordErrorRate` is the uncertified
// legacy ruler #1356 replaced — it charges 71% WER for `five dollars and fifty cents` vs `$5.50`, 50%
// for `21.4%` and 33% for `colour`/`color`, so a ranking built on it partly ranks orthography.
// `wordErrorRate` owns normalization and records the track and normalization identity on every row.
import { wordErrorRate } from '../evidence/werMetric';
import { AUDIO_ARGS, collectBenchmarkPreconditionSnapshot, preparePrivateModelIfPrompted, selectBenchmarkMode, waitForBenchmarkSaveCandidate, readBenchmarkTranscript, startBenchmarkRecording, stopBenchmarkRecording } from './helpers/benchmark-utils';
import { RECORDER_BAR } from '../helpers/micControls';
import { WASHINGTON_01 } from '../fixtures/stt-isomorphic/washington-speeches';

const BASE_URL = process.env.BASE_URL;
const WASHINGTON_AUDIO = fileURLToPath(new URL('../fixtures/stt-isomorphic/audio/washington_01.wav', import.meta.url));
const AUDIO_COMPLETION_MARGIN_MS = 3_000;

test.use({
  permissions: ['microphone'],
  baseURL: BASE_URL,
  launchOptions: {
    args: [
      ...AUDIO_ARGS,
      '--disable-gpu',
      '--disable-webgpu',
      `--use-file-for-fake-audio-capture=${WASHINGTON_AUDIO}`,
    ],
  },
});

test.describe('Private long-form timing branch proof @live', () => {
  test.beforeEach(() => {
    test.skip(!BASE_URL, 'BASE_URL is required so this proof can target the intended app.');
  });

  test('captures __PRIVATE_TIMING__ on washington_01 65.8s speech', async ({ page }, testInfo) => {
    test.setTimeout(420_000);

    await enablePrivateLiveHooks(page);
    const account = makeTesterAccount();
    await signUp(page, account.email, account.password);

    await expect(page).toHaveURL(/\/session/, { timeout: 45_000 });
    await expect(page.getByTestId('pro-badge')).toBeVisible({ timeout: 20_000 });
    await selectBenchmarkMode(page, 'private');
    await preparePrivateModelIfPrompted(page, 180_000);

    const beforeStart = await collectBenchmarkPreconditionSnapshot(page, 'private-longform-before-start');
    // #1304 Task 2: see the note in private-decode-params-ab — the combined toggle is retired and the
    // recorder bar's presence is the current recording signal.
    await startBenchmarkRecording(page, 'private-longform');
    const recordingStartedAt = Date.now();
    await expect(page.getByTestId(RECORDER_BAR)).toBeVisible({ timeout: 60_000 });

    const firstVisibleText = await waitForNonPlaceholderTranscript(page);
    const elapsedSinceStartMs = Date.now() - recordingStartedAt;
    await page.waitForTimeout(Math.max(
      0,
      WASHINGTON_01.metadata.durationSec * 1000 + AUDIO_COMPLETION_MARGIN_MS - elapsedSinceStartMs,
    ));

    const visibleAtStop = await readTranscriptText(page);
    // Stop through the shared helper (clicks `recorder-stop`, waits for the recorder bar to vanish).
    await stopBenchmarkRecording(page, 'private-longform-washington', 90_000);
    const saveCandidate = await waitForBenchmarkSaveCandidate(page, 'private-longform-washington', 120_000);
    const diagnostics = await readDiagnostics(page);
    const afterStop = await collectBenchmarkPreconditionSnapshot(page, 'private-longform-after-stop');

    // #1304 Task 2: VALIDATE BEFORE MEASURING — see the note in private-decode-params-ab. The WER,
    // the attached artifact and the PRIVATE_LONGFORM_TIMING_EVIDENCE log all preceded the check that
    // a finalized transcript existed, so an invalid run still left a number behind.
    const selectedForSave = saveCandidate.selectedForSave ?? '';
    if (selectedForSave.trim().length === 0) {
      throw new Error(
        `Run INVALID (no_finalized_saved_transcript) for private-longform-washington: ` +
        `saveCandidate=${JSON.stringify(saveCandidate)}. No WER is computed and no artifact is ` +
        `written — an absent transcript is not a measurement.`
      );
    }
    // The certified scorer owns normalization; the spec-local `normalizeForWer` was a second ruler.
    const scored = wordErrorRate(WASHINGTON_01.transcript, selectedForSave, { track: 'track_a' });
    if (scored.wer === null) {
      throw new Error(
        'Run INVALID (unmeasurable_reference) for private-longform-washington: the ground-truth ' +
        'reference normalized to zero words. No WER is computed and no artifact is written.'
      );
    }
    const wer = scored.wer;
    const accuracyPct = Number(((1 - wer) * 100).toFixed(2));
    const privateTiming = diagnostics.privateTiming as PrivateTiming | null;
    const finalizeDecodeMs = typeof privateTiming?.finalizeDecodeMs === 'number'
      ? privateTiming.finalizeDecodeMs
      : null;
    const utteranceSeconds = typeof privateTiming?.utteranceSeconds === 'number'
      ? privateTiming.utteranceSeconds
      : null;
    const rtf = finalizeDecodeMs != null && utteranceSeconds && utteranceSeconds > 0
      ? Number((finalizeDecodeMs / (utteranceSeconds * 1000)).toFixed(4))
      : null;

    const evidence = {
      capturedAt: new Date().toISOString(),
      fixture: WASHINGTON_01.id,
      fixtureAudio: WASHINGTON_AUDIO,
      expectedDurationSec: WASHINGTON_01.metadata.durationSec,
      expectedWords: WASHINGTON_01.metadata.words,
      accountEmail: account.email,
      beforeStart,
      firstVisibleText,
      visibleAtStop,
      afterStop,
      saveCandidate,
      privateTiming,
      rtf,
      stopPredecodeBreakdown: diagnostics.stopPredecodeBreakdown,
      privateTimelineTail: diagnostics.privateTimelineTail,
      transcriptContent: diagnostics.transcriptContent,
      selectedForSave,
      // Counts come from the SCORER, not a second normalizer recomputing them alongside it.
      referenceWords: scored.referenceWords,
      substitutions: scored.substitutions,
      deletions: scored.deletions,
      insertions: scored.insertions,
      wer: Number(wer.toFixed(4)),
      accuracyPct,
      scoringTrack: scored.track,
      normalizationVersion: scored.normalizationVersion,
    };

    await attachJson(testInfo, 'private-longform-washington-timing.json', evidence);
    console.log(`PRIVATE_LONGFORM_TIMING_EVIDENCE ${JSON.stringify(evidence)}`);

    expect(privateTiming, 'window.__PRIVATE_TIMING__ must be present after Stop').toBeTruthy();
    expect(finalizeDecodeMs, 'finalizeDecodeMs must be numeric').not.toBeNull();
    expect(saveCandidate.selectedForSaveLength ?? 0, 'saveCandidate selected text must exist').toBeGreaterThan(0);
  });
});

type PrivateTiming = {
  timeToFirstProvisionalMs?: number | null;
  timeToFirstFinalMs?: number | null;
  finalizeWaitMs?: number | null;
  finalizePrepMs?: number | null;
  finalizeDecodeMs?: number | null;
  utteranceSeconds?: number | null;
  peakBufferedSeconds?: number | null;
};

async function enablePrivateLiveHooks(page: Page) {
  await page.addInitScript(() => {
    const win = window as Window & {
      __E2E_CONTEXT__?: boolean;
      REAL_WHISPER_TEST?: boolean;
      __FORCE_TRANSFORMERS_JS__?: boolean;
      __STT_LOAD_TIMEOUT__?: number;
      __E2E_DEPS__?: Record<string, unknown>;
      __PRIVATE_TRANSCRIPT_TRACE__?: boolean;
    };

    win.__E2E_CONTEXT__ = true;
    win.REAL_WHISPER_TEST = true;
    win.__FORCE_TRANSFORMERS_JS__ = true;
    win.__STT_LOAD_TIMEOUT__ = 180000;
    win.__PRIVATE_TRANSCRIPT_TRACE__ = true;
    win.__E2E_DEPS__ = {
      ...win.__E2E_DEPS__,
      fetchUsageLimit: async () => ({
        can_start: true,
        subscription_status: 'pro',
        is_pro: true,
        streak_count: 0,
        trial_active: true,
      }),
    };
  });
}

function makeTesterAccount() {
  // STABLE reusable account — never mints a per-run user (which accumulated as private-longform-*
  // residue). Pro/trial state is mocked client-side, so no DB provisioning.
  return {
    email: `private-longform-reuse@example.test`,
    password: process.env.PRIVATE_LONGFORM_REUSE_PASSWORD ?? 'SpeakSharpLongform-Reuse!Aa9',
  };
}

// Idempotent: create the stable account on first run, sign in on every run after. Reuse, never accumulate.
async function signUp(page: Page, accountEmail: string, accountPassword: string) {
  await page.goto('/auth/signup');
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('email-input').fill(accountEmail);
  await page.getByTestId('password-input').fill(accountPassword);
  await page.getByTestId('sign-up-submit').click();
  if (await page.waitForURL(/\/session/, { timeout: 15_000 }).then(() => true).catch(() => false)) return;
  await page.goto('/auth/signin');
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('email-input').fill(accountEmail);
  await page.getByTestId('password-input').fill(accountPassword);
  await page.getByTestId('sign-in-submit').click();
  await expect(page).toHaveURL(/\/session|\/analytics/, { timeout: 30_000 });
}

async function waitForNonPlaceholderTranscript(page: Page) {
  let text = '';
  await expect(async () => {
    text = await readTranscriptText(page);
    expect(text).not.toMatch(/words appear here|listening|no speech|start recording/i);
    expect(text.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(3);
  }).toPass({ timeout: 120_000, intervals: [1_000, 2_000, 5_000] });
  return text;
}

/**
 * #1304 Task 2 — read the CURRENT rendered transcript surface, failing closed.
 *
 * This read `transcript-container`, which renders NOWHERE since the session overhaul. `textContent()`
 * resolved to null and `normalizeText(null)` turned it into `''` — an empty transcript
 * indistinguishable from a model that produced nothing, on every run.
 *
 * An absent or empty surface now THROWS with a named reason rather than returning empty text, so a
 * run that observed nothing cannot contribute a WER row.
 */
async function readTranscriptText(page: Page) {
  const read = await readBenchmarkTranscript(page);
  if (!read.ok) {
    throw new Error(`transcript read INVALID (${read.invalidReason}) — no WER row may be emitted from an unobserved surface`);
  }
  return normalizeText(read.text);
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
      stopPredecodeBreakdown: privateTimeline.filter((entry) => entry.event === 'stop_predecode_breakdown'),
      privateTimelineTail: privateTimeline.slice(-20),
      // #1304 Task 2: was `transcript-text-only`, a THIRD retired id that the surface guard caught —
      // rendered by nothing, so this diagnostic reported null on every run and looked like "no text".
      transcriptContent: document.querySelector('[data-testid="transcript-content"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    };
  });
}

function normalizeText(text: string | null) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown) {
  const filePath = testInfo.outputPath(name);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  await testInfo.attach(name, {
    path: filePath,
    contentType: 'application/json',
  });
}
