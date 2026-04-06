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
  engineType?: 'mock' | 'real' | 'system';
  debug?: boolean;
  flags?: {
    bypassMutex?: boolean;
    fastTimers?: boolean;
    DEBUG_ENABLED?: boolean;
  };
  registry?: Record<string, unknown>;
}

/**
 * Unified Environment Bridge (ENV)
 * 
 * All environmental and behavioral branches MUST be routed through this object.
 * Direct inspection of globalThis.__TEST__ or window.__SS_E2E__ is BANNED outside this file.
 */
export const ENV = (() => {
  const isBrowser = typeof window !== 'undefined';

  // 1. Base Identities
  const isE2E = isBrowser && !!window.__SS_E2E__?.isActive;
  const isUnit =
    typeof globalThis !== 'undefined' &&
    globalThis.__TEST__ === true;
  const isTest = isE2E || isUnit;

  // 2. Behavioral Flags
  const engineType = (isE2E && window.__SS_E2E__?.engineType) || 'system';
  const fastTimers = isTest; // Forced in all test modes
  const disableWasm = isTest && engineType !== 'real';
  const debug = isE2E && !!window.__SS_E2E__?.debug;
  const useRealDatabase = isBrowser && window.VITE_USE_REAL_DATABASE === 'true';

  return {
    // --- MODERN INTERFACE (Strangler Pattern Core) ---
    isTest,
    isE2E,
    isUnit,
    engineType,
    fastTimers,
    disableWasm,
    useRealDatabase,
    debug,

    // --- COMPATIBILITY SHIM (Legacy Mapping) ---
    // These aliases prevent CI breakages while files transition to lowercase properties.
    IS_E2E: isE2E,
    IS_TEST_MODE: isTest,
    ENGINE_TYPE: engineType,
    USE_REAL_DATABASE: useRealDatabase,
    DEBUG_ENABLED: debug,
    BYPASS_MUTEX: isE2E && !!window.__SS_E2E__?.flags?.bypassMutex,
    FLAGS: {
      DEBUG_ENABLED: debug,
      BYPASS_MUTEX: isE2E && !!window.__SS_E2E__?.flags?.bypassMutex,
      FAST_TIMERS: fastTimers,
      DISABLE_WASM: disableWasm
    }
  };
})();