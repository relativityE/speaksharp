// src/config/env.ts
import type { UserGoals } from '../types/goal';

/**
 * STATIC allowlist of the client env this module exposes. Each value is read with DIRECT property access
 * (`import.meta.env.VITE_x`) so Vite statically replaces exactly that key at build time. We must never read
 * `import.meta.env[dynamicKey]` or spread/iterate the object: a computed access forces Vite to inline the
 * ENTIRE env object into the chunk — which on Vercel includes the per-deployment `VITE_VERCEL_GIT_COMMIT_SHA`,
 * embedding the commit SHA into otherwise-stable chunks and rotating their content hash every deploy.
 */
const CLIENT_ENV = {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
  // #1061 activation gate for the Guided Rehearsal "Notify me" waitlist. OFF until the Edge Function is
  // deployed AND a confirmation-email provider is wired — until then the CTA shows an honest "coming soon"
  // acknowledgement and never calls the (undeployed) backend. Flip to 'true' as the separately-authorized
  // activation step; no code change required.
  VITE_GUIDED_WAITLIST_ENABLED: import.meta.env.VITE_GUIDED_WAITLIST_ENABLED as string | undefined,
} as const;

export type ClientEnvKey = keyof typeof CLIENT_ENV;

export const getEnvVar = (key: ClientEnvKey): string | undefined => {
  const fromVite = CLIENT_ENV[key];
  if (fromVite !== undefined) return fromVite;
  // Node/SSR/test fallback. process.env is NOT bundled by Vite, so a dynamic read here is safe (it never
  // inlines the client env object) and only runs outside the browser build.
  if (typeof process !== 'undefined' && process.env) return process.env[key];
  return undefined;
};

export const SUPABASE_URL = getEnvVar('VITE_SUPABASE_URL');
export const SUPABASE_ANON_KEY = getEnvVar('VITE_SUPABASE_ANON_KEY');
/** #1061: true only when the waitlist backend is deployed + a provider is wired (activation). Default OFF. */
export const GUIDED_WAITLIST_ENABLED = getEnvVar('VITE_GUIDED_WAITLIST_ENABLED') === 'true';
/** 
 * 🚨 FROZEN SHIM (Strangler Pattern)
 * 
 * Governance Rules:
 * 1. PURE PROJECTION ONLY: No logic, computation, or functions allowed for flags.
 * 2. SSOT-ONLY: Reference only modern ENV properties (ENV.isTest, etc.). 
 *    Illegal: TestFlags.IS_E2E ❌
 * 3. DYNAMIC CORRECTNESS: ENV properties are getters. They are safe to read
 *    even if globals are set AFTER this file is imported.
 */
import { ENV } from './TestFlags';
export const IS_TEST_ENVIRONMENT = ENV.isTest;

// Minimum session duration required for saving (in seconds)
// Sessions shorter than this don't generate meaningful metrics
export const MIN_SESSION_DURATION_SECONDS = 5;

// SCALABILITY: Limit fetch to 20 sessions for dashboard/trends.
export const DASHBOARD_PAGINATION_LIMIT = 20;

// USER GOALS: Default values and storage keys
export const GOALS_STORAGE_KEY = 'speaksharp:user-goals';
export const DEFAULT_GOALS: UserGoals = {
  weeklyGoal: 5,
  clarityGoal: 90,
};
