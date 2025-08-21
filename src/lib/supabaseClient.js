import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Supabase URL and Anon Key are missing. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.");
  throw new Error('Supabase URL and Anon Key must be provided in environment variables.');
}

// IMPORTANT: The VITE_SUPABASE_URL should be the API URL (e.g., https://<project-ref>.supabase.co),
// NOT the dashboard URL (e.g., https://supabase.com/dashboard/project/...).
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // This is the default, but it's good to be explicit.
    // We are using the browser's localStorage to store the user's session.
    // This is safe because Supabase's JWTs are stateless and stored in a secure,
    // http-only cookie by default. The JS client needs access to the JWT to
    // know if the user is authenticated.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  }
});
