import { Page, Response, test as base, expect } from '@playwright/test';
import { stubThirdParties } from './sdkStubs';
import fs from 'fs';

export async function dumpPageState(page: Page, name = 'failure') {
  try {
    const html = await page.content();
    const htmlPath = `debug-${name}.html`;
    const screenshotPath = `debug-${name}.png`;

    fs.writeFileSync(htmlPath, html);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Saved debug state to ${htmlPath} and ${screenshotPath}`);

    // Read the screenshot back and log it as base64 as a workaround for artifact deletion
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
export const test = base.extend<{ sandboxPage: void }>({
  sandboxPage: [
    async ({ page }, use) => {
      await page.goto('about:blank');
      await stubThirdParties(page);
      await use();
    },
    { auto: true },
  ],
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

  // Navigate to the auth page and wait for it to be idle
  await page.goto('/auth', { timeout: 10000 });
  await page.waitForLoadState('networkidle');

  // Get handles to the form elements
  const emailField = page.getByLabel('Email');
  const passwordField = page.getByLabel('Password');
  const signInButton = page.getByRole('button', { name: 'Sign In' });

  // Assert that the form elements are visible before interacting with them
  await expect(emailField).toBeVisible();
  await expect(passwordField).toBeVisible();
  await expect(signInButton).toBeVisible();

  // Fill in the login form
  await emailField.fill(email);
  await passwordField.fill(password);

  // Assert that the sign-in button is enabled after filling the form
  await expect(signInButton).toBeEnabled();

  // Create a promise to wait for the auth response. This is more reliable
  // than waiting for a specific URL, as the auth flow may involve redirects.
  const responsePromise = page.waitForResponse(
    (res: Response) =>
      (res.url().includes('/auth/v1/token') || res.url().includes('/auth/v1/user')) &&
      res.status() === 200,
    { timeout: 10000 }
  );

  // Click the sign-in button and wait for the auth response
  await signInButton.click();
  try {
    await responsePromise;
  } catch {
    console.warn('Did not receive an auth response within the timeout. This may be okay if the page redirects quickly.');
  }

  // After login, wait for the page to redirect to the root and be idle
  try {
    await page.waitForURL('/', { timeout: 15000 });
    console.log('Successfully redirected to home page after login.');
  } catch (err) {
    console.error(`Login redirect failed! Current URL: ${page.url()}`);
    await page.screenshot({ path: `debug-login-redirect-failed-${email.replace(/[@.]/g, '-')}.png` });
    throw err;
  }

  await page.waitForLoadState('networkidle');
}

/**
 * A helper to start a practice session.
 * @param page The Playwright Page object.
 * @param buttonText The text of the button to start the session.
 */
export async function startSession(page: Page, buttonText = 'Start For Free') {
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

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const html = await page.content();
    console.error(`[E2E DEBUG] Page HTML at failure:\n${html.slice(0, 500)}...`);
    await page.screenshot({ path: `debug-${testInfo.title.replace(/\s+/g, '-')}.png` });
  }
});
