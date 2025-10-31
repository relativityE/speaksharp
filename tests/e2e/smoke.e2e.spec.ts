import { test, expect } from '@playwright/test';
import { healthCheck } from './shared';

test.describe('Smoke Test', () => {
  test('should perform a full user journey: login, navigate, and log out @smoke', async ({ page }) => {
    // DIAGNOSTIC: Forward all browser console logs to the Node.js console.
    page.on('console', msg => {
      console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`);
    });

    // Step 1: Programmatic login
    await test.step('Health Check (Login)', async () => {
      await healthCheck(page);
      console.log('✅ Health-check completed successfully.');
    });

    // Step 2: Navigate to Session Page and verify content
    await test.step('Navigate to Session Page', async () => {
      await page.goto('/session');
      await expect(page.getByRole('heading', { name: 'Live Transcript' })).toBeVisible();

      // Robust assertion: Verify that the main functional element, the start/stop button,
      // is visible. This button exists in both the desktop and mobile layouts, so this
      // test is resilient to responsive UI changes.
      await expect(page.getByTestId('session-start-stop-button')).toBeVisible();
    });

    // Step 3: Navigate to Analytics Page and verify content
    await test.step('Navigate to Analytics Page', async () => {
      await page.goto('/analytics');
      // Now that the SessionProvider is fixed, we can just wait for the data to load.
      await expect(page.getByTestId('speaking-pace')).toBeVisible({ timeout: 15000 });
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
      await expect(page.getByTestId('nav-login-button')).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('nav-sign-out-button')).not.toBeVisible();
    });
  });
});
