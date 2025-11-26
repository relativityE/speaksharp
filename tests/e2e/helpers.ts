// tests/e2e/helpers.ts
/**
 * This file contains E2E test helper functions including programmaticLogin
 * which uses MSW network mocking instead of window.supabase injection.
 */

import type { Page } from '@playwright/test';
import {
  MOCK_TRANSCRIPTS,
} from './fixtures/mockData';

/* ---------------------------------------------
   Utilities
---------------------------------------------- */

/**
 * Stream console logs into Playwright (original feature)
 */
export function attachLiveTranscript(page: Page): void {
  page.on('console', (msg) => {
    console.log(`[BROWSER ${msg.type().toUpperCase()}] ${msg.text()}`);
  });
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
  });

  // 2. Navigate to app
  console.log('[E2E DEBUG] Navigating to /');
  await page.goto('/');

  // 3. Wait for MSW to be ready (required for network mocking)
  console.log('[E2E DEBUG] Waiting for MSW ready signal');
  await page.waitForFunction(() => (window as unknown as { mswReady: boolean }).mswReady === true, { timeout: 10000 });
  console.log('[E2E DEBUG] MSW ready signal received');

  // 4. Wait for app to initialize (app-main indicates auth is complete)
  console.log('[E2E DEBUG] Waiting for app-main element');
  await page.waitForSelector('[data-testid="app-main"]', { timeout: 10000 });
  console.log('[E2E DEBUG] App-main element found');

  console.log('[E2E] MSW ready, user authenticated via network mocking');
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
      const panel = document.querySelector(
        '[data-testid="transcript-display"]'
      );
      if (panel) {
        const div = document.createElement('div');
        div.textContent = text;
        panel.appendChild(div);
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
