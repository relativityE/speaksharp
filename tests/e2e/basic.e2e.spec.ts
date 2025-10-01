// tests/e2e/basic.e2e.spec.ts
import { test, expect } from '../setup/verifyOnlyStepTracker';
import { loginUser } from './helpers';
import { TEST_USER_FREE } from '../constants';

test.describe('Basic Environment Verification (fast-fail)', () => {
  // The global setup in `verifyOnlyStepTracker.ts` now handles page navigation
  // and waiting for MSW. No `beforeEach` is needed here anymore.

  test('should load homepage and verify environment @smoke', async ({ page }) => {
    // The global setup navigates to `/` and waits for MSW.
    // We can now proceed directly with test-specific actions.
    await loginUser(page, TEST_USER_FREE.email, TEST_USER_FREE.password);

    await expect(page).toHaveURL('/');
    await expect(page).toHaveTitle(/SpeakSharp/, { timeout: 7_000 });

    const headerLocator = page.locator('header#main-header'); // adjust selector as needed
    await expect(headerLocator).toBeVisible({ timeout: 5_000 });
  });
});