/**
 * Private STT corpus acceptance validator.
 *
 * Encodes the test-agent report's gate as code so dev "done" claims map to the
 * SAME acceptance criteria the test agent applies, instead of just unit tests.
 *
 * A focused Private CPU row FAILS acceptance if any of:
 *   - structured runtime telemetry is missing (privateRuntime/privateProvider null)
 *   - cloud fallback was attempted (privacy violation) or not provably false
 *   - the final transcript is wrong (truth-preserving substrings missing)
 *   - stop finalization exceeded the hard latency limit
 *
 * Pure + dependency-free so it runs with no browser. Used both by the artifact
 * validator test and (optionally) by the corpus harness to gate a run.
 */

export const PRIVATE_ACCEPTANCE = {
  STOP_FINALIZATION_HARD_LIMIT_MS: 8000,
  FIRST_TEXT_HARD_LIMIT_MS: 5000,
};

/**
 * Validate a single corpus result row. `requiredFinalSubstrings` lets the caller
 * assert truth-preserving fragments (e.g. ['pepper spoils'] for h1_2).
 */
export function validatePrivateRow(row, requiredFinalSubstrings = []) {
  const failures = [];

  if (!row || typeof row !== 'object') {
    return { fixture: row?.fixture ?? 'unknown', pass: false, failures: ['row_missing'] };
  }

  // Runtime telemetry must be structurally present (the P0.1 gate).
  if (row.privateRuntime == null) failures.push('runtime_telemetry_null');
  if (row.privateProvider == null) failures.push('provider_telemetry_null');

  // Privacy invariant: cloud fallback must be provably false (never null/true).
  if (row.privateCloudFallbackAttempted !== false) failures.push('cloud_fallback_not_proven_false');

  // Final transcript correctness (truth-preserving fragments).
  const finalText = String(row.detailTranscript ?? row.postStopTranscript ?? '').toLowerCase();
  for (const fragment of requiredFinalSubstrings) {
    if (!finalText.includes(String(fragment).toLowerCase())) {
      failures.push(`final_missing:${fragment}`);
    }
  }

  // Latency gate.
  if (typeof row.stopFinalizationMs === 'number' && row.stopFinalizationMs > PRIVATE_ACCEPTANCE.STOP_FINALIZATION_HARD_LIMIT_MS) {
    failures.push(`stop_finalization_over_limit:${row.stopFinalizationMs}`);
  }

  return { fixture: row.fixture, pass: failures.length === 0, failures };
}

/**
 * Validate a whole corpus artifact. `expectations` maps fixtureId ->
 * requiredFinalSubstrings[]. Returns per-row results plus an overall verdict.
 */
export function validatePrivateCorpusArtifact(artifact, expectations = {}) {
  const results = Array.isArray(artifact?.results) ? artifact.results : [];
  const rows = results
    .filter((row) => row && row.mode !== 'native' && row.fixture)
    .map((row) => validatePrivateRow(row, expectations[row.fixture] ?? []));

  return {
    rowCount: rows.length,
    passCount: rows.filter((r) => r.pass).length,
    failCount: rows.filter((r) => !r.pass).length,
    pass: rows.length > 0 && rows.every((r) => r.pass),
    rows,
  };
}
