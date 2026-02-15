import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, debugLog } from './helpers';

test.describe('Analytics Details', () => {
    test.beforeEach(async ({ page }) => {
        await programmaticLoginWithRoutes(page);
    });

    test('Journey 8: Session Detail View', async ({ page }) => {
        await navigateToRoute(page, '/analytics');

        // Check if there are sessions (mocked data usually has some)
        const sessionLink = page.locator('a[href^="/analytics/"]').first();

        if (await sessionLink.isVisible()) {
            await sessionLink.click();

            // Verify URL pattern
            await expect(page).toHaveURL(/\/analytics\/[a-zA-Z0-9-]+/);

            // Verify page title or header
            await expect(page.getByText(/session analysis/i)).toBeVisible();

            // Verify metrics presence
            await expect(page.getByText(/clarity score/i)).toBeVisible();
            await expect(page.getByText(/speaking rate/i)).toBeVisible();
        } else {
            debugLog('No sessions found in analytics list - skipping detail view verification');
        }
    });

    test('Journey 8.3: Invalid Session ID', async ({ page }) => {
        // Use navigateToRoute to preserve auth context
        await navigateToRoute(page, '/analytics/invalid-session-id');

        // Wait for the "Session Not Found" heading to appear
        // This is more robust than waiting for a window flag, since the flag depends
        // on session query resolution which may not happen for invalid IDs in the mock layer.
        await expect(page.getByTestId('session-not-found-heading')).toBeVisible({ timeout: 15000 });

        // Verify link back to dashboard
        const dashboardLink = page.getByRole('link', { name: /view dashboard/i });
        await expect(dashboardLink).toBeVisible();

        await dashboardLink.click();
        await expect(page).toHaveURL('/analytics');
    });
});
