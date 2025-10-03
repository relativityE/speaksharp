// tests/e2e/basic.e2e.spec.ts
import { test, expect } from '@playwright/test';
import { programmaticLogin, MockUser } from './helpers';
import { stubThirdParties } from './sdkStubs';

// Define a mock user for this test.
const basicUser: MockUser = {
  id: 'user-123',
  email: 'free-user@test.com', // CORRECTED: Use an email that the mock API accepts.
  subscription_status: 'free',
};

test.describe('Basic Environment Verification', () => {
  test.beforeEach(async ({ page }) => {
    // Stub third-party services to ensure a clean and predictable environment.
    await stubThirdParties(page);
  });

  test('should load homepage and verify core elements after login @smoke', async ({ page }) => {
    await test.step('Programmatically log in', async () => {
      // This helper authenticates the user but stays on the homepage (`/`)
      // because auto-redirect is disabled in test/dev mode.
      await programmaticLogin(page, basicUser);
    });

    await test.step('Manually navigate to the session page', async () => {
      // As per ARCHITECTURE.md, we must manually navigate to the desired
      // page after login in a test environment.
      await page.goto('/session');
    });

    await test.step('Verify session page content is visible', async () => {
      // Now that we are correctly on the /session page, we can assert its content.
      const sessionHeading = page.getByRole('heading', { name: 'Practice Session' });
      await expect(sessionHeading).toBeVisible({ timeout: 10000 });

      const headerLocator = page.locator('header');
      await expect(headerLocator).toBeVisible();
    });
  });
});