import { test, expect } from './fixtures';
import { programmaticLoginWithRoutes, navigateToRoute, debugLog } from './helpers.js';
import { waitForStoreState } from './helpers/e2e-state.helpers.js';

// Extend Window interface for E2E mock control
declare global {
    interface Window {
        __TEST_REGISTRY_QUEUE__?: { key: string; factory: unknown; opts?: unknown }[];
        __resolvePrivateInit__?: (success: boolean) => void;
        __simulatePrivateProgress__?: (progress: number) => void;
        logger?: { info: (msg: string | object, label?: string) => void };
    }
}

test.describe('Private STT Resilience', () => {
    // 🚀 Deterministic Serial Mode for stateful STT fallback tests
    test.describe.configure({ mode: 'serial' });


    test('should start session immediately using fallback while model downloads in background', async ({ page }) => {
        // 1. ENABLE REGISTRY & INJECT FAKE STT via Queue
        await page.addInitScript(() => {
            const win = window as unknown as {
                __TEST_REGISTRY_ENABLE__: boolean;
                __TEST_REGISTRY_QUEUE__: { key: string; factory: unknown; opts?: unknown }[];
                __STT_LOAD_TIMEOUT__: number;
                __resolvePrivateInit__?: (success: boolean) => void;
                __simulatePrivateProgress__?: (progress: number) => void;
                logger?: { info: (msg: string | object, label?: string) => void };
            };
            win.__TEST_REGISTRY_ENABLE__ = true;
            win.__TEST_REGISTRY_QUEUE__ = win.__TEST_REGISTRY_QUEUE__ || [];

            win.__STT_LOAD_TIMEOUT__ = 500;

            class FakePrivateSTT {
                private callbacks: Record<string, (...args: unknown[]) => void> = {};
                private _engineType = 'whisper-turbo';

                constructor(options: Record<string, (...args: unknown[]) => void>) {
                    if (win.logger) win.logger.info('[FakePrivateSTT] constructor called');
                    this.callbacks = options;
                }

                async init() {
                    if (win.logger) win.logger.info('[FakePrivateSTT] init() called');
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
                    if (win.logger) win.logger.info({ audioLength: audio.length }, '[FakePrivateSTT] Processing audio chunk');
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
        await programmaticLoginWithRoutes(page, { userType: 'pro' });
        await navigateToRoute(page, '/session');

        // Select Private mode
        await page.getByRole('button', { name: /Cloud|Private|Native Browser/i }).click();
        await page.getByRole('menuitemradio', { name: /Private/i }).click();

        // Start session
        await page.getByTestId('session-start-stop-button').click();

        // 3. VERIFY FALLBACK
        await expect(page.getByTestId('live-session-header')).toHaveAttribute('data-recording', 'true', { timeout: 10000 });

        // 4. VERIFY BACKGROUND DOWNLOAD
        const backgroundIndicator = page.getByTestId('background-task-indicator');
        await expect(backgroundIndicator).toBeVisible();

        // 5. SIMULATE PROGRESS
        debugLog('[TEST] ⚡ Simulating 50% progress...');
        await page.evaluate(() => {
            if (window.__simulatePrivateProgress__) window.__simulatePrivateProgress__(0.5);
        });

        await waitForStoreState(page,
            (state: unknown) => (state as { modelLoadingProgress: number }).modelLoadingProgress,
            50
        );
        await expect(backgroundIndicator).toBeVisible();

        debugLog('[TEST] ⚡ Simulating 90% progress...');
        await page.evaluate(() => {
            if (window.__simulatePrivateProgress__) window.__simulatePrivateProgress__(0.9);
        });
        await waitForStoreState(page,
            (state: unknown) => (state as { modelLoadingProgress: number }).modelLoadingProgress,
            90
        );
        await expect(backgroundIndicator).toBeVisible();

        // 6. SIMULATE COMPLETION
        debugLog('[TEST] 🚀 Resolving init success...');
        await page.evaluate(() => {
            if (window.__resolvePrivateInit__) window.__resolvePrivateInit__(true);
        });

        await expect(page.getByTestId('live-session-header')).toHaveAttribute('data-recording', 'true');

        // 7. VERIFY READINESS NOTIFICATION (Indicator gone, Notification active)
        await expect(page.getByTestId('status-message-text')).toContainText(/Private Ready/i, { timeout: 10000 });

        // The background indicator should be removed
        await expect(backgroundIndicator).not.toBeVisible();

        debugLog('[TEST] ✅ Resilience verification complete.');

        // Cleanup
        await page.getByTestId('session-start-stop-button').click();
    });
});
