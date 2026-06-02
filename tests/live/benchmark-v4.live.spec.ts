/**
 * Benchmark: Private — Transformers.js v4 worker
 */
import { test, expect } from '@playwright/test';
import { calculateWordErrorRate } from '../../frontend/src/lib/wer';
import { HARVARD_FULL } from '../fixtures/stt-isomorphic/harvard-sentences';
import {
    AUDIO_ARGS,
    assertNoRegression,
    expectBenchmarkRecordingStarted,
    expectBenchmarkTranscriptOutput,
    preparePrivateModelIfPrompted,
    readBenchmarks,
    selectBenchmarkMode,
    waitForBenchmarkSession,
    writeBenchmarks,
} from './helpers/benchmark-utils';
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

test('measure Transformers.js v4 worker', async ({ page }) => {
    test.setTimeout(240_000);

    const testEmail = process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL;
    const testPassword = process.env.PRO_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD;

    if (!testEmail || !testPassword) {
        throw new Error('PRO_TEST_EMAIL and PRO_TEST_PASSWORD must be set for benchmark runs. E2E_PRO_EMAIL/E2E_PRO_PASSWORD remain supported as legacy local aliases.');
    }

    await page.addInitScript(() => {
        window.__E2E_CONTEXT__ = true;
        window.REAL_WHISPER_TEST = true;
        window.__STT_LOAD_TIMEOUT__ = 180000;
        window.localStorage.setItem('speaksharp.private.engine', 'transformers-js-v4');
    });

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
    await selectBenchmarkMode(page, 'private');
    await preparePrivateModelIfPrompted(page, 180_000);

    await page.getByTestId('session-start-stop-button').click();
    await expectBenchmarkRecordingStarted(page, 'private-v4');
    await expectBenchmarkTranscriptOutput(page, 'private-v4', 30_000);

    await page.waitForTimeout(20_000);

    await page.getByTestId('session-start-stop-button').click();
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
        throw new Error(
            `Benchmark aborted: transcript has only ${wordCount} words against ` +
            `${referenceWordCount} expected. Engine likely did not initialize. ` +
            `WER of ${(wer * 100).toFixed(1)}% would be meaningless and must not ` +
            `be committed as a ceiling.`
        );
    }

    const accuracyPct = parseFloat(((1 - wer) * 100).toFixed(2));

    console.log(`\n📊 Private (Transformers.js v4 worker) Ceiling: WER ${(wer * 100).toFixed(2)}% → Accuracy ${accuracyPct}%`);

    assertNoRegression('Private', wer, 'TransformersJS v4 worker', 'v4');

    const benchmarks = readBenchmarks();
    benchmarks.engines.Private.v4.expectedAccuracy = accuracyPct;
    benchmarks.engines.Private.v4.history.push({
        timestamp: new Date().toISOString(),
        model: 'TransformersJS v4 onnx-community/whisper-tiny.en',
        corpus: 'harvard-list-1',
        ceiling_wer: parseFloat(wer.toFixed(4)),
        ceiling_accuracy_pct: accuracyPct,
        environment: 'chromium-playwright-v4-worker',
    });
    writeBenchmarks(benchmarks);
});
