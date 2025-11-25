import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';
import fs from 'fs';
import path from 'path';

const screenshotDir = 'screenshots';

// Ensure the screenshot directory exists.
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

test.describe('Screenshot Capture', () => {
  test('capture UI states', async ({ page }) => {
    // Capture unauthenticated
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Sign In' }).first()).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotDir, 'unauthenticated-home.png'),
      fullPage: true
    });

    // Perform login
    await programmaticLogin(page);

    // Capture authenticated
    await expect(page.getByTestId('app-main')).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotDir, 'authenticated-home.png'),
      fullPage: true
    });
  });
});
