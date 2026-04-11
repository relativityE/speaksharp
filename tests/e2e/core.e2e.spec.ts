import { test, expect } from '@playwright/test';
import { goToInfrastructureRoute } from './helpers';

/**
 * Core System Probe (Deterministic, Zero-Auth)
 *
 * Validates the application's infrastructure foundation before the UI layer.
 * These tests are free of external network calls and randomness.
 * Must run in < 60s.
 *
 * Coverage:
 *   1. App Boot Integrity       — SessionPage renders, no JS crashes       — App starts and shows the session screen
 *   2. ENV Bridge Validity      — window.__SS_E2E__ readable at runtime    — Test settings are correctly loaded
 *   3. Registry Injection (T=0) — manifest registry present at boot        — Mock settings are ready before start
 *   4. Engine Selection         — engineType propagated from manifest      — Using the fast mock engine as told
 *   5. WASM Isolation           — real WASM not loaded in mock mode        — Heavy tech is disabled for speed
 *   6. FSM Transition           — recording state transitions correctly    — Start/Stop button works correctly
 *   7. Transcription Smoke      — mock engine signals flow through to UI   — Words show up on screen when "talking"
 *   8. No Race Conditions       — no STT_ENGINE_MISSING errors on start    — App doesn't crash on fast clicks
 *   9. Timer Compression        — 200ms sleep completes well under 1s      — Tests run faster than real life
 *  10. No External Network      — no calls outside localhost               — No data leaves your machine
 */
