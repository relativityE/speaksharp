import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { Session } from '@supabase/supabase-js';
import logger from './logger';
import { safeLocalStorageGet } from './safeStorage';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Synchronously retrieves the Supabase session from localStorage.
 * 🛡️ Hardened for E2E: Uses safeStorage to avoid SecurityError.
 *
 * NOTE: This relies on the internal storage format of supabase-js,
 * which could change in future versions.
 *
 * @returns The Supabase session object or null if not found.
 */
export function getSyncSession(): Session | null {
  try {
    if (typeof window === 'undefined') return null;
    
    // Find the supabase auth key
    const storage = window.localStorage;
    const key = Object.keys(storage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    
    if (!key) return null;
    
    const data = safeLocalStorageGet(key);
    if (!data) return null;

    const session = JSON.parse(data) as Session;

    // Basic validation to ensure it looks like a session
    if (session && session.access_token && session.user) {
      return session;
    }

    return null;
  } catch (error) {
    logger.error({ error }, "Error parsing sync session from localStorage");
    return null;
  }
}
