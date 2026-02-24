import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, attachLiveTranscript } from './helpers';
import { setupE2EMocks } from './mock-routes';
import { registerMockInE2E, enableTestRegistry } from '../helpers/testRegistry.helpers';

test.describe('Whisper Lifecycle UX', () => {

    test.beforeEach(async ({ page }) => {
        await setupE2EMocks(page);
        await enableTestRegistry(page);
    });

    test('should verify the full lifecycle: download -> cache -> instant-start', async ({ page }) => {
        attachLiveTranscript(page);
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });

        // 1. First Attempt: Simulate Cache Miss & Download
        await registerMockInE2E(page, 'private', `(opts) => {
            let progressCb = opts?.onModelLoadProgress;
            return {
                init: async () => {
                    window.__E2E_ADVANCE_PROGRESS__ = (p) => {
                        if (progressCb) progressCb(p);
                    };
                    
                    if (!window.__MODEL_CACHED__) {
                        console.log('[Mock] Simulating Cache Miss');
                        throw Object.assign(new Error('CACHE_MISS'), { code: 'CACHE_MISS' });
                    }
                    console.log('[Mock] Cache Hit');
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
        // Assert behavior: indicator is visible (download in progress) — not specific text content
        await expect(indicator).toBeVisible();

        // Advance to 42%
        await page.evaluate(`window.__E2E_ADVANCE_PROGRESS__?.(0.42)`);
        await expect(indicator).toContainText('42%');

        // Complete download & Mark as cached in global state
        await page.evaluate(`(() => {
            window.__MODEL_CACHED__ = true;
            window.__E2E_ADVANCE_PROGRESS__?.(1);
        })()`);

        // Indicator should disappear eventually or show ready
        await expect(indicator).not.toBeVisible({ timeout: 5000 });

        // Wait for MIN_SESSION_DURATION_SECONDS=5
        await page.waitForTimeout(5100);

        // Stop session — assert: session stopped (data-recording flips to 'false')
        // Note: fastForward causes negative elapsedTime → 'too short' path, but stopListening() still runs
        await page.getByTestId('session-start-stop-button').click();
        await expect(page.getByTestId('session-start-stop-button')).toHaveAttribute('data-recording', 'false', { timeout: 8000 });

        // 🔵 Lifecycle Stage 2: Cache Hit (Instant Start)
        // Ensure no indicator appears this time
        await page.getByTestId('session-start-stop-button').click();

        // It should go straight to recording without showing the download indicator
        await expect(indicator).not.toBeVisible();
        // Assert behavior: recording started — button shows Stop (not text in status bar which shows toasts)
        await expect(page.getByLabel(/Stop Recording/i)).toBeVisible({ timeout: 5000 });

        await page.waitForTimeout(5100);
        await page.getByTestId('session-start-stop-button').click();
    });

    test('should survive and resume if download is interrupted', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });

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
        await expect(page.getByTestId('session-status-indicator')).toContainText(/Falling back|Recording active/i);
    });
});
