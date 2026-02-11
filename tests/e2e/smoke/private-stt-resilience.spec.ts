import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, debugLog } from '../helpers';

// Extend Window interface for E2E mock control
declare global {
    interface Window {
        __TEST_REGISTRY_QUEUE__?: { key: string, factory: () => unknown }[];
        // Control methods attached by the FakePrivateSTT during init
        __resolvePrivateInit__?: (success: boolean) => void;
        __simulatePrivateProgress__?: (progress: number) => void;
    }
}

/**
 * Private STT Resilience & Fallback Test
 * 
 * STRATEGY: Dependency Injection via Registry
 * -----------------------------------------
 * We inject a `FakePrivateSTT` via the Test Registry Queue.
 * This fake engine exposes control methods on `window` to allow the test
 * to simulate hangs, progress, and completion.
 */

test.describe('Private STT Resilience', () => {

    test('should start session immediately using fallback while model downloads in background', async ({ page }) => {
        // 1. INJECT FAKE STT (Dependency Injection via Registry Queue)
        await page.addInitScript(() => {
            interface STTOptions {
                onModelLoadProgress?: (progress: number) => void;
                onReady?: () => void;
                [key: string]: unknown;
            }

            class FakePrivateSTT {
                private callbacks: STTOptions = {};
                private _engineType = 'mock-private';

                async init(options: STTOptions) {
                    console.log('[FakePrivateSTT] init() called');
                    this.callbacks = options;

                    // Simulate "Downloading..." state immediately
                    if (this.callbacks.onModelLoadProgress) {
                        this.callbacks.onModelLoadProgress(0);
                    }

                    // BLOCK: Return a Promise that simulates the download/init process
                    // We attach control references to window so the Playwright test can drive it.
                    return new Promise((resolve) => {
                        window.__resolvePrivateInit__ = (success: boolean) => {
                            console.log('[FakePrivateSTT] Manually resolving init...');
                            if (success) {
                                // Simulate 100% progress
                                if (this.callbacks.onModelLoadProgress) {
                                    this.callbacks.onModelLoadProgress(100);
                                }
                                // Simulate Ready
                                if (this.callbacks.onReady) {
                                    this.callbacks.onReady();
                                }
                                resolve({ isOk: true, value: 'mock-engine' });
                            } else {
                                resolve({ isErr: true, error: new Error('Mock init failed') });
                            }
                        };

                        window.__simulatePrivateProgress__ = (progress: number) => {
                            if (this.callbacks.onModelLoadProgress) {
                                this.callbacks.onModelLoadProgress(progress);
                            }
                        };
                    });
                }

                async transcribe(audio: Float32Array) {
                    // Log usage to satisfy linter
                    console.log(`[FakePrivateSTT] Processing audio chunk of size: ${audio.length}`);
                    return { isErr: false, value: "Fake transcription" };
                }

                async destroy() {
                    console.log('[FakePrivateSTT] destroy() called');
                }

                getEngineType() {
                    return this._engineType;
                }
            }

            // Register factory via queue
            window.__TEST_REGISTRY_QUEUE__ = window.__TEST_REGISTRY_QUEUE__ || [];
            window.__TEST_REGISTRY_QUEUE__.push({
                key: 'privateSTT',
                factory: () => new FakePrivateSTT()
            });
            console.log('[E2E Init] Registered FakePrivateSTT factory in queue');
        });

        // 2. SETUP SESSION
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, '/session');

        // Select Private mode
        await page.getByRole('button', { name: /cloud|private|native/i }).click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();

        // Start session
        await page.getByTestId('session-start-stop-button').click();

        // 3. VERIFY FALLBACK (Optimistic Entry Pattern)
        await expect(page.getByTestId('session-status-indicator')).toContainText(/Recording active/i, { timeout: 10000 });
        await expect(page.getByText(/Setting up private model/i)).toBeVisible();

        // 4. VERIFY BACKGROUND DOWNLOAD (Dual-State UI)
        const backgroundIndicator = page.getByTestId('background-task-indicator');
        await expect(backgroundIndicator).toBeVisible();
        await expect(backgroundIndicator).toContainText(/Downloading private model/i);

        // 5. SIMULATE PROGRESS (Control the Fake via window)
        debugLog('[TEST] ⚡ Simulating 50% progress...');
        await page.evaluate(() => {
            if (window.__simulatePrivateProgress__) window.__simulatePrivateProgress__(50);
        });
        await expect(backgroundIndicator).toContainText(/50%/);

        debugLog('[TEST] ⚡ Simulating 90% progress...');
        await page.evaluate(() => {
            if (window.__simulatePrivateProgress__) window.__simulatePrivateProgress__(90);
        });
        await expect(backgroundIndicator).toContainText(/90%/);

        // 6. SIMULATE COMPLETION
        debugLog('[TEST] 🚀 Resolving init success...');
        await page.evaluate(() => {
            if (window.__resolvePrivateInit__) window.__resolvePrivateInit__(true);
        });

        // 7. VERIFY SUCCESS STATE
        // The "Private model ready" message is now delivered via Toast
        await expect(page.getByText('Private model ready')).toBeVisible({ timeout: 10000 });

        // The background indicator should be removed
        await expect(backgroundIndicator).not.toBeVisible();

        debugLog('[TEST] ✅ Resilience verification complete.');

        // Cleanup
        await page.getByTestId('session-start-stop-button').click();
    });
});
