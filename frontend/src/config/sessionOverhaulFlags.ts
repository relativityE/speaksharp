/**
 * ============================================================================
 * #1222 S11 — SESSION-OVERHAUL FLAG (flag-gated, OFF by default)
 * ============================================================================
 *
 * The session-page overhaul (one page, three states, four fixed slots) ships behind ONE master flag so
 * it lands as a coherent, reversible unit with a real kill switch and — crucially — so prod and every
 * existing session e2e stay on today's page until the new page is deliberately flipped on:
 *  - flag OFF (default) => the current SessionPage body (today's behavior). This is the kill switch.
 *  - flag ON            => the #1222 shell (SessionOverhaulView) renders instead.
 *
 * Exposure hierarchy mirrors `sttHierarchyFlags`:
 *  - PostHog runtime flag `session_overhaul_v1` = primary control (kill switch + cohort).
 *  - Build env `VITE_SESSION_OVERHAUL_DISABLED=true` = HARD global disable overriding the flag.
 *
 * Safety: never throws. SSR/no-window, uninitialized PostHog, or any read error resolve to OFF.
 */
import posthog from 'posthog-js';
import logger from '@/lib/logger';

/** PostHog flag key. Keep in sync with the PostHog project. */
export const SESSION_OVERHAUL_FLAG_KEY = 'session_overhaul_v1' as const;

const HARD_DISABLED: boolean = (() => {
  try {
    // Direct static access so Vite statically replaces exactly this key at build time.
    return import.meta.env.VITE_SESSION_OVERHAUL_DISABLED === 'true';
  } catch {
    return false;
  }
})();

function readFlag(key: string): boolean {
  try {
    return posthog?.isFeatureEnabled?.(key) === true;
  } catch (error) {
    logger.debug?.({ error, key }, '[sessionOverhaulFlags] feature-flag read failed; defaulting OFF');
    return false;
  }
}

/**
 * Is the #1222 session overhaul active for this user right now?
 * OFF (today's page) on SSR, hard-disable, uninitialized PostHog, or any error.
 */
export function isSessionOverhaulEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (HARD_DISABLED) return false;
  return readFlag(SESSION_OVERHAUL_FLAG_KEY);
}
