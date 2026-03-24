import { Session } from '@supabase/supabase-js';

interface SS_E2E_Manifest {
  isActive: boolean;
  engineType: 'mock' | 'real' | 'system';
  registry: Record<string, unknown>;
  flags: {
    bypassMutex: boolean;
    fastTimers: boolean;
  };
  debug?: boolean;
}

declare global {
  interface Window {
    // This is a test-only hook exposed by supabaseClient.ts to allow E2E tests
    // to programmatically set the auth session.
    __setSupabaseSession: (session: Session) => Promise<void>;
    
    // Readiness Contract (Deterministic CI Signaling)
    // Map of boolean signals + optional high-resolution timestamps for traceability.
    __APP_READY_STATE__?: Record<string, boolean | Record<string, number>> & {
      _timestamps?: Record<string, number>;
    };

    // STRICT ZERO: Unified E2E Manifest
    __SS_E2E__?: SS_E2E_Manifest;

    // Legacy Readiness Signals (Scheduled for retirement)
    __APP_READY__?: boolean;
    mswReady?: boolean;

    // React internals (optional diagnostics)
    _speakSharpRootInitialized?: boolean;
  }
}

// This export statement is necessary to make this file a module,
// which allows the `declare global` to work correctly.
export {};