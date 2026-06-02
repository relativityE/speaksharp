/**
 * Benchmark: Private — TransformersJS (CPU)
 */
import { test, expect } from '@playwright/test';
import { calculateWordErrorRate } from '../../frontend/src/lib/wer';
import { HARVARD_FULL } from '../fixtures/stt-isomorphic/harvard-sentences';
import { readBenchmarks, writeBenchmarks, assertNoRegression, AUDIO_ARGS, selectBenchmarkMode, waitForBenchmarkSession, preparePrivateModelIfPrompted, expectBenchmarkRecordingStarted, expectBenchmarkTranscriptOutput, logBenchmarkPhase } from './helpers/benchmark-utils';
import { HARVARD_BENCHMARK_AUDIO } from './helpers/audio-fixtures';

test.use({
    launchOptions: {
        args: [
            ...AUDIO_ARGS,
            '--disable-gpu',
            '--disable-webgpu',
            `--use-file-for-fake-audio-capture=${HARVARD_BENCHMARK_AUDIO}`,
        ]
    }
});

test('measure TransformersJS (CPU)', async ({ page }) => {
    test.setTimeout(360_000); // allow setup/readiness to fail with diagnostics before global timeout

    const testEmail = process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL;
    const testPassword = process.env.PRO_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD;

    if (!testEmail || !testPassword) {
        throw new Error('PRO_TEST_EMAIL and PRO_TEST_PASSWORD must be set for benchmark runs. E2E_PRO_EMAIL/E2E_PRO_PASSWORD remain supported as legacy local aliases.');
    }

    // Force Real WASM Execution instead of Mock Engine
    await page.addInitScript(() => {
        window.__E2E_CONTEXT__ = true;
        window.REAL_WHISPER_TEST = true;
        window.__FORCE_TRANSFORMERS_JS__ = true;
        window.__STT_LOAD_TIMEOUT__ = 180000;
    });

    // Real Authentication Flow to ensure real WASM engines are loaded
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

    // Navigate to the session page where the STT WASM engines actually initialize.
    await waitForBenchmarkSession(page);
    

    await selectBenchmarkMode(page, 'private');

    // Ensure the Private engine/model is downloaded and fully initialized BEFORE starting.
    await preparePrivateModelIfPrompted(page, 180_000);

    await page.getByTestId('session-start-stop-button').click();
    await expectBenchmarkRecordingStarted(page, 'private-cpu');

    // Fast-fail: assert the engine is producing output during the recording window
    // We use word count because transcript-container shows placeholder text ("Listening...")
    await expectBenchmarkTranscriptOutput(page, 'private-cpu', 20_000);

    // Wait for the remainder of the audio fixture (35s total - 15s elapsed avg)
    await page.waitForTimeout(20_000);

    // Stop and collect transcript
    await page.getByTestId('session-start-stop-button').click();
    await logBenchmarkPhase(page, 'PROOF_JOURNEY_STOP_CLICKED_PRIVATE_CPU');
    await expect(page.getByTestId('transcript-container')).not.toBeEmpty({ timeout: 15_000 });
    const transcriptText = (await page.getByTestId('transcript-container').textContent() ?? '')
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const wordCount = transcriptText.split(/\s+/).filter(w => w.length > 0).length;
    const referenceWordCount = HARVARD_FULL.split(/\s+/).length;
    const wer = calculateWordErrorRate(HARVARD_FULL, transcriptText);

    if (wordCount < referenceWordCount * 0.3) {
        await logBenchmarkPhase(page, 'PROOF_ACCURACY_FINAL_COMPLETENESS_FAIL_PRIVATE_CPU');
        throw new Error(
            `Benchmark aborted: transcript has only ${wordCount} words against ` +
            `${referenceWordCount} expected. Engine likely did not initialize. ` +
            `WER of ${(wer * 100).toFixed(1)}% would be meaningless and must not ` +
            `be committed as a ceiling.`
        );
    }

    const accuracyPct = parseFloat(((1 - wer) * 100).toFixed(2));

    console.log(`\n📊 Private (CPU) Ceiling: WER ${(wer * 100).toFixed(2)}% → Accuracy ${accuracyPct}%`);

    assertNoRegression('Private', wer, 'TransformersJS', 'cpu');

    const benchmarks = readBenchmarks();
    benchmarks.engines.Private.cpu.expectedAccuracy = accuracyPct;
    benchmarks.engines.Private.cpu.history.push({
        timestamp: new Date().toISOString(),
        model: 'TransformersJS whisper-small (ONNX CPU)',
        corpus: 'harvard-list-1',
        ceiling_wer: parseFloat(wer.toFixed(4)),
        ceiling_accuracy_pct: accuracyPct,
        environment: 'chromium-playwright-cpu',
    });
    writeBenchmarks(benchmarks);
});
