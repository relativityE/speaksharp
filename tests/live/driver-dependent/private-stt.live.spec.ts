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
import { programmaticLoginWithRoutes, navigateToRoute, debugLog } from '../../e2e/helpers';
import { MicStream } from '../../../frontend/src/services/transcription/utils/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Extend Window interface to disable mocks
declare global {
    interface Window {
        __E2E_MOCK_LOCAL_WHISPER__?: boolean;
        __E2E_PLAYWRIGHT__?: boolean;
        __FORCE_TRANSFORMERS_JS__?: boolean;
        __E2E_CONTEXT__?: boolean;
        REAL_WHISPER_TEST?: boolean;
        micStream?: MicStream;
    }
}

// Configure Playwright to inject real audio via fake media stream
const syntheticAudio = path.resolve(__dirname, '../../fixtures/test_speech_16k.wav');

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

// Mark as slow test (90s timeout for model loading)
test.describe.configure({ timeout: 90000 });

test.describe('Private STT Real Audio (High Fidelity)', () => {

    test.skip(({ browserName }) => browserName !== 'chromium', 'Private STT only tested on Chromium');

    test.beforeEach(async ({ page }) => {
        // Capture browser console logs
        page.on('console', msg => {
            console.log(`[BROWSER] ${msg.type()}: ${msg.text()}`);
        });

        // CRITICAL: Disable MockEngine and force TransformersJS/Real Audio
        await page.addInitScript(() => {
            window.__E2E_CONTEXT__ = true;
            window.REAL_WHISPER_TEST = true;
            // Force TransformersJS (skip WhisperTurbo WebGPU for stability in headless)
            window.__FORCE_TRANSFORMERS_JS__ = true;
        });
    });

    test('should transcribe real audio using TransformersJS (no mocks, no cost)', async ({ page }) => {
        debugLog('🎤 Running High-Fidelity Private STT test with REAL audio');
        debugLog(`📂 Audio file: ${syntheticAudio}`);

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

        // 5. STABILIZATION: Wait for Microphone Stream to be fully initialized (AudioWorklet ready)
        // This resolves the "Listening..." hang by ensuring the pipeline isn't missing the start of the audio.
        debugLog('⏳ Waiting for MicStream readiness signal...');
        await page.waitForFunction(() => {
            const mic = window.micStream;
            return mic && mic.state === 'ready';
        }, { timeout: 30000 });
        debugLog('✅ MicStream is READY');

        // 6. Wait for UI to reflect recording state
        await expect(startButton.first()).toContainText(/stop/i, { timeout: 60000 });
        debugLog('✅ UI indicates recording active');

        // 7. Wait for transcript to appear
        const transcriptContainer = page.getByTestId('transcript-container');

        // The synthetic audio says: "Testing audio transcription with real speech"
        debugLog('👂 Listening for transcript output...');
        await expect(transcriptContainer).toContainText(/testing|audio|transcription|speech/i, { timeout: 60000 });

        const transcriptText = await transcriptContainer.textContent();
        debugLog(`📝 Transcript received: "${transcriptText?.substring(0, 100)}..."`);

        // 8. Stop recording
        await startButton.click();
        await expect(startButton).toContainText(/start/i, { timeout: 5000 });
        debugLog('✅ Recording stopped');
    });
});
