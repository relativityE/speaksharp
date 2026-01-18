// tests/e2e/helpers.ts
/**
 * This file contains E2E test helper functions for Playwright-based E2E tests.
 * Uses Playwright route interception for network mocking (replacing MSW).
 */

import type { Page } from '@playwright/test';
import {
  MOCK_TRANSCRIPTS,
} from './fixtures/mockData';

// Global window augmentation for E2E bridge
declare global {
  interface Window {
    mswReady?: boolean;
    __e2eProfileLoaded?: boolean;
    dispatchMockTranscript?: (text: string, isFinal?: boolean) => void;
    __E2E_MOCK_SESSION__?: boolean;
    TEST_MODE?: boolean;
  }
}

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
 * Log only if E2E_DEBUG is set
 */
export const debugLog = (...args: unknown[]) => {
  if (process.env.E2E_DEBUG === 'true') {
    console.log('[E2E]', ...args);
  }
};

/**
 * Wrap async wait operations with debug logging.
 * Logs start, end, and duration when E2E_DEBUG=true.
 * Flags waits >5s as slow with stack trace context.
 */
export async function debugWait<T>(description: string, promise: Promise<T>): Promise<T> {
  const debugMode = process.env.E2E_DEBUG === 'true';
  const SLOW_THRESHOLD_MS = 30000; // 30s - align with Playwright timeout

  // Capture call site for slow wait warnings
  const stack = new Error().stack || '';
  const callerLine = stack.split('\n')[2] || ''; // Skip Error + debugWait lines
  const callerMatch = callerLine.match(/at.*\((.*):(\d+):\d+\)/) || callerLine.match(/at (.*):(\d+):\d+/);
  const callerFile = callerMatch?.[1]?.split('/').pop() || 'unknown';
  const callerLineNum = callerMatch?.[2] || '?';

  if (debugMode) {
    console.log(`[WAIT START] ${description}`);
  }

  const startTime = Date.now();
  try {
    const result = await promise;
    const duration = Date.now() - startTime;

    if (duration > SLOW_THRESHOLD_MS) {
      // Always log slow waits, even without E2E_DEBUG
      console.warn(`⚠️ [WAIT SLOW] ${description} took ${duration}ms (${callerFile}:${callerLineNum})`);
    } else if (debugMode) {
      console.log(`[WAIT END] ${description} resolved after ${duration}ms`);
    }

    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`[WAIT FAIL] ${description} failed after ${duration}ms (${callerFile}:${callerLineNum}):`, err);
    throw err;
  }
}

/**
 * Stream console logs into Playwright with colorized ERROR/WARN output.
 * Controlled by E2E_DEBUG environment variable:
 * - E2E_DEBUG=true: All logs shown (ERROR, WARNING, LOG, etc.)
 * - E2E_DEBUG unset: Only ERROR logs shown for cleaner CI output
 */
