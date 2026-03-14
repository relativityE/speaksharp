import { test, expect } from './fixtures';
import { navigateToRoute, attachLiveTranscript } from './helpers';
import { registerMockInE2E, enableTestRegistry } from '../helpers/testRegistry.helpers';

test.describe('Whisper Lifecycle UX', () => {
    const usingMockEngine = process.env.STT_ENGINE === 'mock';
    test.skip(!usingMockEngine && !process.env.HAS_GPU, 'Whisper lifecycle requires GPU hardware/WASM SIMD support');

    test.afterEach(async ({ proPage: page }) => {
        await page.evaluate(() => {
            // 1. Reset behavioral gating signal
            document.body.removeAttribute('data-stt-policy');
            
            // 2. Clear engine overrides
            window.__TEST_REGISTRY__?.clear();
            
            // 3. Reset service ephemeral state
            // @ts-ignore - Internal test hook
            window.__TRANSCRIPTION_SERVICE__?.resetEphemeralState();
        });
    });

    test('should verify the full lifecycle: download -> cache -> instant-start', async ({ proPage: page }) => {
        await enableTestRegistry(page);
        attachLiveTranscript(page);

        // 1. First Attempt: Simulate Cache Miss & Download
        await registerMockInE2E(page, 'private', `(opts) => {
            let progressCb = opts?.onModelLoadProgress;
            const log = window.logger || { info: () => {}, error: () => {} };
            return {
                init: async () => {
                    window.__E2E_ADVANCE_PROGRESS__ = (p) => {
                        if (progressCb) progressCb(p);
                    };
                    
                    if (!window.__MODEL_CACHED__) {
                        log.info('[Mock] Simulating Cache Miss');
                        throw Object.assign(new Error('CACHE_MISS'), { code: 'CACHE_MISS' });
                    }
                    log.info('[Mock] Cache Hit');
                },
                startTranscription: async () => { },
                stopTranscription: async () => 'lifecycle test transcript',
                getTranscript: async () => 'lifecycle test transcript',
                terminate: async () => { },
                getEngineType: () => 'whisper-turbo'
            };
        }`);

        await navigateToRoute(page, '/session');

        // Select Private mode
        await page.getByTestId('stt-mode-select').click();
        await page.getByRole('menuitemradio', { name: /Private/i }).click();

        // 🟢 Lifecycle Stage 1: Initial Download
        await page.getByTestId('session-start-stop-button').click();

        const indicator = page.getByTestId('background-task-indicator');
        await expect(indicator).toBeVisible();

        // Advance to 42%
        await page.evaluate(`window.__E2E_ADVANCE_PROGRESS__?.(0.42)`);
        await expect(indicator).toBeVisible();

        // Complete download & Mark as cached in global state
        await page.evaluate(`(() => {
            window.__MODEL_CACHED__ = true;
            window.__E2E_ADVANCE_PROGRESS__?.(1);
        })()`);

        await expect(indicator).not.toBeVisible({ timeout: 5000 });

        // Wait for MIN_SESSION_DURATION_SECONDS=5
        await page.waitForTimeout(5100);

        // Stop session
        await page.getByTestId('session-start-stop-button').click();
        await expect(page.getByTestId('session-start-stop-button')).toHaveAttribute('data-recording', 'false', { timeout: 8000 });

        // 🔵 Lifecycle Stage 2: Cache Hit (Instant Start)
        await page.getByTestId('session-start-stop-button').click();

        await expect(indicator).not.toBeVisible();
        await expect(page.getByLabel(/Stop Recording/i)).toBeVisible({ timeout: 5000 });

        await page.waitForTimeout(5100);
        await page.getByTestId('session-start-stop-button').click();
    });

    test('should survive and resume if download is interrupted', async ({ proPage: page }) => {
        await enableTestRegistry(page);
        await registerMockInE2E(page, 'private', `(opts) => {
            let progressCb = opts?.onModelLoadProgress;
            return {
                init: async () => {
                    window.__E2E_ADVANCE_PROGRESS__ = (p) => { if (progressCb) progressCb(p); };
                    
                    if (window.__SIMULATE_FAILURE__) {
                        window.__SIMULATE_FAILURE__ = false; // Only fail once
                        throw new Error('NETWORK_TIMEOUT');
                    }
                    
                    if (!window.__MODEL_CACHED__) {
                        throw Object.assign(new Error('CACHE_MISS'), { code: 'CACHE_MISS' });
                    }
                },
                startTranscription: async () => { },
                stopTranscription: async () => 'resumption test',
                terminate: async () => { },
                getEngineType: () => 'whisper-turbo'
            };
        }`);

        await navigateToRoute(page, '/session');
        await page.getByTestId('stt-mode-select').click();
        await page.getByRole('menuitemradio', { name: /Private/i }).click();

        // 🔴 Lifecycle Stage 3: Failure & Resumption
        await page.evaluate(`window.__SIMULATE_FAILURE__ = true`);

        await page.getByTestId('session-start-stop-button').click();

        // Verify fallback notice or subsequent recording state
        await expect(page.getByTestId('live-session-header')).toHaveAttribute('data-recording', 'true');
    });
});
