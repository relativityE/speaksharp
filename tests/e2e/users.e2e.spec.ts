import { test, expect } from './fixtures';
import { navigateToRoute } from './helpers';

test.describe('User Tier Flows', () => {
  test('should not show the upgrade banner for a pro user', async ({ proPage: page }) => {
    // Wait for the app to be fully loaded
    await expect(page.getByTestId('nav-sign-out-button')).toBeVisible({ timeout: 15000 });

    await navigateToRoute(page, '/analytics');
    // Behavioral check
    await expect(page).toHaveURL(/\/analytics/, { timeout: 10000 });
    await expect(page.locator('h1, h2, [data-testid="dashboard-heading"]').first()).toBeVisible();

    // For a 'pro' user, the upgrade banner should not be visible.
    await expect(page.getByTestId('analytics-page-upgrade-button')).not.toBeVisible();
  });
});
