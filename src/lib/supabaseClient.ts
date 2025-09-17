import { createClient } from '@supabase/supabase-js';

const supabaseUrl: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // In test mode, we can allow this to be empty and rely on mocks.
  // In other modes, it's a critical error.
  if (import.meta.env.MODE !== 'test') {
    throw new Error("Supabase URL and Anon Key are missing. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.");
  }
}

const isTest: boolean = import.meta.env.MODE === 'test';

// The '!' non-null assertion operator is used here because the check above ensures
// that for non-test environments, these variables will be defined.
// In a test environment, they might be undefined, but the client will be mocked.
export const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
  auth: {
    autoRefreshToken: !isTest,
    persistSession: !isTest,
    detectSessionInUrl: !isTest,
  },
});
