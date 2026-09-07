import { analyticsBuffer } from './AnalyticsBuffer';
import type { TranscriptionMode } from './transcription/TranscriptionPolicy';

/**
 * #1428 F-15/F-16 — content-free session latency measurements.
 *
 * These boundaries are deliberately attached to the lifecycle authorities rather than DOM paint,
 * network observation, or a test-only trace:
 *
 * - initialization: immediately before the controller receives Start -> its promise resolves at RECORDING;
 * - stop-to-review/save: immediately before the controller receives Stop -> the caller has made the
 *   saved-review decision after the controller reaches its terminal persistence/finalization result.
 *
 * There is intentionally no pass/fail threshold here. These are observations for establishing a real-world
 * baseline. Product acceptance can add a target only after the Product Owner approves one.
 */
export const SESSION_LATENCY_EVENTS = Object.freeze({
    INITIALIZATION: 'session_initialization_latency_measured',
    STOP_TO_REVIEW_SAVE: 'session_stop_to_review_save_latency_measured',
} as const);

export type SessionInitializationOutcome = 'recording_started' | 'failed';
export type SessionStopOutcome = 'review_ready' | 'discarded' | 'failed';

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
                });
            } catch {
                // Observability must never turn a successful Start/Stop lifecycle into a product failure.
            }
            return durationMs;
        },
    };
}

export function beginSessionInitializationLatency(
    mode: TranscriptionMode,
    now: Now = monotonicNow,
): SessionLatencyMeasurement<SessionInitializationOutcome> {
    return beginMeasurement(SESSION_LATENCY_EVENTS.INITIALIZATION, mode, now);
}

export function beginSessionStopLatency(
    mode: TranscriptionMode,
    now: Now = monotonicNow,
): SessionLatencyMeasurement<SessionStopOutcome> {
    return beginMeasurement(SESSION_LATENCY_EVENTS.STOP_TO_REVIEW_SAVE, mode, now);
}
