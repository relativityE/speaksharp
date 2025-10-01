import { test, expect } from '@playwright/test';

test('dump DOM and console', async ({ page }) => {
  // This test explicitly uses the headless setting from playwright.config.ts
  page.on('console', msg => console.log('[browser]', msg.text()));
  page.on('pageerror', err => console.error('[pageerror]', err));

  // The global setup in `tests/setup/verifyOnlyStepTracker.ts` already navigates to '/'
  // and waits for MSW, so we can proceed directly to getting the content.
  // await page.goto('/'); // This is no longer needed.

  const html = await page.content();
  console.log('DOM length:', html.length);
  const isSignInPresent = html.includes('Sign In');
  console.log('Sign-in button present:', isSignInPresent);
  expect(isSignInPresent).toBe(true);
});