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
// Error Detection Helper - FAIL FAST!
// ---------------------------------
export async function checkForAuthErrors(page: Page, context: string) {
  // Common error selectors (add more as you discover them)
  const errorSelectors = [
    '[data-testid="auth-error-message"]',
    '[data-testid="error-message"]',
    '[role="alert"]',
    '.error-message',
    '.auth-error',
    '[class*="error"]',
    '[class*="Error"]'
  ];

  for (const selector of errorSelectors) {
    const errorElement = page.locator(selector);

    if (await errorElement.isVisible({ timeout: 1000 }).catch(() => false)) {
      const errorText = await errorElement.textContent();

      // Dump detailed state for debugging
      await dumpPageState(page, `error-${context}`);

      // Fail loudly with context
      throw new Error(
        `❌ AUTH ERROR DETECTED (${context})\n` +
        `   Selector: ${selector}\n` +
        `   Message: ${errorText}\n` +
        `   Check debug-error-${context}.html for full page state`
      );
    }
  }

  // Check console for errors
  const consoleErrors = await page.evaluate(() => {
    return (window as any).__E2E_CONSOLE_ERRORS__ || [];
  });

  if (consoleErrors.length > 0) {
    console.warn(`⚠️  Console errors detected during ${context}:`, consoleErrors);
  }
}

// ---------------------------------
// Timestamped Logging System
// ---------------------------------
export class TestLogger {
  private logs: Array<{ timestamp: string; level: string; context: string; message: string; data?: any }> = [];
  private testName: string;
  private startTime: number;

  constructor(testName: string) {
    this.testName = testName;
    this.startTime = Date.now();
  }

  private getTimestamp(): string {
    return new Date().toISOString();
  }

  private getElapsed(): string {
    const elapsed = Date.now() - this.startTime;
    return `+${(elapsed / 1000).toFixed(2)}s`;
  }

  info(context: string, message: string, data?: any) {
    const entry = {
      timestamp: this.getTimestamp(),
      elapsed: this.getElapsed(),
      level: 'INFO',
      context,
      message,
      data
    };
    this.logs.push(entry);
    console.log(`[${entry.elapsed}] [INFO] [${context}] ${message}`, data || '');
  }

  warn(context: string, message: string, data?: any) {
    const entry = {
      timestamp: this.getTimestamp(),
      elapsed: this.getElapsed(),
      level: 'WARN',
      context,
      message,
      data
    };
    this.logs.push(entry);
    console.warn(`[${entry.elapsed}] [WARN] [${context}] ${message}`, data || '');
  }

  error(context: string, message: string, data?: any) {
    const entry = {
      timestamp: this.getTimestamp(),
      elapsed: this.getElapsed(),
      level: 'ERROR',
      context,
      message,
      data
    };
    this.logs.push(entry);
    console.error(`[${entry.elapsed}] [ERROR] [${context}] ${message}`, data || '');
  }

  credential(context: string, username: string, password: string, success: boolean) {
    const entry = {
      timestamp: this.getTimestamp(),
      elapsed: this.getElapsed(),
      level: success ? 'INFO' : 'ERROR',
      context,
      message: success ? 'Credentials used (SUCCESS)' : 'Credentials used (FAILED)',
      data: {
        username,
        password: password ? '***' + password.slice(-3) : '(none)',
        passwordLength: password?.length || 0,
        success
      }
    };
    this.logs.push(entry);

    const logFn = success ? console.log : console.error;
    logFn(
      `[${entry.elapsed}] [${entry.level}] [${context}] Credentials:\n` +
      `   Username: ${username}\n` +
      `   Password: ${entry.data.password} (length: ${entry.data.passwordLength})\n` +
      `   Result: ${success ? '✅ SUCCESS' : '❌ FAILED'}`
    );
  }

  saveLogs(filename?: string) {
    const logFile = filename || `test-log-${this.testName.replace(/\s+/g, '-')}-${Date.now()}.json`;
    const logPath = `logs/${logFile}`;

    fs.mkdirSync('logs', { recursive: true });
    fs.writeFileSync(logPath, JSON.stringify({
      testName: this.testName,
      startTime: new Date(this.startTime).toISOString(),
      duration: `${((Date.now() - this.startTime) / 1000).toFixed(2)}s`,
      logs: this.logs
    }, null, 2));

    console.log(`\n📝 Test logs saved to: ${logPath}`);
    return logPath;
  }

