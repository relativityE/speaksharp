import { test, expect } from './fixtures';
import { navigateToRoute, attachLiveTranscript, openSessionDetailFromHistoryItem, waitForFeature } from './helpers';

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

    // Verify the default analytics story explains why these signals are grouped.
    await expect(page.getByText('Analytics Focus')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sound Confident', exact: true })).toBeVisible();
    await expect(page.getByText('Your Sound Confident signals')).toBeVisible();
    await expect(page.getByText(/These cards are selected together because they support the current focus/i)).toBeVisible();
    await expect(page.getByTestId('stat-card-speaking_pace')).toBeVisible();
    await expect(page.getByTestId('stat-card-filler_words_per_min')).toBeVisible();
    await expect(page.getByTestId('stat-card-clarity_score')).toBeVisible();
    // Pause Rhythm is now first-class in the default (Sound Confident) focus.
    await expect(page.getByTestId('stat-card-pause_rhythm')).toBeVisible();
  });

  // SCENARIO 2: Detail Flow (Click-through Analysis)
  test('Analytics Matrix: Session Detail View and Error Handling', async ({ userPage: page }) => {
    await navigateToRoute(page, '/analytics');
    await waitForFeature(page, 'analytics');

    // Check for session list items
    const firstSession = page.getByTestId(/session-history-item-/).first();
    
    if (await firstSession.isVisible()) {
      await openSessionDetailFromHistoryItem(page, firstSession);

      // Verify Detail View URL and Header
      await expect(page).toHaveURL(/\/analytics\/[a-zA-Z0-9-]+/);
      await expect(page.getByText(/session analysis/i)).toBeVisible();
      
      // Verify Detail Metrics
      await expect(page.getByText(/clear delivery/i)).toBeVisible();
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
    await expect(page.getByText(/Your trends start after one saved session/i)).toBeVisible();
  });

});
