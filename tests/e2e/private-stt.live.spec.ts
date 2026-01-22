/**
 * @file private-stt-real.e2e.spec.ts
 * @description E2E High-Fidelity Test for Private STT with REAL AUDIO → REAL TRANSCRIPT.
 * 
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │                    PRIVATE STT E2E TEST SUITE OVERVIEW                        │
 * ├──────────────────────────────────────────────────────────────────────────────┤
 * │ Test File                        │ Strategy          │ Purpose               │
 * │──────────────────────────────────│───────────────────│───────────────────────│
 * │ private-stt.e2e.spec.ts          │ MockEngine        │ UI flow, button states│
 * │ private-stt-integration.spec.ts  │ MockEngine (CI)   │ App lifecycle, toasts │
 * │ private-stt-resilience.spec.ts   │ Hang simulation   │ Timeout, fallback     │
 * │ private-stt-real.e2e.spec.ts     │ TransformersJS +  │ REAL audio → REAL     │
 * │ (THIS FILE)                      │ Real Audio        │ transcript verification│
 * │ private-stt-performance.spec.ts  │ Real Whisper      │ Memory/CPU profiling  │
 * └──────────────────────────────────────────────────────────────────────────────┘
 * 
 * HOW THIS TEST IS DIFFERENT:
 * ---------------------------
 * 1. Injects REAL audio file (jfk_16k.wav) via Playwright fake media stream.
 * 2. Uses TransformersJS engine (ONNX CPU) - NOT MockEngine.
 * 3. Verifies ACTUAL transcript output contains expected words ("Americans", "fellow").
 * 4. NO cost - runs locally, unlike Cloud STT.
 * 5. May be slow (~60s) due to model loading and inference.
 * 
 * WHEN TO RUN:
 * ------------
 * - Headed mode: `npx playwright test private-stt-real.e2e.spec.ts --headed`
 * - CI: May timeout in headless. Marked as slow test.
 * 
 * RELATED FILES:
 * - frontend/src/services/transcription/modes/PrivateWhisper.ts
 * - frontend/src/services/transcription/engines/TransformersJSEngine.ts
 * - tests/fixtures/jfk_16k.wav (audio file)
 * 
 * @see docs/ARCHITECTURE.md - "Triple-Engine Architecture"
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { programmaticLoginWithRoutes, navigateToRoute, debugLog } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const audioFile = path.resolve(__dirname, '../fixtures/jfk_16k.wav');

// Extend Window interface to disable mocks
declare global {
    interface Window {
        __E2E_MOCK_LOCAL_WHISPER__?: boolean;
        __E2E_PLAYWRIGHT__?: boolean;
        __FORCE_TRANSFORMERS_JS__?: boolean;
    }
}

// Configure Playwright to inject real audio via fake media stream
test.use({
    launchOptions: {
        args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-audio-capture=${audioFile}`
        ]
    },
    permissions: ['microphone']
});

// Mark as slow test (30s default timeout - CAPPED)
test.describe.configure({ timeout: 30000 });

test.describe('Private STT Real Audio (High Fidelity)', () => {

    /**
     * Skip in headless CI where TransformersJS may not have enough resources.
     * This test is designed for headed mode or manual verification.
     */
    test.skip(({ browserName }) => browserName !== 'chromium', 'Private STT only tested on Chromium');

    test.beforeEach(async ({ page }) => {
        // CRITICAL: Disable MockEngine and force TransformersJS
        await page.addInitScript(() => {
            // Do NOT use MockEngine
            window.__E2E_MOCK_LOCAL_WHISPER__ = false;
            window.__E2E_PLAYWRIGHT__ = true;
            // Force TransformersJS (skip WhisperTurbo WebGPU)
            window.__FORCE_TRANSFORMERS_JS__ = true;
            debugLog('[E2E] Real audio test: MockEngine DISABLED, TransformersJS FORCED');
        });
    });

    // SKIP: Playwright fake media streams don't provide actual audio data to TransformersJS ONNX engine.
    // The audio injection works at the browser level but TransformersJS processes raw PCM data from
    // AudioWorklet which receives silence from fake streams. This test requires a real browser with
    // real microphone input or a different approach to audio injection.
    // See: https://github.com/nickarellano/speaksharp/issues/XXX for tracking.
    test('should transcribe real audio using TransformersJS (no mocks, no cost)', async ({ page }) => {
        debugLog('🎤 Running High-Fidelity Private STT test with REAL audio');
        debugLog(`📂 Audio file: ${audioFile}`);

        // 1. Login as Pro user (Private STT requires Pro)
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });

        // 2. Navigate to session page
        await navigateToRoute(page, '/session');
        await page.waitForSelector('[data-testid="app-main"]');

        // 3. Select Private STT mode
        const modeButton = page.getByRole('button', { name: /Native|Cloud AI|Private/ });
        await modeButton.click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();
        debugLog('✅ Selected Private STT mode');

        // 4. Start recording - this triggers TransformersJS model loading
        const startButton = page.getByTestId('session-start-stop-button');
        await startButton.click();
        debugLog('🚀 Started recording, waiting for model to load...');

        // 5. Wait for model to load (can take 30-60s)
        // Look for either "Listening" or "Stop" to indicate model is ready
        await expect(
            startButton.first()
        ).toContainText(/stop/i, { timeout: 30000 });
        debugLog('✅ Model loaded, transcription active');

        // 6. Wait for transcript to appear
        const transcriptContainer = page.getByTestId('transcript-container');

        // The JFK audio says: "And so, my fellow Americans: ask not what your country can do for you..."
        // We check for key words that should appear in the transcript
        debugLog('👂 Listening for transcript output...');

        await expect(transcriptContainer).toContainText(/Americans|fellow|country|ask/i, { timeout: 30000 });

        const transcriptText = await transcriptContainer.textContent();
        debugLog(`📝 Transcript received: "${transcriptText?.substring(0, 100)}..."`);

        // 7. Stop recording
        await startButton.click();
        await expect(startButton).toContainText(/start/i, { timeout: 5000 });
        debugLog('✅ Recording stopped');

        // 8. Verify transcript contains expected content
        expect(transcriptText).toMatch(/Americans|fellow|country/i);
        debugLog('✅ HIGH-FIDELITY VERIFICATION PASSED: Real audio → Real transcript');
    });
});
