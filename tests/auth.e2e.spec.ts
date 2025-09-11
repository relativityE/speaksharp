// tests/auth.e2e.spec.ts - REFACTORED
import { expect, test } from '@playwright/test';
import { stubThirdParties } from './sdkStubs';

test.describe('Authentication Flows', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to a blank page to ensure no app code runs yet
    await page.goto('about:blank');
    // Stub all third-party services BEFORE navigating to the app
    // await stubThirdParties(page);

    // Monitor for failed requests
    page.on('requestfailed', request => {
      console.log(`[REQUEST FAILED] ${request.url()}: ${request.failure()?.errorText}`);
    });

    page.on('response', response => {
      if (response.status() >= 400) {
        console.log(`[HTTP ERROR] ${response.status()} ${response.url()}`);
      }
    });
  });

  test('a user can sign in and is redirected to the main page', async ({ page }) => {
    test.setTimeout(60000); // 1 minute max

    console.log('Starting test: a user can sign in...');
    await page.goto('/auth', { timeout: 10000 });
    console.log('Navigated to /auth');
    await page.screenshot({ path: 'test-results/e2e-artifacts/01-auth-page.png' });

    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible({ timeout: 5000 });
    console.log('Sign in form is visible');

    await page.getByLabel('Email').fill('pro@example.com');
    await page.getByLabel('Password').fill('password');
    console.log('Filled in email and password');
    await page.screenshot({ path: 'test-results/e2e-artifacts/02-form-filled.png' });

    await page.getByRole('button', { name: 'Sign In' }).click();
    console.log('Clicked Sign In button, current URL:', page.url());

    // Wait a moment for any immediate redirects
    await page.waitForTimeout(2000);
    console.log('After 2s wait, current URL:', page.url());

    // Check if we're still on auth page
    if (page.url().includes('/auth')) {
      console.log('Still on auth page, looking for error messages...');
      await page.screenshot({ path: 'test-results/e2e-artifacts/stuck-on-auth.png' });

      const errorElement = page.locator('[role="alert"], .error, .alert');
      if (await errorElement.isVisible({ timeout: 1000 })) {
        console.log('Error message found:', await errorElement.textContent());
      }
    }

    try {
      await page.waitForURL('/', { timeout: 15000 });
      console.log('Successfully redirected to /');
    } catch (error) {
      console.log('Failed to redirect to /, current URL:', page.url());
      await page.screenshot({ path: 'test-results/e2e-artifacts/redirect-failure.png' });
      throw error;
    }

    await page.screenshot({ path: 'test-results/e2e-artifacts/05-after-wait-for-url.png' });

    await expect(page.getByText('pro@example.com')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Sign In' })).not.toBeVisible({ timeout: 5000 });
    console.log('Test finished successfully');
  });

  test('a logged-in user is redirected from auth page to root', async ({ page }) => {
    test.setTimeout(60000);

    // Log the user in first
    await page.goto('/auth', { timeout: 10000 });
    await page.getByLabel('Email').fill('free@example.com');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: 'Sign In' }).click();

    try {
      await page.waitForURL('/', { timeout: 15000 });
    } catch (error) {
        console.log('Failed to redirect to / after initial login, current URL:', page.url());
        await page.screenshot({ path: 'test-results/e2e-artifacts/redirect-failure-test2-part1.png' });
        throw error;
    }


    // Now, navigate back to the auth page
    await page.goto('/auth', { timeout: 10000 });

    // User should be immediately redirected back to the root
    try {
        await page.waitForURL('/', { timeout: 15000 });
    } catch (error) {
        console.log('Failed to redirect to / on second auth visit, current URL:', page.url());
        await page.screenshot({ path: 'test-results/e2e-artifacts/redirect-failure-test2-part2.png' });
        throw error;
    }

    await expect(page.getByText('free@example.com')).toBeVisible({ timeout: 5000 });
  });
});
