import { Session } from '@supabase/supabase-js';

interface SS_E2E_Manifest {
  isActive: boolean;
  enableRealEngine?: boolean;
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
  registry?: Record<string, unknown>;
  flags?: {
    bypassMutex?: boolean;
    fastTimers?: boolean;
  };
  debug?: boolean;
  // 🧬 STRUCTURED IDENTITY DASHBOARD
  runtimeEventLog?: Array<{ event: string; instanceId: string; timestamp: number }>;
  pushEvent?: (event: string, instanceId: string) => void;
}

declare global {
  var __TEST__: boolean | undefined;

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

    // Environment and Test Flags
    VITE_USE_REAL_DATABASE?: string;
    VITE_SUPABASE_URL?: string;
    VITE_SUPABASE_ANON_KEY?: string;
    __TEST_REGISTRY__?: {
        register: (mode: string, factory: unknown) => void;
        clear: () => void;
    };
    __activeSpeechRecognition?: unknown;
  }
}

// This export statement is necessary to make this file a module,
// which allows the `declare global` to work correctly.
export {};