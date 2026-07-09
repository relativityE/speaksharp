/**
 * Phase 5.8 — flag for the transcript-recount filler SSOT.
 *
 * DEFAULT OFF. There is NO default production enablement. When OFF, the live filler counter
 * (useFillerWords → store.fillerData) drives the live display/clarity/score exactly as today.
 *
 * When ON, the filler count comes from the deterministic transcript RECOUNT —
 * `countFillerWords(selected/committed transcript, userWords)` — the same value Analytics/PDF/save
 * already use; the clarity and score that consume filler inherit that source.
 *
 * Exposure hierarchy (mirrors privateV4Flags — product decision):
 *  - Test override (`__setFillerRecountSsotForTests`) = deterministic unit/e2e control, wins over all.
 *  - Build env hard kill (`VITE_FILLER_RECOUNT_SSOT_DISABLED=true`) = global kill switch; forces OFF
 *    regardless of the runtime flag or build-enable env.
 *  - Build env enable (`VITE_FILLER_RECOUNT_SSOT=true`) = **dev/test/local override ONLY**. It is gated
 *    on a dev/test build (`import.meta.env.DEV || ENV.isTest`, same as isShadowMetricsEngineEnabled) and
 *    is INERT in a normal production build — so it can never override or block a PostHog rollback in prod.
 *  - PostHog runtime flag (`filler_recount_ssot_enabled`) = the runtime authority in production: real
 *    kill switch (set to 0% to roll back) + internal/canary cohort targeting enforced by PostHog.
 *    In a production build, after the hard-kill check PostHog is the ONLY enablement path.
 *
 * Reversible: nothing is deleted, no legacy writer removed. In production, with the runtime flag at 0%,
 * this returns OFF and today's behavior is preserved byte-for-byte (the dev/test build-env enable does
 * not apply). Safety: never throws — SSR/no-window, uninitialized PostHog, or any read error resolve OFF.
 */
import posthog from 'posthog-js';
import logger from '@/lib/logger';
import { ENV } from '@/config/TestFlags';

/** PostHog flag keys. Keep in sync with the PostHog project. */
export const FILLER_SSOT_FLAG_KEYS = {
  /** Runtime master switch: route the filler source to the transcript recount for this user? */
  ENABLED: 'filler_recount_ssot_enabled',
  /** Informational: this exposure is internal/canary-only (targeting enforced by PostHog). */
  INTERNAL_ONLY: 'filler_recount_ssot_internal_only',
} as const;

/** How the current ON/OFF decision was reached — enum only, for telemetry/debug. No text/PII. */
export type FillerSsotSource = 'test' | 'hard-disabled' | 'build-env' | 'posthog' | 'off';

let testOverride: boolean | null = null;

/** Build-time hard kill switch — overrides the runtime flag and the build-enable env. */
const FILLER_SSOT_HARD_DISABLED: boolean = (() => {
  try {
    return import.meta.env?.VITE_FILLER_RECOUNT_SSOT_DISABLED === 'true';
  } catch {
    return false;
  }
})();

/** Dev/test build only (mirrors isShadowMetricsEngineEnabled). Never true in a normal prod build. */
function isDevOrTestBuild(): boolean {
  try {
    return import.meta.env?.DEV === true || ENV.isTest;
  } catch {
    return false;
  }
}

/**
 * Explicit build-env enable — **dev/test/local override ONLY**. Gated on a dev/test build so it is
 * INERT in production, leaving PostHog as the sole runtime authority (and rollback path) there.
 */
function readBuildEnvEnabled(): boolean {
  try {
    return isDevOrTestBuild() && import.meta.env?.VITE_FILLER_RECOUNT_SSOT === 'true';
  } catch {
    return false;
  }
}

/** PostHog runtime flag read. `isFeatureEnabled` is boolean|undefined (undefined before load) → OFF. */
function readRuntimeFlag(key: string): boolean {
  try {
    return posthog?.isFeatureEnabled?.(key) === true;
  } catch (error) {
    logger.debug?.({ error, key }, '[fillerSsotFlag] feature-flag read failed; defaulting OFF');
    return false;
  }
}

/**
 * Resolve the source of the current decision (enum only). Priority: test → hard-kill → build-env →
 * posthog → off. Exposed so a later canary step can attribute enablement without adding text/PII.
 */
export function getFillerRecountSsotSource(): FillerSsotSource {
  if (testOverride !== null) return testOverride ? 'test' : 'off';
  if (FILLER_SSOT_HARD_DISABLED) return 'hard-disabled';
  if (readBuildEnvEnabled()) return 'build-env';
  if (readRuntimeFlag(FILLER_SSOT_FLAG_KEYS.ENABLED)) return 'posthog';
  return 'off';
}

/** Is this exposure internal/canary-only (informational; targeting enforced by PostHog)? */
export function isFillerRecountSsotInternalOnly(): boolean {
  return readRuntimeFlag(FILLER_SSOT_FLAG_KEYS.INTERNAL_ONLY);
}

/**
 * The single question every consumer asks: should filler come from the transcript recount right now?
 * DEFAULT OFF. Byte-identical to legacy when: no test override, no hard-kill, build env unset, and the
 * PostHog flag is absent/0% (`isFeatureEnabled` → undefined/false).
 */
export function isFillerRecountSsotEnabled(): boolean {
  if (testOverride !== null) return testOverride;
  if (FILLER_SSOT_HARD_DISABLED) return false;
  if (readBuildEnvEnabled()) return true;
  return readRuntimeFlag(FILLER_SSOT_FLAG_KEYS.ENABLED);
}

/** Test-only override; pass null to clear. Wins over env, PostHog, and the hard kill. */
export function __setFillerRecountSsotForTests(on: boolean | null): void {
  testOverride = on;
}
