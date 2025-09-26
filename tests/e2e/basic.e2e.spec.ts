// tests/e2e/basic.e2e.spec.ts
import { test, expect } from '@playwright/test';
import { loginUser } from './helpers';
import { TEST_USER_FREE } from '../constants';

// Helper for logging with a consistent prefix
function logStep(step: string, message?: string) {
  console.log(`[smoke][${step}] ${message || ''}`);
}

test.describe('Basic Environment Verification (fast-fail)', () => {
  // This hook runs before each test in this suite.
  // It ensures the application is loaded and the mock service worker is ready.
  test.beforeEach(async ({ page }) => {
    // Navigate to the root page to ensure the app and MSW are loaded.
    await page.goto('/');
    // Wait for the mswReady promise to resolve, which indicates the mock server is active.
    await page.waitForFunction(() => (window as any).mswReady);
    logStep('beforeEach', 'Mock Service Worker is ready.');
  });

  test('should load homepage and verify environment', async ({ page, baseURL }) => {
    logStep('start', `Base URL: ${baseURL}`);

    // --- Step 1: Login ---
    console.time('[smoke][loginUser]');
    try {
      await loginUser(page, TEST_USER_FREE.email, TEST_USER_FREE.password);
    } catch (err) {
      logStep('loginUser', `FAILED: ${err}`);
      throw err; // fail-fast
    }
    console.timeEnd('[smoke][loginUser]');
    logStep('loginUser', '✅ Success');

    // --- Step 2: Navigate ---
    // Navigation is now handled in the beforeEach hook.
    // We can verify the current URL as a sanity check.
    console.time('[smoke][page.goto]');
    expect(page.url()).toContain('/'); // Ensure we are on the homepage
    console.timeEnd('[smoke][page.goto]');
    logStep('page.goto', `Current URL: ${page.url()}`);

    // --- Step 3: Check Title ---
    console.time('[smoke][toHaveTitle]');
    try {
      await expect(page).toHaveTitle(/SpeakSharp/, { timeout: 7_000 });
    } catch (err) {
      logStep('toHaveTitle', `FAILED title check: ${await page.title()}`);
      throw err;
    }
    console.timeEnd('[smoke][toHaveTitle]');
    logStep('toHaveTitle', `Page title verified: ${await page.title()}`);

    // --- Step 4: Optional Content Check ---
    const headerLocator = page.locator('header#main-header'); // adjust selector as needed
    console.time('[smoke][headerCheck]');
    try {
      await expect(headerLocator).toBeVisible({ timeout: 5_000 });
    } catch (err) {
      logStep('headerCheck', 'FAILED: Main header not visible');
      throw err;
    }
    console.timeEnd('[smoke][headerCheck]');
    logStep('headerCheck', '✅ Main header visible');

    logStep('end', '✅ Smoke test completed successfully');
  });
});