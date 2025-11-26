// tests/e2e/helpers.ts
/**
 * This file merges:
 *  - The agent’s architectural fixes
 *  - The original full-feature helpers.ts (transcript, full DB mock, logs)
 *  - Strict ESLint + TS compatibility (no ts-nocheck)
 */

import type { Page } from '@playwright/test';
import type { Session } from '@supabase/supabase-js';
import {
  MOCK_USER,
  MOCK_USER_PROFILE,
  MOCK_SESSION_KEY,
  MOCK_TRANSCRIPTS,
  MOCK_SESSIONS,
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

export async function programmaticLogin(
  page: Page,
  overrides?: { sessions?: typeof MOCK_SESSIONS | [] }
): Promise<void> {
  // Set flag to inject mock session via e2e-bridge.ts
  await page.addInitScript(() => {
    (window as any).__E2E_MOCK_SESSION__ = true;
  });

  // Navigate to homepage - this triggers MSW initialization
  await page.goto('/');

  // Wait for MSW to be ready
  await page.waitForFunction(() => (window as any).mswReady === true, { timeout: 10000 });

  console.log('[E2E] MSW ready, user authenticated via network mocking');
}

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
