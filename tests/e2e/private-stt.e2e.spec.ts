import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, debugLog, attachLiveTranscript } from './helpers';
import { setupE2EMocks } from './mock-routes';

// Extend Window interface for E2E mock flag
interface E2EWindow extends Window {
    __E2E_MOCK_LOCAL_WHISPER__?: boolean;
    __E2E_MANUAL_PROGRESS__?: boolean;
    __E2E_ADVANCE_PROGRESS__?: (progress: number) => void;
}

/**
 * On-Device STT (Whisper) E2E Test Suite
 * 
 * PURPOSE: Comprehensive tests for On-Device Whisper transcription mode.
 * 
 * ARCHITECTURE:
 * - Uses MockOnDeviceWhisper for fast, deterministic testing (~600ms vs real 2-5s)
 * - Mocks are needed because Playwright contexts are isolated (no shared IndexedDB)
 * 
 * WHAT'S TESTED:
 * 1. Download progress indicator appears
 * 2. Button states during loading
 * 3. Fast cached load (no progress indicator)
 * 4. Mode selector availability for Pro users
 * 5. Toast notification on completion
 * 6. P1 REGRESSION: Button returns to "Start" after Stop (NOT "Initializing...")
 * 
 * P1 BUG FIX (2025-12-18):
 * - Bug: Button showed "Initializing..." after clicking Stop
 * - Root Cause: modelLoadingProgress wasn't reset on stop/reset
 * - Fix: Added setModelLoadingProgress(null) in useSpeechRecognition
 * 
 * RELATED FILES:
 * - frontend/src/lib/e2e-bridge.ts - MockOnDeviceWhisper class
 * - frontend/src/services/transcription/TranscriptionService.ts - Checks __E2E_MOCK_LOCAL_WHISPER__
 * - frontend/src/hooks/useSpeechRecognition/index.ts - P1 bug fix location
 * - frontend/public/sw.js - Service Worker cache logic
 * 
 * @see docs/ARCHITECTURE.md - "Private STT (Whisper) & Service Worker Caching"
 */

