import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

test.describe('User Tier Flows', () => {
  test('should not show the upgrade banner for a pro user', async ({ page }) => {
    // Explicitly log in a 'pro' user.
    await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });

    // Wait for the app to be fully loaded and on the home page before navigating
    await expect(page.getByTestId('app-main')).toBeVisible();

    await navigateToRoute(page, '/analytics');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('dashboard-heading')).toBeVisible();

    // For a 'pro' user, the upgrade banner should not be visible.
    await expect(page.getByTestId('analytics-page-upgrade-button')).not.toBeVisible();
  });
});
