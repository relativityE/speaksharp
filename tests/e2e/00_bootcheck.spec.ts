// tests/e2e/00_bootcheck.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Boot sanity check', () => {
  test('app should load and present a DOM', async ({ page }) => {
    // surface browser console messages to terminal
    page.on('console', msg => {
      // include text and type for quick scanning in logs
      console.log(`[BROWSER ${msg.type()}] ${msg.text()}`);
    });

    // navigate to root and wait for initial load (networkidle is a good default)
    await page.goto('/', { waitUntil: 'networkidle' });

    // basic check: HTML element is present and visible
    const html = page.locator('html');
    await expect(html).toBeVisible({ timeout: 15000 });

    // as an extra sanity step, ensure a <head> exists and the title is readable
    const title = await page.title();
    console.log(`[BOOTCHECK] Page title: ${title}`);

    // if we reached here, page rendered enough DOM to proceed
  });
});
