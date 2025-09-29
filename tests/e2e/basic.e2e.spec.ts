import { test, expect } from './autoStepTest';
import { loginUser } from './helpers';
import { TEST_USER_FREE } from '../constants';
import '../setup/logging';

test.describe('Basic Environment Verification (fast-fail)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).mswReady);
  });

  test('should load homepage and verify environment @smoke', async ({ page }) => {
    await loginUser(page, TEST_USER_FREE.email, TEST_USER_FREE.password);

    // Verify we are on the homepage after login
    expect(page.url()).toContain('/');

    // Verify the page title
    await expect(page).toHaveTitle(/SpeakSharp/, { timeout: 7_000 });

    // Verify a key element is visible
    const headerLocator = page.getByRole('heading', { name: 'Speak with Crystal Clarity' });
    await expect(headerLocator).toBeVisible({ timeout: 5_000 });
  });
});