import { Session } from '@supabase/supabase-js';

declare global {
  interface Window {
    // This is a test-only hook exposed by supabaseClient.ts to allow E2E tests
    // to programmatically set the auth session.
    __setSupabaseSession: (session: Session) => Promise<void>;
    
    // 🚀 Readiness Contract (Deterministic CI Signaling)
    __APP_READY_STATE__?: 
      | 'BOOTING' 
      | 'SERVICE_READY' 
      | 'ENGINE_READY' 
      | 'READY'
      | {
          boot: boolean;
          layout: boolean;
          auth: boolean;
          analytics: boolean;
          stt: boolean;
          timestamps: Record<string, number>;
        };

    // Legacy Readiness Signals (Scheduled for retirement)
    __APP_READY__?: boolean;
    mswReady?: boolean;

    // 🚀 Deterministic Test Environment (Unified Namespace)
    __APP_TEST_ENV__?: {
      mode: 'e2e' | 'unit' | 'integration';
      sttEngine?: 'mock' | 'real';
      useRealDatabase?: boolean;
      forceCpuTranscription?: boolean;
      analytics?: 'enabled' | 'disabled';
      debug?: boolean;
    };

    // E2E Context (Scheduled for retirement in favor of __APP_TEST_ENV__)
    __E2E_CONTEXT__?: boolean;
    __E2E_MOCK_SESSION__?: boolean;

    // React internals (optional diagnostics)
    _speakSharpRootInitialized?: boolean;
  }
}

// This export statement is necessary to make this file a module,
// which allows the `declare global` to work correctly.
export {};