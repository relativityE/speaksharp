import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, debugLog } from './helpers.js';
import { waitForStoreState } from './helpers/e2e-state.helpers.js';

// Extend Window interface for E2E mock control
declare global {
    interface Window {
        __TEST_REGISTRY_QUEUE__?: { key: string; factory: unknown; opts?: unknown }[];
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

// E2EWindow replaced by inline casts for brevity

test.describe('Private STT Resilience', () => {

    test('should start session immediately using fallback while model downloads in background', async ({ page }) => {
        // 1. ENABLE REGISTRY & INJECT FAKE STT via Queue (Industrial Strength)
        await page.addInitScript(() => {
            const win = window as unknown as {
                __TEST_REGISTRY_ENABLE__: boolean;
                __TEST_REGISTRY_QUEUE__: unknown[];
                __STT_LOAD_TIMEOUT__: number;
                __resolvePrivateInit__?: (success: boolean) => void;
                __simulatePrivateProgress__?: (progress: number) => void;
            };
            win.__TEST_REGISTRY_ENABLE__ = true;
            win.__TEST_REGISTRY_QUEUE__ = win.__TEST_REGISTRY_QUEUE__ || [];

            // ✅ EXPERT FIX: Force Optimistic Entry timeout to 500ms for fast testing
            win.__STT_LOAD_TIMEOUT__ = 500;

            class FakePrivateSTT {
                private callbacks: Record<string, (...args: unknown[]) => void> = {};
                private _engineType = 'mock-private-resilience';

                constructor(options: Record<string, (...args: unknown[]) => void>) {
                    console.log('[FakePrivateSTT] constructor called');
                    this.callbacks = options;
                }

                async init() {
                    console.log('[FakePrivateSTT] init() called');
                    // Initial progress
                    if (this.callbacks.onModelLoadProgress) this.callbacks.onModelLoadProgress(0);

                    return new Promise((resolve) => {
                        win.__resolvePrivateInit__ = (success: boolean) => {
                            if (success) {
                                if (this.callbacks.onModelLoadProgress) this.callbacks.onModelLoadProgress(1.0);
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

                async startTranscription() { }
                async stopTranscription() { return "Mock transcript"; }
                async transcribe(audio: Float32Array) {
                    console.log(`[FakePrivateSTT] Processing audio chunk of size: ${audio.length}`);
                    return { isErr: false, value: "Fake transcription" };
                }

                async destroy() { }
                getEngineType() { return this._engineType; }
            }

            win.__TEST_REGISTRY_QUEUE__.push({
                key: 'privateSTT',
                factory: (opts: Record<string, unknown>) => new FakePrivateSTT(opts as Record<string, (...args: unknown[]) => void>),
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
        // Note: Progress is expected as 0.0 to 1.0 fraction
        debugLog('[TEST] ⚡ Simulating 50% progress...');
        await page.evaluate(() => {
            if (window.__simulatePrivateProgress__) window.__simulatePrivateProgress__(0.5);
        });

        await waitForStoreState(page,
            (state: unknown) => (state as { modelLoadingProgress: number }).modelLoadingProgress,
            50
        );
        await expect(backgroundIndicator).toContainText(/50%/);

        debugLog('[TEST] ⚡ Simulating 90% progress...');
        await page.evaluate(() => {
            if (window.__simulatePrivateProgress__) window.__simulatePrivateProgress__(0.9);
        });
        await waitForStoreState(page,
            (state: unknown) => (state as { modelLoadingProgress: number }).modelLoadingProgress,
            90
        );
        await expect(backgroundIndicator).toContainText(/90%/);

        // 6. SIMULATE COMPLETION
        debugLog('[TEST] 🚀 Resolving init success...');
        await page.evaluate(() => {
            if (window.__resolvePrivateInit__) window.__resolvePrivateInit__(true);
        });

        await waitForStoreState(page,
            (state: unknown) => ((state as { sttStatus: { type: string } }).sttStatus)?.type,
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
