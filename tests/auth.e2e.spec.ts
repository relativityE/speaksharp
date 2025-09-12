// tests/auth.e2e.spec.ts - REFACTORED AND ROBUST
import { expect, test, Page } from '@playwright/test';
import { stubThirdParties } from './sdkStubs';
import path from 'path';
import fs from 'fs';

const SHORT_TIMEOUT = 5000;
const MEDIUM_TIMEOUT = 15000;
const LONG_TIMEOUT = 60000;

// Ensure test-results/e2e-artifacts exists
const artifactDir = path.join(process.cwd(), 'test-results', 'e2e-artifacts');
if (!fs.existsSync(artifactDir)) {
  fs.mkdirSync(artifactDir, { recursive: true });
}

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/auth', { timeout: MEDIUM_TIMEOUT });

  const emailField = page.getByLabel('Email');
  await expect(emailField).toBeVisible({ timeout: SHORT_TIMEOUT });
  await emailField.fill(email);

  const passwordField = page.getByLabel('Password');
  await expect(passwordField).toBeVisible({ timeout: SHORT_TIMEOUT });
  await passwordField.fill(password);

  const signInButton = page.getByRole('button', { name: 'Sign In' });
  await expect(signInButton).toBeVisible({ timeout: SHORT_TIMEOUT });
  await signInButton.click();

  // Wait for redirect to main page
  await page.waitForURL('/', { timeout: MEDIUM_TIMEOUT });
}

test.describe('Authentication Flows', () => {
  test.beforeEach(async ({ page }) => {
    // Start with a blank page
    await page.goto('about:blank');

    // Stub all third-party services BEFORE navigating to the app
    await stubThirdParties(page);

    // Optional verbose logging
    page.on('requestfailed', request => {
      console.log(`[REQUEST FAILED] ${request.url()}: ${request.failure()?.errorText}`);
    });
    page.on('response', response => {
      if (response.status() >= 400) {
        console.log(`[HTTP ERROR] ${response.status()} ${response.url()}`);
      }
    });
  });

  // Capture screenshot on failure
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const filename = path.join(
        artifactDir,
        `${testInfo.title.replace(/\s+/g, '_')}.png`
      );
      await page.screenshot({ path: filename, fullPage: true });
      console.log(`Saved screenshot for failed test: ${filename}`);
    }
  });

  test('a user can sign in and is redirected to the main page', async ({ page }) => {
    test.setTimeout(LONG_TIMEOUT);
    await loginAs(page, 'pro@example.com', 'password');

    await expect(page.getByText('pro@example.com')).toBeVisible({ timeout: SHORT_TIMEOUT });
    await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible({ timeout: SHORT_TIMEOUT });
    await expect(page.getByRole('button', { name: 'Sign In' })).not.toBeVisible({ timeout: 2000 });
  });

  test('a logged-in user is redirected from auth page to root', async ({ page }) => {
    test.setTimeout(LONG_TIMEOUT);

    await loginAs(page, 'free@example.com', 'password');

    await page.goto('/auth', { timeout: MEDIUM_TIMEOUT });

    // Should immediately redirect to root
    await page.waitForURL('/', { timeout: MEDIUM_TIMEOUT });
    await expect(page.getByText('free@example.com')).toBeVisible({ timeout: SHORT_TIMEOUT });
  });
});
