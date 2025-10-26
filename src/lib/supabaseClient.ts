import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config/env';

let supabaseInstance: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  // 1. Check if the instance already exists
  if (supabaseInstance) {
    return supabaseInstance;
  }

  // 2. Check for an injected E2E mock client first
  if (typeof window !== 'undefined' && 'supabase' in window) {
    console.log('[getSupabaseClient] Using injected mock Supabase client.');
    supabaseInstance = (window as { supabase: SupabaseClient }).supabase || null;
    if (supabaseInstance) {
      return supabaseInstance;
    }
  }

  // 3. Create a real client if no mock is found
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    console.log('[getSupabaseClient] Creating new real Supabase client.');
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        // FIX: Disable session persistence in test mode to improve isolation
        persistSession: import.meta.env.MODE !== 'test',
        detectSessionInUrl: true,
      },
    });

    // In non-production environments, expose the client for debugging.
    if (import.meta.env.MODE !== 'production') {
       console.warn(
        '⚠️ Supabase client exposed on window object for debugging/testing. This should not be present in production.',
      );
      (window as { supabase?: SupabaseClient }).supabase = supabaseInstance;
    }

    return supabaseInstance;
  }

  throw new Error("Supabase URL or Anon Key is missing, and no mock client was injected.");
}

// Export the getter function for cases where lazy initialization is critical
export { getSupabaseClient };
