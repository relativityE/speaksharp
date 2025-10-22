import { createClient, Session } from '@supabase/supabase-js';

const supabaseUrl: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // In test mode, these are provided by the test environment, so we don't throw.
  if (import.meta.env.MODE !== 'test' && !window.__E2E_MODE__) {
    throw new Error("Supabase URL and Anon Key are missing. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.");
  }
}

const isTest: boolean = import.meta.env.MODE === 'test' || window.__E2E_MODE__ === true;

export const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
  auth: {
    autoRefreshToken: !isTest,
    persistSession: true, // Always persist session in tests
    detectSessionInUrl: !isTest,
  },
});

// In test mode, expose the client and a helper function to the window object for E2E tests.
// The global types for these are defined in `src/types/ambient.d.ts`.
if (isTest) {
  window.supabase = supabase; // Expose the client instance
  window.__setSupabaseSession = async (session: Session) => {
    const { error } = await supabase.auth.setSession(session);
    if (error) {
      console.error('E2E: Error setting supabase session', error);
    }
  };
}
