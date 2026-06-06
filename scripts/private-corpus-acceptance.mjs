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

const asArray = (value) => Array.isArray(value) ? value : [];
const eventName = (event) => String(event?.event ?? event?.name ?? event?.type ?? '');
const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isSpeechFixture = (row) => {
  if (row?.expectedSpeech === false || row?.expectedSilence === true) return false;
  const fixture = String(row?.fixture ?? '').toLowerCase();
  return !/(silence|near[-_ ]?silence|tone|empty)/i.test(fixture);
};

/**
 * Classify invalid harness/audio-delivery evidence before model accuracy.
 *
 * This intentionally runs only when the row includes audio/timeline/timing proof
 * fields. Older artifact rows without those fields still validate via the legacy
 * acceptance checks; current proof rows with zero audio must be INVALID, never a
 * model FAIL.
 */
export function classifyPrivateAudioValidity(row) {
  if (!row || typeof row !== 'object') {
    return { valid: false, reason: 'row_missing' };
  }

  const privateTrace = [
    ...asArray(row.privateTrace),
    ...asArray(row.privateTimeline),
  ];
  const privateAudioChunks = [
    ...asArray(row.privateAudioChunks),
    ...asArray(row.privateUtteranceAudioChunks),
  ];
  const hasProofFields = privateTrace.length > 0
    || privateAudioChunks.length > 0
    || Object.prototype.hasOwnProperty.call(row, 'privateTrace')
    || Object.prototype.hasOwnProperty.call(row, 'privateTimeline')
    || Object.prototype.hasOwnProperty.call(row, 'privateAudioChunks')
    || Object.prototype.hasOwnProperty.call(row, 'privateUtteranceAudioChunks');

  if (!hasProofFields) {
    return { valid: true, reason: null };
  }

  const hasProcessAudioReady = privateTrace.some((event) => eventName(event) === 'process_audio_ready');
  const hasSpeechStart = privateTrace.some((event) => eventName(event) === 'speech_start_detected');

  if (finiteNumber(row.stopFinalizationMs) && row.stopFinalizationMs <= 0) {
    return { valid: false, reason: `invalid_impossible_timing:${row.stopFinalizationMs}` };
  }

  if (privateAudioChunks.length === 0) {
    return { valid: false, reason: 'invalid_no_audio_delivered' };
  }

  if (!hasProcessAudioReady) {
    return { valid: false, reason: 'invalid_process_audio_ready_missing' };
  }

  if (privateAudioChunks.length > 0) {
    const energyValues = privateAudioChunks.flatMap((chunk) => [chunk.rms, chunk.peak]).filter(finiteNumber);
    if (energyValues.length > 0 && energyValues.every((value) => value <= 0)) {
      return { valid: false, reason: 'invalid_zero_audio_energy' };
    }
  }

  if (isSpeechFixture(row) && privateTrace.length > 0 && !hasSpeechStart) {
    return { valid: false, reason: 'invalid_no_speech_start_detected' };
  }

  return { valid: true, reason: null };
}

/**
 * Validate a single corpus result row. `requiredFinalSubstrings` lets the caller
 * assert truth-preserving fragments (e.g. ['pepper spoils'] for h1_2).
 */
export function validatePrivateRow(row, requiredFinalSubstrings = []) {
  const failures = [];

  if (!row || typeof row !== 'object') {
    return { fixture: row?.fixture ?? 'unknown', pass: false, failures: ['row_missing'] };
  }

  const audioValidity = classifyPrivateAudioValidity(row);
  if (!audioValidity.valid) {
    return {
      fixture: row.fixture,
      pass: false,
      invalid: true,
      invalidReason: audioValidity.reason,
      failures: [audioValidity.reason],
    };
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
