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
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/safeStorage';

/** PostHog flag key. Keep in sync with the PostHog project. */
export const SESSION_OVERHAUL_FLAG_KEY = 'session_overhaul_v1' as const;

/** Sticky per-browser override so a reviewer can turn the new page on/off immediately, no deploy/flag. */
const OVERRIDE_STORAGE_KEY = 'speaksharp_session_overhaul_override';

/**
 * Immediate, per-browser override read from `?overhaul=1|0` (sticky in localStorage) — lets the PO/reviewer
 * see the new page the moment they add the param and on every later refresh, independent of the PostHog
 * rollout. `?overhaul=0` forces it off again. Returns undefined when no override is set. Never throws.
 */
function readOverride(): boolean | undefined {
  try {
    if (typeof window !== 'undefined' && typeof window.location?.search === 'string') {
      const param = new URLSearchParams(window.location.search).get('overhaul');
      if (param === '1' || param === 'true') { safeLocalStorageSet(OVERRIDE_STORAGE_KEY, '1'); return true; }
      if (param === '0' || param === 'false') { safeLocalStorageSet(OVERRIDE_STORAGE_KEY, '0'); return false; }
    }
    const stored = safeLocalStorageGet(OVERRIDE_STORAGE_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch (error) {
    logger.debug?.({ error }, '[sessionOverhaulFlags] override read failed; ignoring');
  }
  return undefined;
}

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
  // A per-browser override (from `?overhaul=1|0`) wins so a reviewer sees the new page immediately, but a
  // HARD build disable still trumps everything (kill switch).
  if (HARD_DISABLED) return false;
  const override = readOverride();
  if (override !== undefined) return override;
  return readFlag(SESSION_OVERHAUL_FLAG_KEY);
}
