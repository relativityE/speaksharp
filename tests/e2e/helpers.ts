// tests/e2e/helpers.ts
/**
 * This file contains E2E test helper functions for Playwright-based E2E tests.
 * Uses Playwright route interception for network mocking (replacing MSW).
 */

import { type Page, expect } from '@playwright/test';
import {
  MOCK_TRANSCRIPTS,
} from './fixtures/mockData';
import { MOCK_SESSION } from '../../backend/supabase/functions/_shared/test-fixtures';
import logger from '../../frontend/src/lib/logger';

// 1. Unified E2E Window interface (consolidated from various files)
declare global {
  interface Window {
    // 🚀 Deterministic Test Environment (Unified Namespace)
    __APP_TEST_ENV__?: import('../../tests/types/e2eConfig').E2EConfig;
    
    // Readiness state flags
    __APP_READY_STATE__?: {
      boot: boolean;
      layout: boolean;
      auth: boolean;
      analytics: boolean;
      stt: boolean;
      timestamps: Record<string, number>;
    };
    mswReady?: boolean;
    __E2E_EMPTY_SESSIONS__?: boolean;
    dispatchMockTranscript?: (text: string, isFinal?: boolean) => void;
    // 🛡️ Enhanced E2E Signals (Strictly Typed)
    __e2eProfileLoaded__?: boolean;
    // Allow dynamic sticky flags [__e2e_EVENT_fired__]
    [key: `__e2e_${string}_fired__`]: boolean | undefined;
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
export const debugLog = (msg: string, ...args: unknown[]) => {
  if (process.env.E2E_DEBUG === 'true') {
    if (args.length > 0) {
      logger.info({ args }, `[E2E] ${msg}`);
    } else {
      logger.info(`[E2E] ${msg}`);
    }
  }
};

/**
 * Wrap async wait operations with debug logging.
 * Logs when a wait starts, ends, or fails with precise timing and line numbers.
 */
export async function debugWait<T>(
  description: string,
  promise: Promise<T>,
  debugMode: boolean = process.env.E2E_DEBUG === 'true'
): Promise<T> {
  const stack = new Error().stack;
  const callerLine = stack?.split('\n')[2] || '';
  const callerMatch = callerLine.match(/\/([^/]+):(\d+):\d+\)?$/);
  const callerFile = callerMatch?.[1] || 'unknown';
  const callerLineNum = callerMatch?.[2] || '?';

  if (debugMode) {
    logger.info(`[WAIT START] ${description}`);
  }

  const startTime = Date.now();
  try {
    const result = await promise;
    const duration = Date.now() - startTime;
    if (duration > 5000) {
      logger.warn({ duration, callerFile, callerLineNum }, `⚠️ [WAIT SLOW] ${description}`);
    } else if (debugMode) {
      logger.info(`[WAIT END] ${description} resolved after ${duration}ms`);
    }
    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ err, duration, callerFile, callerLineNum }, `[WAIT FAIL] ${description} failed`);
    throw err;
  }
}

/**
 * Common delays for flaky UI transitions
 */
export const DELAYS = {
  SHORT: 500,
  MEDIUM: 1500,
  LONG: 3000,
};

/**
 * Setup browser console logging for E2E tests with buffering for diagnostics
 */
