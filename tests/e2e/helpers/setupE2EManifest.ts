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
 * E2EWindow — Extended window for Playwright bridge.
 */
export interface E2EWindow extends Window {
  __SS_E2E__: SSE2EManifest;
  __SS_E2E_ACTIVE_ENGINE__?: unknown;
  __SS_E2E_ENGINE_CACHE__?: Record<string, unknown>;
  __MODEL_CACHED__?: boolean;
  __SS_E2E_BRIDGE__?: {
    emitTranscript: (text: string, isFinal?: boolean) => void;
  };
  __APP_READY_STATE__?: Record<string, boolean>;
  __E2E_READY__?: boolean;
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
}

/**
 * 🛡️ INTERNAL: Structural bridge for bridge routing without full controller dependency
 */
interface BridgeTarget {
  service?: {
    strategy?: {
      emitTranscript?: (text: string, isFinal: boolean) => void;
    };
    isTerminated: boolean;
  };
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
  }
) {
  const { storage = {}, ...manifest } = config;

  await page.addInitScript(({ m, s }: { m: unknown; s: Record<string, string> }) => {
    console.warn('[TRACE] TEST_HEARTBEAT');
    console.warn('[TRACE] RAW_MANIFEST_CONFIG', JSON.stringify(m));
    
    // 🛡️ [E2E-LOGGER] Local proxy to allow 'logger' syntax before Pino loads
    // [E2E-LOGGER] Removed unused local proxy to satisfy lint

    const localManifest = m as SSE2EManifest;
    const localBrowserStorage = s;

    // 1. CLEAR: Strict Zero baseline
    window.localStorage.clear();

    // 2. STORAGE: Re-inject tokens
    Object.entries(localBrowserStorage).forEach(([key, val]) => {
      window.localStorage.setItem(key, val);
    });

    // 3. 🛡️ DOMAIN INJECTION (Single Authoritative Handle)
    const win = window as unknown as E2EWindow;
    
    // Cache for engines
    win.__SS_E2E_ENGINE_CACHE__ = win.__SS_E2E_ENGINE_CACHE__ || {};

    const minimalStubFactory = (mode: string) => (opts?: { 
      onReady?: () => void, 
      onTranscriptUpdate?: (update: { transcript: { partial?: string; final?: string } }) => void 
    }) => {
      const fid = Math.random().toString(36).slice(2);
      console.warn('[TRACE] FACTORY_CALLED');
      console.warn('[TRACE] FACTORY_ID', fid);
      const cache = win.__SS_E2E_ENGINE_CACHE__ || {};
      win.__SS_E2E_ENGINE_CACHE__ = cache;
      if (cache[mode]) {
        return cache[mode] as { instanceId: string };
      }

      const id = Math.random().toString(36).substring(7);
      
      const instance = {
        instanceId: id,
        checkAvailability: async () => {
          console.warn('[TRACE] CHECK_AVAILABILITY');
          const win = window as unknown as E2EWindow;
          const isCached = win.__MODEL_CACHED__ !== false; // Default to true if not set
          return { 
            isAvailable: isCached, 
            available: isCached, 
            requiresDownload: !isCached,
            reason: isCached ? undefined : 'CACHE_MISS'
          };
        },
        init: async (opts?: { onStatusChange?: (s: { type: string, progress: number }) => void, onReady?: () => void }) => {
          console.warn('[TRACE] MOCK_INIT_STARTED', id);
          
          // 1. Simulate Download started if not already initialized
          if (!win.__SS_E2E__.isEngineInitialized) {
            opts?.onStatusChange?.({ type: 'downloading', progress: 0 });
            // Small delay to allow Playwright to catch the 'Visible' state
            await new Promise(resolve => setTimeout(resolve, 300));
            opts?.onStatusChange?.({ type: 'downloading', progress: 100 });
          }

          win.__SS_E2E__.isEngineInitialized = true;
          if (opts?.onReady) opts.onReady();
          win.__SS_E2E_ACTIVE_ENGINE__ = instance;
          
          console.warn('[TRACE] MOCK_INIT_COMPLETE', id);
          return { isOk: true };
        },
        start: async () => { },
        stop: async () => { },
        pause: async () => { },
        resume: async () => { },
        destroy: async () => { },
        terminate: async () => { },
        getEngineType: () => mode,
        getLastHeartbeatTimestamp: () => Date.now(),
        getTranscript: async () => '[E2E_MOCK]',
        emitTranscript: (text: string, isFinal: boolean = true) => {
          if (opts?.onTranscriptUpdate) {
            opts.onTranscriptUpdate({ transcript: isFinal ? { final: text } : { partial: text } });
          }
        }
      };
      cache[mode] = instance;
      return instance;
    };

    // Initialize Manifest (Sticky Guard: preserve mobilization if already set)
    const existing = win.__SS_E2E__;
    const supportEngines = ['mock', 'whisper-turbo', 'transformers-js', 'assemblyai', 'native-browser'] as const;
    const engineRegistry = Object.fromEntries(
        supportEngines.map(id => [id, minimalStubFactory(id)])
    );

    win.__SS_E2E__ = {
      isActive: true,
      enableRealEngine: existing?.enableRealEngine || localManifest.enableRealEngine || false,
      MOCK_STT_AVAILABILITY: existing?.MOCK_STT_AVAILABILITY || localManifest?.MOCK_STT_AVAILABILITY || true,
      runtimeEventLog: existing?.runtimeEventLog || [],
      ...localManifest,
      flags: { bypassMutex: true, fastTimers: true, ...(localManifest.flags || {}) },
      registry: {
        ...engineRegistry,
        ...(localManifest.registry || {})
      }
    };
    win.__E2E_FINISH_DOWNLOAD__ = null;

    // Authoritative Bridge
    win.__SS_E2E_BRIDGE__ = {
      emitTranscript: (text: string, isFinal: boolean = true) => {
        const controller = (win as unknown as Record<string, unknown>)['__TRANSCRIPTION_SERVICE__'] as BridgeTarget | undefined;
        const svc = controller?.service;
        if (svc && !svc.isTerminated) {
          svc.strategy?.emitTranscript?.(text, isFinal);
        }
      }
    };

    setInterval(() => {
      if (win.__SS_E2E__) {
        const bridge = win.__SS_E2E_BRIDGE__;
        if (bridge) {
            win.__SS_E2E__.emitTranscript = bridge.emitTranscript;
        }
      }
    }, 50);

    // Readiness signals
    win.__APP_READY_STATE__ = { msw: true, boot: true };
    win.__E2E_READY__ = true;
    
  }, { m: manifest as Record<string, unknown>, s: storage });
}
