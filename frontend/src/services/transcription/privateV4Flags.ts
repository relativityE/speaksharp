/**
 * ============================================================================
 * PRIVATE STT v4 — FEATURE FLAGS (flag-ready, OFF by default)
 * ============================================================================
 *
 * v4 is a POST-paid-soft-launch, flag-gated path. It must never alter the
 * default Private STT behavior. With every flag off, Private STT is functionally
 * identical to the v2-base default (`whisper-base.en` + v2-tiny fallback).
 *
 * Exposure hierarchy (product decision):
 *  - PostHog runtime flags  = primary control (real kill switch + cohort targeting).
 *  - `?privateEngine=transformers-js-v4` / localStorage = dev/test override ONLY
 *    (handled in PrivateSTT.getPrivateEngineOverride, not here).
 *  - Build env `VITE_PRIVATE_STT_V4_DISABLED=true` = HARD global disable that
 *    overrides every flag (a build-time kill switch).
 *
 * Safety: never throws. SSR/no-window, uninitialized PostHog, or any read error
 * all resolve to OFF — the safe default. No user-facing engine internals here.
 */
import posthog from 'posthog-js';
import logger from '@/lib/logger';

/** PostHog flag keys. Keep in sync with the PostHog project. */
export const V4_FLAG_KEYS = {
  /** Master switch: may the resolver consider v4 at all for this user? */
  ENABLED: 'private_stt_v4_enabled',
  /** May the WebGPU distil-q4 accuracy tier be considered (still gated on real WebGPU)? */
  DISTIL_ENABLED: 'private_stt_v4_distil_enabled',
  /** Restrict v4 to internal testers (cohort is enforced by PostHog targeting). */
  INTERNAL_ONLY: 'private_stt_v4_internal_only',
} as const;

export interface V4FlagState {
  /** Master switch — when false the resolver never selects v4. */
  v4Enabled: boolean;
  /** distil-q4 accuracy tier eligible (only meaningful when v4Enabled + real WebGPU). */
  distilEnabled: boolean;
  /** Informational: this exposure is internal-only. */
  internalOnly: boolean;
  /** Build-level hard kill forced everything off, regardless of PostHog. */
  hardDisabled: boolean;
}

const ALL_OFF: V4FlagState = {
  v4Enabled: false,
  distilEnabled: false,
  internalOnly: false,
  hardDisabled: false,
};

const V4_HARD_DISABLED: boolean = (() => {
  try {
    return import.meta.env?.VITE_PRIVATE_STT_V4_DISABLED === 'true';
  } catch {
    return false;
  }
})();

function readFlag(key: string): boolean {
  try {
    // posthog.isFeatureEnabled returns boolean | undefined (undefined before flags load).
    return posthog?.isFeatureEnabled?.(key) === true;
  } catch (error) {
    logger.debug?.({ error, key }, '[privateV4Flags] feature-flag read failed; defaulting OFF');
    return false;
  }
}

/**
 * Resolve the current v4 flag state. Any failure / no-window / hard-disable => all OFF.
 * distilEnabled is only true when v4 is also enabled (cannot enable the accuracy
 * tier without the master switch).
 */
export function getV4FlagState(): V4FlagState {
  if (typeof window === 'undefined') return { ...ALL_OFF };
  if (V4_HARD_DISABLED) return { ...ALL_OFF, hardDisabled: true };

  const v4Enabled = readFlag(V4_FLAG_KEYS.ENABLED);
  return {
    v4Enabled,
    distilEnabled: v4Enabled && readFlag(V4_FLAG_KEYS.DISTIL_ENABLED),
    internalOnly: readFlag(V4_FLAG_KEYS.INTERNAL_ONLY),
    hardDisabled: false,
  };
}

/** Convenience: may Private STT consider the v4 path for this user right now? */
export function isV4FlagEnabled(): boolean {
  return getV4FlagState().v4Enabled;
}
