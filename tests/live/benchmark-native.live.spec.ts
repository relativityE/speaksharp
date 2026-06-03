/**
 * Benchmark: Native (WebSpeechAPI)
 */
import { test, expect } from '@playwright/test';
import { calculateWordErrorRate } from '../../frontend/src/lib/wer';
import { HARVARD_FULL } from '../fixtures/stt-isomorphic/harvard-sentences';
import { readBenchmarks, writeBenchmarks, assertNoRegression, AUDIO_ARGS, selectBenchmarkMode, waitForBenchmarkSession, expectBenchmarkRecordingStarted, collectBenchmarkPreconditionSnapshot, expectBenchmarkTranscriptOutput, assertNativeSpeechRecognitionIsReal, waitForBenchmarkSaveCandidate } from './helpers/benchmark-utils';
import { HARVARD_BENCHMARK_AUDIO } from './helpers/audio-fixtures';

const HARVARD_BENCHMARK_AUDIO_MS = 34_600;
const AUDIO_COMPLETION_MARGIN_MS = 2_000;

test.use({
    launchOptions: {
        args: [
            ...AUDIO_ARGS,
            `--use-file-for-fake-audio-capture=${HARVARD_BENCHMARK_AUDIO}`,
        ]
    }
});

const TRIAL_COUNT = 3;

test('measure Native STT', async ({ page }) => {
    test.setTimeout(180_000); // 3 minutes total

    const testEmail = process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL;
    const testPassword = process.env.PRO_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD;

    if (!testEmail || !testPassword) {
        throw new Error('PRO_TEST_EMAIL and PRO_TEST_PASSWORD must be set for benchmark runs. E2E_PRO_EMAIL/E2E_PRO_PASSWORD remain supported as legacy local aliases.');
    }

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

    await waitForBenchmarkSession(page);

    const trialWers: number[] = [];

    for (let trial = 1; trial <= TRIAL_COUNT; trial++) {

        await waitForBenchmarkSession(page);
        

        await selectBenchmarkMode(page, 'native');
        await assertNativeSpeechRecognitionIsReal(page, `native-trial-${trial}-speech-recognition-preflight`);
        console.log(`NATIVE_BENCHMARK_PREFLIGHT ${JSON.stringify(await collectBenchmarkPreconditionSnapshot(page, `native-trial-${trial}-before-start`))}`);

        await page.getByTestId('session-start-stop-button').click();
        const recordingStartedAt = Date.now();
        await expectBenchmarkRecordingStarted(page, `native-trial-${trial}`);

        // Fast-fail: assert the engine is producing output during the recording window
        // We use word count because transcript-container shows placeholder text ("Listening...")
        await expectBenchmarkTranscriptOutput(page, `native-trial-${trial}`, 15_000);

        const elapsedSinceStartMs = Date.now() - recordingStartedAt;
        await page.waitForTimeout(Math.max(0, HARVARD_BENCHMARK_AUDIO_MS + AUDIO_COMPLETION_MARGIN_MS - elapsedSinceStartMs));

        await page.getByTestId('session-start-stop-button').click();
        const saveCandidate = await waitForBenchmarkSaveCandidate(page, `native-trial-${trial}`);

        const text = (saveCandidate.selectedForSave ?? '')
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .trim();

        const referenceText = HARVARD_FULL;
        const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
        const referenceWordCount = referenceText.split(/\s+/).length;

        const trialWer = calculateWordErrorRate(referenceText, text);

        if (wordCount < referenceWordCount * 0.3) {
            throw new Error(
                `Benchmark aborted: Native trial produced only ${wordCount} words against ` +
                `${referenceWordCount} expected. Failing to prevent corrupted CEILING.`
            );
        }

        trialWers.push(trialWer);
        console.log(`  Trial ${trial}: WER ${(trialWer * 100).toFixed(2)}%`);
    }

    const meanWer = trialWers.reduce((a, b) => a + b, 0) / trialWers.length;
    const accuracyPct = parseFloat(((1 - meanWer) * 100).toFixed(2));

    console.log(`\n📊 Native Ceiling: Mean WER ${(meanWer * 100).toFixed(2)}%`);

    assertNoRegression('Native', meanWer, 'WebSpeechAPI');

    const benchmarks = readBenchmarks();
    benchmarks.engines.Native.expectedAccuracy = accuracyPct;
    benchmarks.engines.Native.history.push({
        timestamp: new Date().toISOString(),
        corpus: 'harvard-list-1',
        trials: trialWers.length,
        ceiling_wer: parseFloat(meanWer.toFixed(4)),
        ceiling_accuracy_pct: accuracyPct,
        environment: 'chromium-playwright',
    });
    writeBenchmarks(benchmarks);
});
