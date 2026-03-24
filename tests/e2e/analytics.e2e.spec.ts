import { test, expect } from './fixtures';
import { navigateToRoute, attachLiveTranscript, waitForFeature } from './helpers';

test.describe('Analytics Page - Dashboard with Data', () => {
  test('should display analytics dashboard with session data', async ({ userPage }) => {
    // Capture browser console logs for debugging
    attachLiveTranscript(userPage);

    // Navigate to analytics (client-side via route helper)
    await navigateToRoute(userPage, '/analytics');
    
    // 🛡️ Architectural Readiness: Wait for analytics data to be fully loaded
    await waitForFeature(userPage, 'analytics');
    // Wait for loading to finish first (robustness against CI slowness)
    await expect(userPage.locator('.animate-spin')).not.toBeVisible({ timeout: 15000 });

    const mainHeading = userPage.getByTestId('dashboard-heading');
    await expect(mainHeading).toBeVisible({ timeout: 30000 });
    await expect(mainHeading).toHaveText('Your Analytics');

    // Verify dashboard renders with data
    const dashboard = userPage.getByTestId('analytics-dashboard');
    await expect(dashboard).toBeVisible();

    // Verify key metrics are displayed (testid pattern: stat-card-{option.id})
    await expect(userPage.getByTestId('stat-card-speaking_pace')).toBeVisible();
  });
});
