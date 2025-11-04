import { test } from '@playwright/test';
import { programmaticLogin } from './helpers';

test.describe('Screenshot Capture', () => {
  test('capture current UI states', async ({ page }) => {
    // Just navigate, wait, and capture - no validation
    console.log('[Screenshot] Loading homepage...');
    await page.goto('/');
    await page.waitForTimeout(2000); // Give it a moment to render
    console.log('[Screenshot] Capturing unauthenticated state...');
    await page.screenshot({
      path: 'tests/test-results/screenshots/LANDING-PAGE-unauthenticated.png',
      fullPage: true
    });
    console.log('✅ Screenshot saved: LANDING-PAGE-unauthenticated.png');

    // Login and capture
    console.log('[Screenshot] Performing programmatic login...');
    await programmaticLogin(page);
    console.log('✅ Login complete');
    console.log('[Screenshot] Capturing authenticated state...');
    await page.screenshot({
      path: 'tests/test-results/screenshots/LANDING-PAGE-authenticated.png',
      fullPage: true
    });
    console.log('✅ Screenshot saved: LANDING-PAGE-authenticated.png');
  });
});
