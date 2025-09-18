import { test, expect } from '@playwright/test';

test.describe('Basic Environment Verification', () => {
  test('should load the homepage and have the correct title', async ({ page }) => {
    // Navigate to the app's base URL
    await page.goto('/');

    // The expect().toHaveTitle() call includes an auto-wait,
    // making it a robust way to ensure the page is ready.
    // The explicit page.waitForLoadState('networkidle') is removed as it's unreliable.
    await expect(page).toHaveTitle(/SpeakSharp/);
  });
});
