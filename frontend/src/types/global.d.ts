import { Session } from '@supabase/supabase-js';

declare global {
  interface Window {
    // This is a test-only hook exposed by supabaseClient.ts to allow E2E tests
    // to programmatically set the auth session.
    __setSupabaseSession: (session: Session) => Promise<void>;
  }
}

// This export statement is necessary to make this file a module,
// which allows the `declare global` to work correctly.
export {};