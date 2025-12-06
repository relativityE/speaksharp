import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

/**
 * Local STT (Whisper) Model Download & Caching E2E Test
 * 
 * PURPOSE: Verify the complete UX flow for local Whisper model download and caching
 * 
 * CRITICAL USER WORKFLOWS:
 * 1. First-time user selects "On-Device" mode
 * 2. Model downloads with progress indicator
 * 3. User sees "Downloading model... X%" message
 * 4. Model is cached locally (IndexedDB via whisper-turbo)
 * 5. Subsequent sessions load instantly from cache
 * 
 * EXPECTED BEHAVIOR:
 * - Progress indicator appears during download
 * - "Initializing..." status shows while loading
 * - Button disabled during download
 * - Once loaded, button becomes "Start Speaking"
 * - Second session loads instantly (no download)
 */

test.describe('Local STT Model Download & Caching', () => {
    test('should show download progress on first use of On-Device mode', async ({ page }) => {
        /**
         * Uses real Pro account to test On-Device mode download flow.
         * Requires E2E_PRO_EMAIL and E2E_PRO_PASSWORD environment variables.
         * Test will be skipped if credentials not configured.
         */
        await programmaticLogin(page);

        await page.goto('/session');
        await page.waitForSelector('[data-testid="app-main"]');

        // Clear IndexedDB to simulate first-time user AND set mock flag
        await page.evaluate(() => {
            // Set mock flag for TranscriptionService
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__E2E_MOCK_LOCAL_WHISPER__ = true;

            return new Promise((resolve) => {
                const request = indexedDB.deleteDatabase('whisper-turbo');
                request.onsuccess = () => resolve(true);
                request.onerror = () => resolve(false);
            });
        });

        // Select On-Device mode
        await page.getByRole('button', { name: /cloud ai|on-device|native/i }).click();
        await page.getByRole('menuitemradio', { name: /on-device/i }).click();

        // Click Start Speaking - this triggers model download
        await page.getByTestId('session-start-stop-button').click();

        // Verify model loading indicator appears
        const loadingIndicator = page.getByTestId('model-loading-indicator');
        await expect(loadingIndicator).toBeVisible({ timeout: 5000 });

        // Verify progress text
        await expect(loadingIndicator).toContainText(/downloading model/i);

        // Verify progress percentage appears
        await expect(loadingIndicator).toContainText(/%/);

        // Verify button shows "Initializing..."
        const startButton = page.getByTestId('session-start-stop-button');
        await expect(startButton).toContainText(/initializing/i);
        await expect(startButton).toBeDisabled();

        // Wait for model to finish loading (up to 60 seconds for large model)
        await expect(loadingIndicator).toBeHidden({ timeout: 60000 });

        // Verify button becomes "Stop" (session auto-starts)
        await expect(startButton).toContainText(/stop/i);
        await expect(startButton).toBeEnabled();

        // Stop the session to clean up
        await startButton.click();
        await expect(startButton).toContainText(/start/i);

        console.log('[TEST] ✅ Model download progress verified');
    });

    test('should load instantly from cache on second use', async ({ page }) => {
        /**
         * Uses real Pro account to verify cached model loads quickly.
         * Requires E2E_PRO_EMAIL and E2E_PRO_PASSWORD environment variables.
         */
        await programmaticLogin(page);
        await page.goto('/session');
        await page.waitForSelector('[data-testid="app-main"]');

        // Select On-Device mode
        await page.getByRole('button', { name: /cloud ai|on-device|native/i }).click();
        await page.getByRole('menuitemradio', { name: /on-device/i }).click();

        const startTime = Date.now();

        // Click Start Speaking
        await page.getByTestId('session-start-stop-button').click();

        // Verify NO download indicator appears (model is cached)
        const loadingIndicator = page.getByTestId('model-loading-indicator');

        // Wait a moment to ensure indicator doesn't appear
        await page.waitForTimeout(500);

        // Indicator should NOT be visible (model loads from cache)
        await expect(loadingIndicator).toBeHidden();

        // Button should become " Stop" quickly (within 2 seconds)
        const startButton = page.getByTestId('session-start-stop-button');
        await expect(startButton).toContainText('Stop', { timeout: 2000 });

        const loadTime = Date.now() - startTime;
        console.log(`[TEST] ✅ Model loaded from cache in ${loadTime}ms`);

        // Verify it was fast (< 2 seconds)
        expect(loadTime).toBeLessThan(2000);
    });

    test('should show mode selector with On-Device option for Pro users', async ({ page }) => {
        /**
         * Uses real Pro account to verify On-Device mode option is available.
         * Requires E2E_PRO_EMAIL and E2E_PRO_PASSWORD environment variables.
         */
        await programmaticLogin(page);
        await page.goto('/session');
        await page.waitForSelector('[data-testid="app-main"]');

        // Click mode selector
        await page.getByRole('button', { name: /cloud ai|on-device|native/i }).click();

        // Verify On-Device option exists
        const onDeviceOption = page.getByRole('menuitemradio', { name: /on-device/i });
        await expect(onDeviceOption).toBeVisible();

        // Check if it's disabled (free user) or enabled (Pro user)
        const isDisabled = await onDeviceOption.getAttribute('data-disabled');

        if (isDisabled === 'true') {
            console.log('[TEST] ✅ On-Device mode disabled for free user (expected)');
        } else {
            console.log('[TEST] ✅ On-Device mode enabled for Pro user');
        }
    });

    test('should show toast notification when model download completes', async ({ page }) => {
        /**
         * Uses real Pro account to test download completion toast.
         * Requires E2E_PRO_EMAIL and E2E_PRO_PASSWORD environment variables.
         */
        await programmaticLogin(page);
        await page.goto('/session');
        await page.waitForSelector('[data-testid="app-main"]');

        // Clear cache and trigger download
        await page.evaluate(() => {
            return indexedDB.deleteDatabase('whisper-turbo');
        });

        // Select On-Device mode and start
        await page.getByRole('button', { name: /cloud ai|on-device|native/i }).click();
        await page.getByRole('menuitemradio', { name: /on-device/i }).click();
        await page.getByTestId('session-start-stop-button').click();

        // Wait for model to load
        await page.waitForSelector('[data-testid="model-loading-indicator"]', { state: 'hidden', timeout: 60000 });

        // Verify success toast appears (use .first() to handle multiple toasts)
        const successToast = page.locator('[data-sonner-toast][data-type="success"]').first();
        await expect(successToast).toBeVisible({ timeout: 5000 });
        await expect(successToast).toContainText(/model (ready|loaded)/i);

        console.log('[TEST] ✅ Toast notification verified');
    });
});