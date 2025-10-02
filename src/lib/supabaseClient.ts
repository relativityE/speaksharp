import { createClient, Session } from '@supabase/supabase-js';

const supabaseUrl: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  if (import.meta.env.MODE !== 'test') {
    throw new Error("Supabase URL and Anon Key are missing. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.");
  }
}

const isTest: boolean = import.meta.env.MODE === 'test';

export const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
  auth: {
    autoRefreshToken: !isTest,
    persistSession: !isTest,
    detectSessionInUrl: !isTest,
  },
});

// In test mode, expose a helper function to set the session programmatically.
// The global type for this is defined in `src/types/global.d.ts`.
if (import.meta.env.MODE === 'test') {
  window.__setSupabaseSession = async (session: Session) => {
    const { error } = await supabase.auth.setSession(session);
    if (error) {
      console.error('E2E: Error setting supabase session', error);
    }
  };
}