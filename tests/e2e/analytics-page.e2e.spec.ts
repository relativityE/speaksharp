import { test, expect } from '@playwright/test';
import { healthCheck } from './shared';

test.beforeEach(async ({ page }) => {
  page.on('console', msg => {
    console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
  });
});

test.describe('Analytics Page', () => {
  test('should display the empty state when no session history is returned from the API', async ({ page }) => {
    await healthCheck(page, false, '/analytics?test=true');

    // Verify empty state is visible
    await test.step('Verify Empty State', async () => {
      await expect(page.getByTestId('analytics-dashboard-empty-state')).toBeVisible({ timeout: 15000 });
    });
  });

  test('should display the dashboard with session history when mock data is returned from the API', async ({ page }) => {
    await healthCheck(page, true, '/analytics?test=true');

    // Verify dashboard is visible
    await test.step('Verify Dashboard', async () => {
      await expect(page.getByTestId('dashboard-heading')).toBeVisible({ timeout: 15000 });
    });

    // Log out
    await test.step('Logout', async () => {
      const signOutButton = page.getByTestId('nav-sign-out-button');
      await expect(signOutButton).toBeVisible();
      await signOutButton.click();
    });

    // Verify successful logout
    await test.step('Verify Logout', async () => {
      await expect(page.getByRole('link', { name: 'Sign In' })).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('nav-sign-out-button')).not.toBeVisible();
    });
  });
});
