import { expect, test } from '@playwright/test';
import { stubThirdParties } from './sdkStubs';

test.describe('Pro User Flow', () => {
  test.beforeEach(async ({ page }) => {
    await stubThirdParties(page);
    test.setTimeout(15000); // 15s max for setup
  });

  test('pro user should not see upgrade prompt', async ({ page }) => {
    test.setTimeout(60000);

    try {
      await page.goto('/auth', { timeout: 10000 });
      await page.getByLabel('Email').fill('pro@example.com');
      await page.getByLabel('Password').fill('password');
      await page.getByRole('button', { name: 'Sign In' }).click();

      await page.waitForURL('/', { timeout: 15000 });
      const upgradeButton = page.getByRole('button', { name: /Upgrade/i });
      await expect(upgradeButton).not.toBeVisible({ timeout: 5000 });
    } catch (err) {
      console.error('Upgrade prompt test failed:', err);
      throw err;
    }
  });

  test('pro user can download session data', async ({ page }) => {
    test.setTimeout(60000);

    try {
      await page.goto('/auth', { timeout: 10000 });
      await page.getByLabel('Email').fill('pro@example.com');
      await page.getByLabel('Password').fill('password');
      await page.getByRole('button', { name: 'Sign In' }).click();

      await page.waitForURL('/', { timeout: 15000 });
      await page.goto('/analytics', { timeout: 10000 });

      const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
      await page.getByRole('button', { name: 'Download Data' }).click();
      const download = await downloadPromise;

      expect(download.suggestedFilename()).toContain('.pdf');
    } catch (err) {
      console.error('Download session test failed:', err);
      throw err;
    }
  });
});
