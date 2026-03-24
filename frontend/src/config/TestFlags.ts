/**
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
  };
  registry?: Record<string, unknown>;
}

declare global {
  interface Window {
    __SS_E2E__?: SSE2EManifest;
    VITE_USE_REAL_DATABASE?: string;
  }
}

/**
 * Primary E2E detection rule.
 * Enforcement: window.__SS_E2E__ is the ONLY source of truth.
 */
export const isE2E = () => typeof window !== 'undefined' && !!window.__SS_E2E__?.isActive;

export const FLAGS = {
    get DEBUG_ENABLED(): boolean {
        return isE2E() && !!window.__SS_E2E__?.debug;
    },
    get BYPASS_MUTEX(): boolean {
        return isE2E() && !!window.__SS_E2E__?.flags?.bypassMutex;
    },
    get FAST_TIMERS(): boolean {
        return isE2E() && !!window.__SS_E2E__?.flags?.fastTimers;
    },
    get DISABLE_WASM(): boolean {
        // Force disable WASM in E2E unless explicitly opting into 'real' engine
        return isE2E() && window.__SS_E2E__?.engineType !== 'real';
    },
} as const;

export const TestFlags = {
    get IS_E2E(): boolean {
        return isE2E();
    },
    get ENGINE_TYPE(): 'mock' | 'real' | 'system' {
        return (isE2E() && window.__SS_E2E__?.engineType) || 'system';
    },
    /**
     * Enforcement: USE_REAL_DATABASE is strictly controlled by environment parity.
     */
    get USE_REAL_DATABASE(): boolean {
        return typeof window !== 'undefined' && window.VITE_USE_REAL_DATABASE === 'true';
    },
    get DEBUG_ENABLED(): boolean {
        return FLAGS.DEBUG_ENABLED;
    },
    FLAGS, // Keep for backward compatibility
} as const;


