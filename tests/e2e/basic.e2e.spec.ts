// tests/e2e/basic.e2e.spec.ts
import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';
import { stubThirdParties } from './sdkStubs';


test.describe('Basic Environment Verification', () => {
  test.beforeEach(async ({ page }) => {
    // Stub third-party services to ensure a clean and predictable environment.
    await stubThirdParties(page);
  });

  test('should load homepage and verify core elements after login @smoke', async ({ page }) => {
    await test.step('Programmatically log in', async () => {
      // This helper authenticates the user but stays on the homepage (`/`)
      // because auto-redirect is disabled in test/dev mode.
      await programmaticLogin(page);
    });

    await test.step('Manually navigate to the session page', async () => {
      // As per ARCHITECTURE.md, we must manually navigate to the desired
      // page after login in a test environment.
      await page.goto('/session');
    });

    await test.step('Verify session page content is visible', async () => {
      // Now that we are correctly on the /session page, we can assert its content.
      const sessionHeading = page.getByTestId('practice-session-heading');
      await expect(sessionHeading).toBeVisible({ timeout: 10000 });

      // The navigation bar is part of the main layout, let's keep verifying it.
      const navLocator = page.locator('nav');
      await expect(navLocator).toBeVisible();
    });
  });
});