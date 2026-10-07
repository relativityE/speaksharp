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

    // #G4: the focus explanation boxes + "selected together" subtitle are gone; the signals section leads
    // with a position-based heading instead.
    // exact:true — "Working on" (the focus eyebrow) must not collide with the goals encouragement
    // sentence ("…Keep working on clarity"), which contains the same substring.
    await expect(page.getByText('Working on', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sound Confident', exact: true })).toBeVisible();
    await expect(page.getByText(/that.s based on/i)).toBeVisible();
    await expect(page.getByTestId('stat-card-speaking_pace')).toBeVisible();
    await expect(page.getByTestId('stat-card-filler_words_per_min')).toBeVisible();
    await expect(page.getByTestId('stat-card-clarity_score')).toBeVisible();
    // Pause Rhythm is now first-class in the default (Sound Confident) focus.
    await expect(page.getByTestId('stat-card-pause_rhythm')).toBeVisible();
  });

  // SCENARIO 1b (#1258 D6/D7, Rev 2 §5.7–5.8): Trends rows start collapsed; Filler words opens to COUNTS, never rates.
  test('Analytics Matrix: Trends rows start collapsed and Filler words shows counts', async ({ userPage: page }, testInfo) => {
    await navigateToRoute(page, '/analytics');
    await waitForFeature(page, 'analytics');

    const trends = page.getByTestId('trends-card');
    await expect(trends.getByRole('heading', { name: 'Trends' })).toBeVisible();
    const rows = trends.getByRole('button', { expanded: false });
    expect(await rows.count()).toBeGreaterThanOrEqual(4);
    await expect(trends.locator('.recharts-wrapper')).toHaveCount(0);

    await trends.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('trends-collapsed.png') });

    await page.getByTestId('trend-row-filler_words').click();
    await expect(page.getByTestId('trend-row-filler_words')).toHaveAttribute('aria-expanded', 'true');
    const body = page.locator('#trend-filler_words');
    await expect(body).toBeVisible();
    const text = (await body.innerText()).replace(/\s+/g, ' ');
    // Counts, not per-minute rates; human labels, never a snake_case key or an ISO timestamp.
    // (the old pooled rates read like "0.38"; a count is a whole number).
    expect(text).not.toMatch(/\/min|\d\.\d|_|\d{4}-\d{2}-\d{2}T/);
    await page.screenshot({ path: testInfo.outputPath('trends-fillers-open.png') });
  });

  // SCENARIO 1c (#1258 D9, Rev 2 §5.9): Recent sessions rows — date/time titles, units in labels, ink Open, yellow PDF,
  // and no horizontal scroll at 375px.
  test('Analytics Matrix: Recent sessions rows at desktop and phone width', async ({ userPage: page }, testInfo) => {
    await navigateToRoute(page, '/analytics');
    await waitForFeature(page, 'analytics');

    const row = page.getByTestId(/session-history-item-/).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('Pace (wpm)')).toBeVisible();
    await expect(row.getByText('Clear delivery (%)')).toBeVisible();
    await expect(row.getByTestId(/open-session-detail-/)).toHaveClass(/\bbg-ink\b/);
    await expect(row.getByTestId(/download-pdf-btn-/)).toHaveClass(/\bbg-signature\b/);
    const text = (await row.innerText()).replace(/\s+/g, ' ');
    expect(text).not.toMatch(/WPM|duration|\d{4}-\d{2}-\d{2}T|Practice Session/);
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('recent-sessions-1280.png') });

    await page.setViewportSize({ width: 375, height: 812 });
    await row.scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal page scroll at 375px').toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath('recent-sessions-375.png') });
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
