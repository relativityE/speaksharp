/**
 * #1259 — journey events for the recording lifecycle (F01, F16).
 *
 * WHAT PRODUCTION ALREADY PROVES, AND WHAT IT CANNOT. PostHog holds the PO's session: the model
 * reported ready at 12:33:39 and `session_started` arrived at 12:35:32 — 113 seconds later, and 126
 * seconds on the second run. So the GAP is already observable. What is not observable is the user:
 * `session_started` is pushed only after `startRecording()` RESOLVES, so a click that was refused
 * emits nothing at all, and a click that was never made looks identical to one that was swallowed.
 *
 * `handleStartStop` has four paths that return before recording begins, and today every one of them
 * is silent to analytics:
 *
 *   - `isProcessingRef.current` — a second click while the first is in flight. Returns with no log.
 *   - `isTranscriptFinalizing`  — the anti-stray-recording gate. Logs a warning, emits nothing.
 *   - `usageLimit.can_start`    — trial exhausted.
 *   - `isLockHeldByOther`       — another tab owns the session.
 *
 * F01 asks us to separate four outcomes, and each needs the intent, not the success:
 *
 *   one click -> preparation -> recording     : one intent, accepted, long ms_to_recording
 *   one click -> readiness -> silent wait     : one intent, accepted, no RECORDING transition follows
 *   two clicks required                       : two intents, the first NOT accepted, with its reason
 *   two clicks -> two starts                  : two intents accepted, attempt_seq 1 and 2
 *
 * The envelope supplies `journey_id`, `attempt_id` and `attempt_seq`, so these events carry no
 * identity of their own.
 */
import { safeEmit } from './safeEmit';

/** Why an intent did not become a recording. `accepted` is the only outcome that starts one. */
export type IntentOutcome =
    | 'accepted'
    | 'suppressed_in_flight'
    | 'suppressed_finalizing'
    | 'blocked_usage_limit'
    | 'blocked_stale_client'
    | 'blocked_lock_held'
    | 'failed';

export type IntentKind = 'start' | 'stop';

/** The completion stages, emitted as separate rows. F16 is unanswerable from one total. */
export type LatencyStage =
    | 'model_acquisition'
    | 'ready_to_intent'
    | 'intent_to_recording'
    | 'recording_to_stop_intent'
    | 'stop_intent_to_termination';

let readyAt: number | null = null;
let lastIntentAt: number | null = null;

/** Record when the runtime became READY, so an intent can say how long the user waited. */
export function markRuntimeReady(): void { readyAt = Date.now(); }

/** Clear readiness — a torn-down engine's old readiness must not date the next intent. */
export function clearRuntimeReady(): void { readyAt = null; }

function since(mark: number | null): number | null {
    if (mark === null) return null;
    const delta = Date.now() - mark;
    // A negative or absurd delta means the mark is stale, not that the user waited a day. Null is the
    // honest answer; a fabricated duration would be indistinguishable from a real measurement.
    return delta >= 0 && delta <= 86_400_000 ? delta : null;
}

export function emitRecordingIntent(input: {
    kind: IntentKind;
    outcome: IntentOutcome;
    runtimeState: string | null;
    modelReady: boolean;
}): void {
    if (input.kind === 'start') lastIntentAt = Date.now();
    safeEmit('recording_intent', {
        intent_kind: input.kind,
        intent_outcome: input.outcome,
        runtime_state_at_intent: input.runtimeState,
        model_ready: input.modelReady,
        // THE NUMBER THAT MAKES F01 A MEASUREMENT. Production already shows 113s between readiness and
        // the start event; this attaches that wait to the CLICK, so a silent wait and a second click
        // stop looking the same.
        ms_since_ready: since(readyAt),
    }, 'HIGH');
}

/** A runtime state transition. Transitions only — never a poll of unchanged state. */
export function emitRecordingState(from: string, to: string, cause: string | null): void {
    safeEmit('recording_state', {
        from_state: from,
        to_state: to,
        transition_cause: cause,
        ms_since_intent: since(lastIntentAt),
    }, 'LOW');
}

/** Milliseconds since the last START intent, or null when there is none or the mark is stale. */
export function msSinceIntent(): number | null { return since(lastIntentAt); }

/** Milliseconds since the runtime last reported READY. */
export function msSinceReady(): number | null { return since(readyAt); }

/** One stage, one row. Never a collapsed total — see LatencyStage. */
export function emitStageLatency(stage: LatencyStage, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    safeEmit('stage_latency', {
        stage,
        duration_ms: Math.round(durationMs),
    }, 'LOW');
}

/** Test seam. */
export function __resetJourneyEventsForTests(): void {
    readyAt = null;
    lastIntentAt = null;
}