export function attachLiveTranscript(page: Page): void {
  const debugMode = process.env.E2E_DEBUG === 'true';

  page.on('console', (msg) => {
    const type = msg.type().toUpperCase();
    const text = msg.text();

    // Noise filter: Skip common strings that are non-actionable in E2E
    const NOISE_PATTERNS = [
      /Stripe\.js integrations must use HTTPS/i,
      /The width\(-1\) and height\(-1\) of chart should be greater than 0/i,
      /PostHog.js/i,
      /Surveys/i,
      /Failed to fetch/i,
      /FeatureFlags/i
    ];

    if (NOISE_PATTERNS.some(p => p.test(text))) {
      return;
    }

    // Always show errors and warnings, optionally show other logs
    const isNegative = type === 'ERROR' || type === 'WARNING' || type === 'WARN';
    if (!isNegative && !debugMode) {
      return; // Skip non-negative logs in CI mode (Assert Positives)
    }

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

  page.on('pageerror', (err) => {
    console.log(`${ANSI.RED}${ANSI.BOLD}[BROWSER PAGE ERROR] ${err.message}${ANSI.RESET}`);
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

  // 1. Set flag before navigation (AuthProvider checks this)
  // Using idempotency guard to prevent script stacking from multiple calls
  await page.addInitScript(() => {
    // Guard against multiple script additions (addInitScript stacks cumulatively)
    if (!(window as unknown as { __E2E_MOCK_SESSION__: boolean }).__E2E_MOCK_SESSION__) {
      (window as unknown as { __E2E_MOCK_SESSION__: boolean }).__E2E_MOCK_SESSION__ = true;
    }
  });

  // 2. Navigate to app
  await page.goto('/');

  // 3. Wait for MSW to be ready (required for network mocking)
  await debugWait('MSW Ready', waitForE2EEvent(page, 'e2e:msw-ready'));

  // 4. Wait for app to initialize (app-main indicates auth is complete)
  await debugWait(
    'App Initialize ([data-testid="app-main"])',
    page.waitForSelector('[data-testid="app-main"]', { timeout: 10000 })
  );

  // 5. Wait for profile to be loaded (fixes race condition where startButton is disabled during profile loading)
  // AuthProvider dispatches 'e2e-profile-loaded' event when profile fetch completes
  await debugWait(
    'Profile Loaded (__e2eProfileLoaded)',
    page.waitForFunction(() => {
      return !!window.__e2eProfileLoaded;
    }, null, { timeout: 10000 })
  );
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
export async function navigateToRoute(
  page: Page,
  route: string,
  options: { waitForMocks?: boolean } = {}
): Promise<void> {
  const { waitForMocks = true } = options;
  // Use evaluate to trigger React Router navigation without full page reload
  await page.evaluate((targetRoute) => {
    // React Router uses the browser history API
    window.history.pushState({}, '', targetRoute);
    // Dispatch popstate to notify React Router of the change
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, route);

  // Wait for route change to complete
  await debugWait(
    `Route Change (${route})`,
    page.waitForURL(`**${route}`, { timeout: 10000 })
  );

  if (waitForMocks) {
    // Wait for MSW to be ready to intercept requests (timing fix)
    // This gives the service worker time to catch up after navigation
    await debugWait(
      'MSW Ready (Post-Navigation)',
      page.waitForFunction(() => {
        return !!window.mswReady;
      }, null, { timeout: 5000 })
    );
  }
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

  debugLog(`[${userType.toUpperCase()} Login] Authenticating with:`, email);

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

  debugLog(`[${userType.toUpperCase()} Login] ✅ Successfully authenticated`);
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

  debugLog(`[E2E CAPTURE] Saved to screenshots/${filename}`);
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
export async function programmaticLoginWithRoutes(
  page: Page,
  options: {
    /** Defaults to 'free'. Set to 'pro' for pro feature tests. */
    subscriptionStatus?: 'free' | 'pro';
  } = {}
): Promise<void> {

  // 1. Setup Playwright routes BEFORE navigation
  await setupE2EMocks(page, { subscriptionStatus: options.subscriptionStatus });

  // 2. Set mock session flag, mswReady (for navigateToRoute compat), and force TEST_MODE
  await page.addInitScript(() => {
    interface CustomWindow extends Window {
      __E2E_MOCK_SESSION__: boolean;
      TEST_MODE: boolean;
      mswReady: boolean;
    }
    const win = window as unknown as CustomWindow;
    win.__E2E_MOCK_SESSION__ = true;
    win.TEST_MODE = true; // Force test mode regardless of Vite config
    win.mswReady = true; // Set mswReady for navigateToRoute compatibility (no actual MSW)
  });

  // 3. Navigate to app
  await page.goto('/');

  // 4. Wait for React to mount (no MSW wait needed!)
  await debugWait(
    'React Mount (#root > *)',
    page.waitForSelector('#root > *', { timeout: 15000 })
  );

  // 5. Inject mock session
  await injectMockSession(page);

  // 6. Reload to pick up the session from localStorage
  // NOTE: page.reload() is required because Supabase Auth initializes synchronously on page load
  // and won't detect localStorage changes via storage events after initialization.
  // Route interceptors (setupE2EMocks) persist across reload in Playwright.
  await page.reload();

  // 7. Wait for authenticated state
  // Note: app-main confirms auth is complete. Profile is now fetched via useUserProfile hook (C2 refactor).
  await debugWait(
    'Authenticated State ([data-testid="app-main"])',
    page.waitForSelector('[data-testid="app-main"]', { timeout: 30000 })
  );
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
  debugLog(`[E2E] Navigating to public route: ${route}`);
  await page.goto(route);
  await page.waitForLoadState('domcontentloaded');
}
