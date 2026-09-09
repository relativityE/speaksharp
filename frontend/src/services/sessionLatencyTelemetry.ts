import { analyticsBuffer } from './AnalyticsBuffer';
import type { TranscriptionMode } from './transcription/TranscriptionPolicy';

/**
 * #1428 F-15/F-16 — content-free session latency measurements.
 *
 * These boundaries are deliberately attached to the lifecycle authorities rather than DOM paint,
 * network observation, or a test-only trace:
 *
 * - start: accepted Start intent -> authoritative RECORDING, classified by cold/cached model state;
 * - save: Stop intent -> terminal persistence result;
 * - review: the same Stop intent -> the retained review read reaches a terminal state.
 *
 * There is intentionally no pass/fail threshold here. These are observations for establishing a real-world
 * baseline. Product acceptance can add a target only after the Product Owner approves one.
 */
export const SESSION_LATENCY_EVENTS = Object.freeze({
    START: 'session_start_latency_measured',
    SAVE: 'session_save_latency_measured',
    REVIEW: 'session_review_latency_measured',
} as const);

export type SessionStartOutcome = 'recording_started' | 'failed' | 'refused';
export type SessionSaveOutcome = 'saved' | 'discarded' | 'failed';
export type SessionReviewOutcome = 'available' | 'unavailable';
export type ModelCacheState = 'cold' | 'cached' | 'not_applicable';

export interface SessionLatencyMeasurement<Outcome extends string> {
    /**
     * Complete this measurement exactly once. Returns the emitted duration, or null after settlement.
     * The returned value exists for deterministic tests and local diagnostics; it never gates behavior.
     */
    settle: (outcome: Outcome) => number | null;
}

type Now = () => number;

const monotonicNow: Now = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

function beginMeasurement<Outcome extends string>(
    event: typeof SESSION_LATENCY_EVENTS[keyof typeof SESSION_LATENCY_EVENTS],
    mode: TranscriptionMode,
    fixedProperties: Readonly<Record<string, string>>,
    now: Now,
): SessionLatencyMeasurement<Outcome> {
    const startedAt = now();
    let settled = false;

    return {
        settle(outcome: Outcome): number | null {
            if (settled) return null;
            settled = true;

            // A monotonic clock should never move backwards, but clamp a malformed/test clock to zero so the
            // governed schema remains truthful. MAX_SAFE_INTEGER is a representational limit, not an SLO.
            const elapsed = now() - startedAt;
            const durationMs = Math.min(
                Number.MAX_SAFE_INTEGER,
                Math.max(0, Math.round(Number.isFinite(elapsed) ? elapsed : 0)),
            );

            // Numeric duration + closed enums only. No recording/session id, transcript, audio, error text,
            // route, user-entered data, or arbitrary property bag can enter this producer.
            try {
                analyticsBuffer.push(event, {
                    duration_ms: durationMs,
                    mode,
                    outcome,
                    ...fixedProperties,
                });
            } catch {
                // Observability must never turn a successful Start/Stop lifecycle into a product failure.
            }
            return durationMs;
        },
    };
}

export function beginSessionStartLatency(
    mode: TranscriptionMode,
    modelCacheState: ModelCacheState,
    now: Now = monotonicNow,
): SessionLatencyMeasurement<SessionStartOutcome> {
    return beginMeasurement(
        SESSION_LATENCY_EVENTS.START,
        mode,
        { model_cache_state: modelCacheState },
        now,
    );
}

export function beginSessionSaveLatency(
    mode: TranscriptionMode,
    now: Now = monotonicNow,
): SessionLatencyMeasurement<SessionSaveOutcome> {
    return beginMeasurement(SESSION_LATENCY_EVENTS.SAVE, mode, {}, now);
}

export function beginSessionReviewLatency(
    mode: TranscriptionMode,
    now: Now = monotonicNow,
): SessionLatencyMeasurement<SessionReviewOutcome> {
    return beginMeasurement(SESSION_LATENCY_EVENTS.REVIEW, mode, {}, now);
}
