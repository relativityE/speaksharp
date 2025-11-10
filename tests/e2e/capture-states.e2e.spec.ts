// tests/e2e/capture-states.e2e.spec.ts
import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';
import fs from 'fs';
import path from 'path';

test.describe('Capture UI States', () => {
  const screenshotsDir = path.join(process.cwd(), 'verification-screenshots');

  test.beforeAll(() => {
    // Ensure screenshots directory exists
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test('capture loading and authenticated states', async ({ page }) => {
    // 1. Capture unauthenticated homepage
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.screenshot({
      path: path.join(screenshotsDir, 'state-01-unauthenticated.png'),
      fullPage: true
    });
    console.log('✅ Captured: Unauthenticated homepage');

    // 2. Try to capture loading skeleton (might be fast!)
    const loadingSkeleton = page.locator('[data-testid="loading-skeleton"]');
    const skeletonCount = await loadingSkeleton.count();
    if (skeletonCount > 0) {
      await page.screenshot({
        path: path.join(screenshotsDir, 'state-02-loading-skeleton.png'),
        fullPage: true
      });
      console.log('✅ Captured: Loading skeleton');
    } else {
      console.log('⚠️  Loading skeleton not visible (loaded too fast)');
    }

    // 3. Perform login
    await programmaticLogin(page);

    // 4. Capture authenticated homepage
    await page.screenshot({
      path: path.join(screenshotsDir, 'state-03-authenticated-home.png'),
      fullPage: true
    });
    console.log('✅ Captured: Authenticated homepage');

    // 5. Navigate to Analytics page and capture
    await page.goto('/analytics');
    await expect(page.getByTestId('dashboard-heading')).toBeVisible({ timeout: 15000 });
    await page.screenshot({
      path: path.join(screenshotsDir, 'state-04-analytics-page.png'),
      fullPage: true
    });
    console.log('✅ Captured: Analytics page');
  });
});
