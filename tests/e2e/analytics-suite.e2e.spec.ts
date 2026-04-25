import { test, expect } from './fixtures';
import { navigateToRoute, attachLiveTranscript, waitForFeature } from './helpers';

/**
 * CONSOLIDATED ANALYTICS SUITE (v1.6)
 * Sharded suite for Dashboard, Metrics, Detail Views, and Empty States.
 */

test.describe('Analytics Suite & Data Matrix', () => {

  test.beforeEach(async ({ userPage: page }) => {
    attachLiveTranscript(page);
  });

  // SCENARIO 1: Dashboard with Data (Metrics Matrix)
  test('Analytics Matrix: Dashboard and Stat-Card Verification', async ({ userPage: page }) => {
    await navigateToRoute(page, '/analytics');
    
    // 🛡️ Architectural Readiness
    await waitForFeature(page, 'analytics');
    await expect(page.locator('.animate-spin')).not.toBeVisible({ timeout: 15000 });

    // Verify Dashboard Heading
    const mainHeading = page.getByTestId('dashboard-heading');
    await expect(mainHeading).toBeVisible();
    await expect(mainHeading).toHaveText('Your Analytics');

    // Verify key metrics are displayed
    await expect(page.getByTestId('stat-card-total_sessions')).toBeVisible();
    await expect(page.getByTestId('stat-card-speaking_pace')).toBeVisible();
    await expect(page.getByTestId('stat-card-filler_words_per_min')).toBeVisible();
  });

  // SCENARIO 2: Detail Flow (Click-through Analysis)
  test('Analytics Matrix: Session Detail View and Error Handling', async ({ userPage: page }) => {
    await navigateToRoute(page, '/analytics');
    await waitForFeature(page, 'analytics');

    // Check for session list items
    const firstSession = page.getByTestId(/session-history-item-/).first();
    
    if (await firstSession.isVisible()) {
      await firstSession.click();

      // Verify Detail View URL and Header
      await expect(page).toHaveURL(/\/analytics\/[a-zA-Z0-9-]+/);
      await expect(page.getByText(/session analysis/i)).toBeVisible();
      
      // Verify Detail Metrics
      await expect(page.getByText(/clarity score/i)).toBeVisible();
      await expect(page.getByTestId('stat-card-speaking_pace')).toBeVisible();
    }
  });

  // SCENARIO 3: Error States (Invalid IDs)
  test('Analytics Matrix: Resilience to Invalid Session IDs', async ({ userPage: page }) => {
    await navigateToRoute(page, '/analytics/invalid-uuid-signal');
    await waitForFeature(page, 'analytics');

    // Verify "Session Not Found" handling
    await expect(page.getByTestId('session-not-found-heading')).toBeVisible({ timeout: 15000 });
    const dashboardLink = page.getByRole('link', { name: /view dashboard/i });
    await expect(dashboardLink).toBeVisible();

    await dashboardLink.click();
    await expect(page).toHaveURL('/analytics');
  });

  // SCENARIO 4: Empty State Matrix
  test('Analytics Matrix: Zero-Data Empty State', async ({ emptyUserPage: page }) => {
    await navigateToRoute(page, '/analytics');
    await waitForFeature(page, 'analytics');

    // Verify Empty State UI
    await expect(page.getByTestId('analytics-dashboard-empty-state')).toBeVisible();
    await expect(page.getByText(/Your Dashboard Awaits!/i)).toBeVisible();
  });

});
