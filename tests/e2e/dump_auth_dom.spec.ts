import { test, expect } from '@playwright/test';
import * as fs from 'fs';

test('should dump DOM before and after authentication', async ({ page }) => {
  // 1. Navigate to auth page and dump "before" DOM
  await page.goto('/auth');
  const beforeAuthDom = await page.content();
  fs.writeFileSync('before-auth-dom.html', beforeAuthDom);

  // 2. Perform sign-up
  await page.getByTestId('mode-toggle').click();
  const email = `test-dom-dump-${Date.now()}@example.com`;
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill('password123');
  await page.getByTestId('sign-up-submit').click();

  // 3. Wait for navigation to the homepage
  await page.waitForURL('/');

  // 4. Dump "after" DOM
  const afterAuthDom = await page.content();
  fs.writeFileSync('after-auth-dom.html', afterAuthDom);
});
