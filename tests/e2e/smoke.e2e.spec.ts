import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

test.describe('Smoke Test', () => {
  test('should perform a full user journey: login, navigate, and log out @smoke', async ({ page }) => {
    // Step 1: Programmatic login
    await test.step('Login', async () => {
      await programmaticLogin(page);
    });

    // Step 2: Navigate to Session Page and verify content
    await test.step('Navigate to Session Page', async () => {
      await page.goto('/session');
      await expect(page.getByRole('heading', { name: 'Live Transcript' })).toBeVisible();
    });

    // Step 3: Navigate to Analytics Page and verify content
    await test.step('Navigate to Analytics Page', async () => {
      await page.goto('/analytics');
      await expect(page.getByTestId('dashboard-heading')).toBeVisible();
    });

    // Step 4: Log out
    await test.step('Logout', async () => {
      // Clicking the sign-out button is a different kind of interaction (triggers an event)
      // so I will leave this as a click.
      const signOutButton = page.getByTestId('nav-sign-out-button');
      await expect(signOutButton).toBeVisible();
      await signOutButton.click();
    });

    // Step 5: Verify successful logout
    await test.step('Verify Logout', async () => {
      await expect(page.getByRole('link', { name: 'Sign In' })).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('nav-sign-out-button')).not.toBeVisible();
    });
  });
});