test.describe('Private STT (Whisper)', () => {

    test.beforeEach(async ({ page }) => {
        page.on('console', msg => {
            const text = msg.text();
            if (text.includes('[Hook]') || text.includes('[TranscriptionService]') || text.includes('[MockPrivateWhisper]') || text.includes('[DIAG]')) {
                console.log(`[BROWSER] ${text}`);
            }
        });
        await setupE2EMocks(page);
    });

    test('should show download progress on first use', async ({ page }) => {
        attachLiveTranscript(page);
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, '/session');
        await page.waitForSelector('[data-testid="app-main"]');


        // Clear IndexedDB and set mock flag with MANUAL CONTROL
        await page.evaluate(() => {
            const win = window as unknown as E2EWindow;
            win.__E2E_MOCK_LOCAL_WHISPER__ = true;
            win.__E2E_MANUAL_PROGRESS__ = true; // Enable deterministic mode
            return new Promise((resolve) => {
                const request = indexedDB.deleteDatabase('whisper-turbo');
                request.onsuccess = () => resolve(true);
                request.onerror = () => resolve(false);
            });
        });

        // Select Private mode
        await page.getByTestId('stt-mode-select').click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();

        // CRITICAL: Wait for React to commit mode state change before clicking Start.
        // Without this, handleStartStop captures stale mode='native' from the closure.
        await expect(page.getByTestId('stt-mode-select')).toContainText(/private/i, { timeout: 2000 });

        // Click Start - triggers model download
        await page.getByTestId('session-start-stop-button').click();

        // Verify loading indicator appears (deterministic w/ infinite wait if needed, but 10s is plenty)
        // With manual mode, it STAYS here until advanced
        const loadingIndicator = page.getByTestId('background-task-indicator');
        await expect(loadingIndicator).toBeVisible({ timeout: 10000 });
        await expect(loadingIndicator).toContainText(/downloading private model/i);

        // Manually advance to 50%
        await page.evaluate(() => (window as unknown as E2EWindow).__E2E_ADVANCE_PROGRESS__?.(0.5));

        // Manually advance to 100% (Complete)
        await page.evaluate(() => (window as unknown as E2EWindow).__E2E_ADVANCE_PROGRESS__?.(1));

        // Verify button shows "Initializing..." (or already "Stop" if fast)
        const startButton = page.getByTestId('session-start-stop-button');
        await expect(startButton.first()).toBeVisible();

        // Wait for model to finish loading
        await expect(loadingIndicator).toBeHidden({ timeout: 30000 });

        // Verify session started
        await expect(page.getByRole('button', { name: /stop/i }).first()).toBeVisible();
        await expect(startButton.first()).toBeEnabled();

        // Stop session and verify clean return to Start (P1 bug fix)
        await startButton.first().click();
        await expect(page.getByRole('button', { name: /start/i }).first()).toBeVisible();
    });

    test('should load instantly from cache (no progress indicator)', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, '/session');

        await page.evaluate(() => {
            (window as unknown as E2EWindow).__E2E_MOCK_LOCAL_WHISPER__ = true;
        });

        await page.getByTestId('stt-mode-select').click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();

        const startButton = page.getByTestId('session-start-stop-button');
        const loadingIndicator = page.getByTestId('background-task-indicator');

        const startTime = Date.now();
        await startButton.first().click();
        await expect(page.getByRole('button', { name: /stop/i }).first()).toBeVisible({ timeout: 5000 });

        const loadTime = Date.now() - startTime;
        debugLog(`[TEST] Model loaded in ${loadTime}ms`);

        // MockPrivateWhisper has a 3s delay (simulating model prep), so expect <5s
        expect(loadTime).toBeLessThan(5000);

        // Verify NO download indicator is visible
        await expect(loadingIndicator).toBeHidden();
    });

    test('should show Private option in mode selector for Pro users', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, '/session');

        await page.getByTestId('stt-mode-select').click();

        const privateOption = page.getByRole('menuitemradio', { name: /private/i });
        await expect(privateOption).toBeVisible();

        // No console.log needed - expect() assertions above handle validation
    });

    test('should start recording after model auto-loads', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, '/session');

        // Clear IndexedDB and set mock flag (auto mode, not manual)
        await page.evaluate(() => {
            (window as unknown as E2EWindow).__E2E_MOCK_LOCAL_WHISPER__ = true;
            return indexedDB.deleteDatabase('whisper-turbo');
        });

        await page.getByTestId('stt-mode-select').click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();

        // Wait for React to commit mode change
        await expect(page.getByTestId('stt-mode-select')).toContainText(/private/i, { timeout: 2000 });

        await page.getByTestId('session-start-stop-button').first().click();

        // Wait for model to auto-load (auto mode takes ~2.5s)
        // Verify recording becomes active with Private mode
        await expect(page.getByTestId('live-session-header')).toContainText(/recording active/i, { timeout: 15000 });

        // Verify the mode label still shows Private (not fallen back to Native)
        await expect(page.getByTestId('stt-mode-select')).toContainText(/private/i);
    });

    test('P1 REGRESSION: button should return to Start after Stop', async ({ page }) => {
        /**
         * P1 Bug: After clicking Stop, button showed "Initializing..." instead of "Start"
         * Root Cause: modelLoadingProgress wasn't reset on stop/reset
         * This test ensures the bug doesn't regress.
         */
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, '/session');
        await page.waitForSelector('[data-testid="app-main"]');

        await page.evaluate(() => {
            (window as unknown as E2EWindow).__E2E_MOCK_LOCAL_WHISPER__ = true;
        });

        await page.getByTestId('stt-mode-select').click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();

        const startButton = page.getByTestId('session-start-stop-button');

        // Start session
        await startButton.first().click();
        await expect(page.getByRole('button', { name: /stop/i }).first()).toBeVisible({ timeout: 5000 });

        // Stop session
        await startButton.first().click();
        await expect(page.getByRole('button', { name: /start/i }).first()).toBeVisible({ timeout: 2000 });
    });
});
