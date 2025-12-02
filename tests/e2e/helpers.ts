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
  console.log('[E2E DEBUG] Setting __E2E_MOCK_SESSION__ flag and MockSpeechRecognition');
  await page.addInitScript(() => {
    (window as unknown as { __E2E_MOCK_SESSION__: boolean }).__E2E_MOCK_SESSION__ = true;

    // Mock SpeechRecognition API
    class MockSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = 'en-US';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      private _onresult: ((event: any) => void) | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      private _eventQueue: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onerror: ((event: any) => void) | null = null;
      onend: (() => void) | null = null;
      onstart: (() => void) | null = null;

      constructor() {
        console.log('[MockSpeechRecognition] Constructed');

        // Listen for simulation events from the test
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        window.addEventListener('e2e:simulate-transcript', (e: any) => {
          console.log('[MockSpeechRecognition] ⚡ Event received:', e.detail);

          // Construct a mock SpeechRecognitionEvent
          const results = [];
          const resultItem = [
            { transcript: e.detail.transcript.final || e.detail.transcript.partial, confidence: 1.0 }
          ];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (resultItem as any).isFinal = !!e.detail.transcript.final;
          results.push(resultItem);

          const event = {
            resultIndex: 0,
            results: results
          };

          // If onresult is set, call it immediately
          if (this._onresult) {
            console.log('[MockSpeechRecognition] ✅ Calling onresult immediately');
            this._onresult(event);
          } else {
            // Otherwise, queue it for later
            console.log('[MockSpeechRecognition] 📦 Queueing event (onresult not set yet)');
            this._eventQueue.push(event);
          }
        });
      }

      // Getter/setter for onresult to replay queued events
      get onresult() {
        return this._onresult;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set onresult(handler: ((event: any) => void) | null) {
        console.log('[MockSpeechRecognition] onresult handler ASSIGNED', handler ? 'YES' : 'NO');
        this._onresult = handler;

        // Replay any queued events
        if (handler && this._eventQueue.length > 0) {
          console.log(`[MockSpeechRecognition] 🔄 Replaying ${this._eventQueue.length} queued events`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          this._eventQueue.forEach((event: any) => {
            console.log('[MockSpeechRecognition] ↪️ Replaying event:', event);
            handler(event);
          });
          this._eventQueue = [];
        }
      }

      start() { console.log('[MockSpeechRecognition] start() called'); if (this.onstart) this.onstart(); }
      stop() { console.log('[MockSpeechRecognition] stop() called'); if (this.onend) this.onend(); }
      abort() { console.log('[MockSpeechRecognition] abort() called'); if (this.onend) this.onend(); }
    }

    // Inject into window
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).SpeechRecognition = MockSpeechRecognition;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).webkitSpeechRecognition = MockSpeechRecognition;
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
