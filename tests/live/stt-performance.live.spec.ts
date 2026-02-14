import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, debugLog } from '../e2e/helpers';
import { TEST_IDS, ROUTES, TIMEOUTS } from '../constants';
import fs from 'fs';
import path from 'path';

/**
 * 🚀 PRIVATE STT PERFORMANCE BENCHMARKS (Robust Trace Version)
 */
test.describe('Private STT Performance @live', () => {
    const SAMPLE = { id: 'sample1', path: '/test-audio/sample1.wav', duration: 10.0 };
    const logFile = path.join(process.cwd(), 'perf_direct.log');

    const log = (msg: string) => {
        const timestamp = new Date().toISOString();
        const line = `[${timestamp}] ${msg}\n`;
        fs.appendFileSync(logFile, line, { flag: 'a' });
        console.log(`[PERF_INFO] ${line.trim()}`);
    };

    test.beforeEach(async ({ page }) => {
        if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, '--- PERF TRACE ---\n');
        log('--- NEW TEST RUN STARTING ---');

        page.on('console', msg => {
            log(`[BROWSER] ${msg.text()}`);
        });

        await page.addInitScript(() => {
            (window as any).__E2E_PLAYWRIGHT__ = true;
            (window as any).__E2E_CONTEXT__ = true;
            (window as any).REAL_WHISPER_TEST = true;
            (window as any).TEST_MODE = true;

            // GLOBAL MICROPHONE MOCK-OVERRIDE
            // This prevents NotSupportedError in headless environments
            const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
            (navigator.mediaDevices as any).originalGetUserMedia = originalGetUserMedia;

            navigator.mediaDevices.getUserMedia = async (constraints) => {
                console.log('[E2E_DEBUG] getUserMedia called with:', constraints);
                // Create a dummy stream with one silent track
                const audioCtx = new AudioContext();
                const oscillator = audioCtx.createOscillator();
                const dst = audioCtx.createMediaStreamDestination();
                oscillator.connect(dst);
                oscillator.start();
                return dst.stream;
            };
        });
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, ROUTES.SESSION);
    });

    test('should measure Cold vs Warm start times', async ({ page }) => {
        // 1. SELECT PRIVATE MODE (Robust Version)
        log('Step 1: Selecting Private Mode...');
        await page.evaluate(() => {
            // Force the mode change directly via the component's internal state if possible,
            // but since it's a hook, we use the UI but with a more robust role-based selector.
            (window as any).dispatchSTTModeChange = (mode: string) => {
                // This is a bridge we'll add to LiveRecordingCard if needed, 
                // but for now let's try the most robust locator.
            };
        });

        const modeSelect = page.getByTestId(TEST_IDS.STT_MODE_SELECT);
        await modeSelect.waitFor({ state: 'visible' });
        await modeSelect.click();

        log('Step 1.1: Clicking Private Mode button via Role...');
        // Radix UI uses menuitemradio for these dropdown items
        const privateBtn = page.getByRole('menuitemradio', { name: /Private/i });
        await page.waitForTimeout(1000); // UI stabilization
        await privateBtn.click({ force: true, timeout: 5000 }).catch(e => {
            log(`Warning: Role-based click failed: ${e.message}. Falling back to test ID.`);
            return page.getByTestId(TEST_IDS.STT_MODE_PRIVATE).click({ force: true });
        });
        log('Step 1.2: Mode selected.');

        // --- COLD START (Clear IDB) ---
        log('Step 2: Starting COLD START (IDB Clear)...');
        // Stay on the domain to avoid SecurityError
        await page.evaluate(async () => {
            return new Promise((resolve) => {
                const request = indexedDB.deleteDatabase('whisper-turbo');
                request.onsuccess = () => resolve(true);
                request.onerror = () => resolve(false);
                // Also clear for transformers-cache if needed
                indexedDB.deleteDatabase('transformers-cache');
            });
        });

        log('Step 3: IDB Cleared. Refreshing to force reload...');
        await page.reload();
        await page.waitForTimeout(3000);

        // CRITICAL: Re-select Private mode after reload!
        log('Step 3.1: Re-selecting Private Mode after reload...');
        await page.getByTestId(TEST_IDS.STT_MODE_SELECT).click();
        await page.getByRole('menuitemradio', { name: /Private/i }).click({ force: true });
        await page.waitForTimeout(1000);

        const coldStartPerf = await page.evaluate(() => performance.now());
        const coldStartTimeDate = Date.now();
        log(`Step 4: CLICKING START (Cold) at ${new Date().toISOString()}`);
        await page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click();

        log('Step 5: Waiting for "Recording" status (Max 180s)...');
        await expect(page.getByTestId(TEST_IDS.SESSION_STATUS_INDICATOR)).toContainText(/Recording/i, { timeout: 180000 });

        log('Step 5.1: Recording for 7s to avoid "Session too short" error...');
        await page.waitForTimeout(7000);

        const coldEndPerf = await page.evaluate(() => performance.now());
        const coldDuration = (Date.now() - coldStartTimeDate) / 1000;
        const coldWasmDelta = coldEndPerf - coldStartPerf;

        log(`COLD COMPLETE: ${coldDuration.toFixed(2)}s (High-Res Delta: ${coldWasmDelta.toFixed(2)}ms)`);

        await page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click();
        await expect(page.getByTestId(TEST_IDS.SESSION_STATUS_INDICATOR)).toContainText(/Ready/i);

        // --- WARM START ---
        log('Step 6: Starting WARM START measurement');
        const warmStartTimeDate = Date.now();
        await page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click();

        await expect(page.getByTestId(TEST_IDS.SESSION_STATUS_INDICATOR)).toContainText(/Recording/i, { timeout: 30000 });
        const warmDuration = (Date.now() - warmStartTimeDate) / 1000;
        log(`WARM COMPLETE: ${warmDuration.toFixed(2)}s`);

        log(`[RESULT] Cold: ${coldDuration.toFixed(2)}s, Warm: ${warmDuration.toFixed(2)}s`);
    });

    test('should measure Real-Time Factor (RTF)', async ({ page }) => {
        log('RTF: Selecting Private Mode...');
        const modeSelect = page.getByTestId(TEST_IDS.STT_MODE_SELECT);
        await modeSelect.waitFor({ state: 'visible' });
        await modeSelect.click();
        await page.waitForTimeout(500);
        await page.getByTestId(TEST_IDS.STT_MODE_PRIVATE).click({ force: true });

        log('RTF: Injecting Audio...');
        await page.evaluate(async (audioUrl) => {
            const audio = new Audio(audioUrl);
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 });
            const source = audioCtx.createMediaElementSource(audio);
            const dest = audioCtx.createMediaStreamDestination();
            source.connect(dest);

            // Note: Global mock in beforeEach already handles this, 
            // but we override it here to play the specific audio sample.
            const originalMock = navigator.mediaDevices.getUserMedia;
            navigator.mediaDevices.getUserMedia = async (constraints) => {
                if (constraints && constraints.audio) {
                    audio.play();
                    return dest.stream;
                }
                return originalMock(constraints);
            };
            (window as any).__TEST_AUDIO__ = audio;
        }, SAMPLE.path);

        const measureStart = Date.now();
        log('RTF: CLICKING START');
        await page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click();

        await page.evaluate(async () => {
            const audio = (window as any).__TEST_AUDIO__;
            await new Promise<void>((resolve) => {
                audio.onended = () => resolve();
                if (audio.ended) resolve();
            });
        });

        await page.waitForTimeout(2000);
        await page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click();
        const totalProcessingTime = (Date.now() - measureStart) / 1000;
        const rtf = SAMPLE.duration / totalProcessingTime;

        log(`RTF COMPLETE: ${rtf.toFixed(2)}`);
    });
});
