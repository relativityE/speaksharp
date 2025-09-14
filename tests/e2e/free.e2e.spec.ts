import { test, expect, loginUser } from './helpers';

test.describe('Free User Flow', () => {
  test.beforeEach(async () => {
    test.setTimeout(15000);
  });

  test('free user sees upgrade prompt', async ({ page }) => {
    test.setTimeout(60000);
    await loginUser(page, 'free@example.com', 'password');

    await page.goto('/session', { timeout: 10000 });
    await page.waitForLoadState('networkidle');

    const upgradeButton = page.getByRole('button', { name: 'Upgrade Now' });
    try {
      await expect(upgradeButton).toBeVisible({ timeout: 10000 });
    } catch {
      const altButton = page.locator('button:has-text("Upgrade")');
      await expect(altButton).toBeVisible({ timeout: 5000 });
    }
  });

  test('pro user does not see upgrade prompt', async ({ page }) => {
    await loginUser(page, 'pro@example.com', 'password');

    await page.goto('/session');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const upgradeButton = page.getByRole('button', { name: 'Upgrade Now' });
    await expect(upgradeButton).not.toBeVisible();

    const upgradeButtons = page.locator('button:has-text("Upgrade")');
    await expect(upgradeButtons).toHaveCount(0);
  });
});

test.describe.configure({ timeout: 60000, retries: 1 });
