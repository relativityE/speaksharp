// src/lib/supabaseClient.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
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

  if (!url || !anonKey) {
    throw new Error('Missing Supabase environment variables (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY)');
  }

  const isVitestUnitRun = typeof process !== 'undefined' && (process.env.NODE_ENV === 'test' || process.env.VITEST);
  const allowMockAuth = isVitestUnitRun && process.env.VITE_ALLOW_MOCK_AUTH_IN_TESTS !== 'false';

  if (
    (import.meta.env.VITE_USE_MOCK_AUTH === 'true' || import.meta.env.VITE_AUTH_MODE === 'mock') &&
    !allowMockAuth
  ) {
    throw new Error(
      'Mock auth is not available from the runtime app. Use the centralized E2E test harness or create real test users through the test-user workflow.'
    );
  }

  if (import.meta.env.DEV && url?.includes('example.supabase.co')) {
    throw new Error(
      'Example Supabase configuration cannot start the runtime app. Use pnpm dev for real local auth or the E2E harness for mocked tests.'
    );
  }

  if (url.includes('.supabase.co') && anonKey.startsWith('mock_')) {
    throw new Error(
      'Invalid Supabase configuration: real Supabase URL is paired with a mock/test anon key. Use pnpm dev for manual auth testing or pnpm dev:test only for mocked E2E diagnostics.'
    );
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
