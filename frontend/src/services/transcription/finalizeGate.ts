// Track 1 — post-save "ready" publish gate.
//
// The finalized-ready signal (finalizedAnalysis → completion toast / Analytics cue / settled
// reconciliation copy) may publish ONLY when BOTH terminal tracks succeed AND the finalize token is
// still current:
//
//   A. Transcript track  — native formatter complete (final display applied), native formatter failed
//                          (word-preserving raw fallback selected), or non-native (already terminal).
//   B. Persistence track — the filler/metrics updateSession call completed SUCCESSFULLY.
//
// If metrics persistence fails, the warning status is preserved and the success UI never shows.
// If a newer session supersedes this stop, the token is stale and nothing publishes.

export interface FinalizeTracks {
    /** Transcript track reached terminal (formatter complete/failed, or non-native). */
    formatterDone: boolean;
    /** Persistence track reached terminal (the filler/metrics updateSession call resolved). */
    metricsDone: boolean;
    /** The metrics/filler persistence SUCCEEDED. false → keep the warning, show no ready UI. */
    metricsOk: boolean;
    /** The finalize token is still current (no newer session started/stopped since this stop). */
    tokenValid: boolean;
}

/** True only when both tracks are terminal, metrics persisted successfully, and the token is valid. */
export function shouldPublishFinalized(t: FinalizeTracks): boolean {
    return t.tokenValid && t.formatterDone && t.metricsDone && t.metricsOk;
}
