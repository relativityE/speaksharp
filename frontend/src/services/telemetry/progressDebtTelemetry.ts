/**
 * RWT-20 — durable Progress debt lifecycle telemetry.
 *
 * WHY. In the Production real-world test a queued Progress evaluation blocked Start for ~88 minutes and left NO
 * trace: nothing recorded that the debt existed, that anything retried it, or why it kept failing. Each transition
 * is now reported with a closed reason and its age/latency, so that state is observable without the device.
 *
 * NOTHING HERE CARRIES AN IDENTIFIER OR TEXT. No session id, no owner, no error message — the producer never passes
 * them and the governed schema would drop them.
 */
import { safeEmit } from './safeEmit';
import type {
    ProgressDebtPhase, ProgressDebtReason, ProgressDebtTrigger,
} from '@/services/progress/progressDebtVocabulary';

export interface ProgressDebtObservation {
    phase: ProgressDebtPhase;
    trigger: ProgressDebtTrigger;
    /** 1-based ordinal of the attempt this event describes (for `released`, attempts made so far). */
    attempt?: number;
    reason?: ProgressDebtReason | null;
    ageMs?: number | null;
    latencyMs?: number | null;
}

const wholeMs = (value: number | null | undefined): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined;

export function emitProgressDebt(observation: ProgressDebtObservation): void {
    const props: Record<string, unknown> = { phase: observation.phase, trigger: observation.trigger };
    if (typeof observation.attempt === 'number' && Number.isInteger(observation.attempt) && observation.attempt >= 0) {
        props.attempt = observation.attempt;
    }
    if (observation.reason) props.reason = observation.reason;
    const age = wholeMs(observation.ageMs);
    if (age !== undefined) props.age_ms = age;
    const latency = wholeMs(observation.latencyMs);
    if (latency !== undefined) props.latency_ms = latency;
    safeEmit('progress_debt', props);
}

/** Age of a debt entry in ms, or null when its timestamp is not a real instant (older entries may carry none). */
export function progressDebtAgeMs(enqueuedAtIso: string | undefined, now: number): number | null {
    const at = enqueuedAtIso ? Date.parse(enqueuedAtIso) : Number.NaN;
    return Number.isFinite(at) ? Math.max(0, now - at) : null;
}
