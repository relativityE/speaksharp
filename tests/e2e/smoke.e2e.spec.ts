// tests/e2e/smoke.e2e.spec.ts
import { test, expect } from '@playwright/test';
import { programmaticLogin, MockUser } from './helpers';
import { stubThirdParties } from './sdkStubs';

// This user is specifically designed to work with the mock API handlers.
const smokeTestUser: MockUser = {
  id: 'user-123',
  email: 'free-user@test.com',
  subscription_status: 'free',
};

test.describe('Smoke Test', () => {
  test.beforeEach(async ({ page }) => {
    // Stub third-party services to ensure a clean and predictable environment.
    await stubThirdParties(page);
  });

  test('should successfully log in and display the main application header @smoke', async ({ page }) => {
    await test.step('Programmatically log in with a valid mock user', async () => {
      await programmaticLogin(page, smokeTestUser);
    });

    await test.step('Manually navigate to the session page', async () => {
      // Manual navigation is required in the test environment.
      await page.goto('/session');
    });

    await test.step('Verify that the main application header is visible', async () => {
      // The header is a fundamental part of the UI and a good indicator of a successful page load.
      const headerLocator = page.locator('header');
      await expect(headerLocator).toBeVisible({ timeout: 15000 }); // Increased timeout for stability
    });

    await test.step('Verify the main heading is present', async () => {
      // Check for the "Practice Session" heading to confirm we are on the correct page.
      const heading = page.getByRole('heading', { name: 'Practice Session' });
      await expect(heading).toBeVisible();
    });
  });
});