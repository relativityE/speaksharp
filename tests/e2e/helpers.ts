// tests/e2e/helpers.ts (Fixed)
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

/**
 * Programmatically logs in a user by setting auth session in localStorage
 *
 * @param page - Playwright Page instance
 * @param email - User email address
 * @param password - User password (optional, not used for mock auth but kept for API consistency)
 */
export async function programmaticLogin(page: Page, email: string, password?: string) {
    const user: MockUser = {
        id: `${email.split('@')[0]}-id`,
        email,
        subscription_status: email.includes('pro') ? 'pro' : 'free',
    };

    await test.step(`Programmatic login for ${user.email}`, async () => {
        // 1. Go to the page and wait for MSW to be ready. This prevents race conditions.
        await page.goto('/');
        await waitForMSW(page);

        // 2. Get the Supabase URL to determine the correct localStorage key
        const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://localhost:54321';

        // 3. Inject the session into localStorage with the correct key format
        await page.evaluate(({ mockUser, supabaseUrl }) => {
            // Extract project reference from Supabase URL
            // Format: https://PROJECT_REF.supabase.co or http://localhost:54321
            const urlParts = supabaseUrl.split('//')[1]?.split('.') || ['local'];
            const projectRef = urlParts[0].replace(':', '-'); // Handle localhost:54321 case

            // Supabase v2 uses this key format
            const storageKey = `sb-${projectRef}-auth-token`;

            const session = {
                access_token: "fake-access-token",
                refresh_token: "fake-refresh-token",
                expires_in: 3600,
                expires_at: Math.floor(Date.now() / 1000) + 3600,
                token_type: "bearer",
                user: {
                    id: mockUser.id,
                    aud: "authenticated",
                    role: "authenticated",
                    email: mockUser.email,
                    email_confirmed_at: new Date().toISOString(),
                    phone: "",
                    confirmed_at: new Date().toISOString(),
                    last_sign_in_at: new Date().toISOString(),
                    app_metadata: { provider: "email", providers: ["email"] },
                    user_metadata: {},
                    identities: [],
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }
            };

            // Store with correct key format
            window.localStorage.setItem(storageKey, JSON.stringify(session));

            // Also set legacy format for backwards compatibility (if your app checks both)
            window.localStorage.setItem('supabase.auth.token', JSON.stringify({
                currentSession: session,
                expiresAt: session.expires_at
            }));

            // Set flag for E2E mock session
            (window as any).__E2E_MOCK_SESSION__ = true;

            console.log(`[E2E] Set auth session with key: ${storageKey}`);
        }, { mockUser: user, supabaseUrl });

        // 4. Reload the page for the AuthProvider to pick up the session from localStorage.
        await page.reload({ waitUntil: 'networkidle' });
        await waitForMSW(page); // Wait again after reload for safety

        // 5. Wait for authentication to complete
        // Give the app a moment to process the session
        await page.waitForTimeout(1000);

        // 6. Verify we're authenticated by checking for sign out button
        await expect(page.getByRole('button', { name: /sign out/i }))
            .toBeVisible({ timeout: 15000 });
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
