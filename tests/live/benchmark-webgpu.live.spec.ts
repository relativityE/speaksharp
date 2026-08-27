/**
 * Benchmark: Private — WhisperTurbo (WebGPU)
 */
import { test } from '@playwright/test';
import { calculateWordErrorRate } from '../../frontend/src/lib/wer';
import { HARVARD_FULL } from '../fixtures/stt-isomorphic/harvard-sentences';
import { readBenchmarks, writeBenchmarks, assertNoRegression, AUDIO_ARGS, selectBenchmarkMode, waitForBenchmarkSession, waitForPrivateEngineReady, expectBenchmarkRecordingStarted, expectBenchmarkTranscriptOutput, startBenchmarkRecording, stopBenchmarkRecording, waitForBenchmarkSaveCandidate } from './helpers/benchmark-utils';
import { HARVARD_BENCHMARK_AUDIO } from './helpers/audio-fixtures';

test.use({
    launchOptions: {
        args: [
            ...AUDIO_ARGS,
            '--enable-features=WebGPU',
            `--use-file-for-fake-audio-capture=${HARVARD_BENCHMARK_AUDIO}`,
        ]
    }
});

test('measure WhisperTurbo (WebGPU)', async ({ page }) => {
    test.setTimeout(240_000); // 4 minutes

    const testEmail = process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL;
    const testPassword = process.env.PRO_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD;

    if (!testEmail || !testPassword) {
        throw new Error('PRO_TEST_EMAIL and PRO_TEST_PASSWORD must be set for benchmark runs. E2E_PRO_EMAIL/E2E_PRO_PASSWORD remain supported as legacy local aliases.');
    }

    // Force Real WASM Execution instead of Mock Engine
    await page.addInitScript(() => {
        window.__E2E_CONTEXT__ = true;
        window.REAL_WHISPER_TEST = true;
        window.__STT_LOAD_TIMEOUT__ = 180000;
    });

    // Real Authentication Flow
    await page.goto('/auth/signin');
    await page.waitForSelector(`[data-testid="auth-form"]`, { timeout: 15_000 });

    await page.getByTestId('email-input').fill(testEmail);
    await page.getByTestId('password-input').fill(testPassword);

    const loginPromise = page.waitForResponse(response =>
        response.url().includes('/auth/v1/token') && response.request().method() === 'POST'
    );
    await page.getByTestId('sign-in-submit').click();
    await loginPromise;

    // Navigate to the session page where the STT WASM engines actually initialize.
    await waitForBenchmarkSession(page);
    

    await selectBenchmarkMode(page, 'private');

    // Ensure the WebGPU engine is fully initialized (WASM downloaded and booted) BEFORE starting.
    await waitForPrivateEngineReady(page, 180_000);

    await startBenchmarkRecording(page, 'private-webgpu');
    await expectBenchmarkRecordingStarted(page, 'private-webgpu');

    // Fast-fail: assert the engine is producing output during the recording window
    // Word count, because the live surface also carries interim placeholder text.
    await expectBenchmarkTranscriptOutput(page, 'private-webgpu', 20_000);

    // Wait for the remainder of the audio fixture (35s total - 15s elapsed avg)
    await page.waitForTimeout(20_000);

    // Stop and collect transcript
    await stopBenchmarkRecording(page, 'private-webgpu');

    // #1304 Task 2: the AUTHORITATIVE final transcript is the one the product selected to SAVE, not
    // transient DOM text. Scraping the rendered surface measured whatever happened to be painted —
    // including interim text — and the retired container it used to read renders nowhere at all, so
    // every WER produced here was computed from an empty string.
    const saveCandidate = await waitForBenchmarkSaveCandidate(page, 'private-webgpu');
    const selectedForSave = saveCandidate.selectedForSave ?? '';
    if (selectedForSave.trim().length === 0) {
        throw new Error(
            `Benchmark run INVALID for private-webgpu: no finalized saved transcript ` +
            `(saveCandidate=${JSON.stringify(saveCandidate)}). No WER row is emitted — an absent ` +
            `transcript is not a measurement.`
        );
    }
    const transcriptText = selectedForSave
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const wordCount = transcriptText.split(/\s+/).filter(w => w.length > 0).length;
    const referenceWordCount = HARVARD_FULL.split(/\s+/).length;
    const wer = calculateWordErrorRate(HARVARD_FULL, transcriptText);

    if (wordCount < referenceWordCount * 0.3) {
        throw new Error(
            `Benchmark aborted: transcript has only ${wordCount} words against ` +
            `${referenceWordCount} expected. Engine likely did not initialize. ` +
            `WER of ${(wer * 100).toFixed(1)}% would be meaningless and must not ` +
            `be committed as a ceiling.`
        );
    }

    const accuracyPct = parseFloat(((1 - wer) * 100).toFixed(2));

    console.log(`\n📊 Private (WebGPU) Measure: WER ${(wer * 100).toFixed(2)}% → Accuracy ${accuracyPct}%`);

    assertNoRegression('Private', wer, 'WhisperTurbo', 'webgpu');

    const benchmarks = readBenchmarks();
    if (!process.env.CI) {
        benchmarks.engines.Private.webgpu.expectedAccuracy = accuracyPct;
    }

    benchmarks.engines.Private.webgpu.history.push({
        timestamp: new Date().toISOString(),
        model: 'WhisperTurbo (WebGPU WASM)',
        corpus: 'harvard-list-1',
        ceiling_wer: parseFloat(wer.toFixed(4)),
        ceiling_accuracy_pct: accuracyPct,
        environment: process.env.CI ? 'github-actions-headless' : 'local-headed-gpu',
        note: process.env.CI ? 'Estimated from CPU runner (not a ceiling)' : 'Measured on local hardware'
    });
    writeBenchmarks(benchmarks);
});
