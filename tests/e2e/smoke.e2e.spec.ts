import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, attachLiveTranscript, debugLog } from './helpers';
import { TEST_IDS, TIMEOUTS } from '../constants';

test.describe('Smoke Test', () => {
  test('should perform comprehensive app health check and full user journey @smoke @health-check', async ({ page }) => {
    // Forward browser console logs with colorized ERROR/WARN output
    attachLiveTranscript(page);

    // Step 1: Programmatic login (this does the initial page.goto('/') internally)
    // IMPORTANT: Do NOT call page.goto() before programmaticLoginWithRoutes - it causes MSW ready event race
    await test.step('Programmatic Login', async () => {
      await programmaticLoginWithRoutes(page);
      debugLog('✅ Login completed successfully.');

      // Verify auth state after login
      await expect(page.getByTestId('nav-sign-out-button')).toBeVisible();
    });

    // Step 2: Verify app booted correctly (done after login to avoid double page.goto)
    await test.step('Verify App Booted Correctly', async () => {
      // Verify main app container loads
      await expect(page.getByTestId('app-main')).toBeVisible({ timeout: 15000 });

      // Verify HTML structure exists
      const html = page.locator('html');
      await expect(html).toBeVisible({ timeout: 15000 });

      // Verify page title is set
      const title = await page.title();
      debugLog(`[BOOTCHECK] Page title: ${title}`);
      expect(title).toBeTruthy();
    });

    // Step 3: Navigate to Session Page and verify content
    await test.step('Navigate to Session Page', async () => {
      await navigateToRoute(page, '/session');
      await expect(page.getByRole('heading', { name: 'Practice Session' })).toBeVisible();

      // Wait for session page to load
      await expect(page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toBeVisible({ timeout: TIMEOUTS.PAGE_LOAD });
      debugLog('[TEST] ✅ Session page loaded');
    });

    // Step 4: Navigate to Analytics Page and verify content
    await test.step('Navigate to Analytics Page', async () => {
      await navigateToRoute(page, '/analytics');

      // Wait for data to load and verify dashboard elements
      // Two-stage assertion: Wait for loading skeleton to disappear, then check for content
      await expect(page.getByTestId('analytics-dashboard-skeleton')).toBeHidden({ timeout: 15000 });
      // Check for dashboard stats
      await expect(page.getByTestId(TEST_IDS.ANALYTICS_DASHBOARD)).toBeVisible();
      await expect(page.getByTestId('stat-card-speaking_pace')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('dashboard-heading')).toBeVisible();
    });

    // Step 5: Log out
    await test.step('Logout', async () => {
      const signOutButton = page.getByTestId('nav-sign-out-button');
      await expect(signOutButton).toBeVisible();
      await signOutButton.click();
    });

    // Step 6: Verify successful logout
    await test.step('Verify Logout', async () => {
      await expect(page.getByRole('link', { name: 'Sign In' }).first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('nav-sign-out-button')).not.toBeVisible();
    });
  });
});
