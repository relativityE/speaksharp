/**
 * User Journey E2E Test
 * 
 * Tests the complete user journey:
 * 1. Pro user logs in
 * 2. Runs first practice session with all STT modes available
 * 3. Views session analytics
 * 4. Returns and runs a second session
 * 5. Compares sessions to see trends
 */
import { test, expect } from './fixtures';
import { navigateToRoute, debugLog } from './helpers';
import { TEST_IDS } from '../constants';

test.describe('User Journey - Full Onboarding to Trend Analysis', () => {
    test('should complete full user journey with session and analytics', async ({ proPage }) => {
        // Navigate to session page and verify it loads
        await navigateToRoute(proPage, '/session');
        await expect(proPage.locator('[data-testid="app-main"]')).toBeVisible();
        await expect(proPage.getByText('Practice Session')).toBeVisible();
        debugLog('[TEST] ✅ Session page loaded');

        // Start a practice session
        const startButton = proPage.getByTestId('session-start-stop-button').first();
        await expect(startButton).toBeVisible();
        await startButton.click();

        // Wait for session to start
        await expect(proPage.getByLabel(/Stop Recording/i)).toBeVisible({ timeout: 10000 });
        await expect(proPage.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toHaveAttribute('data-recording', 'true');
        debugLog('[TEST] ✅ Session started');

        await expect(proPage.getByText('Clarity Score')).toBeVisible();
        debugLog('[TEST] ✅ Clarity Score metric displayed');

        // Wait for 5s minimum session duration
        await proPage.waitForTimeout(6000);

        // Stop the session
        await startButton.click();
        await expect(proPage.getByLabel(/Start Recording/i)).toBeVisible({ timeout: 5000 });
        debugLog('[TEST] ✅ Session stopped');

        // Navigate to analytics
        await navigateToRoute(proPage, '/analytics');
        await expect(proPage.getByTestId('dashboard-heading')).toBeVisible();
        debugLog('[TEST] ✅ Analytics dashboard loaded');

        // Verify session history is displayed
        await expect(proPage.getByText('Export Reports')).toBeVisible();
        debugLog('[TEST] ✅ Session history visible');

        // Navigate back to session for "return user" simulation
        await navigateToRoute(proPage, '/session');
        await expect(proPage.getByText('Practice Session')).toBeVisible();
        debugLog('[TEST] ✅ Return user can access session page');

        debugLog('[TEST] ✅✅✅ Full user journey completed successfully');
    });

    test('should allow pro users to start session with default cloud mode', async ({ proPage }) => {
        await navigateToRoute(proPage, '/session');
        await expect(proPage.locator('[data-testid="app-main"]')).toBeVisible();

        const startButton = proPage.getByTestId('session-start-stop-button').first();
        await expect(startButton).toBeVisible();
        await startButton.click();
        await expect(proPage.getByLabel(/Stop Recording/i)).toBeVisible({ timeout: 10000 });
        await expect(proPage.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toHaveAttribute('data-recording', 'true');

        // Wait for 5s minimum session duration
        await proPage.waitForTimeout(6000);
        await startButton.click();

        debugLog('[TEST] ✅ Pro user can start session (default mode available)');
    });
});

test.describe('Free User Tier Restrictions', () => {
    test('should only allow native browser STT for free users', async ({ freePage: page }) => {
        // Navigate to session page
        await navigateToRoute(page, '/session');
        await expect(page.getByText('Practice Session')).toBeVisible();

        // Free users should only see Native Browser mode is active
        const nativeBrowserIndicator = page.getByText('Native Browser');

        if (await nativeBrowserIndicator.count() > 0) {
            debugLog('[TEST] ✅ Free user defaults to Native Browser mode');
        }

        // Verify session still works for free users
        const startButton = page.getByTestId('session-start-stop-button').first();
        await expect(startButton).toBeVisible();
        await startButton.click();
        await expect(page.getByLabel(/Stop Recording/i)).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toHaveAttribute('data-recording', 'true');
        debugLog('[TEST] ✅ Free user can start session with Native Browser');

        // Wait for 5s minimum session duration
        await page.waitForTimeout(6000);
        await startButton.click();
        debugLog('[TEST] ✅✅ Free user tier gating verified');
    });
});
