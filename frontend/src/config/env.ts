// src/config/env.ts
import type { UserGoals } from '../types/goal';
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

// ServiceWorker registration timeout (in milliseconds)
export const SW_TIMEOUT_MS = 2000;

// Landing page redirect delay (in milliseconds)
// This controls how long authenticated users see the landing page before auto-redirect
export const LANDING_PAGE_REDIRECT_MS = 2000;

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
