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

/** A safe protected deep-link (`from`) as a full path, or null when absent/unsafe. Identity-independent. */
export function safeDeepLink(from?: { pathname?: string; search?: string } | null): string | null {
  const fromPath = from?.pathname;
  return isSafeInternalPath(fromPath) ? `${fromPath}${from?.search ?? ''}` : null;
}

/** Bounded wait for the AUTHENTICATED feature-flag evaluation (default; overridable in tests). */
export const PRACTICE_ENTRY_FLAG_TIMEOUT_MS = 1500;

type FlagPostHog = {
  get_distinct_id?: () => string | undefined;
  onFeatureFlags?: (cb: () => void) => (() => void) | void;
};

/**
 * Await whether the rollout flag is ON *for the just-authenticated user*.
 *
 * The subtlety this solves (review finding #1): right after sign-in, PostHog may still carry the prior
 * ANONYMOUS identity and its flags; `AnalyticsBuffer.identify(userId)` re-identifies and reloads flags
 * ASYNCHRONOUSLY. Reading the flag synchronously at render can therefore return the anonymous cohort's
 * value. So we (a) confirm PostHog's `distinct_id` now equals `userId` — proving the loaded flags belong
 * to the authenticated identity, not the previous anonymous one — and (b) wait for the post-identify
 * `onFeatureFlags` load, both under ONE bounded timeout. Non-targeted, error, timeout, or
 * identity-not-yet-confirmed all resolve FALSE (→ unchanged /session). Never rejects.
 */
export function resolveAuthedFlag(
  userId: string | null | undefined,
  opts?: { timeoutMs?: number; client?: FlagPostHog | null },
): Promise<boolean> {
  const client = (opts?.client ?? (posthog as unknown as FlagPostHog)) || null;
  const timeoutMs = opts?.timeoutMs ?? PRACTICE_ENTRY_FLAG_TIMEOUT_MS;
  return new Promise<boolean>((resolve) => {
    if (typeof window === 'undefined' || !userId || !client) return resolve(false);
    let settled = false;
    let unsub: (() => void) | void;
    const timer = setTimeout(() => settle(false), timeoutMs);
    function settle(value: boolean) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { unsub?.(); } catch { /* ignore */ }
      resolve(value);
    }
    // Flags belong to the authed user only once PostHog's distinct id matches the authenticated id.
    const identityIsAuthed = () => {
      try { return client.get_distinct_id?.() === userId; } catch { return false; }
    };
    const check = () => { if (identityIsAuthed()) settle(isPracticeEntryEnabled()); };
    check(); // already loaded for the authed identity?
    if (settled) return;
    try {
      unsub = client.onFeatureFlags?.(check); // fires after the post-identify flag reload
    } catch { settle(false); }
  });
}

/**
 * Resolve the post-auth destination (async). A valid protected deep-link wins IMMEDIATELY (it is
 * identity-independent and must be honored without waiting). Otherwise the default awaits the
 * authenticated flag: targeted → /practice; non-targeted / error / timeout → the unchanged /session.
 */
export async function resolveAuthedDefaultPath(
  userId: string | null | undefined,
  from?: { pathname?: string; search?: string } | null,
  opts?: { timeoutMs?: number; client?: FlagPostHog | null },
): Promise<string> {
  const deepLink = safeDeepLink(from);
  if (deepLink) return deepLink;
  return (await resolveAuthedFlag(userId, opts)) ? '/practice' : '/session';
}
