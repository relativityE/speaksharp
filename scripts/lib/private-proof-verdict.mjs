// #1314 Phase B — the Private-STT proof VERDICT, extracted from the CDP harness so it can be fixture-tested
// without a browser, a deploy, or a human.
//
// This exists because the previous harness's verdict fields were not merely noisy, they were STRUCTURALLY
// UNREACHABLE: `terminalObserved` gated on a `data-recording` attribute that does not exist, and the WER text
// scraped `transcript-container`, a testid nothing renders. Both silently produced "no evidence" that read as
// "nothing went wrong". A verdict that cannot fail is not a verdict, and a verdict that cannot be exercised
// offline gets debugged during someone's real-device run.
//
// Design rule: PASS is the conjunction of explicitly satisfied REQUIREMENTS. Absent evidence is never a pass —
// every requirement must be positively demonstrated by the captured timeline.

/** Every requirement the qualification must positively demonstrate. Order is report order. */
export const REQUIREMENTS = [
  'exact_release',        // the page ran the deployed build
  'private_runtime',      // Private engine, not Browser/Cloud
  'zero_cloud',           // no provider transcription calls
  'live_transcript',      // transcript visible + cumulative WHILE recording
  'terminal_reached',     // a real recording actually reached a terminal state
  'working_memory_purged',// store transcript + save-candidate cleared at terminal
  'diagnostics_text_free',// no transcript-bearing string on the diagnostic surface, at ANY phase
  'recognition_captured', // recognized text captured for WER (benchmark artifact only)
  'metrics_persisted',    // the save boundary succeeded
  'one_valid_next_action',// exactly one VALID next action; an integrity error is not one
];

const fail = (reasons, code, detail) => { reasons.push(detail ? `${code}: ${detail}` : code); return false; };

/**
 * Release gate. Kept separate because the harness must refuse to even ARM against a stale bundle — producing a
 * verdict at all would imply the evidence is about the deployed build.
 */
export function evaluateRelease(running, expected) {
  if (!expected) return { ok: false, code: 'NO_EXPECTED_RELEASE' };
  if (!running) return { ok: false, code: 'STALE_BUNDLE', running: null, expected };
  if (running !== expected) return { ok: false, code: 'STALE_BUNDLE', running, expected };
  return { ok: true, code: 'RELEASE_OK', running, expected };
}

/**
 * A stale bundle also betrays itself in the SHAPE of its diagnostics: pre-cutover builds exposed the raw
 * transcript strings `selectedTranscriptForSave` / `saveCandidate.selectedForSave`, which the cutover renamed to
 * `...Length` numbers. Seeing a string there means the release gate was bypassed or lied to.
 */
