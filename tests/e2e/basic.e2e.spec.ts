import { test, expect } from '@playwright/test';
import { loginUser } from './helpers';
import { TEST_USER_FREE } from '../constants';

test.describe('Basic Environment Verification', () => {
  test('should load the homepage and have the correct title', async ({ page }) => {
    // Log in first, since the homepage is now a protected route.
    await loginUser(page, TEST_USER_FREE.email, TEST_USER_FREE.password);

    // Navigate to the app's base URL. The new global-setup ensures the server is ready.
    await page.goto('/');

    // The expect().toHaveTitle() call includes an auto-wait,
    // making it a robust way to ensure the page is ready.
    await expect(page).toHaveTitle(/SpeakSharp/);
  });
});
