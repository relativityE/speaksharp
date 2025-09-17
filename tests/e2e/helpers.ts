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

    // Log screenshot as base64 for CI
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

// Extend Playwright base test with sandboxPage fixture
export const test = base.extend<{ sandboxPage: void }>({
  sandboxPage: [
    async ({ page }, use) => {
      page.on('console', msg => {
        if (msg.type() === 'error' || msg.type() === 'warn') {
          console.log(`[CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
        }
      });

      page.on('pageerror', err => {
        console.error(`[PAGE ERROR] ${err.message}`, err);
      });

      await page.goto('about:blank');
      await stubThirdParties(page);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
export type { Response };

// Login helper
export async function loginUser(page: Page, email: string, password: string) {
  console.log(`Logging in as: ${email}`);
  await page.goto('/auth', { timeout: 10000 });
  await page.waitForLoadState('networkidle');

  const emailField = page.getByLabel('Email');
  const passwordField = page.getByLabel('Password');
  const signInButton = page.getByRole('button', { name: 'Sign In' });

  await expect(emailField).toBeVisible();
  await expect(passwordField).toBeVisible();
  await expect(signInButton).toBeVisible();

  await emailField.fill(email);
  await passwordField.fill(password);
  await expect(signInButton).toBeEnabled();

  const responsePromise = page.waitForResponse(
    (res: Response) =>
      (res.url().includes('/auth/v1/token') || res.url().includes('/auth/v1/user')) &&
      res.status() === 200,
    { timeout: 10000 }
  );

  await signInButton.click();
  try { await responsePromise; } catch { console.warn('Auth response timeout'); }

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

// Start session helper
export async function startSession(page: Page, buttonText: string | RegExp = 'Start For Free') {
  if (!page.url().endsWith('/')) await page.goto('/', { waitUntil: 'networkidle' });

  // Wait for loading indicators to disappear
  await expect(page.getByRole('button', { name: /Initializing|Connecting/ })).not.toBeVisible({ timeout: 20000 });

  const startButton = page.getByRole('button', { name: buttonText });
  await expect(startButton).toBeVisible({ timeout: 10000 });
  await expect(startButton).toBeEnabled();
  await startButton.click();

  try {
    await page.waitForURL(/\/session\//, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
  } catch (err) {
    console.error('Failed to navigate to session page after starting session.', err);
    await dumpPageState(page, 'start-session-failed');
    throw err;
  }
}

// Stop session helper
export async function stopSession(page: Page) {
  const stopButton = page.getByRole('button', { name: 'Stop' });
  await expect(stopButton).toBeVisible();
  await expect(stopButton).toBeEnabled();

  const responsePromise = page.waitForResponse(
    (res: Response) => res.url().includes('/rest/v1/sessions') && res.status() === 201,
    { timeout: 5000 }
  );

  await stopButton.click();
  try { await responsePromise; } catch { console.warn('Session save API timeout'); }

  await expect(page.getByText(/Session [Ee]nded|Analysis/)).toBeVisible({ timeout: 10000 });
}

// Capture HTML and screenshot on failure
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await dumpPageState(page, testInfo.title.replace(/\s+/g, '-'));
  }
});
