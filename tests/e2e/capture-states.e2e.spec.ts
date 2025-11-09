// tests/e2e/capture-states.e2e.spec.ts
import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';
import path from 'path';
import fs from 'fs';

test.describe('Screenshot Capture', () => {
  test('capture UI states for verification', async ({ page }) => {
    const screenshotDir = path.join(process.cwd(), 'screenshots');

    // Ensure directory exists
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    // 1. Capture unauthenticated homepage
    console.log('[Screenshot] Navigating to homepage...');
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const screenshotPath1 = path.join(screenshotDir, 'unauthenticated-home.png');
    await page.screenshot({
      path: screenshotPath1,
      fullPage: true
    });
    console.log(`✅ Screenshot saved: ${screenshotPath1}`);

    // 2. Perform login
    console.log('[Screenshot] Performing login...');
    await programmaticLogin(page);

    // 3. Capture authenticated homepage
    const screenshotPath2 = path.join(screenshotDir, 'authenticated-home.png');
    await page.screenshot({
      path: screenshotPath2,
      fullPage: true
    });
    console.log(`✅ Screenshot saved: ${screenshotPath2}`);

    // 4. Capture analytics page (if it exists)
    try {
      await page.goto('/analytics');
      await page.waitForLoadState('networkidle');

      const screenshotPath3 = path.join(screenshotDir, 'analytics-page.png');
      await page.screenshot({
        path: screenshotPath3,
        fullPage: true
      });
      console.log(`✅ Screenshot saved: ${screenshotPath3}`);
    } catch (_e) {
      console.log('⚠️ Analytics page not accessible, skipping');
    }

    // Verify files were created
    expect(fs.existsSync(screenshotPath1)).toBe(true);
    expect(fs.existsSync(screenshotPath2)).toBe(true);
  });
});
