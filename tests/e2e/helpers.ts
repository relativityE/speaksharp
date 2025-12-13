// tests/e2e/helpers.ts
/**
 * This file contains E2E test helper functions including programmaticLogin
 * which uses MSW network mocking instead of window.supabase injection.
 */

import type { Page } from '@playwright/test';
import {
  MOCK_TRANSCRIPTS,
} from './fixtures/mockData';

/**
 * ANSI color codes for terminal output
 */
const ANSI = {
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  BOLD: '\x1b[1m',
  RESET: '\x1b[0m',
};

/**
 * Stream console logs into Playwright with colorized ERROR/WARN output
 * - ERROR messages appear in red bold
 * - WARN messages appear in yellow
 * - Other messages appear normally
 */
export function attachLiveTranscript(page: Page): void {
  page.on('console', (msg) => {
    const type = msg.type().toUpperCase();
    const text = msg.text();

    // Apply color based on message type
    let prefix = '';
    let suffix = '';

    if (type === 'ERROR') {
      prefix = ANSI.RED + ANSI.BOLD;
      suffix = ANSI.RESET;
    } else if (type === 'WARNING' || type === 'WARN') {
      prefix = ANSI.YELLOW;
      suffix = ANSI.RESET;
    }

    console.log(`${prefix}[BROWSER ${type}] ${text}${suffix}`);
  });
}

/**
 * Waits for a custom event dispatched by the E2E bridge
 */
export async function waitForE2EEvent(page: Page, eventName: string): Promise<void> {
  await page.evaluate((name) => {
    return new Promise<void>((resolve) => {
      // If the event has already fired, check fallback flag for mswReady
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (name === 'e2e:msw-ready' && (window as any).mswReady) {
        resolve();
        return;
      }

      window.addEventListener(name, () => resolve(), { once: true });
    });
  }, eventName);
}

/* ---------------------------------------------
   Supabase Mock + Programmatic Login
---------------------------------------------- */

/**
 * Programmatic login using MSW network interception.
 * Sets __E2E_MOCK_SESSION__ flag to trigger mock session injection.
 */
export async function programmaticLogin(
  page: Page
): Promise<void> {
  console.log('[E2E DEBUG] Starting programmaticLogin');

  // 1. Set flag before navigation (AuthProvider checks this)
  console.log('[E2E DEBUG] Setting __E2E_MOCK_SESSION__ flag');
  await page.addInitScript(() => {
    (window as unknown as { __E2E_MOCK_SESSION__: boolean }).__E2E_MOCK_SESSION__ = true;
    // Note: MockSpeechRecognition is provided by e2e-bridge.ts, not here
  });

  // 2. Navigate to app
  console.log('[E2E DEBUG] Navigating to /');
  await page.goto('/');

  // 3. Wait for MSW to be ready (required for network mocking)
  console.log('[E2E DEBUG] Waiting for MSW ready signal');
  await waitForE2EEvent(page, 'e2e:msw-ready');
  console.log('[E2E DEBUG] MSW ready signal received');

  // 4. Wait for app to initialize (app-main indicates auth is complete)
  console.log('[E2E DEBUG] Waiting for app-main element');
  await page.waitForSelector('[data-testid="app-main"]', { timeout: 10000 });
  console.log('[E2E DEBUG] App-main element found');

  // 5. Wait for profile to be loaded (fixes race condition where startButton is disabled during profile loading)
  // AuthProvider dispatches 'e2e-profile-loaded' event when profile fetch completes
  console.log('[E2E DEBUG] Waiting for profile to be loaded');
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return !!(window as any).__e2eProfileLoaded;
  }, null, { timeout: 10000 });
  console.log('[E2E DEBUG] Profile loaded');

  console.log('[E2E] MSW ready, user authenticated via network mocking');
}

/**
 * ⚠️ CRITICAL: Use this instead of page.goto() for protected routes!
 * 
 * Navigate to a protected route using client-side React Router navigation.
 * 
 * ## Why This Exists
 * After `programmaticLogin()`, using `await page.goto('/path')` causes a FULL PAGE RELOAD
 * which destroys the MSW context and mock session, causing tests to fail.
 * 
 * ## ✅ When page.goto() IS Allowed:
 * - Initial navigation BEFORE auth: `await page.goto('/')` in programmaticLogin
 * - Public routes: `await page.goto('/sign-in')`, `await page.goto('/pricing')`
 * 
 * ## ❌ When page.goto() is FORBIDDEN:
 * - AFTER programmaticLogin() for protected routes
 * 
 * ## Anti-Pattern (DO NOT USE):
 * ```typescript
 * await programmaticLogin(page);
 * await page.goto('/analytics'); // ❌ BREAKS MOCKS!
 * ```
 * 
 * ## Correct Pattern:
 * ```typescript
 * await programmaticLogin(page);
 * await navigateToRoute(page, '/analytics'); // ✅ Preserves mocks
 * ```
 * 
 * @param page - Playwright page object
 * @param route - Target route (e.g., '/analytics', '/session')
 * @see https://github.com/[repo]/docs/ARCHITECTURE.md#e2e-anti-pattern
 */
