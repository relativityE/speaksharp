import { test } from '@playwright/test';
import { dumpPageState } from './helpers';

/**
 * Automatically dump page HTML, screenshot, and console logs
 * whenever a test fails or has unexpected status.
 */
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const sanitizedTitle = testInfo.title.replace(/\s+/g, '-').toLowerCase();
    console.warn(`[E2E DEBUG] Test failed: ${testInfo.title}. Dumping page state...`);
    await dumpPageState(page, sanitizedTitle);
  }
});
