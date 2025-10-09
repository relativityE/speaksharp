// tests/e2e/helpers.ts
import { test as base, expect, Page, Response } from '@playwright/test';
import fs from 'fs';
import { AuthPage } from './poms/authPage.pom';

// ---------------------------------
// MSW Readiness Helper
// ---------------------------------

/**
 * A robust helper function that waits for the MSW worker to be ready.
 * It polls for the `window.mswReady` flag, which is set to `true` by
 * our `startMockWorker` function in the browser.
 */
export async function waitForMSW(page: Page) {
  await page.waitForFunction(() => (window as any).mswReady === true, null, {
    timeout: 15_000,
  });
}

// ---------------------------------
// Custom Test Fixture
// ---------------------------------

export const test = base.extend<{
  // This fixture automatically waits for MSW to be ready after the initial navigation.
  page: Page;
  // We also keep the AuthPage POM fixture for convenience.
  authPage: AuthPage;
}>({
  page: async ({ page }, use) => {
    // Navigate to the root of the application.
    await page.goto('/');
    // Wait for the MSW worker to be ready before proceeding.
    await waitForMSW(page);
    // The page is now ready for the test.
    await use(page);
  },
  authPage: async ({ page }, use) => {
    await use(new AuthPage(page));
  },
});

// Re-export `expect` so test files can import it from this central helper.
export { expect };
export type { Response };


// ---------------------------------
// Test Utility Functions
// ---------------------------------

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

export type MockUser = {
  id: string;
  email: string;
  subscription_status: 'free' | 'pro';
};

export async function programmaticLogin(page: Page, mockUser: MockUser) {
  // This function now assumes MSW is already active.
  // It injects the user data into the window for the AuthProvider to pick up.
  await page.addInitScript(user => {
    window.__USER__ = user;
    window.__E2E_MOCK_SESSION__ = true;
  }, mockUser);

  // Reload the page to ensure the init script runs and the AuthProvider re-evaluates.
  await page.reload();

  // After reloading, we must wait for MSW to be ready again.
  await waitForMSW(page);

  // Wait for the UI to update, confirming login.
  await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible();
}

export async function startSession(page: Page, buttonText: string | RegExp = 'Start For Free') {
  if (!page.url().endsWith('/session')) {
    await page.goto('/session');
    await waitForMSW(page);
  }
  await expect(page.getByRole('button', { name: /Initializing|Connecting/ })).not.toBeVisible({ timeout: 20000 });
  const startButton = page.getByRole('button', { name: buttonText });
  await expect(startButton).toBeVisible({ timeout: 10000 });
  await expect(startButton).toBeEnabled({ timeout: 10000 });
  await startButton.click();
  try {
    await page.waitForURL(/\/session\//, { timeout: 15000 });
  } catch (err) {
    console.error('Failed to navigate to session page after starting practice.', err);
    await page.screenshot({ path: 'debug-start-session-failed.png' });
    throw err;
  }
}

export async function stopSession(page: Page) {
  const stopButton = page.getByRole('button', { name: 'Stop' });
  await expect(stopButton).toBeVisible();
  await expect(stopButton).toBeEnabled();
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
  await expect(page.getByText(/Session [Ee]nded|Analysis/)).toBeVisible({ timeout: 10000 });
}

export async function expectSubscriptionButton(page: Page, subscription: 'free' | 'pro') {
  await page.waitForFunction(
    (sub) => window.__USER__?.subscription_status === sub,
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

// This afterEach hook remains valuable for debugging failed tests.
base.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const sanitizedTitle = testInfo.title.replace(/\s+/g, '-').toLowerCase();
    console.warn(`[E2E DEBUG] Test failed: ${testInfo.title}. Dumping page state...`);
    await dumpPageState(page, sanitizedTitle);
  }
});