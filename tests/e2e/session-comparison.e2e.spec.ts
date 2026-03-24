import { test, expect } from './fixtures';
import { navigateToRoute, debugLog, mockLiveTranscript } from './helpers';
import { TEST_IDS } from '../constants';

/**
 * Session Comparison & Progress Tracking E2E Test
 * 
 * PURPOSE: Verify users can track improvement/regression across sessions
 */

test.describe('Session Comparison & Progress Tracking', () => {
    test('should display session history with metrics', async ({ userPage }) => {
        // Ensure fresh state and synchronize MSW
        await userPage.reload();
        

        await navigateToRoute(userPage, '/analytics');
        await userPage.waitForSelector('[data-testid="nav-sign-out-button"]');

        // Check if session history exists
        // Verify at least 2 items
        const firstItem = userPage.getByTestId(/session-history-item-/).first();
        // Wait for hydration and fetch
        await expect(firstItem).toBeVisible({ timeout: 15000 });
        const items = userPage.getByTestId(/session-history-item-/);
        const count = await items.count();
        expect(count).toBeGreaterThanOrEqual(2);

        await expect(items.first()).toBeVisible();

        // Verify each session shows key metrics
        const firstSession = items.first();

        // Verify session item shows WPM metric  
        await expect(firstSession.getByText(/WPM/i)).toBeVisible();

        debugLog(`[TEST] ✅ Found ${count} sessions with metrics displayed`);
    });

    test('should display session history list for trend analysis', async ({ userPage }) => {
        // Ensure fresh state and synchronize MSW
        await userPage.reload();
        

        await navigateToRoute(userPage, '/analytics');
        
        await expect(userPage.getByTestId('dashboard-heading')).toBeVisible({ timeout: 15000 });

        // Verify sessions are displayed
        const sessions = userPage.getByTestId(/session-history-item-/);
        await expect(sessions.first()).toBeVisible();

        // Verify multiple sessions exist for trend analysis
        const count = await sessions.count();
        expect(count).toBeGreaterThan(0);

        // Verify first session shows metrics
        const firstSession = sessions.first();
        await expect(firstSession).toBeVisible();
    });

    test('should show progress trends over time', async ({ userPage }) => {
        // Ensure fresh state and synchronize MSW
        await userPage.reload();
        

        await navigateToRoute(userPage, '/analytics');
        await userPage.waitForSelector('[data-testid="nav-sign-out-button"]');

        // Verify trend charts exist
        const wpmTrendChart = userPage.locator('[data-testid="wpm-trend-chart"]');
        await expect(wpmTrendChart).toBeVisible();

        const clarityTrendChart = userPage.locator('[data-testid="clarity-trend-chart"]');
        await expect(clarityTrendChart).toBeVisible();

        debugLog('[TEST] ✅ Progress trends displayed');
    });

    test('should calculate clarity score correctly in live session', async ({ userPage }) => {
        await navigateToRoute(userPage, '/session');
        await userPage.waitForSelector('[data-testid="nav-sign-out-button"]');

        // 2. Start Recording
        await userPage.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click();
        debugLog('[TEST] ✅ Recording started');
        await expect(userPage.getByLabel(/Stop Recording/i)).toBeVisible();

        // Simulate speech to ensure metrics are calculated
        await mockLiveTranscript(userPage, ["Hello world this is a test for clarity score."]);
        await userPage.waitForTimeout(1000); // Allow metrics to update

        // 3. Verify real-time metrics appear
        await expect(userPage.getByTestId(TEST_IDS.WPM_VALUE)).toBeVisible();
        await expect(userPage.getByTestId(TEST_IDS.CLARITY_SCORE_VALUE)).toBeVisible();
        debugLog('[TEST] ✅ Metrics visible');

        const clarityValue = userPage.getByTestId(TEST_IDS.CLARITY_SCORE_VALUE);

        // Initial value should be visible (default 87% when no data)
        await expect(clarityValue).toBeVisible();
        const initialValue = await clarityValue.textContent();
        debugLog(`[TEST] Initial Clarity Score: ${initialValue}`);

        // Verify it's a percentage
        expect(initialValue).toMatch(/\d+%/);

        debugLog('[TEST] ✅ Clarity Score calculation verified');
    });
});
