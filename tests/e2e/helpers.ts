import { Page, Response, test as base, expect } from '@playwright/test';
import { Session } from '@supabase/supabase-js';
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

export async function programmaticLogin(page: Page, user: MockUser) {
  const mockSession: Session = {
    access_token: `mock-access-token-for-${user.id}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `mock-refresh-token-for-${user.id}`,
    user: {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      app_metadata: {
        provider: 'email',
      },
      user_metadata: {
        subscription_status: user.subscription_status,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };

  await page.goto('/');
  await page.evaluate((session) => {
    window.__setSupabaseSession(session);
  }, mockSession as any); // Use 'as any' to bypass serialization issues with complex types in evaluate

  await page.reload({ waitUntil: 'domcontentloaded' });
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