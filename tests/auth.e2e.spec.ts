import { test, expect } from './helpers';
import { sandboxPage, loginUser } from './helpers';

test.describe('Authentication Flows', () => {
  test.beforeEach(async ({ page }) => {
    await sandboxPage(page);
    test.setTimeout(15000);
  });

  test('sign in and reach main page', async ({ page }) => {
    test.setTimeout(60000);
    await loginUser(page, 'pro@example.com', 'password');

    await expect(page.getByText('pro@example.com')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).not.toBeVisible();
  });

  test('redirect logged-in user from auth to root', async ({ page }) => {
    test.setTimeout(60000);
    await loginUser(page, 'free@example.com', 'password');

    await page.goto('/auth', { timeout: 10000 });
    await page.waitForURL('/', { timeout: 15000 });

    await expect(page.getByText('free@example.com')).toBeVisible();
  });
});

test.describe.configure({ timeout: 60000, retries: 1 });
