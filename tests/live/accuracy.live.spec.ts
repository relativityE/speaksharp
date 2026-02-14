import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, debugLog } from '../e2e/helpers';
import { TEST_IDS, ROUTES, TIMEOUTS } from '../constants';
import { calculateDetailedWER } from './utils/wer';
import fs from 'fs';
import path from 'path';

/**
 * 🎯 PRIVATE STT ACCURACY TEST (HIGH-FIDELITY)
 * 
 * This test injects REAL audio files into the transcription engine
 * and calculates the Word Error Rate (WER) against ground truth.
 * 
 * Target: <15% WER for Whisper Tiny.
 */
test.describe('Private STT Accuracy Verification @live', () => {
    const SAMPLES = [
        { id: 'sample1', refPath: 'tests/live/fixtures/librispeech/samples/sample1.txt' },
        { id: 'sample2', refPath: 'tests/live/fixtures/librispeech/samples/sample2.txt' },
        { id: 'sample3', refPath: 'tests/live/fixtures/librispeech/samples/sample3.txt' },
    ];

    test.beforeEach(async ({ page }) => {
        // 1. Force real transcription mode (avoid MockEngine)
        await page.addInitScript(() => {
            (window as any).__E2E_PLAYWRIGHT__ = true;
            (window as any).__E2E_MOCK_LOCAL_WHISPER__ = false;
        });

        // 2. Auth and Navigate
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, ROUTES.SESSION);
    });

    for (const sample of SAMPLES) {
        test(`should transcribe ${sample.id} with <15% WER`, async ({ page }) => {
            // Read reference transcript
            const reference = fs.readFileSync(path.resolve(sample.refPath), 'utf8').trim();
            debugLog(`[ACCURACY] Reference: ${reference}`);

            // 1. Select Private Mode
            const modeSelect = page.getByTestId(TEST_IDS.STT_MODE_SELECT);
            await modeSelect.click();
            await page.getByTestId(TEST_IDS.STT_MODE_PRIVATE).click();

            // 2. Inject Audio Mock
            // We use the Web Audio API to pipe a .wav file into getUserMedia
            await page.evaluate(async (audioUrl) => {
                const audio = new Audio(audioUrl);
                const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 });
                const source = audioCtx.createMediaElementSource(audio);
                const dest = audioCtx.createMediaStreamDestination();
                source.connect(dest);

                // Override getUserMedia to return our controlled stream
                const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
                navigator.mediaDevices.getUserMedia = async (constraints) => {
                    if (constraints && constraints.audio) {
                        console.log('[TEST] Injecting audio stream from:', audioUrl);
                        audio.play();
                        return dest.stream;
                    }
                    return originalGetUserMedia(constraints);
                };

                // Expose audio globally for completion tracking
                (window as any).__TEST_AUDIO__ = audio;
                (window as any).__TEST_AUDIO_INJECTED__ = true;
            }, `/test-audio/${sample.id}.wav`);

            // 3. Start Session
            await page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click();

            // Wait for engine to be ready and recording to start
            await expect(page.getByTestId(TEST_IDS.SESSION_STATUS_INDICATOR)).toContainText(/Recording/i, { timeout: 60000 });

            // 4. Wait for audio to finish playing
            debugLog(`[ACCURACY] Waiting for audio ${sample.id} to finish...`);
            await page.evaluate(async () => {
                const audio = (window as any).__TEST_AUDIO__;
                if (!audio) return;
                await new Promise<void>((resolve) => {
                    audio.onended = () => resolve();
                    if (audio.ended) resolve();
                });
            });

            // 5. Wait a bit longer for final transcription chunks to process
            debugLog(`[ACCURACY] Audio finished. Processing final chunks...`);
            await page.waitForTimeout(5000);

            // 5. Stop Session
            await page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click();

            // 6. Extract Result
            const transcriptLocator = page.getByTestId(TEST_IDS.TRANSCRIPT_DISPLAY);
            const hypothesis = await transcriptLocator.innerText();
            debugLog(`[ACCURACY] Hypothesis: ${hypothesis}`);

            // 7. Calculate WER
            const result = calculateDetailedWER(hypothesis, reference);
            debugLog(`[ACCURACY] Result for ${sample.id}:`, result);

            console.log(`[ACCURACY] ${sample.id} WER: ${result.wer.toFixed(2)}% (${result.errors}/${result.totalWords} errors)`);

            // 8. Assertions
            expect(result.wer).toBeLessThan(15);
            expect(result.totalWords).toBeGreaterThan(0);
        });
    }
});