export function hasDeprecatedRawDiagnosticFields(sample) {
  const fields = sample?.diagLongStringFields ?? [];
  return fields.some((f) => /\.selectedTranscriptForSave\[|\.selectedForSave\[/.test(f));
}

const isRecording = (s) => s?.controllerState === 'RECORDING';
const isTerminal = (s) => s?.controllerState === 'READY' || s?.controllerState === 'IDLE';

/**
 * Reduce a captured timeline + network evidence to a verdict.
 *
 * @param {object} input
 * @param {string|null} input.release           running release id
 * @param {string} input.expectedRelease        deployed release id
 * @param {Array<object>} input.samples         per-tick samples
 * @param {Array<object>} input.persistenceCalls save-boundary requests (status/ok/error)
 * @param {Array<object>} input.cloudHits       provider transcription requests
 * @param {{recognizedLen:number}} input.benchmark
 */
export function evaluateProof({ release, expectedRelease, samples = [], persistenceCalls = [], cloudHits = [], benchmark = { recognizedLen: 0 } }) {
  const reasons = [];
  const met = {};

  const rel = evaluateRelease(release, expectedRelease);
  met.exact_release = rel.ok || fail(reasons, 'STALE_BUNDLE', `running=${rel.running ?? 'null'} expected=${rel.expected ?? 'null'}`);

  if (samples.length === 0) {
    for (const r of REQUIREMENTS) if (met[r] === undefined) met[r] = false;
    reasons.push('NO_SAMPLES');
    return { pass: false, met, reasons, requirements: REQUIREMENTS };
  }

  const recordingSamples = samples.filter(isRecording);

  met.private_runtime = samples.some((s) => s.serviceMode === 'private')
    || fail(reasons, 'PRIVATE_RUNTIME_NOT_OBSERVED');

  met.zero_cloud = cloudHits.length === 0
    || fail(reasons, 'CLOUD_REQUESTS', `${cloudHits.length}`);

  // Visible AND cumulative: a single non-zero reading could be a placeholder banner. Require growth, and require
  // it from the DOM the user actually sees — this is the check the dead-selector bug silently voided.
  const domLens = recordingSamples.map((s) => s.dom_transcript_len ?? 0);
  const sawElement = recordingSamples.some((s) => s.dom_transcript_present === true);
  const grew = domLens.some((v, i) => i > 0 && v > domLens[i - 1] && v > 0);
  met.live_transcript = (sawElement && grew)
    || fail(reasons, 'LIVE_TRANSCRIPT_NOT_OBSERVED',
        !sawElement ? 'transcript element never present (selector likely wrong)' : 'transcript never grew while recording');

  const sawRecording = recordingSamples.length > 0;
  const terminalIdx = samples.findIndex((s, i) => isTerminal(s) && samples.slice(0, i).some(isRecording));
  met.terminal_reached = (sawRecording && terminalIdx >= 0)
    || fail(reasons, 'TERMINAL_NOT_REACHED', sawRecording ? 'recording never reached a terminal state' : 'never recorded');

  const terminalSamples = terminalIdx >= 0 ? samples.slice(terminalIdx) : [];
  met.working_memory_purged = (terminalSamples.length > 0
      && terminalSamples.every((s) => (s.transcriptLength ?? 0) === 0 && s.saveCandidate_present !== true))
    || fail(reasons, 'WORKING_MEMORY_NOT_PURGED');

  // At ANY phase, not merely after READY: a transcript-bearing diagnostic during STOPPING is still a leak.
  const leaking = samples.filter((s) => (s.diagLongStringFields ?? []).length > 0);
  met.diagnostics_text_free = leaking.length === 0
    || fail(reasons, 'DIAGNOSTICS_CARRIED_TEXT', `${leaking.length} sample(s)`);

  if (samples.some(hasDeprecatedRawDiagnosticFields)) {
    met.exact_release = fail(reasons, 'DEPRECATED_RAW_DIAGNOSTIC_FIELDS',
      'pre-cutover selectedTranscriptForSave/selectedForSave strings present — evidence is not about the deployed build');
  }

  met.recognition_captured = (benchmark?.recognizedLen ?? 0) > 0
    || fail(reasons, 'NO_RECOGNIZED_TEXT', 'nothing captured for WER');

  const failedWrites = persistenceCalls.filter((c) => c.ok === false);
  met.metrics_persisted = (persistenceCalls.length > 0 && failedWrites.length === 0)
    || fail(reasons, persistenceCalls.length === 0 ? 'NO_PERSISTENCE_CALLS' : 'PERSISTENCE_FAILED',
        failedWrites.map((c) => `${c.endpoint} ${c.status}${c.error?.code ? ` (${c.error.code})` : ''}`).join(', ') || undefined);

  // An integrity error is a rendered FAILURE, not a next action. Conflating them is exactly how the prior run's
  // `oneNextAction: 1` read as a pass.
  const sawIntegrityError = samples.some((s) => (s.nextActionIntegrityError ?? 0) > 0);
  const sawExactlyOneValid = samples.some((s) => (s.nextActionValid ?? 0) === 1);
  met.one_valid_next_action = (sawExactlyOneValid && !sawIntegrityError)
    || fail(reasons, sawIntegrityError ? 'NEXT_ACTION_INTEGRITY_ERROR' : 'NO_VALID_NEXT_ACTION');

  return { pass: REQUIREMENTS.every((r) => met[r] === true), met, reasons, requirements: REQUIREMENTS };
}
