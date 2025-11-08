import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

test.describe('Analytics Page', () => {
  test('should load the analytics page and display the main heading', async ({ page }) => {
    // Step 1: Log in programmatically
    await programmaticLogin(page);

    // Step 2: Navigate to the analytics page
    await page.goto('/analytics');

    // Step 3: Assert that the main dashboard heading is visible
    const mainHeading = page.getByTestId('dashboard-heading');
    await expect(mainHeading).toBeVisible({ timeout: 10000 });
    await expect(mainHeading).toHaveText('Your Dashboard');
  });
});
