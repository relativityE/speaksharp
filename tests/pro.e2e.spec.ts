import { expect, test, Page } from '@playwright/test';
import { stubThirdParties } from './sdkStubs';

async function loginAsPro(page: Page) {
  await page.goto('/auth');

  const emailField = page.getByLabel('Email');
  await expect(emailField).toBeVisible({ timeout: 5000 });
  await emailField.fill('pro@example.com');

  const passwordField = page.getByLabel('Password');
  await expect(passwordField).toBeVisible({ timeout: 5000 });
  await passwordField.fill('password');

  const signInButton = page.getByRole('button', { name: 'Sign In' });
  await expect(signInButton).toBeEnabled();
  await signInButton.click();

  await page.waitForURL('/');
  await page.waitForLoadState('networkidle');
}

test.describe('Pro User Flow', () => {
  test.beforeEach(async ({ page }) => {
    await stubThirdParties(page);
  });

  test('a pro user should not see an upgrade prompt', async ({ page }) => {
    await loginAsPro(page);

    // The main page for a pro user should not have any 'upgrade' buttons
    const upgradeButton = page.getByRole('button', { name: /Upgrade/i });
    await expect(upgradeButton).not.toBeVisible({ timeout: 2000 });
  });

  test('a pro user can download their session data', async ({ page }) => {
    await loginAsPro(page);

    await page.goto('/analytics');
    await page.waitForLoadState('networkidle');

    const downloadButton = page.getByRole('button', { name: 'Download Data' });
    await expect(downloadButton).toBeVisible();
    await expect(downloadButton).toBeEnabled();

    const downloadPromise = page.waitForEvent('download', { timeout: 5000 });
    await downloadButton.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain('.pdf');
  });
});
