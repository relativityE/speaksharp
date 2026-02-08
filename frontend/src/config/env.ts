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
// E2E Flag Constants (Consolidated here to avoid magic strings)
export const E2E_CONTEXT_FLAG = '__E2E_CONTEXT__';
export const E2E_MOCK_SESSION_FLAG = '__E2E_MOCK_SESSION__';
export const E2E_BRIDGE_READY_FLAG = '__e2eBridgeReady__';
export const E2E_PROFILE_LOADED_FLAG = '__e2eProfileLoaded__';
export const E2E_SESSION_DATA_LOADED_FLAG = '__e2eSessionDataLoaded__';
export const E2E_MSW_READY_FLAG = 'mswReady'; // Legacy compat

export const IS_TEST_ENVIRONMENT =
  getEnvVar('VITE_TEST_MODE') === 'true' ||
  import.meta.env.MODE === 'test' ||
  (typeof window !== 'undefined' && (window as unknown as { [key: string]: unknown })[E2E_CONTEXT_FLAG] === true);

// ServiceWorker registration timeout (in milliseconds)
export const SW_TIMEOUT_MS = 2000;

// Landing page redirect delay (in milliseconds)
// This controls how long authenticated users see the landing page before auto-redirect
export const LANDING_PAGE_REDIRECT_MS = 2000;

// Minimum session duration required for saving (in seconds)
// Sessions shorter than this don't generate meaningful metrics
export const MIN_SESSION_DURATION_SECONDS = 5;
