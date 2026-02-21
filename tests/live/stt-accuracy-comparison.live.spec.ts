/**
 * @file stt-accuracy-comparison.live.spec.ts
 * @description Multi-engine Accuracy Audit: Native vs Cloud vs Private.
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { programmaticLoginWithRoutes, navigateToRoute, debugLog } from '../e2e/helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const syntheticAudio = path.resolve(__dirname, '../fixtures/test_speech_16k.wav');

// Expected keywords from test_speech_16k.wav
const EXPECTED_KEYWORDS = [/testing/i, /audio/i, /transcription/i, /speech/i];

test.use({
    launchOptions: {
        args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-audio-capture=${syntheticAudio}`
        ]
    },
    permissions: ['microphone']
});

test.describe('STT Accuracy Audit (Multi-Engine)', () => {

    test.beforeEach(async ({ page }) => {
        // Force real transcription and disable mocks
        await page.addInitScript(() => {
            window.REAL_WHISPER_TEST = true;
            (window as any).__FORCE_TRANSFORMERS_JS__ = true;
        });

        // Login as Pro to have access to all engines
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, '/session');
        await page.waitForSelector('[data-testid="app-main"]');
    });

    const engines = [
        { name: 'Native', label: /native browser/i },
        { name: 'Cloud', label: /cloud ai/i },
        { name: 'Private', label: /private/i }
    ];

    for (const engine of engines) {
        test(`should produce accurate transcript using ${engine.name} STT`, async ({ page }) => {
            debugLog(`🎯 Auditing ${engine.name} STT accuracy...`);

            // 1. Select Engine
            const modeButton = page.getByRole('button', { name: /Native|Cloud AI|Private/ });
            await modeButton.click();
            await page.getByRole('menuitemradio', { name: engine.label }).click();
            debugLog(`✅ Selected ${engine.name} mode`);

            // 2. Start Recording
            const startButton = page.getByTestId('session-start-stop-button');
            await startButton.click();
            debugLog('🚀 Recording started...');

            // 3. Wait for transcription
            const transcriptContainer = page.getByTestId('transcript-container');

            // Give it plenty of time for model load / network latency
            // Especially for Private (model load) and Cloud (socket connection)
            for (const keyword of EXPECTED_KEYWORDS) {
                await expect(transcriptContainer).toContainText(keyword, { timeout: 60000 });
            }

            const finalTranscript = await transcriptContainer.textContent();
            debugLog(`📝 [${engine.name}] Result: "${finalTranscript}"`);

            // 4. Stop
            await startButton.click();
            await expect(startButton).toContainText(/start/i, { timeout: 10000 });
        });
    }
});
