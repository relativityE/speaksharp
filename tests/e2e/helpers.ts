// tests/e2e/helpers.ts
import { test as base, expect, Page, Response } from '@playwright/test';
import fs from 'fs';
import { AuthPage } from './poms/authPage.pom';

declare global {
  interface Window {
    mswReady: Promise<any>;
    __USER__: MockUser;
    __E2E_MOCK_SESSION__: boolean;
  }
}

// ---------------------------------
// MSW Readiness Helper
// ---------------------------------
export async function waitForMSW(page: Page) {
  await page.waitForFunction(() => window.mswReady, { timeout: 10000 }).catch(async (err) => {
    console.error(`[HELPER] MSW readiness timeout: ${err.message}`);
    const consoleLogs = await page.evaluate(() => (window as any).consoleLog);
    console.error('[HELPER] Browser console logs:', consoleLogs);
    throw err;
  });
}

// ---------------------------------
// Custom Test Fixture
// ---------------------------------
export const test = base.extend<{
  authPage: AuthPage;
}>({
  authPage: async ({ page }, use) => {
    await use(new AuthPage(page));
  },
});

export { expect };
export type { Response, Page };

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

export async function programmaticLogin(page: Page, email: string, password?: string) {
    const user: MockUser = {
        id: `${email.split('@')[0]}-id`,
        email,
        subscription_status: email.includes('pro') ? 'pro' : 'free',
    };

    await test.step(`Programmatic login for ${user.email}`, async () => {
        await page.addInitScript((mockUser) => {
            window.localStorage.setItem('supabase.auth.token', JSON.stringify({
                "currentSession": {
                    "provider_token": null,
                    "provider_refresh_token": null,
                    "access_token": "fake-access-token",
                    "refresh_token": "fake-refresh-token",
                    "expires_in": 3600,
                    "expires_at": Math.floor(Date.now() / 1000) + 3600,
                    "user": {
                        "id": mockUser.id,
                        "aud": "authenticated",
                        "role": "authenticated",
                        "email": mockUser.email,
                        "email_confirmed_at": new Date().toISOString(),
                        "phone": "",
                        "confirmed_at": new Date().toISOString(),
                        "last_sign_in_at": new Date().toISOString(),
                        "app_metadata": {
                            "provider": "email",
                            "providers": [
                                "email"
                            ]
                        },
                        "user_metadata": {},
                        "identities": [],
                        "created_at": new Date().toISOString(),
                        "updated_at": new Date().toISOString()
                    }
                },
                "expiresAt": Math.floor(Date.now() / 1000) + 3600
            }));
            window.localStorage.setItem('user-profile-cache', JSON.stringify({
                id: mockUser.id,
                email: mockUser.email,
                subscription_status: mockUser.subscription_status || 'free',
            }));
            (window as any).__E2E_MOCK_SESSION__ = true;
        }, user);

        await page.goto('/');
        await waitForMSW(page);
        await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible({ timeout: 10000 });
    });
}

export async function stubThirdParties(page: Page) {
    await page.route(/https:\/\/.*\.sentry\.io\/.*/, route => route.abort());
    await page.route(/https:\/\/.*\.posthog\.com\/.*/, route => route.abort());
}

base.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const sanitizedTitle = testInfo.title.replace(/\s+/g, '-').toLowerCase();
    console.warn(`[E2E DEBUG] Test failed: ${testInfo.title}. Dumping page state...`);
    await dumpPageState(page, sanitizedTitle);
  }
});