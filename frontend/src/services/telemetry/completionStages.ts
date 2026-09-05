/**
 * #1259 F16 — where the time between Stop and a readable review actually goes.
 *
 * Production gives one number and no breakdown: `session_started` to `session_saved` was 99 and 104
 * seconds against recorded durations of 88 and 90, so roughly 11 and 14 seconds elapsed after the user
 * stopped speaking. The PO saw a finalizing banner for about seventeen. One interval, and at least six
 * different things happening inside it.
 *
 * That single number cannot be acted on. Eleven seconds of decode is a model problem; eleven seconds
 * of save is a database problem; eleven seconds before the review renders is a front-end problem. They
 * have different owners and different fixes, and the directive says explicitly not to collapse them.
 *
 * So each stage reports the interval since the PREVIOUS stage completed, from the authority that owns
 * it. A stage that never arrives emits nothing — and its absence is itself the finding, because the
 * chain stops exactly where the session got stuck.
 */
import { emitStageLatency, type LatencyStage } from './journeyEvents';

/** The completion chain, in the order it must occur. */
export const COMPLETION_CHAIN: readonly LatencyStage[] = [
    'stop_intent',
    'recording_terminated',
    'final_transcript',
    'evaluation_complete',
    'session_saved',
    'practice_loop_ready',
    'review_rendered',
];

let previousStage: LatencyStage | null = null;
let previousAt: number | null = null;
const seen = new Set<LatencyStage>();

/**
 * Record that a completion stage has been reached.
 *
 * Each stage is recorded ONCE per take. A stage re-entered — a re-render of the review, a second save
 * callback — would otherwise emit a second, tiny interval and make the chain look faster than the user
 * experienced it, which is the flattering direction and the wrong one.
 */
export function markCompletionStage(stage: LatencyStage): void {
    if (seen.has(stage)) return;
    seen.add(stage);

    const now = Date.now();
    if (previousAt !== null && previousStage !== null) {
        const delta = now - previousAt;
        // A negative or absurd interval means a stale mark, not a long wait.
        if (delta >= 0 && delta <= 86_400_000) emitStageLatency(stage, delta);
    }
    previousStage = stage;
    previousAt = now;
}

/** A new take starts a new chain. Without this the second take measures from the first take's stop. */
export function resetCompletionChain(): void {
    previousStage = null;
    previousAt = null;
    seen.clear();
}

/** Which stages this take reached. The chain STOPPING is where the session got stuck. */
export function reachedStages(): LatencyStage[] {
    return COMPLETION_CHAIN.filter((s) => seen.has(s));
}

export function __resetCompletionStagesForTests(): void { resetCompletionChain(); }
