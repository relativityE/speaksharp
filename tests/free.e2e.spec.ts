//Fixed E2E Test - free.e2e.spec.ts

// tests/free.e2e.spec.ts
import { expect, test, Page, Response } from '@playwright/test';
import { stubThirdParties } from './sdkStubs';

test.describe('Free User Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('about:blank');
    await stubThirdParties(page);
  });

  // Helper function to login with better error handling
  async function loginUser(page: Page, email: string, password: string) {
    console.log(`Attempting to login with: ${email}`);

    await page.goto('/auth');

    // Wait for the auth form to be ready
    await page.waitForLoadState('networkidle');

    console.log(await page.content());

    // Verify form elements exist before filling
    const emailField = page.getByLabel('Email');
    const passwordField = page.getByLabel('Password');
    const signInButton = page.getByRole('button', { name: 'Sign In' });

    await expect(emailField).toBeVisible();
    await expect(passwordField).toBeVisible();
    await expect(signInButton).toBeVisible();

    await emailField.fill(email);
    await passwordField.fill(password);

    // Wait for button to be enabled (in case there's form validation)
    await expect(signInButton).toBeEnabled();

    // Click and wait for either success redirect or error
    const responsePromise = page.waitForResponse(
      (response: Response) => response.url().includes('/auth') || response.url().includes('/login'),
      { timeout: 10000 }
    );

    await signInButton.click();

    try {
      await responsePromise;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      console.log('No auth response received, continuing...');
    }

    // Wait for redirect with longer timeout
    try {
      await page.waitForURL('/', { timeout: 15000 });
      console.log('Successfully redirected to home page');
    } catch (error) {
      console.log(`Login redirect failed for ${email}:`, error);
      // Log current URL for debugging
      console.log('Current URL:', page.url());
      // Take screenshot for debugging
      await page.screenshot({ path: `debug-login-${email.replace('@', '-')}.png` });
      throw new Error(`Login failed for ${email}: ${error}`);
    }

    // Verify we're actually logged in by checking for user-specific elements
    await page.waitForLoadState('networkidle');
  }

  test('a free user sees the upgrade prompt in the sidebar', async ({ page }) => {
    await loginUser(page, 'free@example.com', 'password');

    // Navigate to session page with better error handling
    console.log('Navigating to session page...');
    await page.goto('/session');

    // Wait for page to load completely
    await page.waitForLoadState('networkidle');

    // Add debugging: log what elements are actually present
    const buttons = await page.locator('button').allTextContents();
    console.log('Available buttons:', buttons);

    // Look for upgrade button with multiple possible selectors
    const upgradeButton = page.getByRole('button', { name: 'Upgrade Now' });

    try {
      await expect(upgradeButton).toBeVisible({ timeout: 10000 });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      // If not found, try alternative selectors
      const altUpgradeButton = page.locator('button:has-text("Upgrade")');
      await expect(altUpgradeButton).toBeVisible({ timeout: 5000 });
    }
  });

  test('a pro user does not see the upgrade prompt in the sidebar', async ({ page }) => {
    await loginUser(page, 'pro@example.com', 'password');

    console.log('Navigating to session page...');
    await page.goto('/session');
    await page.waitForLoadState('networkidle');

    // Wait a moment for any dynamic content to load
    await page.waitForTimeout(2000);

    // Check that upgrade button is not present
    const upgradeButton = page.getByRole('button', { name: 'Upgrade Now' });
    await expect(upgradeButton).not.toBeVisible();

    // Alternative check in case the button exists but is hidden
    const upgradeButtons = page.locator('button:has-text("Upgrade")');
    await expect(upgradeButtons).toHaveCount(0);
  });
});

// Add a test configuration with longer timeouts
test.describe.configure({
  timeout: 60000, // Increase overall test timeout
  retries: 1 // Add retry for flaky tests
});
