// tests/e2e/helpers.ts
/**
 * This file contains E2E test helper functions for Playwright-based E2E tests.
 * Uses Playwright route interception for network mocking (replacing MSW).
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
  // Special handling for msw-ready: use polling which is more robust than event listeners
  // because it handles all race conditions (flag set before/during/after) automatically.
  if (eventName === 'e2e:msw-ready') {
    await page.waitForFunction(() => window.mswReady === true, undefined, { timeout: 30000 });
    return;
  }

  // Fallback for other events (though we mainly use this for msw-ready)
  await page.evaluate((name) => {
    return new Promise<void>((resolve) => {
      window.addEventListener(name, () => resolve(), { once: true });
    });
  }, eventName);
}

/* ---------------------------------------------
   Supabase Mock + Programmatic Login
---------------------------------------------- */

/**
 * @deprecated Use programmaticLoginWithRoutes instead.
 * This legacy function uses page.goto which can cause issues.
 * Kept for backwards compatibility only.
 */
export async function programmaticLogin(
  page: Page
): Promise<void> {
  console.log('[E2E DEBUG] Starting programmaticLogin');

  // 1. Set flag before navigation (AuthProvider checks this)
  // Using idempotency guard to prevent script stacking from multiple calls
  console.log('[E2E DEBUG] Setting __E2E_MOCK_SESSION__ flag');
  await page.addInitScript(() => {
    // Guard against multiple script additions (addInitScript stacks cumulatively)
    if (!(window as unknown as { __E2E_MOCK_SESSION__: boolean }).__E2E_MOCK_SESSION__) {
      (window as unknown as { __E2E_MOCK_SESSION__: boolean }).__E2E_MOCK_SESSION__ = true;
    }
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
  await page.goto('/auth/signin');
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
      if (typeof window.dispatchMockTranscript === 'function') {
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
    state: authState === 'unauth' ? 'visible' : 'attached', // Sign-out may be in collapsed nav
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

/* ---------------------------------------------
   PLAYWRIGHT ROUTE-BASED AUTHENTICATION
   (Full MSW migration to Playwright routes)
---------------------------------------------- */

import { setupE2EMocks, injectMockSession } from './mock-routes';

/**
 * Login using Playwright route interception instead of MSW.
 * 
 * ## Why This Exists
 * MSW service workers are browser-global and race in parallel shards.
 * Playwright routes are per-page and eliminate this class of flakiness.
 * 
 * ## How It Works
 * 1. Sets up Playwright route interception BEFORE navigation
 * 2. Routes intercept at browser network layer (higher priority than SW)
 * 3. No dependency on service worker registration
 */
export async function programmaticLoginWithRoutes(page: Page): Promise<void> {
  console.log('[E2E] Starting programmaticLoginWithRoutes (no MSW dependency)');

  // 1. Setup Playwright routes BEFORE navigation
  await setupE2EMocks(page);
  console.log('[E2E] Playwright routes configured');

  // 2. Set mock session flag
  await page.addInitScript(() => {
    (window as unknown as { __E2E_MOCK_SESSION__: boolean }).__E2E_MOCK_SESSION__ = true;
  });

  // 3. Navigate to app
  console.log('[E2E] Navigating to /');
  await page.goto('/');

  // 4. Wait for React to mount (no MSW wait needed!)
  console.log('[E2E] Waiting for React to mount...');
  await page.waitForSelector('#root > *', { timeout: 15000 });

  // 5. Inject mock session
  await injectMockSession(page);

  // 6. Reload to pick up the session
  await page.reload();

  // 7. Wait for authenticated state
  console.log('[E2E] Waiting for app-main...');
  await page.waitForSelector('[data-testid="app-main"]', { timeout: 30000 });

  // 8. Wait for profile loaded
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return !!(window as any).__e2eProfileLoaded;
  }, null, { timeout: 15000 });

  console.log('[E2E] ✅ Logged in via Playwright routes');
}

/**
 * Performs a real login on a live environment.
 * This is exempt from the page.goto() lint rule because it's in helpers.ts.
 */
export async function liveLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(password);
  await page.getByTestId('sign-in-button').click();
  await page.waitForURL('/', { timeout: 15000 });
}

/**
 * Navigate to a public route (no authentication required).
 * This is the approved pattern for E2E tests navigating to public pages
 * without triggering the no-restricted-syntax lint rule.
 * 
 * @param page - Playwright page object
 * @param route - Public route to navigate to (e.g., '/auth/signup', '/pricing')
 */
export async function goToPublicRoute(page: Page, route: string): Promise<void> {
  console.log(`[E2E] Navigating to public route: ${route}`);
  await page.goto(route);
  await page.waitForLoadState('domcontentloaded');
}