export function setupBrowserLogging(page: Page) {
  const logs: { type: string; text: string; timestamp: number }[] = [];
  (page as Page & { _e2e_logs: unknown })._e2e_logs = logs;

  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    logs.push({ type, text, timestamp: Date.now() });
    
    // Keep buffer manageable
    if (logs.length > 100) logs.shift();

    let prefix = '';
    let suffix = '';

    if (type === 'error') {
      prefix = ANSI.RED;
      suffix = ANSI.RESET;
    } else if (type === 'warning') {
      prefix = ANSI.YELLOW;
      suffix = ANSI.RESET;
    }

    // Node-based logging for CI (Level mapping: 10=trace, 20=debug, 30=info, 40=warn, 50=error)
    const isCI = !!process.env.CI;
    const configLogLevel = process.env.LOG_LEVEL || 'info';
    
    // Simple priority map for filtering
    const priorities: Record<string, number> = { debug: 20, info: 30, warn: 40, error: 50 };
    const threshold = priorities[configLogLevel] || 30;
    const currentLevel = priorities[type === 'warning' ? 'warn' : type] || 30;

    if (currentLevel >= threshold) {
      if (type === 'error') {
        logger.error(`${prefix}[BROWSER ${type}] ${text}${suffix}`);
      } else if (type === 'warning') {
        logger.warn(`${prefix}[BROWSER ${type}] ${text}${suffix}`);
      } else if (!isCI || configLogLevel === 'debug' || configLogLevel === 'info') {
        logger.info(`${prefix}[BROWSER ${type}] ${text}${suffix}`);
      }
    }
  });

  page.on('pageerror', (err) => {
    logger.error({ err }, `${ANSI.RED}${ANSI.BOLD}[BROWSER PAGE ERROR] ${err.message}${ANSI.RESET}`);
  });
}

/**
 * Setup network activity tracking for diagnostics
 */
export function setupNetworkTracking(page: Page) {
  const pendingRequests = new Set<string>();
  (page as Page & { _pending_requests: unknown })._pending_requests = pendingRequests;

  page.on('request', (request) => {
    if (request.resourceType() === 'fetch' || request.resourceType() === 'xhr') {
      pendingRequests.add(`${request.method()} ${request.url()}`);
    }
  });

  page.on('requestfinished', (_request) => {
    pendingRequests.delete(`${_request.method()} ${_request.url()}`);
  });

  page.on('requestfailed', (_request) => {
    pendingRequests.delete(`${_request.method()} ${_request.url()}`);
  });
}

/**
 * Navigate to a specific route with stability checks
 */
export async function goToPublicRoute(page: Page, route: string) {
  debugLog(`Navigating to ${route}`);
  await page.goto(route);
  await page.waitForLoadState('networkidle');
  // Ensure we're actually on the right page
  await expect(page).toHaveURL(new RegExp(route));
}

// Keep navigateToRoute as an alias if needed, or just use one
export async function navigateToRoute(page: Page, route: string, options: { waitForMocks?: boolean } = {}) {
  const { waitForMocks = true } = options;
  debugLog(`Navigating to ${route} (waitForMocks: ${waitForMocks})`);
  await page.goto(route);
  if (waitForMocks) {
    await page.waitForLoadState('networkidle');
  }
  // Ensure we're actually on the right page
  await expect(page).toHaveURL(new RegExp(route));
}

/**
 * Perform a real login on production/staging infrastructure using credentials.
 * Used exclusively by Canary tests.
 */
export async function canaryLogin(page: Page, email?: string, password?: string) {
  if (!email || !password) {
    throw new Error('[CANARY] Missing credentials for canaryLogin');
  }

  debugLog(`[CANARY] Performing real login for ${email}...`);
  await page.goto('/log-in');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  // Wait for the critical path readiness indicator
  await expect(page).toHaveURL(/\/(session|analytics)/, { timeout: 30000 });
  await page.waitForSelector('[data-app-ready]', { timeout: 30000 });
}

/**
 * Explicit hydration guard: wait for root and essential app state
 */
export async function waitForApp(page: Page) {
  await page.goto('/');
  // Enhanced SPA hydration barrier
  await page.waitForSelector('#root', { timeout: 15000 });
  await page.waitForSelector('[data-app-ready]', { timeout: 30000 });
}

/**
 * Wait for the deterministic application readiness contract
 */
