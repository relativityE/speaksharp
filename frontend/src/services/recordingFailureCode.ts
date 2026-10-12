import { LEASE_NOT_HELD_MESSAGE, LEASE_UNCONFIRMED_MESSAGE } from './recordingLeasePolicy';

/**
 * #1258 (PO 2026-10-12) — WHICH FAILURE, AS A CLOSED CODE.
 *
 * Every save failure in Production reached `FAILED` with `transition_cause: "Error"`: the alpha baseline (runs 38298685079,
 * 38304068207) and the 2026-10-06 failure all look identical, though the stop path can fail on a revoked lease, a usage
 * limit, a refused save, a failed completion or attestation, or an engine error. The class name cannot tell them apart and
 * the message is never sent (it can carry request material). This maps each AUTHORED failure to a closed code; anything
 * else is `other`. Only the code leaves the device — never the message.
 */
export const RECORDING_FAILURE_CODES = [
    'lease_not_held', 'lease_unconfirmed', 'usage_exceeded', 'session_save_failed', 'session_completion_failed',
    'attestation_failed', 'finalize_timeout', 'producer_integrity', 'heartbeat_failure', 'start_failed',
    'start_model_unavailable', 'start_gate_closed', 'start_did_not_record', 'candidate_identity_mismatch',
    'service_missing', 'strategy_missing', 'previous_service_not_retired', 'engine_error', 'mic_permission',
    'timeout', 'aborted', 'mic_not_allowed', 'mic_not_readable', 'other',
] as const;
export type RecordingFailureCode = (typeof RECORDING_FAILURE_CODES)[number];

/** An error the controller raised itself, tagged with its code where the message is not authored (engine errors). */
export function withFailureCode<E extends Error>(error: E, code: RecordingFailureCode): E {
    return Object.assign(error, { failureCode: code });
}

const EXACT: ReadonlyArray<readonly [string, RecordingFailureCode]> = [
    [LEASE_NOT_HELD_MESSAGE, 'lease_not_held'],
    [LEASE_UNCONFIRMED_MESSAGE, 'lease_unconfirmed'],
    ['Session save failed', 'session_save_failed'],
    ['SESSION_COMPLETION_FAILED', 'session_completion_failed'],
    ['PRODUCER_INTEGRITY_ENGINE_CHANGED', 'producer_integrity'],
    ['HEARTBEAT_FAILURE', 'heartbeat_failure'],
    ['RECORDING_START_FAILED', 'start_failed'],
    ['RECORDING_START_MODEL_UNAVAILABLE', 'start_model_unavailable'],
    ['SERVICE_MISSING', 'service_missing'],
    ['STT_STRATEGY_MISSING_AFTER_ENSURE_READY', 'strategy_missing'],
    ['PREVIOUS_TAKE_SERVICE_NOT_RETIRED', 'previous_service_not_retired'],
];
/** Authored messages that carry a variable suffix: matched on their fixed opening only. */
const PREFIX: ReadonlyArray<readonly [string, RecordingFailureCode]> = [
    ['Usage limit exceeded', 'usage_exceeded'],
    ['attestation failed', 'attestation_failed'],
    ['STT_HEARTBEAT_FAILURE', 'heartbeat_failure'],
    ['RECORDING_START_GATE_CLOSED:', 'start_gate_closed'],
    ['TRANSCRIPTION_START_DID_NOT_RECORD:', 'start_did_not_record'],
    ['RUNTIME_CANDIDATE_IDENTITY_MISMATCH:', 'candidate_identity_mismatch'],
];
/** DOMException and timer names are a closed browser vocabulary. */
const BY_NAME: Readonly<Record<string, RecordingFailureCode>> = {
    FinalizationTimeoutError: 'finalize_timeout',
    TimeoutError: 'timeout',
    AbortError: 'aborted',
    NotAllowedError: 'mic_not_allowed',
    NotReadableError: 'mic_not_readable',
};

/** The closed code for a failure, or null when there is no error. The message is read only to match authored text. */
export function recordingFailureCode(error: unknown): RecordingFailureCode | null {
    if (error === null || error === undefined) return null;
    const tagged = (error as { failureCode?: unknown }).failureCode;
    if (typeof tagged === 'string' && (RECORDING_FAILURE_CODES as readonly string[]).includes(tagged)) {
        return tagged as RecordingFailureCode;
    }
    // By name first: a DOMException (mic denied, abort) is not an `Error` instance in every runtime.
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string' && Object.prototype.hasOwnProperty.call(BY_NAME, name)) return BY_NAME[name];
    if (!(error instanceof Error)) return 'other';
    const message = error.message ?? '';
    for (const [text, code] of EXACT) if (message === text) return code;
    for (const [prefix, code] of PREFIX) if (message.startsWith(prefix)) return code;
    return 'other';
}
