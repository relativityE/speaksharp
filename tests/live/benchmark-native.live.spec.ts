/**
 * Benchmark: Native (WebSpeechAPI)
 */
import { test, expect } from '@playwright/test';
import { calculateWordErrorRate } from '../../frontend/src/lib/wer';
import { HARVARD_LIST_1_SENTENCES } from '../fixtures/stt-isomorphic/harvard-sentences';
import { readBenchmarks, writeBenchmarks, assertNoRegression, AUDIO_ARGS } from './helpers/benchmark-utils';
import * as path from 'path';

test.use({
    launchOptions: {
        args: [
            ...AUDIO_ARGS,
            `--use-file-for-fake-audio-capture=${path.resolve('tests/fixtures/harvard_benchmark_16k.wav')}`,
        ]
    }
});

const TRIAL_COUNT = 3;

test('measure Native STT', async ({ page }) => {
    test.setTimeout(180_000); // 3 minutes total

    const testEmail = process.env.E2E_PRO_EMAIL;
    const testPassword = process.env.E2E_PRO_PASSWORD;

    if (!testEmail || !testPassword) {
        throw new Error('E2E_PRO_EMAIL and E2E_PRO_PASSWORD must be set for benchmark runs.');
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

    // Test Behavior: Wait for explicit auth signal (Sign Out button) since app-main is always rendered
    await expect(page.getByTestId('nav-sign-out-button')).toBeVisible({ timeout: 15_000 });

    const trialWers: number[] = [];

    for (let trial = 1; trial <= TRIAL_COUNT; trial++) {

        await page.goto('/session');
        

        const modeButton = page.getByTestId('stt-mode-select');
        await modeButton.click();
        await page.getByTestId('stt-mode-native').click();

        await page.getByTestId('session-start-stop-button').click();
        await expect(page.getByLabel(/Stop Recording/i)).toBeVisible({ timeout: 10_000 });

        // Fast-fail: assert the engine is producing output during the recording window
        // We use word count because transcript-container shows placeholder text ("Listening...")
        await expect(async () => {
            const text = await page.getByTestId('transcript-container').textContent() ?? '';
            const currentWordCount = text.trim().split(/\s+/).filter(w => w.length > 2).length;
            expect(currentWordCount).toBeGreaterThan(5);
        }).toPass({ timeout: 15_000 });

        await page.waitForTimeout(10_000);

        await page.getByTestId('session-start-stop-button').click();
        await expect(page.getByTestId('transcript-container')).not.toBeEmpty({ timeout: 15_000 });

        const text = (await page.getByTestId('transcript-container').textContent() ?? '')
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .trim();

        const referenceText = HARVARD_LIST_1_SENTENCES.slice(0, 5).join(' ');
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
        corpus: 'harvard-list-1-first5',
        trials: trialWers.length,
        ceiling_wer: parseFloat(meanWer.toFixed(4)),
        ceiling_accuracy_pct: accuracyPct,
        environment: 'chromium-playwright',
    });
    writeBenchmarks(benchmarks);
});
