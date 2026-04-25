/**
 * 🚨 READ-ONLY: This file is part of the core test infrastructure.
 * No modifications are allowed unless directed by User.
 * 
 * STRICT ZERO Manifest: Unified E2E environment orchestration.
 * 
 * This is the SINGLE SOURCE OF TRUTH at T=0. 
 * All legacy flags are DELETED.
 */

export interface SSE2EManifest {
  isActive: boolean;
  isEngineInitialized?: boolean;
  _activeCallbacks?: {
    onTranscriptUpdate?: (update: {
      transcript: { partial?: string; final?: string };
      isFinal: boolean;
      isPartial: boolean;
      timestamp: number;
    }) => void;
  } | null;
  engineType?: 'mock' | 'real' | 'system';
  emitTranscript?: (text: string, isFinal?: boolean) => void;
  debug?: boolean;
  flags?: {
    bypassMutex?: boolean;
    fastTimers?: boolean;
    DEBUG_ENABLED?: boolean;
  };
  registry?: Record<string, unknown>;
}

export interface SSE2EWindow extends Window {
  __SS_E2E__?: SSE2EManifest;
  ENV?: unknown;
  SSE_ENV?: unknown;
  VITE_USE_REAL_DATABASE?: string;
}

import logger from '../lib/logger';

const getWindow = (): SSE2EWindow => (typeof window !== 'undefined' ? (window as unknown as SSE2EWindow) : ({} as SSE2EWindow));

/**
 * Unified Environment Bridge (ENV)
 * 
 * All environmental and behavioral branches MUST be routed through this object.
 * Direct inspection of globalThis.__TEST__ or window.__SS_E2E__ is BANNED outside this file.
 * 
 * DESIGN: Uses lazy getters to ensure T=0 correctness during Playwright injection.
 */
export const ENV = {
  // --- MODERN INTERFACE (Strangler Pattern Core) ---
  get isE2E(): boolean {
    return !!getWindow().__SS_E2E__?.isActive;
  },
  get isUnit(): boolean {
    return typeof globalThis !== 'undefined' && globalThis.__TEST__ === true;
  },
  get isTest(): boolean {
    return this.isE2E || this.isUnit;
  },
  get engineType(): 'mock' | 'real' | 'system' {
    return (this.isE2E && getWindow().__SS_E2E__?.engineType) || 'system';
  },
  get fastTimers(): boolean {
    return this.isTest;
  },
  get disableWasm(): boolean {
    return this.isTest && this.engineType !== 'real';
  },
  get useRealDatabase(): boolean {
    return getWindow().VITE_USE_REAL_DATABASE === 'true';
  },
  get debug(): boolean {
    return this.isE2E && !!getWindow().__SS_E2E__?.debug;
  },

  // --- COMPATIBILITY SHIM (Legacy Mapping) ---
  get IS_E2E(): boolean { return this.isE2E; },
  get IS_TEST_MODE(): boolean { return this.isTest; },
  get ENGINE_TYPE(): string { return this.engineType; },
  get USE_REAL_DATABASE(): boolean { return this.useRealDatabase; },
  get DEBUG_ENABLED(): boolean { return this.debug; },
  get BYPASS_MUTEX(): boolean {
    return this.isE2E && !!getWindow().__SS_E2E__?.flags?.bypassMutex;
  },
  get FLAGS() {
    return {
      get DEBUG_ENABLED(): boolean { return ENV.debug; },
      get BYPASS_MUTEX(): boolean { return ENV.BYPASS_MUTEX; },
      get FAST_TIMERS(): boolean { return ENV.fastTimers; },
      get DISABLE_WASM(): boolean { return ENV.disableWasm; }
    };
  }
};

// 🛡️ Integrity Protection
Object.freeze(ENV);

// 🛡️ Exposure: Attach to window for test-runner accessibility
if (typeof window !== 'undefined') {
  (window as unknown as SSE2EWindow).ENV = ENV;
}

// 🛡️ Assertion Guard: Detect bridge failures early in the lifecycle
if (typeof window !== 'undefined' && (import.meta.env.MODE === 'test' || window.location.search.includes('testMode=true'))) {
  if (!window.__SS_E2E__) {
    logger.warn('[ENV] ⚠️ Test mode detected but __SS_E2E__ bridge is missing. Capture may be stale.');
  } else {
    logger.info('[ENV] ✅ E2E Bridge connected (T=0 Dynamic Getters active)');
  }
}