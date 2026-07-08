/**
 * Phase 5.8 APPLY — flag for the transcript-recount filler SSOT.
 *
 * DEFAULT OFF. There is NO default production enablement. When OFF, the live filler counter
 * (useFillerWords → store.fillerData) drives the live display/clarity/score exactly as today.
 *
 * When ON (dev/test only, or an explicit build env), the filler count comes from the deterministic
 * transcript RECOUNT — `countFillerWords(selected/committed transcript, userWords)` — the same value
 * Analytics/PDF/save already use; the clarity and score that consume filler inherit that source.
 *
 * Reversible: nothing is deleted, no legacy writer removed. Flipping the flag off restores today's
 * behavior byte-for-byte.
 */
let testOverride: boolean | null = null;

export function isFillerRecountSsotEnabled(): boolean {
  if (testOverride !== null) return testOverride;
  // Never on by default. Only when an explicit build flag is set (never set in the default prod build).
  return import.meta.env.VITE_FILLER_RECOUNT_SSOT === 'true';
}

/** Test-only override; pass null to clear. */
export function __setFillerRecountSsotForTests(on: boolean | null): void {
  testOverride = on;
}
