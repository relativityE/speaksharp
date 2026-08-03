/**
 * #1120 S1 — STT launch preflight (contradictory-state falsification).
 *
 * Encodes the authoritative public-release invariant for the STT hierarchy + Cloud gates so a release
 * check can FAIL CLOSED on any contradictory or Cloud-enabling configuration before it ships.
 *
 * Authoritative states (PR #1155):
 *  - Launch acceptance:   hierarchy ON (Private primary, not hard-disabled) AND both Cloud gates OFF.
 *  - Hierarchy rollback:  hierarchy OFF/hard-disabled AND both Cloud gates OFF (Browser default; Cloud stays
 *                         off + unreachable — rollback NEVER enables Cloud).
 *  - Any client/server Cloud-gate disagreement fails (a stale/partial deploy must never ship).
 *  - Both Cloud gates ON is INTERNAL characterization only — it is NOT public-launch acceptable.
 */

export interface SttLaunchState {
  /** PostHog `stt_private_primary_v1` resolved ON (Private is primary). */
  hierarchyPrimary: boolean;
  /** Build env `VITE_STT_PRIVATE_PRIMARY_DISABLED === 'true'` — hard kill overriding the flag. */
  hierarchyHardDisabled: boolean;
  /** Client gate `VITE_CLOUD_STT_ENABLED === 'true'`. */
  clientCloudEnabled: boolean;
  /** Edge gate `CLOUD_STT_ENABLED === 'true'`. */
  serverCloudEnabled: boolean;
}

export interface SttPreflightVerdict {
  /** True only for the launch acceptance state. */
  launchAcceptable: boolean;
  /** True only for the hierarchy rollback state. */
  rollbackAcceptable: boolean;
  /** True when the config is neither a valid launch nor a valid rollback state. */
  publicReleaseBlocked: boolean;
  /** Human-readable blocking reasons (empty when a valid public state). */
  reasons: string[];
}

export function evaluateSttLaunchPreflight(state: SttLaunchState): SttPreflightVerdict {
  const reasons: string[] = [];

  const hierarchyOn = state.hierarchyPrimary && !state.hierarchyHardDisabled;
  const cloudGatesAgree = state.clientCloudEnabled === state.serverCloudEnabled;
  const cloudFullyOff = !state.clientCloudEnabled && !state.serverCloudEnabled;

  // Cloud must be OFF on BOTH gates for ANY public state (launch or rollback).
  if (!cloudGatesAgree) {
    reasons.push('Cloud client/server gate disagreement (VITE_CLOUD_STT_ENABLED vs CLOUD_STT_ENABLED)');
  } else if (!cloudFullyOff) {
    // Gates agree AND are both ON — internal characterization only, never public-launch.
    reasons.push('Both Cloud gates ON — internal characterization only, not public-launch acceptable');
  }

  const launchAcceptable = hierarchyOn && cloudFullyOff;
  const rollbackAcceptable = !hierarchyOn && cloudFullyOff;

  if (cloudFullyOff && !hierarchyOn) {
    // Valid rollback; note it so callers can distinguish from a hard block.
    reasons.push('Hierarchy OFF/hard-disabled — hierarchy rollback state (Browser default, Cloud still off)');
  }

  const publicReleaseBlocked = !launchAcceptable && !rollbackAcceptable;
  return { launchAcceptable, rollbackAcceptable, publicReleaseBlocked, reasons };
}
