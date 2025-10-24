import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config/env';

let supabaseInstance: SupabaseClient | null = null;

export const getSupabaseClient = (): SupabaseClient => {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  if (typeof window !== 'undefined' && (window as any).supabase) {
    console.log('[getSupabaseClient] Using injected mock Supabase client.');
    supabaseInstance = (window as any).supabase;
  } else if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    console.log('[getSupabaseClient] Creating new real Supabase client.');
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  } else {
    throw new Error("Supabase URL or Anon Key is missing, and no mock client was injected.");
  }

  return supabaseInstance;
};
