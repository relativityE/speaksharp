// src/config/env.ts
export const getEnvVar = (key: string): string | undefined => {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return (import.meta.env as Record<string, string>)[key];
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key];
  }
  return undefined;
};

export const SUPABASE_URL = getEnvVar('VITE_SUPABASE_URL');
export const SUPABASE_ANON_KEY = getEnvVar('VITE_SUPABASE_ANON_KEY');
export const IS_TEST_ENVIRONMENT = getEnvVar('VITE_TEST_MODE') === 'true' || process.env.NODE_ENV === 'test';

// ServiceWorker registration timeout (in milliseconds)
export const SW_TIMEOUT_MS = 2000;

// Landing page redirect delay (in milliseconds)
// This controls how long authenticated users see the landing page before auto-redirect
export const LANDING_PAGE_REDIRECT_MS = 2000;
