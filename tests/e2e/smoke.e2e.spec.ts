import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

test.describe('Smoke Test', () => {
  test('should perform comprehensive app health check and full user journey @smoke @health-check', async ({ page }) => {
    // Forward browser console logs for diagnostics
    page.on('console', msg => {
      console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`);
    });

    // Step 1: Verify app boots and renders DOM (from bootcheck)
    await test.step('Boot Check - Verify DOM Renders', async () => {
      await page.goto('/');

      // Verify main app container loads
      await expect(page.getByTestId('app-main')).toBeVisible({ timeout: 15000 });

      // Verify HTML structure exists
      const html = page.locator('html');
      await expect(html).toBeVisible({ timeout: 15000 });

      // Verify page title is set
      const title = await page.title();
      console.log(`[BOOTCHECK] Page title: ${title}`);
      expect(title).toBeTruthy();
    });

    // Step 2: Verify unauthenticated state (from health-check)
    await test.step('Verify Unauthenticated Homepage', async () => {
      // Should show Sign In button when not authenticated
      await expect(page.getByRole('link', { name: 'Sign In' }).first()).toBeVisible();

      // Should NOT show sign-out button
      await expect(page.getByTestId('nav-sign-out-button')).not.toBeVisible();
    });

    // Step 3: Programmatic login
    await test.step('Programmatic Login', async () => {
      await programmaticLogin(page);
      console.log('✅ Login completed successfully.');

      // Verify auth state after login
      await expect(page.getByTestId('nav-sign-out-button')).toBeVisible();
    });

    // Step 4: Navigate to Session Page and verify content
    await test.step('Navigate to Session Page', async () => {
      await page.goto('/session');
      await expect(page.getByRole('heading', { name: 'Practice Session' })).toBeVisible();

      // Verify the start/stop button (main functional element)
      await expect(page.getByTestId('session-start-stop-button')).toBeVisible();
    });

    // Step 5: Navigate to Analytics Page and verify content
    await test.step('Navigate to Analytics Page', async () => {
      await page.goto('/analytics');

      // Wait for data to load and verify dashboard elements
      // Two-stage assertion: Wait for loading skeleton to disappear, then check for content
      await expect(page.getByTestId('analytics-dashboard-skeleton')).toBeHidden({ timeout: 15000 });
      await expect(page.getByTestId('speaking-pace')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('dashboard-heading')).toBeVisible();
    });

    // Step 6: Log out
    await test.step('Logout', async () => {
      const signOutButton = page.getByTestId('nav-sign-out-button');
      await expect(signOutButton).toBeVisible();
      await signOutButton.click();
    });

    // Step 7: Verify successful logout
    await test.step('Verify Logout', async () => {
      await expect(page.getByRole('link', { name: 'Sign In' }).first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('nav-sign-out-button')).not.toBeVisible();
    });
  });
});
