// tests/e2e/basic.e2e.spec.ts
import { test, expect } from '../setup/verifyOnlyStepTracker';
import { loginUser } from './helpers';
import { TEST_USER_FREE } from '../constants';

test.describe('Basic Environment Verification (fast-fail)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the root page to establish an origin for localStorage
    await page.goto('/');
    // Clear localStorage to ensure no stale session from previous runs
    await page.evaluate(() => localStorage.clear());
    // Reload the page to ensure the AuthProvider re-initializes with a clean state
    await page.reload();
    // Wait for the mswReady promise to resolve, which indicates the mock server is active.
    await page.waitForFunction(() => (window as Window & { mswReady: Promise<void> }).mswReady);
  });

  test('should load homepage and verify environment @smoke', async ({ page }) => {
    await loginUser(page, TEST_USER_FREE.email, TEST_USER_FREE.password);

    // The beforeEach hook handles navigation, so we just verify the result.
    await expect(page).toHaveURL('/');
    await expect(page).toHaveTitle(/SpeakSharp/, { timeout: 7_000 });

    const headerLocator = page.locator('header#main-header'); // adjust selector as needed
    await expect(headerLocator).toBeVisible({ timeout: 5_000 });
  });
});