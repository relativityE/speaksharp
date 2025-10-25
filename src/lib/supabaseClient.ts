import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config/env';

let supabaseInstance: SupabaseClient;

function createSupabaseClient(): SupabaseClient {
  if (typeof window !== 'undefined' && (window as any).supabase) {
    console.log('[getSupabaseClient] Using injected mock Supabase client.');
    return (window as any).supabase;
  }
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    console.log('[getSupabaseClient] Creating new real Supabase client.');
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }
  throw new Error("Supabase URL or Anon Key is missing, and no mock client was injected.");
}

// Initialize the client immediately at the module level.
// This ensures a single instance is used throughout the application.
const supabase = createSupabaseClient();

// In non-production environments, expose the client for debugging and E2E testing.
if (process.env.NODE_ENV !== 'production') {
  console.warn(
    '⚠️ Supabase client exposed on window object for debugging/testing. This should not be present in production.',
  );
  (window as any).supabase = supabase;
}

export { supabase };
