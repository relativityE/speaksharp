import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, attachLiveTranscript } from './helpers';

test.describe('Analytics Page - Dashboard with Data', () => {
  test('should display analytics dashboard with session data', async ({ page }) => {
    // Capture browser console logs for debugging
    attachLiveTranscript(page);

    // MSW provides mock session data by default
    await programmaticLoginWithRoutes(page);

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

    // Verify key metrics are displayed (testid pattern: stat-card-{option.id})
    await expect(page.getByTestId('stat-card-speaking_pace')).toBeVisible();
  });
});
