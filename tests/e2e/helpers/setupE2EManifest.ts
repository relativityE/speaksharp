import { type Page } from '@playwright/test';

/**
 * SSE2EManifest — Unified bridge for E2E orchestration.
 */
export interface SSE2EManifest {
  isActive: boolean;
  enableRealEngine?: boolean;
  isEngineInitialized?: boolean;
  engineType?: 'mock' | 'real' | 'system';
  debug?: boolean;
  flags?: Record<string, unknown>;
  registry?: Record<string, unknown>;
  MOCK_STT_AVAILABILITY?: boolean;
  guestStatus?: 'free' | 'basic' | 'pro';
  emitTranscript?: (text: string, isFinal?: boolean) => void;
  onStateChange?: (cb: (state: string) => void) => (() => void) | void;
  destroyService?: () => Promise<void>;
  getFSMState?: () => string;
  startRecording?: () => void;
  stopRecording?: () => void;
  runtimeEventLog?: Array<{ event: string; instanceId: string; timestamp: number }>;
  pushEvent?: (event: string, instanceId: string) => void;
  _activeCallbacks?: {
    onTranscriptUpdate?: (update: {
      transcript: { partial?: string; final?: string };
      isFinal: boolean;
      isPartial: boolean;
      timestamp: number;
    }) => void;
  } | null;
}

/**
 * Minimal interface for the controller to avoid importing the full class.
 */
interface ControllerBridge {
  service?: {
    strategy?: {
      emitTranscript?: (text: string, isFinal: boolean) => void;
    };
    isTerminated: boolean;
  };
}

/**
 * E2EWindow — Extended window for Playwright bridge.
 * 🛡️ We DO NOT extend Window here to avoid type conflicts with global.d.ts definitions.
 */
export interface E2EWindow {
  __SS_E2E__: SSE2EManifest;
  __SS_E2E_ACTIVE_ENGINE__?: unknown;
  __SS_E2E_ENGINE_CACHE__?: Record<string, unknown>;
  __MODEL_CACHED__?: boolean;
  __SS_E2E_BRIDGE__?: {
    emitTranscript: (text: string, isFinal?: boolean) => void;
  };
  __APP_READY_STATE__?: Record<string, boolean>;
  __E2E_READY__?: boolean;
  __E2E_LOG_LEVEL__?: string;
  __E2E_FINISH_DOWNLOAD__?: (() => void) | null;
  __WASM_LOADED__?: boolean;
  dispatchMockTranscript?: (text: string, isFinal: boolean) => void;
  ENV?: { isE2E: boolean };
  SSE_ENV?: { isE2E: boolean };
  TEST_MODE?: boolean;
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  MockPrivateWhisper?: unknown;
  __activeSpeechRecognition?: unknown;
  __e2eBridgeReady__?: boolean;
  __MOCK_PROFILE__?: { subscription_status: string };
  __TRANSCRIPTION_SERVICE__?: ControllerBridge;
  localStorage: Storage;
  location: Location;
  setInterval: (handler: TimerHandler, timeout?: number, ...args: unknown[]) => number;
}

/**
 * setupE2EManifest — Atomic T=0 injection.
 */