  printSummary() {
    const errors = this.logs.filter(l => l.level === 'ERROR');
    const warnings = this.logs.filter(l => l.level === 'WARN');

    console.log('\n========== TEST LOG SUMMARY ==========');
    console.log(`Test: ${this.testName}`);
    console.log(`Duration: ${this.getElapsed()}`);
    console.log(`Total entries: ${this.logs.length}`);
    console.log(`Errors: ${errors.length}`);
    console.log(`Warnings: ${warnings.length}`);

    if (errors.length > 0) {
      console.log('\n❌ ERRORS:');
      errors.forEach(e => {
        console.log(`  [${e.elapsed}] [${e.context}] ${e.message}`);
        if (e.data) console.log(`    Data:`, e.data);
      });
    }

    if (warnings.length > 0) {
      console.log('\n⚠️  WARNINGS:');
      warnings.forEach(w => {
        console.log(`  [${w.elapsed}] [${w.context}] ${w.message}`);
      });
    }
    console.log('======================================\n');
  }
}

// Global logger registry
const testLoggers = new Map<string, TestLogger>();

export function getLogger(testName: string): TestLogger {
  if (!testLoggers.has(testName)) {
    testLoggers.set(testName, new TestLogger(testName));
  }
  return testLoggers.get(testName)!;
}

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

    // Also dump useful runtime state
    const runtimeState = await page.evaluate(() => ({
      url: window.location.href,
      localStorage: Object.keys(localStorage).reduce((acc, key) => {
        acc[key] = localStorage.getItem(key);
        return acc;
      }, {} as Record<string, string | null>),
      cookies: document.cookie,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString()
    }));

    fs.writeFileSync(
      `debug-${name}-state.json`,
      JSON.stringify(runtimeState, null, 2)
    );

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
 * FAILS FAST if authentication errors are detected
 *
 * @param page - Playwright Page instance
 * @param email - User email address
 * @param password - User password (optional, not used for mock auth but kept for API consistency)
 * @param url - The URL to navigate to after logging in (defaults to '/')
 */
export async function programmaticLogin(page: Page, email: string, password?: string, url: string = '/') {
    const user: MockUser = {
        id: `${email.split('@')[0]}-id`,
        email,
        subscription_status: email.includes('pro') ? 'pro' : 'free',
    };

    await test.step(`Programmatic login for ${user.email}`, async () => {
        // 1. Go to the page and wait for MSW to be ready
        await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1000);

        try {
            await waitForMSW(page);
        } catch (err) {
            await dumpPageState(page, 'msw-timeout');
            throw new Error(
                `❌ MSW initialization timeout\n` +
                `   This usually means the service worker didn't start.\n` +
                `   Check debug-msw-timeout.html for details`
            );
        }

        // 2. Get the Supabase URL to determine the correct localStorage key
        const supabaseUrl = process.env.VITE_SUPABASE_URL;

        if (!supabaseUrl) {
            throw new Error(
                `❌ MISSING ENVIRONMENT VARIABLE\n` +
                `   VITE_SUPABASE_URL is not set.\n` +
                `   Check your .env.test file or playwright.config.ts`
            );
        }

        // 3. Now that we are on the correct origin, set the authentication token in localStorage
        await page.evaluate(({ mockUser, supabaseUrl }) => {
            // Extract project reference from Supabase URL
            const urlParts = supabaseUrl.split('//')[1]?.split('.') || ['local'];
            const projectRef = urlParts[0].replace(':', '-');

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

            window.localStorage.setItem(storageKey, JSON.stringify(session));

            // Also set legacy format for backwards compatibility
            window.localStorage.setItem('supabase.auth.token', JSON.stringify({
                currentSession: session,
                expiresAt: session.expires_at
            }));

            // Set flag for E2E mock session
            (window as any).__E2E_MOCK_SESSION__ = true;
        }, { mockUser: user, supabaseUrl: process.env.VITE_SUPABASE_URL });

        // 5. FAIL FAST: Check for any authentication errors IMMEDIATELY
        await checkForAuthErrors(page, 'post-login');

        // 4. Reload the page for the AuthProvider to pick up the session
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1000);
        await waitForMSW(page);

        // 5. FAIL FAST: Check for any authentication errors IMMEDIATELY
        await checkForAuthErrors(page, 'post-login');

        // 6. Wait a moment for React state to update
        await page.waitForTimeout(1000);
    });
}

export async function stubThirdParties(page: Page) {
    await page.route(/https:\/\/.*\.sentry\.io\/.*/, route => route.abort());
    await page.route(/https:\/\/.*\.posthog\.com\/.*/, route => route.abort());
}

// Capture console errors for fail-fast detection
base.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        (window as any).__E2E_CONSOLE_ERRORS__ = [];
        const originalError = console.error;
        console.error = (...args: any[]) => {
            (window as any).__E2E_CONSOLE_ERRORS__.push(args.join(' '));
            originalError.apply(console, args);
        };
    });
});

base.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const sanitizedTitle = testInfo.title.replace(/\s+/g, '-').toLowerCase();
    console.warn(`[E2E DEBUG] Test failed: ${testInfo.title}. Dumping page state...`);
    await dumpPageState(page, sanitizedTitle);
  }
});
