import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Supabase URL and Anon Key are missing. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.");
  throw new Error('Supabase URL and Anon Key must be provided in environment variables.');
}

// IMPORTANT: The VITE_SUPABASE_URL should be the API URL (e.g., https://<project-ref>.supabase.co),
// NOT the dashboard URL (e.g., https://supabase.com/dashboard/project/...).
const isTest = import.meta.env.MODE === 'test';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: !isTest,
    persistSession: !isTest,
    detectSessionInUrl: !isTest,
  },
});
