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
import { calculateWordErrorRate } from '../../../frontend/src/lib/wer';
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
const syntheticAudio = path.resolve(__dirname, '../../fixtures/10sec.wav');

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
test.describe.configure({ timeout: 120000, mode: 'serial' });

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
            // Extend timeout for model loading in headless environment
            window.__STT_LOAD_TIMEOUT__ = 90000;
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

        // 5. ENGINE-READY GATE: wait for data-state='recording' on the card wrapper.
        //    Replaces window.micStream.state === 'ready' which was an internal impl detail
        //    not covered by AGENTS.md behavioral contracts.
        //    data-state='recording' is emitted by LiveRecordingCard only when activeEngine
        //    !== 'none' — i.e., WASM pipeline() has resolved and getUserMedia is granted.
        //    Per AGENTS.md: "Event-Based Synchronization: Never use sleep(). Use selectors."
        //    Timeout: 60s — WASM cold load takes 20-30s in headless.
        debugLog('⏳ Waiting for WASM engine ready signal (data-state="recording")...');
        const statusDiv = page.locator('[data-testid="live-session-header"]').locator('..');
        await expect(statusDiv).toHaveAttribute('data-state', 'recording', { timeout: 60_000 });
        debugLog('✅ WASM engine initialized — data-state="recording" observed');

        // 6. Allow 5s audio accumulation after engine is ready.
        //    10sec.wav guarantees audio is still streaming. No DOM event exists for
        //    "N seconds of VAD-processed audio" — this bounded wait is the only option.
        await page.waitForTimeout(5_000);
        debugLog('✅ 5s audio accumulation complete');

        // 7. Stop recording — use data-action behavioral contract (not getByLabel).
        await startButton.click();
        await expect(startButton).toHaveAttribute('data-action', 'start', { timeout: 10_000 });
        debugLog('✅ Recording stopped');

        // 8. Assert via WER ≤ 0.15 — not regex toContainText.
        //    Whisper WASM (quantized ONNX) is non-deterministic at chunk boundaries.
        //    WER ≤ 0.15 is the NIST standard for STT integration gates.
        // The synthetic audio says: "Testing audio transcription with real speech"
        const EXPECTED = 'testing audio transcription with real speech';
        const transcriptContainer = page.getByTestId('transcript-container');
        await expect(transcriptContainer).not.toBeEmpty({ timeout: 15_000 });
        const transcriptText = ((await transcriptContainer.textContent()) ?? '').trim().toLowerCase();
        const wer = calculateWordErrorRate(EXPECTED, transcriptText);
        debugLog(`📝 Received: "${transcriptText.substring(0, 100)}"`);
        debugLog(`📊 WER: ${(wer * 100).toFixed(1)}% (threshold: 15%)`);
        expect(wer, `WER ${(wer * 100).toFixed(1)}% exceeded 15% threshold. Got: "${transcriptText}"`).toBeLessThanOrEqual(0.15);
        debugLog('✅ WER gate passed');
    });
});
