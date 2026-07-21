/**
 * Feature-flag resolver for the Executive Outcome Rehearsal MVP.
 *
 * Mirrors the Private-STT-v4 flag pattern (`privateV4Flags.ts`): a build-env hard kill switch
 * overrides everything, PostHog is the runtime source of truth, and the resolver NEVER throws —
 * it resolves OFF on any error / SSR / uninitialised client so the feature is default-safe.
 *
 * Two independently-gated capabilities:
 *  - `rehearsalEnabled`      — the whole Executive Outcome Rehearsal purpose layer (default OFF).
 *  - `semanticNudgesEnabled` — the optional P1 in-session semantic AI nudges (default OFF, and
 *    additionally gated on explicit per-user consent at the call site — a flag ON does NOT imply
 *    consent to send transcript text to a cloud service; see outcomeScorecard privacy notes).
 *
 * This module performs NO network I/O and sends NO transcript/brief text anywhere.
 */

export const EXEC_REHEARSAL_FLAG_KEYS = {
  enabled: 'executive_rehearsal_enabled',
  semanticNudges: 'executive_rehearsal_semantic_nudges_enabled',
} as const;

export interface ExecutiveRehearsalFlagState {
  /** The rehearsal purpose layer is available. Default OFF. */
  rehearsalEnabled: boolean;
  /** Optional P1 semantic AI nudges are permitted by config. Default OFF. Consent is separate. */
  semanticNudgesEnabled: boolean;
}

const OFF: ExecutiveRehearsalFlagState = Object.freeze({
  rehearsalEnabled: false,
  semanticNudgesEnabled: false,
});

/** Minimal shape of a PostHog-like client we read flags from. Kept structural to avoid coupling. */
export interface FlagReader {
  isFeatureEnabled?: (key: string) => boolean | undefined;
}

/**
 * Build-env hard kill switch. When `VITE_EXECUTIVE_REHEARSAL_DISABLED === 'true'` the feature is
 * force-OFF regardless of any runtime flag. Reading import.meta.env is guarded so this never throws.
 */
function isHardDisabled(): boolean {
  try {
    return (import.meta as unknown as { env?: Record<string, unknown> })?.env?.VITE_EXECUTIVE_REHEARSAL_DISABLED === 'true';
  } catch {
    return false;
  }
}

/**
 * Resolve the flag state. Never throws; returns the frozen OFF state on the hard kill switch, a
 * missing/failing reader, or any error. A `true` from the reader only flips a capability ON.
 */
export function getExecutiveRehearsalFlagState(reader?: FlagReader | null): ExecutiveRehearsalFlagState {
  if (isHardDisabled()) return OFF;
  if (!reader || typeof reader.isFeatureEnabled !== 'function') return OFF;
  try {
    const rehearsalEnabled = reader.isFeatureEnabled(EXEC_REHEARSAL_FLAG_KEYS.enabled) === true;
    if (!rehearsalEnabled) return OFF; // semantic nudges require the parent capability ON.
    const semanticNudgesEnabled = reader.isFeatureEnabled(EXEC_REHEARSAL_FLAG_KEYS.semanticNudges) === true;
    return Object.freeze({ rehearsalEnabled, semanticNudgesEnabled });
  } catch {
    return OFF;
  }
}
