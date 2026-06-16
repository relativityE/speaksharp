/**
 * Benchmark: Private — Transformers.js v4 worker
 */
import { test } from '@playwright/test';
import { calculateWordErrorRate } from '../../frontend/src/lib/wer';
import { HARVARD_FULL } from '../fixtures/stt-isomorphic/harvard-sentences';
import {
    AUDIO_ARGS,
    assertNoRegression,
    expectBenchmarkRecordingStarted,
    expectBenchmarkTranscriptOutput,
    logBenchmarkPhase,
    preparePrivateModelIfPrompted,
    readBenchmarks,
    selectBenchmarkMode,
    waitForBenchmarkSaveCandidate,
    waitForBenchmarkSession,
    writeBenchmarks,
    attachPrivateBenchmarkEvidence,
} from './helpers/benchmark-utils';
import { HARVARD_BENCHMARK_AUDIO } from './helpers/audio-fixtures';

const HARVARD_BENCHMARK_AUDIO_MS = 34_600;
const AUDIO_COMPLETION_MARGIN_MS = 2_000;

// Parameterized so Test can benchmark the ROLLOUT v4 models (not the legacy tiny.en) on either device:
//   V4_VARIANT=base_q4|distil_q4   (default base_q4 — the universal rollout floor)
//   V4_DEVICE=wasm|webgpu          (default wasm; webgpu requires a REAL GPU machine, not headless CI)
// e.g.  V4_VARIANT=distil_q4 V4_DEVICE=webgpu pnpm exec playwright test tests/live/benchmark-v4.live.spec.ts
// NOTE: distil_q4 is the WebGPU accuracy tier — run it with V4_DEVICE=webgpu (the resolver gates distil
// on confirmed WebGPU). The run logs the actual loaded model; confirm it matches the intended variant.
const V4_VARIANT = (process.env.V4_VARIANT ?? 'base_q4') as 'base_q4' | 'distil_q4';
const V4_DEVICE = (process.env.V4_DEVICE ?? 'wasm') as 'wasm' | 'webgpu';
const V4_VARIANT_MODEL_ID: Record<string, string> = {
    base_q4: 'onnx-community/whisper-base.en',
    distil_q4: 'onnx-community/distil-small.en',
};
const GPU_ARGS = V4_DEVICE === 'webgpu'
    ? ['--enable-features=WebGPU', '--enable-unsafe-webgpu']
    : ['--disable-gpu', '--disable-webgpu'];

test.use({
    launchOptions: {
        args: [
            ...AUDIO_ARGS,
            ...GPU_ARGS,
            // Default: Chrome LOOPS the fixture into the fake capture device (the proven path). Setting
            // STT_FAKE_AUDIO_NOLOOP=1 appends %noloop to play the file ONCE — used to validate onset
            // alignment empirically before adopting it as the default (the long pre-record auth+download
            // delay means a free-running single play can finish before record, so loop stays the safe default).
            `--use-file-for-fake-audio-capture=${HARVARD_BENCHMARK_AUDIO}${process.env.STT_FAKE_AUDIO_NOLOOP === '1' ? '%noloop' : ''}`,
        ]
    }
});

test.afterEach(async ({ page }, testInfo) => {
    await attachPrivateBenchmarkEvidence(page, testInfo, 'private-v4');
});