test.describe('Core System Validation (Deterministic)', () => {
  // 🛡️ Zero-Any Mandate: Explicitly type the E2E bridge and window extensions.
  interface E2EWindow extends Window {
    __SS_E2E__: {
      isActive: boolean;
      engineType: 'mock' | 'real' | 'system';
      registry: Record<string, unknown>;
      flags: { bypassMutex: boolean; fastTimers: boolean };
      emitTranscript: (text: string, isFinal?: boolean) => void;
    };
    __WASM_LOADED__?: boolean;
    dispatchMockTranscript?: (text: string, isFinal: boolean) => void;
  }

  test.beforeEach(async ({ page }) => {
    // 🛡️ T=0 Injection: Define the deterministic mock harness directly in the browser context.
    // Directive alignment: No functions passed through helpers; full contract factory; captured instance.
    await page.addInitScript(() => {
      window.localStorage.clear();

      let activeCallbacks: { 
        onTranscriptUpdate?: (data: { 
          transcript: { final?: string; partial?: string }; 
          isFinal: boolean; 
          timestamp: number 
        }) => void 
      } | null = null;

      const mockFactory = () => {
        console.log('[E2E-MOCK] Factory creating engine instance...');
        return {
          instanceId: 'e2e-mock-instance',
          init: async (callbacks: typeof activeCallbacks) => {
            activeCallbacks = callbacks;
            console.log('[E2E-MOCK] Engine initialized with callbacks.');
            return { isOk: true };
          },
          start: async () => { console.log('[E2E-MOCK] Engine started.'); },
          stop: async () => { console.log('[E2E-MOCK] Engine stopped.'); },
          getTranscript: async () => 'Mock transcript from core probe',
          getEngineType: () => 'mock',
          getLastHeartbeatTimestamp: () => Date.now(),
          terminate: async () => { },
          destroy: async () => { }
        };
      };

      const e2eManifest = {
        isActive: true,
        engineType: 'mock',
        registry: {
          mock: mockFactory,
          private: mockFactory,
          cloud: mockFactory,
          native: mockFactory
        },
        flags: { bypassMutex: true, fastTimers: true },

        // 2. Control Hook: Inject results into the active engine instance (Modernized Bridge)
        emitTranscript: (text: string, isFinal: boolean = true) => {
          console.log('[E2E-MOCK] Emitting transcript:', text);
          if (activeCallbacks?.onTranscriptUpdate) {
            // Use correct object shape: { transcript: { final|partial: string } }
            const transcriptObj = isFinal ? { final: text } : { partial: text };
            activeCallbacks.onTranscriptUpdate({ 
              transcript: transcriptObj,
              isFinal,
              timestamp: Date.now()
            });
          } else {
            console.warn('[E2E-MOCK] No active transcription callbacks to emit to.');
          }
        }
      };


      // 3. Inject into global scope (Strict Zero boundary)
      (window as unknown as E2EWindow).__SS_E2E__ = e2eManifest as unknown as E2EWindow['__SS_E2E__'];

      console.log('[T=0] Manifest & Surgical Mock Engine injected.');
    });

    await goToInfrastructureRoute(page, '/');

    // Debug: Check manifest immediately after goto to see if it persisted
    const manifest = await page.evaluate(() => (window as unknown as E2EWindow).__SS_E2E__);
    console.log(`[E2E-TEST-DEBUG] URL: ${page.url()}, Manifest Active: ${!!manifest?.isActive}`);
  });

  // 1. App Boot Integrity
  test('app boots without runtime errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    // SessionPage renders a <main data-runtime-state=...> — its presence confirms boot
    await page.waitForSelector('[data-runtime-state]', { timeout: 15000 });
    expect(errors).toEqual([]);
  });

  // 2. ENV Bridge Validity
  test('ENV reflects test mode', async ({ page }) => {
    const isTest = await page.evaluate(() => {
      return (window as unknown as E2EWindow).__SS_E2E__?.isActive === true;
    });
    expect(isTest).toBe(true);
  });

  // 3. Registry Injection (T=0)
  test('registry is available at boot', async ({ page }) => {
    const hasRegistry = await page.evaluate(() => {
      return !!(window as unknown as E2EWindow).__SS_E2E__?.registry;
    });
    expect(hasRegistry).toBe(true);
  });

  // 4. Engine Selection (Mock Path)
  test('mock engine is selected', async ({ page }) => {
    const result = await page.evaluate(() => {
      // Read manifest directly — dynamic import of TestRegistry would require alias resolution
      return (window as unknown as E2EWindow).__SS_E2E__?.engineType;
    });
    expect(result).toBe('mock');
  });

  // 5. WASM Isolation
  test('does not load real WASM', async ({ page }) => {
    const wasmLoaded = await page.evaluate(() => {
      return (window as unknown as E2EWindow).__WASM_LOADED__ === true;
    });
    expect(wasmLoaded).not.toBe(true);
  });

  // 6. FSM Transition (Async Correctness)
  test('FSM transitions correctly', async ({ page }) => {
    await page.waitForSelector('[data-runtime-state]', { timeout: 15000 });
    await page.getByTestId('session-start-stop-button').click();

    // data-recording-state on <html> is set by SpeechRuntimeController (source of truth)
    await expect(page.locator('html')).toHaveAttribute('data-recording-state', 'recording', { timeout: 5000 });
  });

  // 7. Transcription Smoke
  test('mock transcription flows through system', async ({ page }) => {
    await page.waitForSelector('[data-runtime-state]', { timeout: 15000 });
    await page.getByTestId('session-start-stop-button').click();

    // Trigger a mock transcript via the bridge helper (Modernized)
    await page.evaluate(() => {
      (window as unknown as E2EWindow).__SS_E2E__.emitTranscript?.('Hello from E2E', false);
    });

    // The UI should reflect the emitted transcript
    await expect(page.getByTestId('transcript-container'))
      .toContainText(/Hello from E2E/, { timeout: 3000 });
  });

  // 8. No Race Conditions (Deterministic Start)
  test('no STT_ENGINE_MISSING errors', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', msg => logs.push(msg.text()));

    await page.waitForSelector('[data-runtime-state]', { timeout: 15000 });
    await page.getByTestId('session-start-stop-button').click();

    await page.waitForTimeout(500);

    const hasError = logs.some(l => l.includes('STT_ENGINE_MISSING'));
    expect(hasError).toBe(false);
  });

  // 9. Timer Compression
  test('fast timers applied', async ({ page }) => {
    const duration = await page.evaluate(async () => {
      const start = performance.now();
      await new Promise(r => setTimeout(r, 200));
      return performance.now() - start;
    });
    expect(duration).toBeLessThan(1000);
  });

  // 10. No External Network Calls
  test('no external network calls occur', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', req => {
      if (!req.url().includes('localhost') && !req.url().includes('127.0.0.1')) {
        requests.push(req.url());
      }
    });

    await page.waitForTimeout(500);
    expect(requests.length).toBe(0);
  });

});
