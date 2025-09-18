import { Page, Response, test as base, expect } from '@playwright/test';
import { stubThirdParties } from './sdkStubs';
import fs from 'fs';
import { AuthPage } from './poms/authPage.pom';

export async function dumpPageState(page: Page, name = 'failure') {
  try {
    const html = await page.content();
    const htmlPath = `debug-${name}.html`;
    const screenshotPath = `debug-${name}.png`;

    fs.writeFileSync(htmlPath, html);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Saved debug state to ${htmlPath} and ${screenshotPath}`);

    if (fs.existsSync(screenshotPath)) {
      const screenshotContent = fs.readFileSync(screenshotPath, { encoding: 'base64' });
      console.log(`--- DEBUG_SCREENSHOT_BASE64_START_${name} ---`);
      console.log(screenshotContent);
      console.log(`--- DEBUG_SCREENSHOT_BASE64_END_${name} ---`);
    }

  } catch (err) {
    console.error('Failed to dump page state', err);
  }
}

// Extend the base test object with our sandboxed page fixture
export const test = base.extend<{
  sandboxPage: void;
  authPage: AuthPage;
}>({
  sandboxPage: [
    async ({ page }, use) => {
      await page.goto('about:blank');
      await stubThirdParties(page);
      await use();
    },
    { auto: true },
  ],
  authPage: async ({ page }, use) => {
    await use(new AuthPage(page));
  },
});

export { expect };

// Re-exporting Response type for convenience in tests
export type { Response };

/**
 * A helper function to log in a user with a given email and password.
 * It handles navigation to the auth page, filling in credentials,
 * and waiting for the redirect back to the app's home page.
 * @param page The Playwright Page object.
 * @param email The user's email.
 * @param password The user's password.
 */
export async function loginUser(page: Page, email: string, password: string) {
  console.log(`Logging in as: ${email}`);
  const authPage = new AuthPage(page);
  await authPage.goto();
  await authPage.login(email, password);
  await page.waitForURL('/');
  console.log('Successfully redirected to home page after login.');
}

/**
 * A helper to start a practice session.
 * @param page The Playwright Page object.
 * @param buttonText The text or regex of the button to start the session.
 */
export async function startSession(page: Page, buttonText: string | RegExp = 'Start For Free') {
  // Ensure we are at the root of the application before starting a session
  if (!page.url().endsWith('/')) {
    await page.goto('/', { waitUntil: 'networkidle' });
  }

  // First, wait for any loading/connecting indicators to disappear.
  // This makes the test more robust against race conditions where the button
  // is temporarily in a loading state.
  await expect(page.getByRole('button', { name: /Initializing|Connecting/ })).not.toBeVisible({ timeout: 20000 });

  const startButton = page.getByRole('button', { name: buttonText });
  await expect(startButton).toBeVisible({ timeout: 10000 });
  await expect(startButton).toBeEnabled({ timeout: 10000 });
  await startButton.click();

  try {
    // Wait for the URL to change to include '/session/'
    await page.waitForURL(/\/session\//, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
  } catch (err) {
    console.error('Failed to navigate to session page after starting practice.', err);
    await page.screenshot({ path: 'debug-start-session-failed.png' });
    throw err;
  }
}

/**
 * A helper to stop a practice session.
 * @param page The Playwright Page object.
 */
export async function stopSession(page: Page) {
  const stopButton = page.getByRole('button', { name: 'Stop' });
  await expect(stopButton).toBeVisible();
  await expect(stopButton).toBeEnabled();

  // Wait for the API call that saves the session data
  const responsePromise = page.waitForResponse(
    (res: Response) => res.url().includes('/rest/v1/sessions') && res.status() === 201,
    { timeout: 5000 }
  );

  await stopButton.click();

  try {
    await responsePromise;
  } catch {
    console.warn('Session save API did not respond within the timeout. This might be acceptable in some test flows.');
  }

  // After stopping, we expect to see a confirmation
  await expect(page.getByText(/Session [Ee]nded|Analysis/)).toBeVisible({ timeout: 10000 });
}

/**
 * Waits for the user profile to be loaded and asserts upgrade button visibility
 * @param page Playwright Page
 * @param subscription 'free' | 'pro'
 */
export async function expectSubscriptionButton(page: Page, subscription: 'free' | 'pro') {
  // Wait until the profile is loaded in test mode and has the correct subscription status
  await page.waitForFunction(
    (sub) => (window as any).__USER__?.subscription_status === sub,
    subscription
  );

  const upgradeButton = page.getByRole('button', { name: 'Upgrade Now' });

  if (subscription === 'free') {
    await expect(upgradeButton).toBeVisible({ timeout: 10000 });
  } else {
    await expect(upgradeButton).not.toBeVisible({ timeout: 10000 });
    const otherUpgradeButtons = page.locator('button:has-text("Upgrade")');
    await expect(otherUpgradeButtons).toHaveCount(0);
  }
}

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const sanitizedTitle = testInfo.title.replace(/\s+/g, '-').toLowerCase();
    console.warn(`[E2E DEBUG] Test failed: ${testInfo.title}. Dumping page state...`);
    await dumpPageState(page, sanitizedTitle);
  }
});
