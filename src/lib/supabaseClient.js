console.log("Executing supabaseClient.js");
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // In test mode, we can allow this to be empty and rely on mocks.
  // In other modes, it's a critical error.
  if (import.meta.env.MODE !== 'test') {
    throw new Error("Supabase URL and Anon Key are missing. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.");
  }
}

const isTest = import.meta.env.MODE === 'test';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: !isTest,
    persistSession: !isTest,
    detectSessionInUrl: !isTest,
  },
});
