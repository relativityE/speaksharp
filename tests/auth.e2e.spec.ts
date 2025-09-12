import { expect, test } from '@playwright/test';
import { stubThirdParties } from './sdkStubs';

test.describe('Authentication Flows', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to a blank page to ensure no app code runs yet
    await page.goto('about:blank');

    // Stub all third-party services BEFORE navigating to the app
    await stubThirdParties(page);

    // Monitor for failed requests
    page.on('requestfailed', (request) => {
      console.log(`[REQUEST FAILED] ${request.url()}: ${request.failure()?.errorText}`);
    });

    page.on('response', (response) => {
      if (response.status() >= 400) {
        console.log(`[HTTP ERROR] ${response.status()} ${response.url()}`);
      }
    });

    // Max 15s for setup to prevent hangs
    test.setTimeout(15000);
  });

  test('user can sign in and reach main page', async ({ page }) => {
    test.setTimeout(60000); // 1 min max

    try {
      await page.goto('/auth', { timeout: 10000 });
      await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible({ timeout: 5000 });

      await page.getByLabel('Email').fill('pro@example.com');
      await page.getByLabel('Password').fill('password');
      await page.getByRole('button', { name: 'Sign In' }).click();

      // Wait for redirect
      await page.waitForURL('/', { timeout: 15000 });
      await expect(page.getByText('pro@example.com')).toBeVisible({ timeout: 5000 });
      await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible({ timeout: 5000 });
      await expect(page.getByRole('button', { name: 'Sign In' })).not.toBeVisible({ timeout: 5000 });
    } catch (err) {
      console.error('Test failed:', err);
      throw err;
    }
  });

  test('logged-in user redirected from auth to root', async ({ page }) => {
    test.setTimeout(60000);

    try {
      // Login first
      await page.goto('/auth', { timeout: 10000 });
      await page.getByLabel('Email').fill('free@example.com');
      await page.getByLabel('Password').fill('password');
      await page.getByRole('button', { name: 'Sign In' }).click();

      await page.waitForURL('/', { timeout: 15000 });

      // Navigate back to auth page, expect redirect
      await page.goto('/auth', { timeout: 10000 });
      await page.waitForURL('/', { timeout: 15000 });

      await expect(page.getByText('free@example.com')).toBeVisible({ timeout: 5000 });
    } catch (err) {
      console.error('Redirection test failed:', err);
      throw err;
    }
  });
});
