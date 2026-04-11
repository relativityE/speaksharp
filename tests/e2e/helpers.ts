// tests/e2e/helpers.ts
/**
 * This file contains E2E test helper functions for Playwright-based E2E tests.
 * Uses Playwright route interception for network mocking (replacing MSW).
 * 
 * ALIGNED WITH PRESCRIPTIVE MODEL v1.1
 */

import { type Page, expect } from '@playwright/test';
import { setupE2EManifest } from './helpers/setupE2EManifest';
import {
  MOCK_TRANSCRIPTS,
} from './fixtures/mockData';
import { MOCK_SESSION } from '../../backend/supabase/functions/_shared/test-fixtures';
import logger from '../../frontend/src/lib/logger';
// Atomic Readiness Signal Registry (Section 7)

// 1. Unified Readiness Types (Section 7)
export type ReadinessSignal =
  | 'boot'
  | 'layout'
  | 'auth'
  | 'stt'
  | 'msw'
  | 'analytics'
  | 'profile';

export const REQUIRED_GLOBAL: ReadinessSignal[] = [
  'boot',
  'layout',
  'auth',
  'stt',
  'msw',
];

// 2. Infrastructure Helpers
const ANSI = {
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  BOLD: '\x1b[1m',
  RESET: '\x1b[0m',
};

export const debugLog = (msg: string, ...args: unknown[]) => {
  if (process.env.E2E_DEBUG === 'true') {
    if (args.length > 0) {
      logger.info({ args }, `[E2E] ${msg}`);
    } else {
      logger.info(`[E2E] ${msg}`);
    }
  }
};

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

export const DELAYS = {
  SHORT: 500,
  MEDIUM: 1500,
  LONG: 3000,
};