test('measure Transformers.js v4 worker', async ({ page }) => {
    test.setTimeout(180_000);

    const testEmail = process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL;
    const testPassword = process.env.PRO_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD;

    if (!testEmail || !testPassword) {
        throw new Error('PRO_TEST_EMAIL and PRO_TEST_PASSWORD must be set for benchmark runs. E2E_PRO_EMAIL/E2E_PRO_PASSWORD remain supported as legacy local aliases.');
    }

    await page.addInitScript((cfg: { variant: string; device: string }) => {
        window.__E2E_CONTEXT__ = true;
        window.REAL_WHISPER_TEST = true;
        window.__STT_LOAD_TIMEOUT__ = 180000;
        (window as unknown as { __PRIVATE_TRANSCRIPT_TRACE__?: boolean }).__PRIVATE_TRANSCRIPT_TRACE__ = true;
        // Select v4 + the specific rollout variant/device via the dev/test experiment overrides
        // (honored only in DEV/test — inert in production). forceAuto + variant is how PrivateSTT
        // picks base_q4 vs distil_q4 under identical conditions; device pins the runtime backend.
        window.localStorage.setItem('speaksharp.private.engine', 'transformers-js-v4');
        window.localStorage.setItem('speaksharp.v4.forceAuto', '1');
        window.localStorage.setItem('speaksharp.v4.variant', cfg.variant);
        window.localStorage.setItem('speaksharp.v4.device', cfg.device);
    }, { variant: V4_VARIANT, device: V4_DEVICE });

    await page.goto('/auth/signin');
    await page.waitForSelector(`[data-testid="auth-form"]`, { timeout: 15_000 });
    await logBenchmarkPhase(page, 'SETUP_AUTH_TIER_FORM_VISIBLE');

    await page.getByTestId('email-input').fill(testEmail);
    await page.getByTestId('password-input').fill(testPassword);

    const loginPromise = page.waitForResponse(response =>
        response.url().includes('/auth/v1/token') && response.request().method() === 'POST'
    );
    await page.getByTestId('sign-in-submit').click();
    await loginPromise;
    await logBenchmarkPhase(page, 'SETUP_AUTH_TIER_LOGIN_SUCCESS');

    await waitForBenchmarkSession(page);
    await selectBenchmarkMode(page, 'private');
    await preparePrivateModelIfPrompted(page, 90_000);

    await page.getByTestId('session-start-stop-button').click();
    const recordingStartedAt = Date.now();
    await expectBenchmarkRecordingStarted(page, 'private-v4');
    await expectBenchmarkTranscriptOutput(page, 'private-v4', 30_000);

    const elapsedSinceStartMs = Date.now() - recordingStartedAt;
    await page.waitForTimeout(Math.max(0, HARVARD_BENCHMARK_AUDIO_MS + AUDIO_COMPLETION_MARGIN_MS - elapsedSinceStartMs));

    await page.getByTestId('session-start-stop-button').click();
    await logBenchmarkPhase(page, 'PROOF_JOURNEY_STOP_CLICKED_PRIVATE_V4');
    const saveCandidate = await waitForBenchmarkSaveCandidate(page, 'private-v4');
    const transcriptText = (saveCandidate.selectedForSave ?? '')
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const wordCount = transcriptText.split(/\s+/).filter(w => w.length > 0).length;
    const referenceWordCount = HARVARD_FULL.split(/\s+/).length;
    // Normalize the reference the SAME way as transcriptText — calculateWordErrorRate is
    // punctuation-sensitive, and HARVARD_FULL is punctuation-rich, so a raw reference inflates WER ~27pp.
    const wer = calculateWordErrorRate(HARVARD_FULL.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim(), transcriptText);

    if (wordCount < referenceWordCount * 0.3) {
        await logBenchmarkPhase(page, 'PROOF_ACCURACY_FINAL_COMPLETENESS_FAIL_PRIVATE_V4');
        throw new Error(
            `PROOF_FAIL proof.accuracy.final_completeness under_capture: transcript has only ${wordCount} words against ` +
            `${referenceWordCount} expected. Engine likely did not initialize. ` +
            `saveCandidate=${JSON.stringify(saveCandidate)} ` +
            `WER of ${(wer * 100).toFixed(1)}% would be meaningless and must not ` +
            `be committed as a ceiling.`
        );
    }

    const accuracyPct = parseFloat(((1 - wer) * 100).toFixed(2));

    console.log(`\n📊 Private (Transformers.js v4 worker) Ceiling: WER ${(wer * 100).toFixed(2)}% → Accuracy ${accuracyPct}%`);
    console.log(`📝 TRANSCRIPT(${wordCount}w/${referenceWordCount}): ${transcriptText}`);

    const benchmarkConfig = `${V4_VARIANT}|${V4_DEVICE}`;
    // Regression is checked against THIS config's own floor (base_q4|wasm, base_q4|webgpu,
    // distil_q4|webgpu); a null/absent floor means this run establishes it.
    assertNoRegression('Private', wer, 'TransformersJS v4 worker', 'v4', benchmarkConfig);

    const benchmarks = readBenchmarks();
    // Per-variant|device floor = the source of truth for the v2-vs-v4 A/B. Each run records (and may
    // only improve) its own config's floor; the latest measurement becomes the floor going forward.
    benchmarks.engines.Private.v4.floors = benchmarks.engines.Private.v4.floors ?? {};
    benchmarks.engines.Private.v4.floors[benchmarkConfig] = {
        expectedAccuracy: accuracyPct,
        model: V4_VARIANT_MODEL_ID[V4_VARIANT],
    };
    // Keep the legacy engine-level expectedAccuracy in sync for the rollout default so the frontend
    // STTAccuracyVsBenchmark component (reads expectedAccuracy) reflects the shipping floor.
    if (V4_VARIANT === 'base_q4' && V4_DEVICE === 'wasm') {
        benchmarks.engines.Private.v4.expectedAccuracy = accuracyPct;
    }
    benchmarks.engines.Private.v4.history.push({
        timestamp: new Date().toISOString(),
        model: `TransformersJS v4 ${V4_VARIANT_MODEL_ID[V4_VARIANT]}`,
        variant: V4_VARIANT,
        device: V4_DEVICE,
        corpus: 'harvard-list-1',
        ceiling_wer: parseFloat(wer.toFixed(4)),
        ceiling_accuracy_pct: accuracyPct,
        environment: `chromium-playwright-v4-worker-${V4_DEVICE}`,
    });
    writeBenchmarks(benchmarks);
});
