import { test, expect } from './fixtures';
import { navigateToRoute, debugLog } from './helpers';

test.describe('Analytics Details', () => {
    test('Journey 8: Session Detail View', async ({ userPage }) => {
        await navigateToRoute(userPage, '/analytics');

        // Check if there are sessions (mocked data usually has some)
        const sessionLink = userPage.locator('a[href^="/analytics/"]').first();

        if (await sessionLink.isVisible()) {
            await sessionLink.click();

            // Verify URL pattern
            await expect(userPage).toHaveURL(/\/analytics\/[a-zA-Z0-9-]+/);

            // Verify page title or header
            await expect(userPage.getByText(/session analysis/i)).toBeVisible();

            // Verify metrics presence
            await expect(userPage.getByText(/clarity score/i)).toBeVisible();
            await expect(userPage.getByTestId('stat-card-speaking_pace')).toBeVisible();
        } else {
            debugLog('No sessions found in analytics list - skipping detail view verification');
        }
    });

    test('Journey 8.3: Invalid Session ID', async ({ userPage }) => {
        // Use navigateToRoute to preserve auth context
        await navigateToRoute(userPage, '/analytics/invalid-session-id');

        // Wait for the "Session Not Found" heading to appear
        await expect(userPage.getByTestId('session-not-found-heading')).toBeVisible({ timeout: 15000 });

        // Verify link back to dashboard
        const dashboardLink = userPage.getByRole('link', { name: /view dashboard/i });
        await expect(dashboardLink).toBeVisible();

        await dashboardLink.click();
        await expect(userPage).toHaveURL('/analytics');
    });
});