export function setupBrowserLogging(page: Page) {
  const logs: { type: string; text: string; timestamp: number }[] = [];
  (page as Page & { _e2e_logs: unknown })._e2e_logs = logs;

  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    logs.push({ type, text, timestamp: Date.now() });

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

    const isCI = !!process.env.CI;
    const configLogLevel = process.env.LOG_LEVEL || 'info';
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

// 3. Navigation Helpers
export async function goToPublicRoute(page: Page, route: string) {
  debugLog(`Navigating to ${route}`);
  await page.goto(route);

  // 1. BOOT BARRIER: Wait for deterministic app-shell readiness (Registry + Controller + State)
  await page.locator('[data-app-booted="true"]').waitFor({ timeout: 10000 });

  // 2. Wait for route-specific data resolution (Profile, Critical Queries)
  await page.locator('[data-route-ready="true"]').waitFor({ timeout: 10000 });

  // 3. Wait for data hydration (Cluster 4)
  await page.locator('[data-data-ready="true"]').waitFor({ timeout: 10000 });
}

/**
 * Minimal navigation helper for zero-auth infrastructure probes (e.g. core.e2e.spec.ts).
 *
 * Waits ONLY for the app shell to boot ([data-app-booted]). Does not wait for
 * data-route-ready or data-data-ready, which require an authenticated route to resolve.
 * Use this for T=0 infrastructure checks that operate at the window/FSM level.
 *
 * For journey and feature tests that require full auth + data resolution,
 * use goToPublicRoute or programmaticLoginWithRoutes instead.
 */
export async function goToInfrastructureRoute(page: Page, route: string) {
  debugLog(`[INFRA] Navigating to ${route}`);
  await page.goto(route);
  await page.locator('[data-app-booted="true"]').waitFor({ timeout: 10000 });
}

export async function navigateToRoute(page: Page, route: string, options: { waitForMocks?: boolean } = {}) {
  const { waitForMocks = true } = options;
  debugLog(`Navigating to ${route} (waitForMocks: ${waitForMocks})`);
  await page.goto(route);

  // 1. BOOT BARRIER: Wait for deterministic app-shell readiness (Registry + Controller + State)
  await page.locator('[data-app-booted="true"]').waitFor({ timeout: 10000 });

  // 2. Wait for route-specific data resolution (Profile, Critical Queries)
  await page.locator('[data-route-ready="true"]').waitFor({ timeout: 10000 });

  // 3. Wait for data hydration (Cluster 4)
  await page.locator('[data-data-ready="true"]').waitFor({ timeout: 10000 });
}





// 4. Auth & Readiness Helpers (Section 7)
export async function canaryLogin(page: Page, email?: string, password?: string) {
  if (!email || !password) {
    throw new Error('[CANARY] Missing credentials for canaryLogin');
  }

  debugLog(`[CANARY] Performing real login for ${email}...`);
  await page.goto('/log-in');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  await expect(page).toHaveURL(/\/(session|analytics)/, { timeout: 30000 });
  await waitForAppReady(page);
}

export async function waitForApp(page: Page) {
  await page.goto('/');
  await page.waitForSelector('#root', { timeout: 15000 });
  await waitForAppReady(page);
}

function buildPredicate(required: ReadinessSignal[]) {
  return () => {
    const s = (window as unknown as { __APP_READY_STATE__: Record<string, boolean> }).__APP_READY_STATE__;
    if (!s || typeof s !== 'object') return false;
    return required.every(k => s[k] === true);
  };
}

export async function waitForAppReady(page: Page, timeout: number = 30000) {
  debugLog('Awaiting deterministic BOOT BARRIER...');

  // 1. Primary Signal: DOM Attribute (Set by App.tsx after Registry + Controller + First State Commit)
  try {
    await page.waitForSelector('[data-app-booted="true"]', { timeout: timeout / 2 });
    debugLog('App shell ready via data-app-booted barrier');
    return;
  } catch {
    debugLog('data-app-booted barrier not found, falling back to signal polling...');
  }

  // 2. Fallback: Direct Signal Map Polling (Section 7)
  await page.waitForFunction(buildPredicate(REQUIRED_GLOBAL), { timeout: timeout / 2 });
  debugLog('App shell ready via signal map polling');
}

export async function waitForFeature(page: Page, feature: ReadinessSignal, timeout: number = 30000) {
  debugLog(`Waiting for feature readiness: ${feature}`);
  await page.waitForFunction(
    (f) => {
      const s = (window as unknown as { __APP_READY_STATE__: Record<string, boolean> }).__APP_READY_STATE__;
      return s && typeof s === 'object' && s[f] === true;
    },
    feature,
    { timeout }
  );
}

export async function waitForAppAndFeatures(page: Page, features: ReadinessSignal[], timeout: number = 30000) {
  const required = [...REQUIRED_GLOBAL, ...features];
  debugLog(`Waiting for composite readiness: ${required.join(', ')}`);
  await page.waitForFunction(buildPredicate(required), { timeout });
}

export async function dumpReadinessState(page: Page) {
  const state = await page.evaluate(() => (window as unknown as { __APP_READY_STATE__: unknown }).__APP_READY_STATE__);
  logger.info({ state }, '[E2E DEBUG] Readiness State Dump:');
}

/**
 * @deprecated Use waitForFeature(page, 'analytics')
 */
export async function waitForAnalyticsReady(page: Page, timeout: number = 30000) {
  return waitForFeature(page, 'analytics', timeout);
}

export async function programmaticLoginWithRoutes(
  page: Page,
  options: {
    projectRef?: string;
    supabaseUrl?: string;
    userType?: 'free' | 'pro';
    emptySessions?: boolean;
    debug?: boolean;
  } = {}
) {
  const { 
    projectRef: optRef, 
    supabaseUrl: optUrl, 
    userType = 'free', 
    emptySessions = false,
    debug = false
  } = options;
  let projectRef = optRef || 'yxlapjuovrsvjswkwnrk';
  const supabaseUrl = optUrl || process.env.VITE_SUPABASE_URL;

  if (supabaseUrl && !optRef) {
    try {
      const urlObj = new URL(supabaseUrl);
      projectRef = urlObj.hostname.split('.')[0];
    } catch (err) {
      logger.warn({ err }, '[API Auth] Could not parse Supabase URL for project ref.');
    }
  }

  const localStorageKey = `sb-${projectRef}-auth-token`;
  const session = { ...MOCK_SESSION };
  session.user.app_metadata.subscription_status = userType;
  if (userType === 'pro') session.user.email = 'pro@example.com';

  const { setupE2EMocks } = await import('./mock-routes');
  await setupE2EMocks(page, { userType, emptySessions });

  setupBrowserLogging(page);
  setupNetworkTracking(page);

  // Harden:setupE2EManifest now correctly inlines the mock registry in the browser context.
  await setupE2EManifest(page, {
    engineType: userType === 'pro' ? 'real' : 'mock',
    debug: !!debug,
    storage: {
      [localStorageKey]: JSON.stringify(session)
    }
  });

  await page.goto('/');
  await waitForAppReady(page);
  return session;
}

// 5. Simulation Helpers
export async function simulateTranscription(page: Page, text: string, isFinal: boolean = true) {
  await page.evaluate(({ transcription, final }) => {
    // Define bridge interface locally for type-safe access
    interface E2EWindow extends Window {
      __SS_E2E__: {
        isActive: boolean;
        engineType?: 'mock' | 'real' | 'system';
        emitTranscript?: (text: string, isFinal?: boolean) => void;
      };
      dispatchMockTranscript?: (text: string, isFinal: boolean) => void;
    }
    const win = window as unknown as E2EWindow;
    // Modern pattern: window.__SS_E2E__.emitTranscript
    if (win.__SS_E2E__?.emitTranscript) {
      win.__SS_E2E__.emitTranscript(transcription, final);
    } else if (typeof win.dispatchMockTranscript === 'function') {
      win.dispatchMockTranscript(transcription, final);
    }
  }, { transcription: text, final: isFinal });
}

export function attachLiveTranscript(page: Page) {
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[Transcription]')) {
      logger.info(`[LIVE TRANSCRIPT] ${text}`);
    }
  });
}

