/**
 * ============================================================================
 * #1120 S1 — STT HIERARCHY FLAG (flag-gated, OFF by default)
 * ============================================================================
 *
 * S1 makes Private the primary/recommended first experience, demotes Browser to an
 * explicit secondary fallback (labelled "Browser" everywhere), and keeps Cloud
 * globally off + customer-invisible + never a silent fallback.
 *
 * The whole slice sits behind ONE master flag so it ships as a coherent, reversible
 * unit with a real kill switch:
 *  - flag OFF (default) => today's behavior EXACTLY (Browser default; Cloud visible to
 *    entitled Pro users). This is the kill switch.
 *  - flag ON => new/unset sessions default to Private v2; Private is primary+recommended;
 *    Browser is the secondary fallback; Cloud is hidden + unselectable.
 *
 * Exposure hierarchy (mirrors privateV4Flags):
 *  - PostHog runtime flag `stt_private_primary_v1` = primary control (kill switch + cohort).
 *  - Build env `VITE_STT_PRIVATE_PRIMARY_DISABLED=true` = HARD global disable overriding the flag.
 *
 * Safety: never throws. SSR/no-window, uninitialized PostHog, or any read error resolve to
 * OFF (today's behavior) — the safe default.
 */
import posthog from 'posthog-js';
import logger from '@/lib/logger';

/** PostHog flag key. Keep in sync with the PostHog project. */
export const STT_HIERARCHY_FLAG_KEY = 'stt_private_primary_v1' as const;

const HARD_DISABLED: boolean = (() => {
  try {
    // Direct static access (no optional chaining) so Vite statically replaces it and does not
    // inline the whole env object into this chunk. The try/catch guards SSR/missing env.
    return import.meta.env.VITE_STT_PRIVATE_PRIMARY_DISABLED === 'true';
  } catch {
    return false;
  }
})();

function readFlag(key: string): boolean {
  try {
    return posthog?.isFeatureEnabled?.(key) === true;
  } catch (error) {
    logger.debug?.({ error, key }, '[sttHierarchyFlags] feature-flag read failed; defaulting OFF');
    return false;
  }
}

/**
 * Is the #1120 S1 Private-primary hierarchy active for this user right now?
 * OFF (today's behavior) on SSR, hard-disable, uninitialized PostHog, or any error.
 */
export function isPrivatePrimaryEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (HARD_DISABLED) return false;
  return readFlag(STT_HIERARCHY_FLAG_KEY);
}

/**
 * #1120 S1 — the default STT mode for a NEW/UNSET session. Private is the primary first experience when the
 * hierarchy flag is ON and the user can use Private; otherwise the instant Browser path (today's behavior, or
 * a user without Private access). Pure + deterministic so the decision is unit-tested independent of the hook.
 * An explicit in-session Browser choice is honored separately (the caller only applies this when unset).
 */
export function resolveDefaultSttMode(privatePrimary: boolean, canUsePrivate: boolean): 'private' | 'native' {
  return privatePrimary && canUsePrivate ? 'private' : 'native';
}

/**
 * Is Cloud STT selectable/visible to the customer at all?
 * S1 keeps Cloud globally off + invisible when the hierarchy flag is ON. When the flag is OFF
 * (today), Cloud selectability is unchanged and still governed by the caller's entitlement check.
 * Cloud is never a SILENT fallback in either state — that invariant lives in the policy layer.
 */
export function isCloudSttGloballyVisible(): boolean {
  return !isPrivatePrimaryEnabled();
}
