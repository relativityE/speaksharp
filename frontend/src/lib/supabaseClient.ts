// src/lib/supabaseClient.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { createMockSupabase } from './mockSupabase';
import logger from './logger';

declare global {
  // allow tests to inject a mock client on window
  interface Window {
    supabase?: SupabaseClient;
  }
}

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  // Prefer a test-injected client to avoid real network calls in E2E
  if (typeof window !== 'undefined' && window.supabase) {
    return window.supabase;
  }

  if (cachedClient) {
    return cachedClient;
  }

  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  // Check for mock mode or dummy credentials
  const useMock = import.meta.env.VITE_USE_MOCK_AUTH === 'true' ||
    (import.meta.env.DEV && url?.includes('example.supabase.co'));

  if (useMock) {
    logger.warn('[supabaseClient] Creating MOCK Supabase client for development');
    return (cachedClient = createMockSupabase() as unknown as SupabaseClient);
  }

  if (!url || !anonKey) {
    throw new Error('Missing Supabase environment variables (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY)');
  }

  cachedClient = createClient(url as string, anonKey as string, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });

  logger.info({ project: url?.replace(/https?:\/\//, '').split('.')[0] }, '[Supabase] Real client connected');
  return cachedClient;
}
