import { test, expect } from './helpers';
import { sandboxPage, loginUser, startSession, stopSession } from './helpers';

test.describe('Pro User Flow', () => {
  test.beforeEach(async ({ page }) => {
    await sandboxPage(page);
    test.setTimeout(15000);
  });

  test('no upgrade prompt for pro', async ({ page }) => {
    test.setTimeout(60000);
    await loginUser(page, 'pro@example.com', 'password');

    await page.goto('/session');
    await page.waitForLoadState('networkidle');

    const upgradeButton = page.getByRole('button', { name: 'Upgrade Now' });
    await expect(upgradeButton).not.toBeVisible();
  });

  test('start and stop session for pro', async ({ page }) => {
    test.setTimeout(60000);
    await loginUser(page, 'pro@example.com', 'password');
    await startSession(page);
    await stopSession(page);
  });
});

test.describe.configure({ timeout: 60000, retries: 1 });