export async function waitForAppReady(page: Page, options: { needsAnalytics?: boolean; needsSTT?: boolean; timeout?: number } = {}) {
  const { needsAnalytics = false, needsSTT = false, timeout = 60000 } = options;
  try {
    // Primary SPA hydration barrier
    await page.waitForSelector('[data-app-ready]', { timeout });
    
    await debugWait(
      `Readiness Contract (${needsAnalytics ? 'Full + Analytics' : 'Base'}${needsSTT ? ' + STT' : ''})`,
      page.waitForFunction((opts) => {
        const s = window.__APP_READY_STATE__;
        if (!s) return false;
        
        // 🚀 Support for new Clean Pipeline string signal
        if (s === 'READY') return true;
        
        // Handle legacy object-based state or intermediate booting strings
        if (typeof s === 'string') return false; 
        
        const baseReady = s.boot && s.layout && s.auth;
        const analyticsReady = opts.needsAnalytics ? s.analytics : true;
        const sttReady = opts.needsSTT ? s.stt : true;
        return baseReady && analyticsReady && sttReady;
      }, { needsAnalytics, needsSTT }, { timeout })
    );
  } catch (err) {
    // Diagnostic Dump
    const state = await page.evaluate(() => ({
      readyState: window.__APP_READY_STATE__,
      testEnv: window.__APP_TEST_ENV__,
      url: window.location.href,
      localStorage: Object.keys(window.localStorage)
    }));
    
    const logs = (page as Page & { _e2e_logs?: { type: string; text: string }[] })._e2e_logs || [];
    const pendingRequests = Array.from((page as Page & { _pending_requests?: Set<string> })._pending_requests || []);
    
    logger.error({ 
      state, 
      pendingRequests,
      recentLogs: logs.slice(-20),
      error: err instanceof Error ? err.message : String(err) 
    }, '🔴 [CI] Readiness contract timeout. Diagnostic dump:');
    
    throw err;
  }
}

/**
 * Programmatic login by injecting a session directly into localStorage.
 * Bypasses the UI for speed and reliability.
 * Uses Playwright route interception for network mocking.
 */
export async function programmaticLoginWithRoutes(
  page: Page,
  options: {
    projectRef?: string;
    supabaseUrl?: string;
    userType?: 'free' | 'pro';
    needsAnalytics?: boolean;
    emptySessions?: boolean;
  } = {}
) {
  const { projectRef: optRef, supabaseUrl: optUrl, userType = 'free', needsAnalytics = false, emptySessions = false } = options;

  // 1. Determine project ref
  let projectRef = optRef || 'yxlapjuovrsvjswkwnrk'; // Default to staging
  const supabaseUrl = optUrl || process.env.VITE_SUPABASE_URL;

  if (supabaseUrl && !optRef) {
    try {
      const urlObj = new URL(supabaseUrl);
      projectRef = urlObj.hostname.split('.')[0];
    } catch (err) {
      logger.warn({ err }, '[API Auth] Could not parse Supabase URL for project ref, falling back to default injection.');
    }
  }

  const localStorageKey = `sb-${projectRef}-auth-token`;

  // 2. Prepare mock session with correct user data
  const session = { ...MOCK_SESSION };
  session.user.app_metadata.subscription_status = userType;
  if (userType === 'pro') {
    session.user.email = 'pro@example.com';
  }

  // 3. Setup Mocks & Inject init script
  const { setupE2EMocks } = await import('./mock-routes');
  await setupE2EMocks(page, { userType, emptySessions });

  // 4. Diagnostics & Console Guards
  setupBrowserLogging(page);
  setupNetworkTracking(page);

  await page.addInitScript(({ key, sessionData, emptySessions }) => {
    window.__E2E_EMPTY_SESSIONS__ = emptySessions;
    window.__APP_TEST_ENV__ = {
      context: 'e2e',
      testMode: true,
      isE2E: true,
      useMockSession: true,
      emptySessions: emptySessions,
      stt: {
        mode: 'mock',
        loadTimeout: 45000,
        mocks: { private: 'auto' }
      },
      progress: { mode: 'auto' },
      auth: { mode: 'mock' },
      limits: { mode: 'mock' },
      registry: { overrides: new Map() },
      exposedState: {},
      debug: true,
      mswReady: true
    };

    // RESET READY STATE BEFORE NAVIGATION
    window.__APP_READY_STATE__ = {
      boot: false,
      layout: false,
      auth: false,
      analytics: false,
      stt: false,
      timestamps: { reset: performance.now() }
    };

    // Atomic injection into localStorage before app starts
    window.localStorage.setItem(key, JSON.stringify(sessionData));
  }, { key: localStorageKey, sessionData: session, emptySessions });

  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      // Fail on specific forbidden patterns
      if (text.includes('Unexpected token <') || text.includes('Attempted to overwrite recording state')) {
        throw new Error(`[CI GUARD] Forbidden browser error: ${text}`);
      }
    }
  });

  // 5. Navigate
  await page.goto('/');

  // 6. Wait for single deterministic signal
  await waitForAppReady(page, { needsAnalytics });

  return session;
}

