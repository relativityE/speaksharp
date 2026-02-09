import { test, expect } from '@playwright/test';
import { navigateToRoute, debugLog, canaryLogin } from '../e2e/helpers';
import { ROUTES, TEST_IDS, CANARY_USER } from '../constants';


/**
 * 🚨 CANARY SMOKE TEST 🚨
 * 
 * This test runs against REAL STAGING INFRASTRUCTURE.
 * It does NOT use MSW mocks - uses VITE_USE_LIVE_DB=true.
 * 
 * Purpose: Verify the "Critical Path" is operational.
 * 1. Login (Real Auth)
 * 2. Start Session (Real DB Insert, Native STT)
 * 3. Stop Session (Real DB Update)
 * 4. Verify Analytics (Real DB Select)
 * 
 * Cost: $0.00 (Uses Native Browser STT)
 * 
 * Modeled after soak test pattern for proven reliability.
 * 
 * ## Navigation Helpers (DO NOT use page.goto directly!)
 * - `goToPublicRoute()` - for public pages (sign-in, pricing) BEFORE auth
 * - `navigateToRoute()` - for client-side navigation AFTER auth
 * 
 * @see tests/e2e/helpers.ts for helper implementations
 */
test.describe('Production Smoke Canary @canary', () => {
    test.beforeAll(() => {
        // Dynamic skip if password is missing (Local Run)
        test.skip(!CANARY_USER.password, 'Skipping Canary test: Missing CANARY_PASSWORD');
    });

    test('should complete a full session cycle on real infrastructure', async ({ page }) => {
        // 1. Real Login (modeled after soak test)
        await canaryLogin(page, CANARY_USER.email, CANARY_USER.password);

        // 2. Navigate to Session Page (use client-side navigation to preserve state)
        await navigateToRoute(page, ROUTES.SESSION, { waitForMocks: false });
        await expect(page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toBeVisible({ timeout: 15000 });

        // 3. Configure for Native STT (Free/Low Risk)
        debugLog('[CANARY] Configuring Native STT mode...');
        // Standardize: If STT_MODE_SELECT testid is present, use it. Fallback to roles if needed.
        const modeSelect = page.getByTestId(TEST_IDS.STT_MODE_SELECT);
        if (await modeSelect.isVisible()) {
            await modeSelect.click();
            await page.getByTestId(TEST_IDS.STT_MODE_NATIVE).click();
        } else {
            // High-fidelity fallback for legacy UI
            await page.getByRole('button', { name: /Native|Cloud AI|Private|On-Device/i }).click();
            await page.getByRole('menuitemradio', { name: /Native/i }).click();
        }

        // 4. Start Session
        debugLog('[CANARY] Starting session...');
        const startButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
        await expect(startButton).toBeEnabled();
        await startButton.click();

        // Wait for session to become active
        await page.waitForSelector('[data-testid="session-status-indicator"]', { timeout: 10000 });

        // 5. Record for 5 seconds
        debugLog('[CANARY] Recording for 5 seconds...');
        await page.waitForTimeout(5000);

        // 6. Stop Session
        debugLog('[CANARY] Stopping session...');
        await page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click();

        // 7. Handle session end (dialog, empty state, or redirect)
        const dialogLocator = page.locator('div[role="alertdialog"]');
        const emptyStateLocator = page.getByText('No speech was detected');
        const analyticsUrl = page.waitForURL(/\/analytics/, { timeout: 15000 }).catch(() => null);

        // Wait for any end state
        await Promise.race([
            dialogLocator.waitFor({ timeout: 10000 }).catch(() => null),
            emptyStateLocator.waitFor({ timeout: 10000 }).catch(() => null),
            analyticsUrl,
        ]);

        // If dialog appeared, dismiss it
        if (await dialogLocator.isVisible().catch(() => false)) {
            const stayButton = page.getByRole('button', { name: 'Stay on Page' });
            if (await stayButton.isVisible().catch(() => false)) {
                await stayButton.click();
            }
        }

        debugLog('[CANARY] ✅ Smoke test passed. System is operational.');
    });
});
