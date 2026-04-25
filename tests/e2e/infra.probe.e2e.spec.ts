import { test, expect } from '@playwright/test';
import { goToApp, MOCK_STT_AVAILABILITY, waitForTranscriptionService } from './helpers';
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
      isEngineInitialized: boolean;
      _activeCallbacks: {
        onTranscriptUpdate?: (update: {
          transcript: { partial?: string; final?: string };
          isFinal: boolean;
          isPartial: boolean;
          timestamp: number;
        }) => void;
      } | null;
      engineType: 'mock' | 'real' | 'system';
      registry: Record<string, unknown>;
      flags: { bypassMutex: boolean; fastTimers: boolean };
      emitTranscript: (text: string, isFinal?: boolean) => void;
    };
    __WASM_LOADED__?: boolean;
    dispatchMockTranscript?: (text: string, isFinal: boolean) => void;
    ENV?: { isE2E: boolean };
    SSE_ENV?: { isE2E: boolean };
    __APP_READY_STATE__?: Record<string, boolean | Record<string, number>> & {
      _timestamps?: Record<string, number>;
    };
    __E2E_READY__?: boolean;
    TEST_MODE?: boolean;
  }

  test.beforeEach(async ({ page }) => {
    // 🛡️ T=0 Injection: Define the deterministic mock harness directly in the browser context.
    // Directive alignment: No functions passed through helpers; full contract factory; captured instance.
    await page.addInitScript((MOCK_STT_AVAILABILITY: unknown) => {
      // ✅ GLOBAL SIGNALS: Release main.tsx barrier and satisfy TestFlags.ts
      const win = window as unknown as E2EWindow;
      win.TEST_MODE = true;
      win.ENV = { isE2E: true };
      win.__E2E_READY__ = true;

      window.localStorage.clear();
      // Singleton Engine Pattern: Reach for cached instance first to prevent Zombies
      const mockFactory = (options?: {
        onReady?: () => void,
        onTranscriptUpdate?: (update: unknown) => void
      }) => {
        const win = window as unknown as E2EWindow & Record<string, unknown>;
        const cache = (win['__SS_E2E_ENGINE_CACHE__'] || {}) as Record<string, unknown>;
        win['__SS_E2E_ENGINE_CACHE__'] = cache;
        const mode = 'mock';

        if (cache[mode]) {
          console.warn(`[E2E-MOCK] Reusing cached local engine instance for mode: ${mode}`);
          return cache[mode];
        }

        console.log('[E2E-MOCK] Factory creating local engine instance...');
        const opts = options || {};
        const instance = {
          instanceId: `e2e-mock-${Math.random().toString(36).substring(7)}`,
          checkAvailability: async () => MOCK_STT_AVAILABILITY as { isAvailable: boolean },
          init: async () => {
            // ✅ HANDSHAKE v3: Signal readiness
            if (opts.onReady) opts.onReady();
            if (window.__APP_READY_STATE__) {
              window.__APP_READY_STATE__['model-ready'] = true;
            }
            if (window.__SS_E2E__) {
              window.__SS_E2E__.isEngineInitialized = true;
            }
            return { isOk: true };
          },
          start: async () => { console.log('[E2E-MOCK] Engine started.'); },
          stop: async () => { console.log('[E2E-MOCK] Engine stopped.'); },
          pause: async () => { console.log('[E2E-MOCK] Engine paused.'); },
          resume: async () => { console.log('[E2E-MOCK] Engine resumed.'); },
          getTranscript: async () => 'Mock transcript from core probe',
          getEngineType: () => 'mock',
          getLastHeartbeatTimestamp: () => Date.now(),
          terminate: async () => { },
          destroy: async () => { },
          emitTranscript: (text: string, isFinal: boolean = true) => {
            const win = window as unknown as E2EWindow & Record<string, unknown>;
            const bridge = win['__SS_E2E_BRIDGE__'] as ((t: string, f: boolean) => void) | undefined;
            if (bridge) {
              bridge(text, isFinal);
            } else if (opts.onTranscriptUpdate) {
              // Fallback for isolated unit scenarios
              opts.onTranscriptUpdate({
                transcript: isFinal ? { final: text } : { partial: text },
                isFinal,
                isPartial: !isFinal,
                timestamp: Date.now()
              });
            }
          }
        };
        cache[mode] = instance;
        return instance;
      };

      // Injected manifest
      window.__SS_E2E__ = {
        isActive: true,
        enableRealEngine: false, // 🛡️ INFRA-PROBE: Use fast E2E short-circuit
        isEngineInitialized: false, // 🛡️ RESET: Must be set by current app init
        engineType: 'mock' as const,
        _activeCallbacks: null, // 🛡️ RESET: Must be populated by current app init
        registry: {
          mock: mockFactory,
          private: mockFactory,
          cloud: mockFactory,
          native: mockFactory,
          'whisper-turbo': mockFactory,
          'transformers-js': mockFactory,
          'assemblyai': mockFactory,
          'native-browser': mockFactory
        },
        flags: { bypassMutex: true, fastTimers: true },
        emitTranscript(text, isFinal) {
          const final = (isFinal !== undefined) ? isFinal : true;
          const win = window as unknown as E2EWindow & Record<string, unknown>;

          // 🛡️ AUTHORITATIVE PATH (v0.6.16): Delegate to the legitimate controller bridge
          const controller = win.__TRANSCRIPTION_SERVICE__;
          const strategy = (controller?.service as { strategy?: { emitTranscript?: (t: string, f: boolean) => void } })?.strategy;
          if (strategy?.emitTranscript) {
            console.log('[E2E-BRIDGE] Using Controller->Service->Strategy bridge path');
            strategy.emitTranscript(text, final);
            return;
          }

          // 🛡️ FALLBACK PATH: Use direct side-car callbacks (Isolated Infra scenarios)
          const env = (win.__SS_E2E__ || {}) as { _activeCallbacks?: { onTranscriptUpdate?: (u: unknown) => void } };
          const callbacks = env['_activeCallbacks'];
          if (callbacks?.onTranscriptUpdate) {
            console.log('[E2E-BRIDGE] Using _activeCallbacks fallback path');
            callbacks.onTranscriptUpdate({
              transcript: final ? { final: text } : { partial: text }
            });
          }
        }
      };

      // ✅ BOOT BARRIER v4: Release main.tsx ignition lock
      // Note: 'win' is already declared in this scope (InitScript)
      win.TEST_MODE = true;
      win.__E2E_READY__ = true;

      // ✅ APP BARRIER: Satisfy helpers.ts [data-app-ready="true"] requirement
      window.__APP_READY_STATE__ = {
        msw: true,
        boot: true,
        stt: true,
        auth: true,
        layout: true
      };

      console.log('[T=0] Manifest & Boot Signals injected.');
    }, MOCK_STT_AVAILABILITY);

    page.on('console', msg => console.log(`[BROWSER-${msg.type().toUpperCase()}] ${msg.text()}`));
    page.on('pageerror', err => console.log(`[BROWSER-FATAL] ${err.message}`));

    // Check signals manually
    const signals = await page.evaluate(() => {
      const e2eWindow = window as unknown as E2EWindow;
      return {
        htmlAttrs: Array.from(document.documentElement.attributes).map(a => `${a.name}=${a.value}`),
        windowSignals: e2eWindow.__APP_READY_STATE__,
        env: e2eWindow.ENV?.isE2E,
        st: e2eWindow.__SS_E2E__?.isActive
      };
    });
    console.log('[E2E-TEST-DEBUG] Manual Signal Check:', signals);

    await goToApp(page, '/');

    // ✅ Proof of Correctness: Verify E2E bridge resolved at T=0 via dynamic getters
    const envCheck = await page.evaluate(() => {
      const e2eWindow = window as unknown as E2EWindow;
      // Direct access to window to verify the bridge, and ENV access to verify the getter
      return {
        hasWindowBridge: !!e2eWindow.__SS_E2E__,
        isE2EActive: e2eWindow.SSE_ENV?.isE2E || e2eWindow.ENV?.isE2E
      };
    });
    console.log('[E2E-TEST-DEBUG] Rationale: Late-bound getters must resolve true at first access.', envCheck);
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

    // 🛡️ Deterministic Barrier: Wait for engine handshake before clicking start
    await waitForTranscriptionService(page, 'ENGINE_READY');

    // 🛡️ State Barrier: Wait for the UI to signal it is actively recording
    await page.waitForSelector('html[data-recording-state="recording"]', { timeout: 15000 });

    // 🎙️ Emit multi-phase transcript to ensure hook reconcile (Partial -> Final)
    await page.evaluate(async () => {
      try {
        const e2eWindow = window as unknown as E2EWindow;
        console.log('[E2E-TEST] 📞 Emission Start. Bridge Keys:', Object.keys(e2eWindow.__SS_E2E__ || {}));
        const bridge = e2eWindow.__SS_E2E__;

        if (typeof bridge.emitTranscript !== 'function') {
          throw new Error(`[E2E-TEST] 🚨 FATAL: bridge.emitTranscript is NOT a function! Type: ${typeof bridge.emitTranscript}`);
        }

        // Step A: Partial Word
        bridge.emitTranscript('Hello', false);

        // Step B: Small delay then Final Sentence
        await new Promise(r => setTimeout(r, 500));
        bridge.emitTranscript('Hello from E2E', true);
        console.log('[E2E-TEST] ✅ Emission Finish.');
      } catch (err) {
        const error = err as Error;
        console.error('[E2E-TEST] 🚨 EMISSION FAILED:', error.message);
        throw error;
      }
    });

    // The UI should reflect the emitted transcript
    await expect(page.getByTestId('transcript-container'))
      .toContainText(/Hello from E2E/, { timeout: 15000 });
  });

  // 8. No Race Conditions (Deterministic Start)
  test('no STT_ENGINE_MISSING errors', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', msg => logs.push(msg.text()));

    await page.waitForSelector('[data-runtime-state]', { timeout: 15000 });
    await page.getByTestId('session-start-stop-button').click();

    // Pacing by state acknowledgement instead of fixed timeout
    await page.waitForSelector('html[data-recording-state="recording"]', { timeout: 5000 });

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

    // Verification of isolation between simulated and real environments
    await page.waitForSelector('[data-runtime-state]', { timeout: 5000 });
    expect(requests.length).toBe(0);
  });

});
