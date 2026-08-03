/**
 * ============================================================================
 * #1120 S1 — STT HIERARCHY FLAG (flag-gated, OFF by default)
 * ============================================================================
 *
 * S1 makes Private the primary/recommended first experience and demotes Browser to an explicit
 * secondary fallback (labelled "Browser" everywhere). This flag controls ONLY the Private/Browser
 * ordering. Cloud is gated INDEPENDENTLY by the canonical Cloud release gate — client mirror
 * `VITE_CLOUD_STT_ENABLED` (see isCloudSttEnabled/isCloudSttGloballyVisible) and Edge `CLOUD_STT_ENABLED`,
 * both exact-"true"/fail-closed — so Cloud is globally OFF + customer-invisible + never a silent fallback,
 * and this hierarchy flag NEVER restores Cloud visibility or entitlement in EITHER state.
 *
 * The Private/Browser slice sits behind ONE master flag so it ships as a coherent, reversible unit with a
 * real kill switch. Rolling the flag back changes ONLY the Private/Browser ordering — it does not touch the
 * Cloud gate:
 *  - flag OFF (default) => Browser-default ordering (today's Private/Browser ordering). This is the kill switch.
 *  - flag ON => new/unset sessions default to Private v2; Private is primary+recommended; Browser is the
 *    secondary fallback. Cloud visibility/selectability is unchanged by this flag in either state.
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
import { ENV } from '@/config/TestFlags';

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
  // #1120 S1 (PR #1155): bounded E2E-only hierarchy override, resolved BEFORE the PostHog read so launch
  // (true) and hierarchy-rollback (false) are deterministic at T=0. Prod-inert — `e2eSttHierarchyOverride`
  // is `undefined` unless the E2E manifest is active and `ENV.isE2E`. Hierarchy only; never affects Cloud.
  const e2eOverride = ENV.e2eSttHierarchyOverride;
  if (e2eOverride !== undefined) return e2eOverride;
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
 * #1120 S1 (review round-2): the CANONICAL, INDEPENDENT, FAIL-CLOSED Cloud gate — the build-time env
 * `VITE_CLOUD_STT_ENABLED` compared EXACT-true, mirroring the Edge `CLOUD_STT_ENABLED`. Cloud is OFF unless
 * this is exactly the string "true": SSR, unset, any other value, or a read error all deny Cloud (launch
 * invariant — Cloud default-disabled unless separately authorized). Deliberately NOT coupled to the
 * Private-primary hierarchy flag, so the hierarchy rollout/rollback never grants or revokes Cloud. Read at
 * CALL TIME (not a module-load const) so it is evaluated at invocation on every grant path — client
 * entitlement writers, the engine factory, and the token callback — and enforced independently at the Edge fn.
 */
export function isCloudSttEnabled(): boolean {
  try {
    // Direct static access (no optional chaining) so Vite statically replaces it; try/catch guards SSR/missing.
    return import.meta.env.VITE_CLOUD_STT_ENABLED === 'true';
  } catch {
    return false;
  }
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
    // #1120 S1 (PR #1155): a bounded E2E hierarchy override makes the state deterministic at T=0 — nothing to
    // wait for, so report ready immediately (never strand behind an uninitialized PostHog in E2E).
    if (ENV.e2eSttHierarchyOverride !== undefined) return true;
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
