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

export const test = base.extend<{
  sandboxPage: void;
  authPage: AuthPage;
}>({
  sandboxPage: [
    async ({ page }, use) => {
      const logStream = fs.createWriteStream('network.log', { flags: 'w' });
      page.on('request', req => {
        logStream.write(`[Request] ${req.method()} ${req.url()}\\n`);
      });

      await page.goto('about:blank');
      await stubThirdParties(page);
      await use();

      logStream.end();
    },
    { auto: true },
  ],
  authPage: async ({ page }, use) => {
    await use(new AuthPage(page));
  },
});

export { expect };
export type { Response };

export type MockUser = {
  id: string;
  email: string;
  subscription_status: 'free' | 'pro';
};

export async function programmaticLogin(page: Page, mockUser: MockUser) {
  // Inject the mock user directly into the window before the page loads.
  // This is more reliable than setting a flag and waiting for the app to react.
  await page.addInitScript(user => {
    window.__USER__ = user;
    window.__E2E_MOCK_SESSION__ = true; // Keep flag for any legacy checks
  }, mockUser);

  // Intercept the user_profiles call specifically for this test to ensure it returns
  // the correct data, isolating the test from global MSW handlers.
  await page.route('**/rest/v1/user_profiles*', async (route, request) => {
    const url = new URL(request.url());
    const userId = url.searchParams.get('id')?.replace('eq.', '');

    if (userId === mockUser.id) {
      console.log(`[E2E Helper] Intercepted and mocked /user_profiles for user: ${userId}`);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // Ensure the response is a single object, as if from .single()
        body: JSON.stringify({ id: mockUser.id, email: mockUser.email, subscription_status: mockUser.subscription_status }),
      });
    } else {
      // For any other user_profiles request, let it fall back to the global MSW handlers
      console.log(`[E2E Helper] Passing through /user_profiles request for other users.`);
      await route.continue();
    }
  });

  // Navigate to the app's entry point.
  await page.goto('/');

  // Wait for the MSW to be ready before proceeding.
  await page.waitForFunction(() => (window as any).mswReady, null, {
    timeout: 7000,
  });
  // Set a flag for any subsequent checks that might need it.
  await page.evaluate(() => { (window as any).mswIsReady = true; });

  // Wait for the user object to be available on the window.
  await page.waitForFunction(() => !!window.__USER__, null, { timeout: 15000 });

  // Wait for the mocked user_profiles response to ensure the AuthProvider has initialized.
  await page.waitForResponse(resp =>
    resp.url().includes('/user_profiles') && resp.status() === 200,
    { timeout: 5000 }
  );

  const userOnPage = await page.evaluate(() => window.__USER__);
  console.log('[E2E Helper] Logged in as user:', userOnPage);
}

export async function startSession(page: Page, buttonText: string | RegExp = 'Start For Free') {
  if (!page.url().endsWith('/')) {
    await page.goto('/', { waitUntil: 'networkidle' });
  }
  await expect(page.getByRole('button', { name: /Initializing|Connecting/ })).not.toBeVisible({ timeout: 20000 });
  const startButton = page.getByRole('button', { name: buttonText });
  await expect(startButton).toBeVisible({ timeout: 10000 });
  await expect(startButton).toBeEnabled({ timeout: 10000 });
  await startButton.click();
  try {
    await page.waitForURL(/\/session\//, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
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

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const sanitizedTitle = testInfo.title.replace(/\s+/g, '-').toLowerCase();
    console.warn(`[E2E DEBUG] Test failed: ${testInfo.title}. Dumping page state...`);
    await dumpPageState(page, sanitizedTitle);
  }
});