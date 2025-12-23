import { test, expect } from '@playwright/test';
import { programmaticLoginPro, navigateToRoute } from './helpers';

/**
 * 🚨 CANARY SMOKE TEST 🚨
 * 
 * This test runs against REAL STAGING INFRASTRUCTURE.
 * It does NOT use mocks (except where absolutely necessary for browser APIs).
 * 
 * Purpose: Verify the "Critical Path" is operational.
 * 1. Login (Real Auth)
 * 2. Start Session (Real DB Insert, Native STT)
 * 3. Stop Session (Real DB Update)
 * 4. Verify Analytics (Real DB Select)
 * 
 * Cost: $0.00 (Uses Native Browser STT)
 */
test.describe('Production Smoke Canary @canary', () => {
    // Only run if CANARY credentials are present
    test.beforeAll(() => {
        if (!process.env.E2E_PRO_EMAIL || !process.env.E2E_PRO_PASSWORD) {
            console.warn('⚠️ Skipping Canary test: Missing E2E_PRO_EMAIL or E2E_PRO_PASSWORD');
            test.skip();
        }
    });

    test('should complete a full session cycle on real infrastructure', async ({ page }) => {
        // 1. Real Login
        console.log('[CANARY] logging in with real credentials...');
        await programmaticLoginPro(page);

        // 2. Navigate to Session Page
        await navigateToRoute(page, '/session');
        await expect(page).toHaveURL(/\/session/);

        // 3. Configure for Native STT (Free/Low Risk)
        // Ensure we are in "Native" mode to avoid Cloud API costs
        await page.getByRole('button', { name: /cloud ai|on-device|native/i }).click();
        await page.getByRole('menuitemradio', { name: /native/i }).click();

        // 4. Start Session
        console.log('[CANARY] Starting real session...');
        const startButton = page.getByTestId('session-start-stop-button');
        await expect(startButton).toBeEnabled();
        await startButton.click();

        // Verify "connected" state (Mic active)
        await expect(page.getByText(/listening/i)).toBeVisible();

        // 5. Record for 5 seconds
        console.log('[CANARY] Recording for 5 seconds...');
        await page.waitForTimeout(5000);

        // 6. Stop Session
        console.log('[CANARY] Stopping session...');
        // Note: Stop button is the same testid
        await page.getByTestId('session-start-stop-button').click();

        // 7. Verify Redirect to Analytics
        // This confirms the session was successfully saved to the REAL database
        await expect(page).toHaveURL(/\/analytics/, { timeout: 15000 });
        console.log('[CANARY] Session saved and redirected to analytics');

        // 8. Verify Session Appears in List
        const sessionList = page.getByTestId('session-history-list');
        await expect(sessionList).toBeVisible();
        const latestSession = sessionList.locator('[data-testid^="session-history-item-"]').first();
        await expect(latestSession).toBeVisible();

        console.log('[CANARY] ✅ Smoke test passed. System is operational.');
    });
});
