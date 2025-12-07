import { test, expect } from '@playwright/test';
import { programmaticLogin, navigateToRoute } from './helpers';

test.describe('Analytics Page - Dashboard with Data', () => {
  test('should display analytics dashboard with session data', async ({ page }) => {
    // MSW provides mock session data by default
    await programmaticLogin(page);

    // Use client-side navigation to avoid full page reload issues
    await navigateToRoute(page, '/analytics');

    console.log('[TEST] Current URL:', page.url());
    console.log('[TEST] Waiting for dashboard heading...');

    // Verify dashboard heading
    const mainHeading = page.getByTestId('dashboard-heading');
    await expect(mainHeading).toBeVisible({ timeout: 10000 });
    await expect(mainHeading).toHaveText('Your Dashboard');

    // Verify dashboard renders with data
    const dashboard = page.getByTestId('analytics-dashboard');
    await expect(dashboard).toBeVisible();

    // Verify key metrics are displayed
    await expect(page.getByTestId('speaking-pace')).toBeVisible();
  });
});
