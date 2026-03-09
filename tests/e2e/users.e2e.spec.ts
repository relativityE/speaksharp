import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

test.describe('User Tier Flows', () => {
  test('should not show the upgrade banner for a pro user', async ({ page }) => {
    // Explicitly log in a 'pro' user.
    await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });

    // Wait for the app to be fully loaded (Problem A fix verification)
    await expect(page.getByTestId('app-main')).toBeVisible({ timeout: 15000 });

    await navigateToRoute(page, '/analytics');
    // Behavioral check: Verify we reached analytics by checking the URL and a core element
    await expect(page).toHaveURL(/\/analytics/, { timeout: 10000 });
    await expect(page.locator('h1, h2, [data-testid="dashboard-heading"]').first()).toBeVisible();

    // For a 'pro' user, the upgrade banner should not be visible.
    await expect(page.getByTestId('analytics-page-upgrade-button')).not.toBeVisible();
  });
});
