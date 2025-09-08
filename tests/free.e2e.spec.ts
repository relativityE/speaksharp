import { expect, test } from '@playwright/test';
import { stubThirdParties } from './sdkStubs';

test.describe('Free User Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('about:blank');
    await stubThirdParties(page);
  });

  test('a free user sees the upgrade prompt in the sidebar', async ({ page }) => {
    // Log in as a free user
    await page.goto('/auth');
    await page.getByLabel('Email').fill('free@example.com');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL('/');

    // Go to the session page
    await page.goto('/session');

    // The "Upgrade to Pro" button should be visible
    await expect(page.getByRole('button', { name: 'Upgrade Now' })).toBeVisible();
  });

  test('a pro user does not see the upgrade prompt in the sidebar', async ({ page }) => {
    // Log in as a pro user
    await page.goto('/auth');
    await page.getByLabel('Email').fill('pro@example.com');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL('/');

    // Go to the session page
    await page.goto('/session');

    // The "Upgrade to Pro" button should NOT be visible
    await expect(page.getByRole('button', { name: 'Upgrade Now' })).not.toBeVisible();
  });
});