export async function mockLiveTranscript(page: Page, transcriptLines: string[] | keyof typeof MOCK_TRANSCRIPTS) {
  let lines: string[];
  if (Array.isArray(transcriptLines)) {
    lines = transcriptLines;
  } else {
    lines = MOCK_TRANSCRIPTS as unknown as string[];
  }

  for (const line of lines) {
    await simulateTranscription(page, line, false);
    await page.waitForTimeout(100);
  }
  await simulateTranscription(page, lines[lines.length - 1], true);
}

export async function selectTranscriptionEngine(page: Page, mode: 'native' | 'cloud' | 'private') {
  const select = page.getByTestId('stt-mode-select');
  await select.click();
  const option = page.getByTestId(`stt-option-${mode}`);
  await option.click();
}

export async function waitForToast(page: Page, message: string | RegExp) {
  const toast = page.locator('li[data-sonner-toast]');
  if (typeof message === 'string') {
    await expect(toast).toContainText(message);
  } else {
    await expect(toast).toHaveText(message);
  }
}

export async function waitForE2EEvent(page: Page, eventName: string, timeout: number = 10000) {
  await page.waitForFunction((name) => {
    return (window as unknown as Record<string, boolean | undefined>)[`__e2e_${name}_fired__`] === true;
  }, eventName, { timeout });
}

/**
 * Deterministic Model Readiness Signal
 * Awaits the global data-model-status="ready" signal set by SessionPage.
 */
export async function waitForModelReady(page: Page, timeout: number = 30000) {
  debugLog('Awaiting global data-model-status="ready" signal...');
  await page.waitForFunction(() => {
    return document.documentElement.getAttribute('data-model-status') === 'ready';
  }, { timeout });
  debugLog('STT Model is ready (via data-model-status)');
}

export async function capturePage(page: Page, filename: string, folder: string = 'screenshots') {
  const path = `tests/e2e/screenshots/${folder}/${filename}`;
  await page.screenshot({ path, fullPage: true });
  debugLog(`Screenshot saved to ${path}`);
}
