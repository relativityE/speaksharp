// #1033 — STT engine-attribution lifecycle (durable contract, Option B).
// `attribution_status` is a CONSTRAINED TEXT status column (a TEXT column + CHECK constraint on
// public.sessions, not a PostgreSQL ENUM type). A saved session's `attribution_status` self-describes
// whether its persisted STT identity
// (engine / engine_version / model_name / device_type) was actually confirmed — so analytics,
// benchmarks, audits and Report Issue never have to infer it from engine_version naming.

export const ATTRIBUTION_STATUS = {
  /** Existing rows created before this feature. NEVER inferred/promoted to verified. */
  LEGACY_UNKNOWN: 'legacy_unknown',
  /** A new recording row was created; finalization identity not yet written (DB column default). */
  PENDING: 'pending',
  /** Finalization succeeded AND the full producing-engine tuple was written in one atomic update. */
  VERIFIED: 'verified',
  /** Finalization completed but the producing identity could not be resolved (no invented tokens). */
  UNVERIFIED: 'unverified',
} as const;

export type AttributionStatus = (typeof ATTRIBUTION_STATUS)[keyof typeof ATTRIBUTION_STATUS];

export const ATTRIBUTION_STATUS_VALUES: readonly AttributionStatus[] = Object.values(ATTRIBUTION_STATUS);

/**
 * Engine-specific evidence rule: only `verified` rows may be used for engine/WER/latency comparisons.
 * Do NOT use engine_version string heuristics. Use this predicate everywhere engine-specific evidence
 * is aggregated (analytics, STT benchmarks, the tester-evidence audit).
 */
export function isVerifiedAttribution(status: string | null | undefined): boolean {
  return status === ATTRIBUTION_STATUS.VERIFIED;
}
