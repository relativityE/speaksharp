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

/** PostHog flag key for the INDEPENDENT Cloud gate. Keep in sync with the PostHog project. */
export const CLOUD_STT_FLAG_KEY = 'cloud_stt_enabled' as const;

const CLOUD_HARD_DISABLED: boolean = (() => {
  try {
    return import.meta.env.VITE_CLOUD_STT_DISABLED === 'true';
  } catch {
    return false;
  }
})();

/**
 * #1120 S1 (review #3/#4/#5): the INDEPENDENT, FAIL-CLOSED Cloud gate. Cloud is OFF unless a dedicated flag
 * `cloud_stt_enabled` is EXACTLY true. It is deliberately NOT coupled to the Private-primary hierarchy flag —
 * the hierarchy rollout/rollback must never grant or revoke Cloud. Default OFF on SSR, hard-disable, an
 * unresolved/undefined flag, or any error, so "flag missing/OFF" denies Cloud (the launch invariant:
 * Cloud remains default-disabled unless separately authorized). Enforced at EVERY grant path (client entitlement
 * writers, engine factory) and independently at the Edge token function (`CLOUD_STT_ENABLED`).
 */
export function isCloudSttEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (CLOUD_HARD_DISABLED) return false;
  return readFlag(CLOUD_STT_FLAG_KEY);
}

/** Cloud is visible/selectable to the customer ONLY when the independent Cloud gate is enabled. */
export function isCloudSttGloballyVisible(): boolean {
  return isCloudSttEnabled();
}

/**
 * #1120 S1 (review #1): PostHog flag-load readiness. On a cold/newly-identified session `isFeatureEnabled`
 * returns undefined until flags load; latching the default then persists a premature 'native' and ignores the
 * later cohort assignment. `sttFlagsReadyInitial()` is true only when there is nothing to wait for (SSR, or
 * PostHog absent/uninitialized — e.g. unit/E2E), so those paths proceed immediately with safe defaults; when
 * PostHog IS present, callers wait for `onSttFlagsReady` before latching. Never throws.
 */
export function sttFlagsReadyInitial(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return !posthog || typeof posthog.onFeatureFlags !== 'function';
  } catch {
    return true;
  }
}

/** Subscribe to PostHog flag-load completion. Fires the callback once flags are available (and on changes). */
export function onSttFlagsReady(cb: () => void): () => void {
  try {
    if (!posthog || typeof posthog.onFeatureFlags !== 'function') { cb(); return () => {}; }
    return posthog.onFeatureFlags(() => cb());
  } catch {
    cb();
    return () => {};
  }
}
