import { test, expect } from '@playwright/test';

test.describe('Basic Environment Verification', () => {
  test('should load the homepage and have the correct title', async ({ page }) => {
    // Navigate to the app's base URL
    await page.goto('/');

    // Wait for the page to be fully loaded
    await page.waitForLoadState('networkidle');

    // Assert that the page title is what we expect
    await expect(page).toHaveTitle(/SpeakSharp/);
  });
});
