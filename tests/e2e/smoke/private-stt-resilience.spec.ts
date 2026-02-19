import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, debugLog, attachLiveTranscript } from '../helpers';
import { waitForStoreState } from '../helpers/e2e-state.helpers';

// Extend Window interface for E2E mock control
declare global {
    interface Window {
        __TEST_REGISTRY_QUEUE__?: unknown[];
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
 * to simulate hangs, progress, and completion.
 */

test.describe('Private STT Resilience', () => {

    test('should start session immediately using fallback while model downloads in background', async ({ page }) => {
        attachLiveTranscript(page);

        // 1. INJECT FAKE STT via Queue (before bundle loads)
        await page.addInitScript(() => {
            class FakePrivateSTT {
                private callbacks: Record<string, (...args: unknown[]) => void> = {};
                private _engineType = 'mock-private-resilience';

                constructor(options: Record<string, (...args: unknown[]) => void>) {
                    this.callbacks = options || {};
                }

                async init() {
                    if (this.callbacks.onModelLoadProgress) {
                        this.callbacks.onModelLoadProgress(0);
                    }

                    return new Promise((resolve) => {
                        (window as unknown as { __resolvePrivateInit__: (s: boolean) => void }).__resolvePrivateInit__ = (success: boolean) => {
                            if (success) {
                                if (this.callbacks.onModelLoadProgress) this.callbacks.onModelLoadProgress(100);
                                if (this.callbacks.onReady) this.callbacks.onReady();
                                resolve({ isErr: false, value: 'mock' });
                            } else {
                                resolve({ isErr: false, value: 'mock' });
                            }
                        };

                        (window as unknown as { __simulatePrivateProgress__: (p: number) => void }).__simulatePrivateProgress__ = (progress: number) => {
                            if (this.callbacks.onModelLoadProgress) {
                                this.callbacks.onModelLoadProgress(progress);
                            }
                        };
                    });
                }

                async transcribe() {
                    return { isErr: false, value: "Fake transcription" };
                }

                async startTranscription() { }
                async stopTranscription() { return "Fake transcription"; }
                async destroy() { }
                getEngineType() { return this._engineType; }
            }

            window.__TEST_REGISTRY_QUEUE__ = window.__TEST_REGISTRY_QUEUE__ || [];
            window.__TEST_REGISTRY_QUEUE__.push({
                key: 'privateSTT',
                factory: (opts: Record<string, (...args: unknown[]) => void>) => new FakePrivateSTT(opts),
                opts: { testName: 'resilience-fake' }
            });
        });

        // 2. SETUP SESSION
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, '/session');

        // Select Private mode
        await page.getByRole('button', { name: /Cloud|Private|Native Browser/i }).click();
        await page.getByRole('menuitemradio', { name: /Private/i }).click();

        // Start session
        await page.getByTestId('session-start-stop-button').click();

        // 3. VERIFY FALLBACK (Optimistic Entry Pattern)
        await expect(page.getByTestId('live-session-header')).toContainText(/Recording active/i, { timeout: 10000 });

        // 4. VERIFY BACKGROUND DOWNLOAD (Dual-State UI)
        const backgroundIndicator = page.getByTestId('background-task-indicator');
        await expect(backgroundIndicator).toBeVisible();
        await expect(backgroundIndicator).toContainText(/Downloading private model/i);

        // 5. SIMULATE PROGRESS (Control the Fake via window)
        debugLog('[TEST] ⚡ Simulating 50% progress...');
        await page.evaluate(() => {
            if (window.__simulatePrivateProgress__) window.__simulatePrivateProgress__(50);
        });

        await waitForStoreState(page,
            (state) => state.modelLoadingProgress,
            50
        );
        await expect(backgroundIndicator).toContainText(/50%/);

        debugLog('[TEST] ⚡ Simulating 90% progress...');
        await page.evaluate(() => {
            if (window.__simulatePrivateProgress__) window.__simulatePrivateProgress__(90);
        });
        await waitForStoreState(page,
            (state) => state.modelLoadingProgress,
            90
        );
        await expect(backgroundIndicator).toContainText(/90%/);

        // 6. SIMULATE COMPLETION
        debugLog('[TEST] 🚀 Resolving init success...');
        await page.evaluate(() => {
            if (window.__resolvePrivateInit__) window.__resolvePrivateInit__(true);
        });

        await waitForStoreState(page,
            (state) => (state.sttStatus as Record<string, unknown>)?.type,
            'recording'
        );

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
