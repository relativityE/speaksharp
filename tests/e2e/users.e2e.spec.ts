import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

test.describe('User Tier Flows', () => {
  test('should not show the upgrade banner for a pro user', async ({ page }) => {
    // The default programmaticLoginWithRoutes logs in a 'pro' user.
    await programmaticLoginWithRoutes(page);

    // Wait for the app to be fully loaded and on the home page before navigating
    await expect(page.getByTestId('app-main')).toBeVisible();

    await navigateToRoute(page, '/analytics');
    await expect(page.getByRole('heading', { name: 'Your Dashboard' })).toBeVisible();

    // For a 'pro' user, the upgrade banner should not be visible.
    await expect(page.getByTestId('analytics-page-upgrade-button')).not.toBeVisible();
  });
});
