import { test, expect } from '@playwright/test';
import { healthCheck } from './shared';
import { programmaticLogin } from './helpers';

test.describe('Smoke Test', () => {
  test('should perform a full user journey: login, navigate, and log out @smoke', async ({ page }) => {
    // Step 1: Programmatic login as a default 'free' user.
    await test.step('Health Check (Login as Free User)', async () => {
      await healthCheck(page); // healthCheck uses the default 'free' user profile.
    });

    // Step 2: Navigate to Session Page and verify content.
    await test.step('Navigate to Session Page', async () => {
      await page.goto('/session');
      await expect(page.getByRole('heading', { name: 'Live Transcript' })).toBeVisible();
    });

    // Step 3: Navigate to Analytics Page and verify the empty state for the 'free' user.
    await test.step('Navigate to Analytics Page (Free User)', async () => {
      await page.goto('/analytics');
      // A 'free' user with no session history should see the empty state dashboard.
      await expect(page.getByTestId('analytics-dashboard-empty-state')).toBeVisible();
    });

    // Step 4: Log in as a 'pro' user and verify the full dashboard state.
    await test.step('Login as Pro User and Verify Dashboard', async () => {
      // Log in as a pro user using the new, simpler options object.
      await programmaticLogin(page, { subscriptionStatus: 'pro' });

      // Navigate to the analytics page again.
      await page.goto('/analytics');

      // As a 'pro' user, the empty state should NOT be visible.
      await expect(page.getByTestId('analytics-dashboard-empty-state')).not.toBeVisible();
    });

    // Step 5: Log out.
    await test.step('Logout', async () => {
      const signOutButton = page.getByTestId('nav-sign-out-button');
      await expect(signOutButton).toBeVisible();
      await signOutButton.click();
    });

    // Step 6: Verify successful logout.
    await test.step('Verify Logout', async () => {
      await expect(page.getByRole('link', { name: 'Sign In' })).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('nav-sign-out-button')).not.toBeVisible();
    });
  });
});
