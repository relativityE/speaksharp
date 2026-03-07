/**
 * Benchmark: Private — WhisperTurbo (WebGPU)
 */
import { test, expect } from '@playwright/test';
import { calculateWordErrorRate } from '../../frontend/src/lib/wer';
import { HARVARD_FULL } from '../fixtures/stt-isomorphic/harvard-sentences';
import { readBenchmarks, writeBenchmarks, assertNoRegression, AUDIO_ARGS } from './helpers/benchmark-utils';
import * as path from 'path';

test.use({
    launchOptions: {
        args: [
            ...AUDIO_ARGS,
            '--enable-features=WebGPU',
            `--use-file-for-fake-audio-capture=${path.resolve('tests/fixtures/harvard_benchmark_16k.wav')}`,
        ]
    }
});

test('measure WhisperTurbo (WebGPU)', async ({ page }) => {
    test.setTimeout(240_000); // 4 minutes

    const testEmail = process.env.E2E_PRO_EMAIL;
    const testPassword = process.env.E2E_PRO_PASSWORD;

    if (!testEmail || !testPassword) {
        throw new Error('E2E_PRO_EMAIL and E2E_PRO_PASSWORD must be set for benchmark runs.');
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

    // Test Behavior: Wait for explicit auth signal (Sign Out button) since app-main is always rendered
    await expect(page.getByTestId('nav-sign-out-button')).toBeVisible({ timeout: 15_000 });

    // Navigate to the session page where the STT WASM engines actually initialize
    await page.goto('/session');
    await page.waitForLoadState('networkidle');

    const modeButton = page.getByTestId('stt-mode-select');
    await modeButton.click();
    await page.getByTestId('stt-mode-private').click();

    // Ensure the WebGPU engine is fully initialized (WASM downloaded and booted) BEFORE starting
    await expect(page.locator('body')).toHaveAttribute('data-stt-engine', 'ready', { timeout: 180_000 });

    await page.getByTestId('session-start-stop-button').click();
    await expect(page.getByLabel(/Stop Recording/i)).toBeVisible({ timeout: 10_000 });

    // Fast-fail: assert the engine is producing output during the recording window
    // We use word count because transcript-container shows placeholder text ("Listening...")
    await expect(async () => {
        const text = await page.getByTestId('transcript-container').textContent() ?? '';
        const currentWordCount = text.trim().split(/\s+/).filter(w => w.length > 2).length;
        expect(currentWordCount).toBeGreaterThan(5);
    }).toPass({ timeout: 20_000 });

    // Wait for the remainder of the audio fixture (35s total - 15s elapsed avg)
    await page.waitForTimeout(20_000);

    // Stop and collect transcript
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