/**
 * Simulate audio transcription by calling the internal dispatch function
 */
export async function simulateTranscription(page: Page, text: string, isFinal: boolean = true) {
  await page.evaluate(({ transcription, final }) => {
    const win = window as unknown as { dispatchMockTranscript?: (text: string, isFinal: boolean) => void; logger?: { error: (msg: string) => void } };
    if (typeof win.dispatchMockTranscript === 'function') {
      win.dispatchMockTranscript(transcription, final);
    } else {
      // Browser-side logging
      if (win.logger) {
        win.logger.error('[E2E Helper] window.dispatchMockTranscript is not defined!');
      }
    }
  }, { transcription: text, final: isFinal });
}

/**
 * Attaches a listener to the page to log transcript events
 */
export function attachLiveTranscript(page: Page) {
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[Transcription]')) {
      logger.info(`[LIVE TRANSCRIPT] ${text}`);
    }
  });
}

/**
 * Mocks a live transcript sequence
 */
export async function mockLiveTranscript(page: Page, transcriptLines: string[] | keyof typeof MOCK_TRANSCRIPTS) {
  let lines: string[];
  if (Array.isArray(transcriptLines)) {
    lines = transcriptLines;
  } else {
    // Fallback for legacy usage if any
    lines = MOCK_TRANSCRIPTS as unknown as string[];
  }

  for (const line of lines) {
    await simulateTranscription(page, line, false);
    await page.waitForTimeout(100);
  }
  await simulateTranscription(page, lines[lines.length - 1], true);
}

/**
 * Select a specific transcription engine from the UI
 */
export async function selectTranscriptionEngine(page: Page, mode: 'native' | 'cloud' | 'private') {
  const select = page.getByTestId('stt-mode-select');
  await select.click();
  const option = page.getByTestId(`stt-option-${mode}`);
  await option.click();
}

/**
 * Wait for a specific toast message to appear
 */
export async function waitForToast(page: Page, message: string | RegExp) {
  const toast = page.locator('li[data-sonner-toast]');
  if (typeof message === 'string') {
    await expect(toast).toContainText(message);
  } else {
    await expect(toast).toHaveText(message);
  }
}

/**
 * Wait for a specific E2E event to be dispatched by the app
 */
export async function waitForE2EEvent(page: Page, eventName: string, timeout: number = 10000) {
  await page.waitForFunction((name) => {
    return window[`__e2e_${name}_fired__`] === true;
  }, eventName, { timeout });
}

/**
 * Capture a screenshot of the current page for UI state verification
 */
export async function capturePage(page: Page, filename: string, folder: string = 'screenshots') {
  const path = `tests/e2e/screenshots/${folder}/${filename}`;
  await page.screenshot({ path, fullPage: true });
  debugLog(`Screenshot saved to ${path}`);
}
