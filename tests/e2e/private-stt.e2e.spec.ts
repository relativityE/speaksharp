import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, debugLog } from './helpers';

// Extend Window interface for E2E mock flag
declare global {
    interface Window {
        __E2E_MOCK_LOCAL_WHISPER__?: boolean;
    }
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

    test('should show download progress on first use', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, '/session');
        await page.waitForSelector('[data-testid="app-main"]');

        // Clear IndexedDB and set mock flag
        await page.evaluate(() => {
            window.__E2E_MOCK_LOCAL_WHISPER__ = true;
            return new Promise((resolve) => {
                const request = indexedDB.deleteDatabase('whisper-turbo');
                request.onsuccess = () => resolve(true);
                request.onerror = () => resolve(false);
            });
        });

        // Select Private mode
        await page.getByRole('button', { name: /cloud|private|native/i }).click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();

        // Click Start - triggers model download
        await page.getByTestId('session-start-stop-button').click();

        // Verify loading indicator appears
        const loadingIndicator = page.getByTestId('model-loading-indicator');
        await expect(loadingIndicator).toBeVisible({ timeout: 5000 });
        await expect(loadingIndicator).toContainText(/downloading model/i);
        await expect(loadingIndicator).toContainText(/%/);

        // Verify button shows "Initializing..." (or already "Stop" if fast)
        const startButton = page.getByTestId('session-start-stop-button');
        await expect(startButton).toContainText(/initializing|stop/i);

        // Wait for model to finish loading
        await expect(loadingIndicator).toBeHidden({ timeout: 30000 });

        // Verify session started
        await expect(startButton).toContainText(/stop/i);
        await expect(startButton).toBeEnabled();

        // Stop session and verify clean return to Start (P1 bug fix)
        await startButton.click();
        await expect(startButton).toContainText(/start/i);
    });

    test('should load instantly from cache (no progress indicator)', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, '/session');

        await page.evaluate(() => {
            window.__E2E_MOCK_LOCAL_WHISPER__ = true;
        });

        await page.getByRole('button', { name: /cloud|private|native/i }).click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();

        const startButton = page.getByTestId('session-start-stop-button');
        const loadingIndicator = page.getByTestId('model-loading-indicator');

        const startTime = Date.now();
        await startButton.click();
        await expect(startButton).toContainText('Stop', { timeout: 5000 });

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

        await page.getByRole('button', { name: /cloud|private|native/i }).click();

        const privateOption = page.getByRole('menuitemradio', { name: /private/i });
        await expect(privateOption).toBeVisible();

        // No console.log needed - expect() assertions above handle validation
    });

    test('should show toast notification when model loads', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, '/session');

        // Clear IndexedDB and set mock flag
        await page.evaluate(() => {
            window.__E2E_MOCK_LOCAL_WHISPER__ = true;
            return indexedDB.deleteDatabase('whisper-turbo');
        });

        await page.getByRole('button', { name: /cloud|private|native/i }).click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();
        await page.getByTestId('session-start-stop-button').click();

        // Wait for model to load
        await page.waitForSelector('[data-testid="model-loading-indicator"]', {
            state: 'hidden',
            timeout: 30000
        });

        // Verify success toast
        const successToast = page.locator('[data-sonner-toast][data-type="success"]').first();
        await expect(successToast).toBeVisible({ timeout: 5000 });
        await expect(successToast).toContainText(/model (ready|loaded)/i);
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
            window.__E2E_MOCK_LOCAL_WHISPER__ = true;
        });

        await page.getByRole('button', { name: /cloud|private|native/i }).click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();

        const startButton = page.getByTestId('session-start-stop-button');

        // Start session
        await startButton.click();
        await expect(startButton).toContainText('Stop', { timeout: 5000 });

        // Stop session
        await startButton.click();

        // Button should say "Start" NOT "Initializing..."
        await expect(startButton).not.toContainText('Initializing', { timeout: 2000 });
        await expect(startButton).toContainText(/start/i, { timeout: 2000 });
    });
});
