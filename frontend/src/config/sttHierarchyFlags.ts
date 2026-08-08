/**
 * ============================================================================
 * #1120 S1 — STT HIERARCHY FLAG (flag-gated, OFF by default)
 * ============================================================================
 *
 * S1 makes Private the primary/recommended first experience for a NEW/UNSET session and keeps Browser as
 * the explicit secondary path. This flag controls ONLY the Private/Browser default ordering. It never
 * touches Cloud (Cloud is gated independently and is globally off) and never causes a silent fallback —
 * an in-session engine choice is always honored separately.
 *
 * The slice sits behind ONE master flag so it ships as a coherent, reversible unit with a real kill switch:
 *  - flag OFF (default) => Browser-default ordering (today's behavior). This is the kill switch.
 *  - flag ON            => new/unset sessions default to Private (v2) when the user can use Private.
 *
 * Exposure hierarchy (mirrors the v4 flags):
 *  - PostHog runtime flag `stt_private_primary_v1` = primary control (kill switch + cohort).
 *  - Build env `VITE_STT_PRIVATE_PRIMARY_DISABLED=true` = HARD global disable overriding the flag.
 *  - `ENV.e2eSttHierarchyOverride` = bounded, prod-inert E2E-only override for deterministic tests.
 *
 * Safety: never throws. SSR/no-window, uninitialized PostHog, or any read error resolve to OFF (today's
 * behavior) — the safe default.
 */
import posthog from 'posthog-js';
import logger from '@/lib/logger';
import { ENV } from '@/config/TestFlags';

/** PostHog flag key. Keep in sync with the PostHog project. */
export const STT_HIERARCHY_FLAG_KEY = 'stt_private_primary_v1' as const;

const HARD_DISABLED: boolean = (() => {
  try {
    // Direct static access (no optional chaining) so Vite statically replaces it and does not inline the
    // whole env object into this chunk. The try/catch guards SSR/missing env.
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
  // Bounded E2E-only override, resolved BEFORE the PostHog read so launch (true) and rollback (false) are
  // deterministic at T=0. Prod-inert — `e2eSttHierarchyOverride` is `undefined` unless the E2E manifest is
  // active and `ENV.isE2E`.
  const e2eOverride = ENV.e2eSttHierarchyOverride;
  if (e2eOverride !== undefined) return e2eOverride;
  if (HARD_DISABLED) return false;
  return readFlag(STT_HIERARCHY_FLAG_KEY);
}

/**
 * #1120 S1 — the default STT mode for a NEW/UNSET session. Private is the primary first experience when the
 * hierarchy flag is ON and the user can use Private; otherwise the instant Browser path (today's behavior,
 * or a user without Private access). Pure + deterministic so the decision is unit-tested independent of the
 * hook. An explicit in-session Browser choice is honored separately (the caller applies this only when unset).
 */
export function resolveDefaultSttMode(privatePrimary: boolean, canUsePrivate: boolean): 'private' | 'native' {
  return privatePrimary && canUsePrivate ? 'private' : 'native';
}

/**
 * PostHog flag-load readiness. On a cold/newly-identified session `isFeatureEnabled` returns undefined until
 * flags load; latching the default then persists a premature 'native' and ignores the later cohort
 * assignment. `sttFlagsReadyInitial()` is true only when there is nothing to wait for (SSR, PostHog
 * absent/uninitialized — e.g. unit/E2E, or a bounded E2E override present), so those paths proceed
 * immediately with safe defaults; when PostHog IS present, callers wait for `onSttFlagsReady` before
 * latching. Never throws.
 */
export function sttFlagsReadyInitial(): boolean {
  if (typeof window === 'undefined') return true;
  try {
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
