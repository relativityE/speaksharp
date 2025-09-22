// tests/e2e/basic.e2e.spec.ts
import { test, expect } from '@playwright/test';
import { loginUser } from './helpers';
import { TEST_USER_FREE } from '../constants';

test.describe('Basic Environment Verification (fast-fail)', () => {
  test('should load the homepage and have the correct title', async ({ page }) => {
    console.log('[smoke] Starting test...');

    // --- Step 1: Login ---
    console.time('[smoke] loginUser');
    await loginUser(page, TEST_USER_FREE.email, TEST_USER_FREE.password);
    console.timeEnd('[smoke] loginUser');

    // --- Step 2: Navigate ---
    console.time('[smoke] page.goto');
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 10_000 });
    console.timeEnd('[smoke] page.goto');

    console.log('[smoke] Current URL after goto:', page.url());

    // --- Step 3: Title Check ---
    console.time('[smoke] toHaveTitle');
    await expect(page).toHaveTitle(/SpeakSharp/, { timeout: 7_000 });
    console.timeEnd('[smoke] toHaveTitle');

    console.log('[smoke] Raw title:', await page.title());
    console.log('[smoke] Finished smoke test.');
  });
});
