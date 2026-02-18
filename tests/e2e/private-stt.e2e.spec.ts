import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, debugLog, attachLiveTranscript } from './helpers';
import { setupE2EMocks } from './mock-routes';
import { registerMockInE2E, enableTestRegistry } from '../helpers/testRegistry.helpers';
import { waitForStoreState } from './helpers/e2e-state.helpers';

// Extend Window interface for E2E mock flag
interface E2EWindow extends Window {
    __E2E_CONFIG__?: unknown;
    __E2E_ADVANCE_PROGRESS__?: (progress: number | null) => void;
    __FAILURE_MANAGER__?: { resetFailureCount: () => void };
    __DIAGNOSTIC__?: {
        factoryCalled: boolean;
        factoryReceivedOpts: string[] | null;
        callbackCaptured: boolean;
        callbackInvoked: boolean;
        callbackValue: number | null;
        error?: string;
    };
}

/**
 * On-Device STT (Whisper) E2E Test Suite
 * 
 * PURPOSE: Comprehensive tests for On-Device Whisper transcription mode.
 * 
 * ARCHITECTURE:
 * - Uses MockOnDeviceWhisper via TestRegistry for fast, deterministic testing.
 * - Migrated to Universal Testing Pattern (Registry > Config > Real).
 */

test.describe('Private STT (Whisper)', () => {

    test.beforeEach(async ({ page }) => {
        page.on('console', msg => {
            const text = msg.text();
            if (text.includes('[Hook]') || text.includes('[TranscriptionService]') || text.includes('[MockPrivateWhisper]') || text.includes('[DIAG]') || text.includes('[E2E_DEBUG]')) {
                console.log(`[BROWSER] ${text}`);
            }
        });
        await setupE2EMocks(page);
        await enableTestRegistry(page);
        // Reset FailureManager to prevent sticky failures from previous tests
        await page.evaluate(() => {
            const win = window as unknown as E2EWindow;
            if (win.__FAILURE_MANAGER__) {
                win.__FAILURE_MANAGER__.resetFailureCount();
                console.log('[E2E Setup] FailureManager count reset');
            }
        });
    });

    test('should show download progress on first use', async ({ page }) => {
        attachLiveTranscript(page);
        // setup login but DON'T navigate yet
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });

        // Initialize E2E Config with MANUAL CONTROL & DIAGNOSTICS
        await page.addInitScript(() => {
            (window as unknown as E2EWindow).__E2E_CONFIG__ = {
                stt: { mode: 'mock', mocks: { private: 'manual' } }
            };
            // ✅ Intercept ALL function calls for debugging
            (window as unknown as E2EWindow).__DIAGNOSTIC__ = {
                factoryCalled: false,
                factoryReceivedOpts: null,
                callbackCaptured: false,
                callbackInvoked: false,
                callbackValue: null
            };
        });

        // Register mock with diagnostics
        await registerMockInE2E(page, 'private', `(opts) => {
            console.log('[DIAGNOSTIC] Factory called with opts:', opts);
            if (!window.__DIAGNOSTIC__) window.__DIAGNOSTIC__ = {}; 
            window.__DIAGNOSTIC__.factoryCalled = true;
            window.__DIAGNOSTIC__.factoryReceivedOpts = Object.keys(opts || {});
            
            // Try to access the callback
            const hasProp = 'onModelLoadProgress' in (opts || {});
            const propValue = opts?.onModelLoadProgress;
            const propType = typeof propValue;
            
            console.log('[DIAGNOSTIC] Has onModelLoadProgress prop:', hasProp);
            console.log('[DIAGNOSTIC] Property value:', propValue);
            console.log('[DIAGNOSTIC] Property type:', propType);
            
            let progressCb = opts?.onModelLoadProgress || null;
            
            if (progressCb) {
                console.log('[DIAGNOSTIC] Callback captured successfully');
                window.__DIAGNOSTIC__.callbackCaptured = true;
            } else {
                console.error('[DIAGNOSTIC] Callback is null!');
            }
            
            return {
                init: async () => {
                   // Expose controller
                   window.__E2E_ADVANCE_PROGRESS__ = (p) => {
                       console.log('[DIAGNOSTIC] Advance called with:', p);
                       window.__DIAGNOSTIC__.callbackInvoked = true;
                       window.__DIAGNOSTIC__.callbackValue = p;
                       
                       if (progressCb) {
                           console.log('[DIAGNOSTIC] Invoking callback...');
                           try {
                               progressCb(p);
                               console.log('[DIAGNOSTIC] Callback invoked successfully');
                           } catch (e) {
                               console.error('[DIAGNOSTIC] Callback threw error:', e);
                           }
                       } else {
                           console.error('[DIAGNOSTIC] No callback to invoke!');
                       }
                   };

                   // CRITICAL: Throw CACHE_MISS to trigger the service's handling logic
                   const err = new Error('CACHE_MISS');
                   err.code = 'CACHE_MISS';
                   throw err;
                },
                startTranscription: async () => { },
                stopTranscription: async () => 'test transcript',
                getTranscript: async () => 'test transcript',
                terminate: async () => { },
                getEngineType: () => 'whisper-turbo'
            };
        }`);

        // Now navigate
        await navigateToRoute(page, '/session');
        await page.waitForSelector('[data-testid="app-main"]');

        // Clear IndexedDB completely to ensure Cache Miss
        await page.evaluate(async () => {
            const request = indexedDB.deleteDatabase('whisper-turbo');
            return new Promise(res => {
                request.onsuccess = () => res(true);
                request.onerror = () => res(false);
            });
        });

        // Select Private mode
        await page.getByTestId('stt-mode-select').click();
        await page.getByRole('menuitemradio', { name: /Private/i }).click();
        await expect(page.getByTestId('stt-mode-select')).toContainText(/private/i, { timeout: 2000 });

        // Click Start - triggers CACHE_MISS -> Download -> Optimistic Fallback
        await page.getByTestId('session-start-stop-button').click();

        // 🔍 DIAGNOSTIC CHECKPOINT
        await page.waitForTimeout(1000);

        type DiagnosticResult = NonNullable<E2EWindow['__DIAGNOSTIC__']> | { error: string };

        const diag1 = await page.evaluate(() => {
            if (!(window as unknown as E2EWindow).__DIAGNOSTIC__) {
                return { error: 'DIAGNOSTIC_OBJECT_MISSING' };
            }
            return (window as unknown as E2EWindow).__DIAGNOSTIC__;
        }) as DiagnosticResult;
        console.log('=== DIAGNOSTICS (INIT) ===', JSON.stringify(diag1, null, 2));

        // FORCE FAILURE WITH DATA if suspicious
        if (diag1.error) {
            throw new Error(`[DIAGNOSTIC_DATA_DUMP] ${JSON.stringify(diag1)}`);
        }

        const strictDiag = diag1 as NonNullable<E2EWindow['__DIAGNOSTIC__']>;
        if (!strictDiag.factoryCalled || !strictDiag.callbackCaptured) {
            throw new Error(`[DIAGNOSTIC_DATA_DUMP]Factory/Callback missing: ${JSON.stringify(diag1)}`);
        }

        // Wait for active state
        await expect(page.getByTestId('session-status-indicator')).toContainText(/Recording active/i, { timeout: 5000 });

        const loadingIndicator = page.getByTestId('background-task-indicator');

        await expect(loadingIndicator).toBeVisible();
        await expect(loadingIndicator).toContainText(/downloading private model/i);

        // ✅ CHECK 3: Verify NO Error Toast (The original bug)
        await expect(page.getByTestId('error-toast')).not.toBeVisible();

        // Manually advance to 50%
        await page.evaluate(() => (window as unknown as E2EWindow).__E2E_ADVANCE_PROGRESS__?.(0.5));

        // Use deterministic store wait logic
        await waitForStoreState(page,
            (state: Record<string, unknown>) => state.modelLoadingProgress,
            50
        );
        await expect(loadingIndicator).toContainText('50%');

        // Manually advance to 100% (Complete)
        await page.evaluate(() => (window as unknown as E2EWindow).__E2E_ADVANCE_PROGRESS__?.(1));

        // Helper to ensure UI updates before we clear it
        await expect(loadingIndicator).toContainText('100%');

        // Signal completion (set progress to null to hide indicator)
        await page.evaluate(() => (window as unknown as E2EWindow).__E2E_ADVANCE_PROGRESS__?.(null));

        // Wait for download to finish (indicator hidden)
        await expect(loadingIndicator).toBeHidden({ timeout: 30000 });

        // Recording should still be active
        await expect(page.getByTestId('session-status-indicator')).toContainText(/Recording active/i);

        // Stop session
        await page.getByTestId('session-start-stop-button').first().click();
        await expect(page.getByLabel(/Start Recording/i)).toBeVisible();
    });

    test('should load instantly from cache (no progress indicator)', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });

        await registerMockInE2E(page, 'private', `() => ({
            init: async () => {},
            startTranscription: async () => {},
            stopTranscription: async () => 'test',
            getTranscript: async () => 'test',
            terminate: async () => {},
            getEngineType: () => 'whisper-turbo'
        })`);

        await navigateToRoute(page, '/session');

        await page.getByTestId('stt-mode-select').click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();

        const startButton = page.getByTestId('session-start-stop-button');
        const loadingIndicator = page.getByTestId('background-task-indicator');

        const startTime = Date.now();
        await startButton.first().click();
        await expect(page.getByLabel(/Stop Recording/i).first()).toBeVisible({ timeout: 5000 });

        const loadTime = Date.now() - startTime;
        debugLog(`[TEST] Model loaded in ${loadTime}ms`);

        // Verify NO download indicator is visible
        await expect(loadingIndicator).toBeHidden();
    });

    test('should show Private option in mode selector for Pro users', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, '/session');

        await page.getByTestId('stt-mode-select').click();

        const privateOption = page.getByRole('menuitemradio', { name: /private/i });
        await expect(privateOption).toBeVisible();
    });

    test('should start recording after model auto-loads', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });

        // Inject auto-loading mock with Manual Control
        await registerMockInE2E(page, 'private', `(opts) => {
            let progressCb = opts?.onModelLoadProgress;
            return {
                init: async () => {
                    // Expose controller for the test to drive
                    window.__E2E_ADVANCE_PROGRESS__ = (p) => {
                       if (progressCb) progressCb(p);
                    };
                    return Promise.resolve();
                },
                startTranscription: async () => {},
                stopTranscription: async () => 'auto-test',
                getTranscript: async () => 'auto-test',
                terminate: async () => {},
                getEngineType: () => 'whisper-turbo'
            }
        }`);

        await navigateToRoute(page, '/session');
        await page.waitForSelector('[data-testid="app-main"]');

        await page.getByTestId('stt-mode-select').click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();

        // Wait for React to commit mode change
        await expect(page.getByTestId('stt-mode-select')).toContainText(/private/i, { timeout: 2000 });

        await page.getByTestId('session-start-stop-button').first().click();

        // Simulate auto-load progress
        await page.evaluate(() => (window as unknown as E2EWindow).__E2E_ADVANCE_PROGRESS__?.(0.5));
        await page.evaluate(() => (window as unknown as E2EWindow).__E2E_ADVANCE_PROGRESS__?.(1));

        // Signal completion
        await page.evaluate(() => (window as unknown as E2EWindow).__E2E_ADVANCE_PROGRESS__?.(null));

        // Expect Recording Active without waiting for state store
        await expect(page.getByTestId('live-session-header')).toHaveText(/Recording active/i, { timeout: 5000 });

        // Verify the mode label still shows Private
        await expect(page.getByTestId('stt-mode-select')).toContainText(/private/i);
    });

    test('P1 REGRESSION: button should return to Start after Stop', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });

        await registerMockInE2E(page, 'private', `() => ({
            init: async () => {},
            startTranscription: async () => {},
            stopTranscription: async () => 'test',
            getTranscript: async () => 'test',
            terminate: async () => {},
            getEngineType: () => 'whisper-turbo'
        })`);

        await navigateToRoute(page, '/session');
        await page.waitForSelector('[data-testid="app-main"]');

        await page.getByTestId('stt-mode-select').click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();

        const startButton = page.getByTestId('session-start-stop-button');

        // Start session
        await startButton.first().click();
        await expect(page.getByLabel(/Stop Recording/i).first()).toBeVisible({ timeout: 5000 });

        // Stop session
        await startButton.first().click();
        await expect(page.getByLabel(/Start Recording/i)).toBeVisible({ timeout: 2000 });
    });
});