export async function navigateToRoute(page: Page, route: string): Promise<void> {
  console.log(`[E2E DEBUG] Navigating to ${route} using client-side navigation`);

  // Use evaluate to trigger React Router navigation without full page reload
  await page.evaluate((targetRoute) => {
    // React Router uses the browser history API
    window.history.pushState({}, '', targetRoute);
    // Dispatch popstate to notify React Router of the change
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, route);

  // Wait for route change to complete
  await page.waitForURL(`**${route}`, { timeout: 10000 });
  console.log(`[E2E DEBUG] Navigation to ${route} complete`);

  // Wait for MSW to be ready to intercept requests (timing fix)
  // This gives the service worker time to catch up after navigation
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return !!(window as any).mswReady;
  }, null, { timeout: 5000 });
  console.log(`[E2E DEBUG] MSW ready confirmed after navigation`);
}

/**
 * User type for real authentication testing
 */
export type UserType = 'free' | 'pro' | 'test';

/**
 * Programmatic login with real account credentials.
 * Uses factory pattern to support different user types (Free, Pro, Admin).
 * 
 * Environment variables:
 * - E2E_FREE_EMAIL / E2E_FREE_PASSWORD
 * - E2E_PRO_EMAIL / E2E_PRO_PASSWORD
 * - E2E_TEST_EMAIL / E2E_TEST_PASSWORD
 * 
 * @param page - Playwright page object
 * @param userType - Type of user to login as ('free' | 'pro' | 'test')
 * @throws Error if credentials not configured for the specified user type
 */
export async function programmaticLoginAs(page: Page, userType: UserType): Promise<void> {
  // Get credentials based on user type
  const envPrefix = userType.toUpperCase();
  const email = process.env[`E2E_${envPrefix}_EMAIL`];
  const password = process.env[`E2E_${envPrefix}_PASSWORD`];

  // Graceful error if credentials not configured
  if (!email || !password) {
    const errorMsg = `${userType.charAt(0).toUpperCase() + userType.slice(1)} account credentials not configured. Set E2E_${envPrefix}_EMAIL and E2E_${envPrefix}_PASSWORD environment variables.`;
    console.warn(`⚠️  ${errorMsg}`);
    throw new Error(errorMsg);
  }

  console.log(`[${userType.toUpperCase()} Login] Authenticating with:`, email);

  // Navigate to sign-in
  await page.goto('/sign-in');
  await page.waitForLoadState('domcontentloaded');

  // Fill credentials
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(password);

  // Submit
  await page.getByTestId('sign-in-button').click();

  // Wait for redirect
  await page.waitForURL('/', { timeout: 15000 });

  // Verify authentication succeeded
  await page.waitForSelector('[data-testid="app-main"]', { timeout: 10000 });

  // For Pro users, verify badge appears
  if (userType === 'pro') {
    const badge = page.locator('[data-testid="pro-badge"]');
    await badge.waitFor({ state: 'visible', timeout: 10000 });
  }

  console.log(`[${userType.toUpperCase()} Login] ✅ Successfully authenticated`);
}

/**
 * Convenience wrapper for Pro user login.
 * Requires E2E_PRO_EMAIL and E2E_PRO_PASSWORD environment variables.
 */
export async function programmaticLoginPro(page: Page): Promise<void> {
  return programmaticLoginAs(page, 'pro');
}

/**
 * Convenience wrapper for Free user login.
 * Requires E2E_FREE_EMAIL and E2E_FREE_PASSWORD environment variables.
 */
export async function programmaticLoginFree(page: Page): Promise<void> {
  return programmaticLoginAs(page, 'free');
}

/**
 * Convenience wrapper for Test user login.
 * Requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD environment variables.
 */
export async function programmaticLoginTest(page: Page): Promise<void> {
  return programmaticLoginAs(page, 'test');
}

/* ---------------------------------------------
 * Navigation Helpers
 * --------------------------------------------- */

/* ---------------------------------------------
   Transcript simulation (original feature)
---------------------------------------------- */
export async function mockLiveTranscript(
  page: Page,
  lines: readonly string[] = MOCK_TRANSCRIPTS,
  delayMs = 200
): Promise<void> {
  for (const line of lines) {
    await page.evaluate((text) => {
      // @ts-expect-error - dispatchMockTranscript is added by e2e-bridge.ts at runtime
      if (typeof window.dispatchMockTranscript === 'function') {
        // @ts-expect-error - dispatchMockTranscript is added by e2e-bridge.ts at runtime
        window.dispatchMockTranscript(text, true);
      } else {
        console.error('[E2E Helper] window.dispatchMockTranscript is not defined!');
      }
    }, line);

    await page.waitForTimeout(delayMs);
  }
}

/* ---------------------------------------------
   Screenshot helper
---------------------------------------------- */

export async function capturePage(
  page: Page,
  filename: string,
  authState: 'unauth' | 'auth' = 'unauth'
): Promise<void> {
  const selector =
    authState === 'unauth'
      ? 'a:has-text("Sign In")'
      : '[data-testid="nav-sign-out-button"]';

  await page.waitForSelector(selector, {
    state: 'visible',
    timeout: 20000,
  });

  // Wait for DOM to be ready (networkidle can hang due to polling)
  await page.waitForLoadState('domcontentloaded');

  // Give extra time for CSS animations and layout rendering
  await page.waitForTimeout(1000);

  await page.screenshot({
    path: `screenshots/${filename}`,
    fullPage: true,
  });

  console.log(`[E2E CAPTURE] Saved to screenshots/${filename}`);
}