export async function setupE2EManifest(
  page: Page,
  config: {
    engineType?: 'mock' | 'real' | 'system';
    enableRealEngine?: boolean;
    flags?: { bypassMutex?: boolean; fastTimers?: boolean };
    debug?: boolean;
    storage?: Record<string, string>;
    userType?: 'free' | 'basic' | 'pro';
  }
) {
  const { storage = {}, userType = 'free', ...manifest } = config;
  
  // 🛡️ Fix 5: Analytics Mock (Mandated Stabilization)
  // Decouples telemetry from UI readiness to prevent network-induced flakiness
  await page.route('**/telemetry/**', route => route.fulfill({ status: 200, body: '{}' }));

  // Some transpiled Playwright init callbacks reference esbuild's __name helper
  // before the callback body executes. Seed it as a global no-op first so
  // browser-side init scripts never fail before the E2E manifest is installed.
  await page.addInitScript(`
    var __name = globalThis.__name || ((target, name) => target);
    globalThis.__name = __name;
  `);

  await page.addInitScript(({ m, s, ut }: { m: unknown; s: Record<string, string>; ut: string }) => {
    // Playwright serializes this callback into the browser. Some TS/esbuild
    // transforms preserve function names by emitting __name(...) calls inside
    // the serialized body, but the helper itself is otherwise outside that
    // body. Keep a local no-op helper so browser init never trips ReferenceError.
    const __name = <T,>(target: T, name: string): T => {
      void name;
      return target;
    };
    void __name;

    // 0. AUTHORITATIVE TIER SIGNAL
    const win = window as unknown as E2EWindow;
    win.__MOCK_PROFILE__ = { 
      subscription_status: ut === 'pro' ? 'pro' : ut === 'basic' ? 'basic' : 'free'
    };

    const localBrowserStorage = s;

    // 1. CLEAR: Strict Zero baseline with Origin Guard
    try {
      if (win.location.origin !== 'null' && win.location.origin !== 'about:blank') {
        win.localStorage.clear();
      }
    } catch (err) {
      console.warn('[E2E] localStorage.clear failed in setupE2EManifest', err);
    }

    // 2. STORAGE: Re-inject tokens
    Object.entries(localBrowserStorage).forEach(([key, val]) => {
      try {
        win.localStorage.setItem(key, val);
      } catch (err) {
        console.warn(`[E2E] localStorage.setItem failed for key ${key}`, err);
      }
    });

    win.__SS_E2E_ENGINE_CACHE__ = win.__SS_E2E_ENGINE_CACHE__ || {};

    const minimalStubFactory = (mode: string) => (opts?: { 
      onReady?: () => void, 
      onTranscriptUpdate?: (update: {
        transcript: { partial?: string; final?: string };
        isFinal: boolean;
        isPartial: boolean;
        timestamp: number;
      }) => void 
    }) => {
      const cache = win.__SS_E2E_ENGINE_CACHE__ || {};
      win.__SS_E2E_ENGINE_CACHE__ = cache;
      if (cache[mode]) return cache[mode];

      const instance = {
        instanceId: `mock-${Math.random().toString(36).slice(2)}`,
        checkAvailability: async () => ({ isAvailable: true }),
        init: async (io?: { onReady?: () => void }) => {
          win.__SS_E2E__.isEngineInitialized = true;
          if (io?.onReady) io.onReady();
          return { isOk: true };
        },
        start: async () => {},
        stop: async () => {},
        pause: async () => {},
        resume: async () => {},
        destroy: async () => {},
        terminate: async () => {},
        getEngineType: () => mode,
        getLastHeartbeatTimestamp: () => Date.now(),
        getTranscript: async () => '[E2E_MOCK]',
        emitTranscript: (text: string, isFinal: boolean = true) => {
          if (opts?.onTranscriptUpdate) {
            opts.onTranscriptUpdate({
              transcript: isFinal ? { final: text } : { partial: text },
              isFinal,
              isPartial: !isFinal,
              timestamp: Date.now()
            });
            return;
          }
          win.__SS_E2E__?._activeCallbacks?.onTranscriptUpdate?.({
            transcript: isFinal ? { final: text } : { partial: text },
            isFinal,
            isPartial: !isFinal,
            timestamp: Date.now()
          });
        }
      };
      cache[mode] = instance;
      return instance;
    };

    const supportEngines = ['mock', 'whisper-turbo', 'transformers-js', 'assemblyai', 'native-browser'];
    const engineRegistry = Object.fromEntries(
        supportEngines.map(id => [id, minimalStubFactory(id)])
    );

    const mCast = m as SSE2EManifest;
    win.__SS_E2E__ = {
      isActive: true,
      enableRealEngine: false,
      MOCK_STT_AVAILABILITY: true,
      guestStatus: ut as 'free' | 'basic' | 'pro',
      ... mCast,
      registry: {
        ...engineRegistry,
        ...(mCast.registry || {})
      }
    };

    win.__SS_E2E_BRIDGE__ = {
      emitTranscript: (text: string, isFinal: boolean = true) => {
        const controller = win.__TRANSCRIPTION_SERVICE__;
        const svc = controller?.service;
        if (svc && !svc.isTerminated) {
          svc.strategy?.emitTranscript?.(text, isFinal);
          return;
        }
        win.__SS_E2E__?._activeCallbacks?.onTranscriptUpdate?.({
          transcript: isFinal ? { final: text } : { partial: text },
          isFinal,
          isPartial: !isFinal,
          timestamp: Date.now()
        });
      }
    };

    win.setInterval(() => {
      if (win.__SS_E2E__ && win.__SS_E2E_BRIDGE__) {
        win.__SS_E2E__.emitTranscript = win.__SS_E2E_BRIDGE__.emitTranscript;
      }
    }, 50);

    const t0 = performance.now();
    // Seed only the mock-layer readiness that this init script owns.
    // The app readiness key is `app` and is set by frontend/src/main.tsx after mount.
    win.__APP_READY_STATE__ = { msw: true };
    win.__E2E_READY__ = true;
    win.TEST_MODE = true;
    
    // Stamp the boot duration once the script finishes its T=0 setup
    // 🛡️ Safe-wait for document.documentElement if called too early in addInitScript
    const stampDuration = () => {
      if (document.documentElement) {
        const duration = (performance.now() - t0).toFixed(2);
        document.documentElement.setAttribute('data-boot-duration-ms', duration);
        console.log(`[E2E] Boot telemetry stamped: ${duration}ms`);
      } else {
        setTimeout(stampDuration, 10);
      }
    };
    stampDuration();
  }, { m: manifest, s: storage, ut: userType });
}
