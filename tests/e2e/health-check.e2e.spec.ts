import { test, expect } from './fixtures';
import { navigateToRoute, attachLiveTranscript, debugLog } from './helpers';
import { TEST_IDS, TIMEOUTS } from '../constants';

test.describe('E2E Critical Path (Mocked)', () => {
  test('should perform comprehensive app health check and full user journey @critical-path @health-check', async ({ userPage }) => {
    // Forward browser console logs with colorized ERROR/WARN output
    attachLiveTranscript(userPage);

    // Step 2: Verify App Booted Correctly (done after login to avoid double page.goto)
    await test.step('Verify App Booted Correctly', async () => {
      // Verify main app container loads
      await expect(userPage.getByTestId('app-main')).toBeVisible({ timeout: 15000 });

      // Verify HTML structure exists
      const html = userPage.locator('html');
      await expect(html).toBeVisible({ timeout: 15000 });

      // Verify page title is set
      const title = await userPage.title();
      debugLog(`[BOOTCHECK] Page title: ${title}`);
      expect(title).toBeTruthy();
    });

    // Step 3: Navigate to Session Page and verify content
    await test.step('Navigate to Session Page', async () => {
      await navigateToRoute(userPage, '/session');
      await expect(userPage.getByRole('heading', { name: 'Practice Session' })).toBeVisible();

      // Wait for session page to load
      await expect(userPage.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toBeVisible({ timeout: TIMEOUTS.PAGE_LOAD });
      debugLog('[TEST] ✅ Session page loaded');
    });

    // Step 4: Navigate to Analytics Page and verify content
    await test.step('Navigate to Analytics Page', async () => {
      await navigateToRoute(userPage, '/analytics');

      // Wait for data to load and verify dashboard elements
      // Two-stage assertion: Wait for loading skeleton to disappear, then check for content
      await expect(userPage.getByTestId('analytics-dashboard-skeleton')).toBeHidden({ timeout: 15000 });
      // Check for dashboard stats
      await expect(userPage.getByTestId(TEST_IDS.ANALYTICS_DASHBOARD)).toBeVisible();
      await expect(userPage.getByTestId('stat-card-speaking_pace')).toBeVisible({ timeout: 15000 });
      await expect(userPage.getByTestId('dashboard-heading')).toBeVisible();
    });

    // Step 5: Log out
    await test.step('Logout', async () => {
      const signOutButton = userPage.getByTestId('nav-sign-out-button');
      await expect(signOutButton).toBeVisible();
      await signOutButton.click();
    });

    // Step 6: Verify successful logout
    await test.step('Verify Logout', async () => {
      await expect(userPage.getByRole('link', { name: 'Sign In' }).first()).toBeVisible({ timeout: 10000 });
      await expect(userPage.getByTestId('nav-sign-out-button')).not.toBeVisible();
    });
  });
});
