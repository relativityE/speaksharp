import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, debugLog } from '../helpers';
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

interface E2EWindow extends Window {
    __TEST_REGISTRY__: {
        register: (mode: string, factory: unknown, opts?: unknown) => void;
        enable: () => void;
        disable: () => void;
    };
    __resolvePrivateInit__?: (success: boolean) => void;
    __simulatePrivateProgress__?: (progress: number) => void;
}

test.describe('Private STT Resilience', () => {

    test('should start session immediately using fallback while model downloads in background', async ({ page }) => {
        // 1. ENABLE REGISTRY & INJECT FAKE STT
        await page.addInitScript(() => {
            const win = window as unknown as E2EWindow;
            win.__TEST_REGISTRY__.enable();

            class FakePrivateSTT {
                private callbacks: Record<string, (...args: unknown[]) => void> = {};
                private _engineType = 'mock-private-resilience';

                async init(options: Record<string, (...args: unknown[]) => void>) {
                    console.log('[FakePrivateSTT] init() called');
                    this.callbacks = options;
                    if (this.callbacks.onModelLoadProgress) this.callbacks.onModelLoadProgress(0);

                    return new Promise((resolve) => {
                        win.__resolvePrivateInit__ = (success: boolean) => {
                            if (success) {
                                if (this.callbacks.onModelLoadProgress) this.callbacks.onModelLoadProgress(100);
                                if (this.callbacks.onReady) this.callbacks.onReady();
                                resolve({ isOk: true, value: 'mock-engine' });
                            } else {
                                resolve({ isErr: true, error: new Error('Mock init failed') });
                            }
                        };

                        win.__simulatePrivateProgress__ = (progress: number) => {
                            if (this.callbacks.onModelLoadProgress) this.callbacks.onModelLoadProgress(progress);
                        };
                    });
                }

                async transcribe(audio: Float32Array) {
                    console.log(`[FakePrivateSTT] Processing audio chunk of size: ${audio.length}`);
                    return { isErr: false, value: "Fake transcription" };
                }

                async destroy() { }
                getEngineType() { return this._engineType; }
            }

            win.__TEST_REGISTRY__.register('private', () => new FakePrivateSTT(), { testName: 'resilience-fake' });
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

        await waitForStoreState(page,
            (state: Record<string, unknown>) => state.modelLoadingProgress,
            50
        );
        await expect(backgroundIndicator).toContainText(/50%/);

        debugLog('[TEST] ⚡ Simulating 90% progress...');
        await page.evaluate(() => {
            if (window.__simulatePrivateProgress__) window.__simulatePrivateProgress__(90);
        });
        await waitForStoreState(page,
            (state: Record<string, unknown>) => state.modelLoadingProgress,
            90
        );
        await expect(backgroundIndicator).toContainText(/90%/);

        // 6. SIMULATE COMPLETION
        debugLog('[TEST] 🚀 Resolving init success...');
        await page.evaluate(() => {
            if (window.__resolvePrivateInit__) window.__resolvePrivateInit__(true);
        });

        await waitForStoreState(page,
            (state: Record<string, unknown>) => (state.sttStatus as Record<string, unknown>)?.type,
            'ready'
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
