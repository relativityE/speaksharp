// tests/e2e/login-debug.spec.ts
import { test, expect } from '@playwright/test';
import fs from 'fs';

test('login page DOM dump and console inspection', async ({ page }) => {
  console.log('--- Navigating to auth page and clearing localStorage ---');

  // Navigate to the page first to establish an origin.
  await page.goto('/auth');

  // Clear localStorage to ensure a clean session state for the test.
  await page.evaluate(() => localStorage.clear());

  // Reload the page to ensure the AuthProvider re-evaluates with a clean slate.
  await page.reload();

  // Capture console messages
  const consoleMessages: string[] = [];
  page.on('console', msg => {
    const t = `[Browser Console] ${msg.type()} ${msg.text()}`;
    consoleMessages.push(t);
    console.log(t);
  });

  // Wait for the page to be stable and for MSW to be ready
  await page.waitForLoadState('networkidle');
  try {
    await page.waitForFunction(() => window.mswReady, null, { timeout: 15000 });
    console.log('MSW is ready.');
  } catch (error) {
    console.error('Timed out waiting for MSW to become ready.');
  }

  // Programmatically check for login elements
  const emailInput = page.locator('[data-testid="email-input"]');
  const passwordInput = page.locator('[data-testid="password-input"]');
  const signInButton = page.locator('[data-testid="sign-in-submit"]');

  const emailExists = await emailInput.count() > 0;
  const passwordExists = await passwordInput.count() > 0;
  const signInExists = await signInButton.count() > 0;

  console.log(`Email input exists: ${emailExists}`);
  console.log(`Password input exists: ${passwordExists}`);
  console.log(`Sign-in button exists: ${signInExists}`);

  // Dump full DOM to a file for manual inspection if needed
  const html = await page.content();
  fs.writeFileSync('debug-login-dom.html', html);
  console.log(`Saved debug-login-dom.html with length: ${html.length}`);

  // Log the credentials that would be used
  if (emailExists) {
    console.log('--- Test credentials that would be used ---');
    console.log('Email:', 'free-user@test.com');
    console.log('Password:', 'password123');
  }

  // Assert that the elements are actually present
  await expect(emailInput, 'Email input with data-testid="email-input" should be visible').toBeVisible();
  await expect(passwordInput, 'Password input with data-testid="password-input" should be visible').toBeVisible();
  await expect(signInButton, 'Sign In button with data-testid="sign-in-submit" should be visible').toBeVisible();
});