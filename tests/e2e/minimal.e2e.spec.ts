import { test, expect } from '@playwright/test';

test('minimal test', async ({ page }) => {
  await page.goto('about:blank');
  await expect(page).toHaveTitle('');
});