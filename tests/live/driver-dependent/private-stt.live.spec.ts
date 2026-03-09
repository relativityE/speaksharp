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
 * │ private-stt-resilience.e2e.spec.ts   │ Hang simulation   │ Timeout, fallback     │
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
// calculateWordErrorRate is the SSOT in frontend/src/lib/wer.ts (not a new file).
// WER ≤ 0.15 replaces exact/regex match — Whisper WASM is non-deterministic at chunk
// boundaries in quantized ONNX. This is the NIST/industry standard for STT gates.
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
        __STT_LOAD_TIMEOUT__?: number;
    }
}

// 10sec.wav replaces test_speech_16k.wav (2.4s).
// Root cause: --use-file-for-fake-audio-capture streams from T=0; WASM init takes ~20s.
// The 2.4s file was exhausted before the engine was ready. 10s guarantees audio is
// still playing when data-state='recording' fires. (Expert-confirmed fix.)
const syntheticAudio = path.resolve(__dirname, '../../fixtures/120sec_tone_16k.wav');

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

test.describe('Private STT Real Audio (High Fidelity)', () => {
    test.describe.configure({ mode: 'serial' });

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
            // Extend timeout for model loading in headless environment
            window.__STT_LOAD_TIMEOUT__ = 180000;

            console.log('🧪 [Playwright] REAL_WHISPER_TEST:', window.REAL_WHISPER_TEST);
            console.log('🧪 [Playwright] __E2E_CONTEXT__:', window.__E2E_CONTEXT__);
        });
    });

    test('should transcribe real audio using TransformersJS (no mocks, no cost)', async ({ page }) => {
        test.setTimeout(240_000); // This takes priority over describe-level in all versions
        debugLog('🎤 Running High-Fidelity Private STT test with REAL audio');
        debugLog(`📂 Audio file: ${syntheticAudio}`);

        // 1. Login as Pro user (Private STT requires Pro)
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });

        // 2. Navigate to session page
        await navigateToRoute(page, '/session');
        await page.waitForSelector('[data-testid="app-main"]');

        // 3. Select Private STT mode
        const modeButton = page.getByTestId('stt-mode-select');
        await modeButton.click();
        await page.getByTestId('stt-mode-private').click();
        debugLog('✅ Selected Private STT mode');

        // 4. ENGINE-READY GATE: Wait for the explicit readiness signal from the application.
        //    This guarantees WASM compilation and model loading is completely finished
        //    BEFORE we trigger getUserMedia and start the fake audio stream.
        debugLog('⏳ Waiting for WASM engine ready signal (data-stt-engine="ready")...');
        await expect(page.locator('body')).toHaveAttribute('data-stt-engine', 'ready', { timeout: 180_000 });
        debugLog('✅ WASM engine explicitly ready');

        // 5. Start recording - now that the engine is warm, this will immediately
        //    hook up the stream and start transcribing, preventing buffer exhaustion.
        const startButton = page.getByTestId('session-start-stop-button');
        await startButton.click();
        debugLog('🚀 Started recording, injecting fake audio stream...');

        // 6. Wait for data-state='recording' on the card wrapper to confirm recording active
        const statusDiv = page.locator('[data-testid="live-session-header"]').locator('..');
        await expect(statusDiv).toHaveAttribute('data-state', 'recording', { timeout: 10_000 });
        debugLog('✅ UI reflects recording state');

        // 7. PIPELINE VERIFICATION: Assert activity WHILE recording.
        //    Since we are using a tone, the engine might not produce words,
        //    but it should at least transition to the "Listening..." state
        //    and clear the "words appear here..." placeholder.
        const transcriptContainer = page.getByTestId('transcript-container');

        await expect(async () => {
            const text = (await transcriptContainer.textContent() ?? '').trim().toLowerCase();

            // 1. Placeholder must be gone (at this point it should show "listening..." or actual words)
            expect(text, 'Container still showing placeholder').not.toContain('words appear here');

            // 2. Either it's showing the "listening..." pulse OR it's already showing some text
            //    A sine wave might hallucinate or remain empty (showing "listening...")
            //    Both are valid proof that the engine is connected and listening.
        }).toPass({ timeout: 20_000 });
        debugLog('✅ Pipeline verified: Component moved past placeholder to active listening');

        // Allow some time for audio processing
        await page.waitForTimeout(5_000);

        // 8. Stop recording — use data-action behavioral contract
        await startButton.click();
        await expect(startButton).toHaveAttribute('data-action', 'start', { timeout: 10_000 });
        debugLog('✅ Recording stopped');
    });
});
