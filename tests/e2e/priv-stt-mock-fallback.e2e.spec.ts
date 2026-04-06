import { test, expect } from './fixtures';
import { programmaticLoginWithRoutes, navigateToRoute, debugLog } from './helpers.js';
import { waitForStoreState } from './helpers/e2e-state.helpers.js';

// Extend Window interface for E2E mock control
declare global {
    interface Window {
        __resolvePrivateInit__?: (success: boolean) => void;
        __simulatePrivateProgress__?: (progress: number) => void;
        logger?: { info: (msg: string | object, label?: string) => void };
    }
}

test.describe('Private STT Resilience', () => {
    // 🚀 Deterministic Serial Mode for stateful STT fallback tests
    test.describe.configure({ mode: 'serial' });


    test('should start session immediately using fallback while model downloads in background', async ({ page }) => {
        // 1. SETUP SESSION with Synchronous Registry Injection (Modern Pattern)
        // Correct Fix: Move mock creation INSIDE browser context
        await page.addInitScript(() => {
            type E2EWindow = Window & {
                __SS_E2E__: {
                    isActive: boolean;
                    engineType?: 'mock' | 'real' | 'system';
                    debug?: boolean;
                    flags?: Record<string, unknown>;
                    registry: Record<string, unknown>;
                    emitTranscript?: (text: string, isFinal?: boolean) => void;
                };
                logger?: { info: (msg: string | object) => void };
                __resolvePrivateInit__?: (success: boolean) => void;
                __simulatePrivateProgress__?: (progress: number) => void;
            };
            const win = window as unknown as E2EWindow;

            // Specialized factory for resilience testing (Safe Path / CPU)
            const fakeTransformersJSFactory = (options: {
                onModelLoadProgress?: (p: number) => void;
                onReady?: () => void;
            }) => {
                return {
                    instanceId: 'transformers-js-resilient',
                    callbacks: options,

                    async init() {
                        if (win.logger) win.logger.info('[FakeTransformersJS] init() called');
                        // Use closure capture for callbacks since 'this' can be tricky
                        const activeCallbacks = options; 
                        if (activeCallbacks.onModelLoadProgress) activeCallbacks.onModelLoadProgress(0);

                        return new Promise((resolve) => {
                            win.__resolvePrivateInit__ = (success: boolean) => {
                                if (success) {
                                    if (activeCallbacks.onModelLoadProgress) activeCallbacks.onModelLoadProgress(1.0);
                                    if (activeCallbacks.onReady) activeCallbacks.onReady();
                                    resolve({ isOk: true });
                                } else {
                                    resolve({ isOk: false, error: new Error('Mock init failed') });
                                }
                            };

                            win.__simulatePrivateProgress__ = (progress: number) => {
                                if (activeCallbacks.onModelLoadProgress) activeCallbacks.onModelLoadProgress(progress);
                            };
                        });
                    },

                    start: async () => { },
                    stop: async () => { },
                    dispose: () => { },
                    getTranscript: async () => "Mock transcript",
                    getLastHeartbeatTimestamp: () => Date.now(),
                    getEngineType: () => 'transformers-js'
                };
            };

            // Injected Fail Factory (Fast Path / GPU)
            const failFactory = () => ({
                instanceId: 'whisper-turbo-failing',
                init: async () => {
                    if (win.logger) win.logger.info('[MockWhisperTurbo] Failing init for fallback test');
                    return { isOk: false, error: new Error('GPU not available (Mock)') };
                },
                start: async () => { },
                stop: async () => { },
                dispose: () => { },
                getTranscript: async () => '',
                getLastHeartbeatTimestamp: () => Date.now(),
                getEngineType: () => 'whisper-turbo'
            });

            // 🛡️ ARCHITECTURAL DECOUPLING:
            // We mock the ENGINES, not the facade. PrivateSTT will run and find these in its internal registry lookups.
            win.__SS_E2E__ = win.__SS_E2E__ || { isActive: true, registry: {} };
            win.__SS_E2E__.registry['whisper-turbo'] = failFactory;
            win.__SS_E2E__.registry['transformers-js'] = fakeTransformersJSFactory;
            console.log('[T=0] Specialized Resilience Engine mocks injected.');
        });

        await programmaticLoginWithRoutes(page, { userType: 'pro' });


        await navigateToRoute(page, '/session');

        // Select Private mode
        await page.getByRole('button', { name: /Cloud|Private|Native Browser/i }).click();
        await page.getByRole('menuitemradio', { name: /Private/i }).click();

        // Start session
        await page.getByTestId('session-start-stop-button').click();

        // 2. VERIFY FALLBACK
        await expect(page.getByTestId('live-session-header')).toHaveAttribute('data-recording', 'true', { timeout: 10000 });

        // 3. VERIFY BACKGROUND DOWNLOAD
        const backgroundIndicator = page.getByTestId('background-task-indicator');
        await expect(backgroundIndicator).toBeVisible();

        // 4. SIMULATE PROGRESS
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

        // 5. SIMULATE COMPLETION
        debugLog('[TEST] 🚀 Resolving init success...');
        await page.evaluate(() => {
            if (window.__resolvePrivateInit__) window.__resolvePrivateInit__(true);
        });

        await expect(page.getByTestId('live-session-header')).toHaveAttribute('data-recording', 'true');

        // 6. VERIFY READINESS NOTIFICATION (Indicator gone, Notification active)
        await expect(page.getByTestId('status-message-text')).toContainText(/Private Ready/i, { timeout: 10000 });

        // The background indicator should be removed
        await expect(backgroundIndicator).not.toBeVisible();

        debugLog('[TEST] ✅ Resilience verification complete.');

        // Cleanup
        await page.getByTestId('session-start-stop-button').click();
    });
});
