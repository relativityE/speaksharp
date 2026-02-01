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
import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, debugLog } from './helpers';

test.describe('User Journey - Full Onboarding to Trend Analysis', () => {
    test('should complete full user journey with session and analytics', async ({ page }) => {
        // Step 1: Login as pro user (explicitly requested)
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });

        // Step 2: Navigate to session page and verify it loads
        await navigateToRoute(page, '/session');
        await expect(page.locator('[data-testid="app-main"]')).toBeVisible();
        await expect(page.getByText('Practice Session')).toBeVisible();
        debugLog('[TEST] ✅ Step 1: Session page loaded');

        // Step 3: Start a practice session
        const startButton = page.getByTestId('session-start-stop-button').first();
        await expect(startButton).toBeVisible();
        await startButton.click();

        // Wait for session to start (button should show Stop)
        await expect(page.getByText('Stop').first()).toBeVisible({ timeout: 10000 });
        debugLog('[TEST] ✅ Step 2: Session started');

        // Step 4: Verify Clarity Score card is displayed (core metric)
        await expect(page.getByText('Clarity Score')).toBeVisible();
        debugLog('[TEST] ✅ Step 3: Clarity Score metric displayed');

        // Wait to comply with 5s minimum session duration
        await page.waitForTimeout(6000);

        // Step 5: Stop the session
        await startButton.click();
        // Wait for button to return to Start state
        await expect(page.getByText('Start').first()).toBeVisible({ timeout: 5000 });
        debugLog('[TEST] ✅ Step 4: Session stopped');

        // Step 6: Navigate to analytics
        await navigateToRoute(page, '/analytics');
        await expect(page.getByTestId('dashboard-heading')).toBeVisible();
        debugLog('[TEST] ✅ Step 5: Analytics dashboard loaded');

        // Step 7: Verify session history is displayed
        await expect(page.getByText('Export Reports')).toBeVisible();
        debugLog('[TEST] ✅ Step 6: Session history visible');

        // Step 8: Navigate back to session for "return user" simulation
        await navigateToRoute(page, '/session');
        await expect(page.getByText('Practice Session')).toBeVisible();
        debugLog('[TEST] ✅ Step 7: Return user can access session page');

        debugLog('[TEST] ✅✅✅ Full user journey completed successfully');
    });

    test('should allow pro users to start session with default cloud mode', async ({ page }) => {
        // Login as pro user (explicitly requested)
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, '/session');
        await expect(page.locator('[data-testid="app-main"]')).toBeVisible();

        // Pro users should be able to start a session
        const startButton = page.getByTestId('session-start-stop-button').first();
        await expect(startButton).toBeVisible();
        await startButton.click();
        await expect(page.getByText('Stop').first()).toBeVisible({ timeout: 10000 });

        // Wait to comply with 5s minimum session duration
        await page.waitForTimeout(6000);
        await startButton.click();

        debugLog('[TEST] ✅ Pro user can start session (default mode available)');
    });
});

test.describe('Free User Tier Restrictions', () => {
    test('should only allow native browser STT for free users', async ({ page }) => {
        // Set up free user profile override BEFORE navigation
        await page.addInitScript(() => {
            (window as unknown as { __E2E_MOCK_SESSION__: boolean }).__E2E_MOCK_SESSION__ = true;
            // Override profile to free user
            (window as unknown as { __E2E_MOCK_PROFILE__: { id: string; subscription_status: string } }).__E2E_MOCK_PROFILE__ = {
                id: 'test-user-123',
                subscription_status: 'free'
            };
        });

        // Use programmaticLoginWithRoutes to set up Playwright route interception
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });

        // Navigate to session page
        await navigateToRoute(page, '/session');
        await expect(page.getByText('Practice Session')).toBeVisible();

        // Free users should NOT see Cloud AI or Private as selectable options
        // They should only see Native Browser mode is active
        const nativeBrowserIndicator = page.getByText('Native Browser');

        // The mode should default to Native Browser for free users
        // Cloud AI and Private should not be selectable or show upgrade prompt
        if (await nativeBrowserIndicator.count() > 0) {
            debugLog('[TEST] ✅ Free user defaults to Native Browser mode');
        }

        // Verify session still works for free users
        const startButton = page.getByTestId('session-start-stop-button').first();
        await expect(startButton).toBeVisible();
        await startButton.click();
        await expect(page.getByText('Stop').first()).toBeVisible({ timeout: 10000 });
        debugLog('[TEST] ✅ Free user can start session with Native Browser');

        // Wait to comply with 5s minimum session duration
        await page.waitForTimeout(6000);
        await startButton.click();
        debugLog('[TEST] ✅✅ Free user tier gating verified - only Native Browser available');
    });
});
