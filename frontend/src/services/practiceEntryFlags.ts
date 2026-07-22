/**
 * Practice-entry rollout flag (fail-OFF PostHog gate) + safe post-auth redirect helper.
 *
 * Gates the new authenticated `/practice` landing for the existing tester cohort with a one-switch
 * rollback: when the flag is OFF (default, and on any PostHog error / SSR / pre-load), post-auth
 * navigation keeps the CURRENT behavior (→ /session), so flipping the flag to 0% instantly reverts
 * everyone. Mirrors the established privateV4Flags fail-safe reader — never throws, never blocks auth.
 */

import posthog from 'posthog-js';
import logger from '@/lib/logger';

/** PostHog feature-flag key. Cohort targeting is enforced server-side in PostHog. */
export const PRACTICE_ENTRY_FLAG_KEY = 'practice_entry_enabled';

/** Read the flag, failing OFF on any error / no-window / flags-not-loaded. */
export function isPracticeEntryEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return posthog?.isFeatureEnabled?.(PRACTICE_ENTRY_FLAG_KEY) === true;
  } catch (error) {
    logger.debug?.({ error, key: PRACTICE_ENTRY_FLAG_KEY }, '[practiceEntryFlags] flag read failed; defaulting OFF');
    return false;
  }
}

/**
 * Only allow an in-app absolute path as a post-auth return destination — never an external URL or
 * protocol-relative target. Guards the `location.state.from` deep-link against open-redirect. A path
 * must start with a single "/" and not begin with "//" (protocol-relative) or contain a scheme.
 */
export function isSafeInternalPath(path: string | undefined | null): path is string {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//')) return false;
  if (/^\/\\/.test(path)) return false; // "/\" backslash trick
  if (/[a-z][a-z0-9+.-]*:/i.test(path)) return false; // any scheme (http:, javascript:, etc.)
  return true;
}

/**
 * Resolve the post-auth destination. A valid protected deep-link (`from`) always wins so users land
 * where they were headed. Otherwise the DEFAULT is /practice when the rollout flag is ON, else the
 * unchanged /session (rollback path). Unsafe/external `from` values are rejected → default.
 */
export function resolvePostAuthPath(from?: { pathname?: string; search?: string } | null): string {
  const fromPath = from?.pathname;
  if (isSafeInternalPath(fromPath)) {
    return `${fromPath}${from?.search ?? ''}`;
  }
  return isPracticeEntryEnabled() ? '/practice' : '/session';
}
