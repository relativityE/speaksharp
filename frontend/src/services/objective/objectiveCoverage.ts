/**
 * #1046 G2 slice 3b — Focus Points coverage bridge.
 *
 * Turns a session's declared focus points + its timestamped transcript into (a) a per-point coverage
 * result for the UI rail and (b) the `p_signals` payload for `objective_finalize_evidence_v1`.
 *
 * Coverage matching is CLIENT-SIDE and LOCAL — it reuses the deterministic keyword-overlap matcher
 * (`mapTalkingPointCoverage`) so nothing about the transcript or brief leaves the device (Private-only).
 * The server does NOT match text; it only records the verdicts implied by the detection offsets we send.
 *
 * Signal mapping (matches the RPC's contract — verdict is derived from offset presence):
 *   - evidence found (covered OR partial) → `detected_at_seconds` = the evidence timestamp
 *   - no evidence (missing)               → `detected_at_seconds = null`  ⇒ not_detected
 * The richer covered/partial/missing (red/yellow/green) distinction is kept for the UI rail; the DB
 * verdict is binary (detected/not_detected), so "we found supporting transcript evidence" = detected.
 *
 * Offsets MUST fall in [0, actual_duration_seconds] or the RPC rejects the ENTIRE finalize, so every
 * offset is rounded and clamped to that window here.
 *
 * Default-off meaning matcher (`VITE_FOCUS_MEANING_MATCHER_ENABLED`): `computeObjectiveCoverageWithMatcher`
 * may replace the keyword verdict with an on-device NLI verdict (`meaning/`), through the SAME signal mapping
 * below. `computeObjectiveCoverage` itself is unchanged and stays the keyword path, the live rail's path and
 * the fallback.
 */
import {
    mapTalkingPointCoverage,
    type TranscriptSegment,
    type TalkingPointCoverage,
} from '@/services/rehearsal/outcomeScorecard';

export type { TranscriptSegment };

/** A focus point as persisted (the id is `objective_brief_point.id`). */
export interface ObjectiveBriefPoint {
    id: string;
    label: string;
    cue?: string | null;
}

/** One entry of `p_signals` for `objective_finalize_evidence_v1`. */
export interface ObjectiveFinalizeSignal {
    brief_point_id: string;
    detected_at_seconds: number | null;
}

/** Per-point coverage for the UI rail, carrying the brief_point_id alongside the matcher result. */
export interface ObjectivePointCoverage extends TalkingPointCoverage {
    briefPointId: string;
}

export interface ObjectiveCoverageResult {
    coverage: ObjectivePointCoverage[];
    signals: ObjectiveFinalizeSignal[];
}

/** Round + clamp an evidence timestamp into the RPC's required [0, floor(duration)] window. */
function toOffsetSeconds(timestampSec: number, durationSeconds: number): number {
    const ceiling = Math.max(0, Math.floor(durationSeconds));
    if (!Number.isFinite(timestampSec)) return 0;
    return Math.max(0, Math.min(Math.round(timestampSec), ceiling));
}

/** The phrase each point is matched by: its label plus optional cue (both carry meaning). */
function objectivePhrases(points: ObjectiveBriefPoint[]): string[] {
    return points.map((p) => [p.label, p.cue].filter((s) => (s ?? '').trim() !== '').join(' '));
}

/**
 * Shared signal mapping: matcher results (in point order) → rail coverage + finalize signals. Used by both the
 * keyword path and the meaning path, so the two can never map a verdict to the RPC differently.
 */
function toObjectiveCoverageResult(
    points: ObjectiveBriefPoint[],
    matched: TalkingPointCoverage[],
    durationSeconds: number,
): ObjectiveCoverageResult {
    const coverage: ObjectivePointCoverage[] = matched.map((result, i) => ({
        ...result,
        // Show the label (not the label+cue phrase the matcher echoed back) in the rail.
        point: points[i].label,
        briefPointId: points[i].id,
    }));

    const signals: ObjectiveFinalizeSignal[] = coverage.map((c) => ({
        brief_point_id: c.briefPointId,
        detected_at_seconds: c.evidence ? toOffsetSeconds(c.evidence.timestampSec, durationSeconds) : null,
    }));

    return { coverage, signals };
}

/**
 * Compute per-point coverage + the finalize signals for a completed objective session.
 * Points are matched against their label plus optional cue (both carry meaning). Point ORDER is
 * preserved so callers can zip results back to their rail rows.
 */
export function computeObjectiveCoverage(
    points: ObjectiveBriefPoint[],
    segments: TranscriptSegment[],
    durationSeconds: number,
): ObjectiveCoverageResult {
    return toObjectiveCoverageResult(points, mapTalkingPointCoverage(objectivePhrases(points), segments), durationSeconds);
}

// ── Default-off meaning matcher (VITE_FOCUS_MEANING_MATCHER_ENABLED) ────────────────────────────────────────

/** Hard cap on the post-Stop meaning check. Past this the keyword verdict is used. */
export const MEANING_MATCH_TIMEOUT_MS = 3000;

/** Which engine produced the saved verdict. */
export type CoverageEngine = 'keyword' | 'nli';

/**
 * Why a meaning-enabled finalize used the keyword verdict instead:
 *   not_ready — the model was not downloaded + loaded (the Stop path never starts a download);
 *   timeout   — no meaning result within MEANING_MATCH_TIMEOUT_MS;
 *   error     — the matcher threw;
 *   no_result — the matcher returned null or a result that does not line up with the points.
 */
export type MeaningFallbackReason = 'not_ready' | 'timeout' | 'error' | 'no_result';

/** The part of `MeaningMatcher` the finalize path needs (kept structural so this module never imports it). */
export interface ObjectiveMeaningMatcher {
    isReady(): boolean;
    match(points: string[], segments: TranscriptSegment[], options: { timeoutMs: number }): Promise<TalkingPointCoverage[] | null>;
}

export interface ObjectiveCoverageWithEngine extends ObjectiveCoverageResult {
    engine: CoverageEngine;
    /** Present only when the verdict is keyword-based BECAUSE the meaning matcher could not be used. */
    fallbackReason?: MeaningFallbackReason;
}

/**
 * The meaning-enabled variant of {@link computeObjectiveCoverage}: same result shape plus `engine`.
 *
 * Uses the meaning matcher only when it is already READY, caps it at `timeoutMs`, and otherwise returns the
 * keyword verdict with the reason. It never throws for a matcher failure and never starts a model download.
 */
export async function computeObjectiveCoverageWithMatcher(
    points: ObjectiveBriefPoint[],
    segments: TranscriptSegment[],
    durationSeconds: number,
    matcher: ObjectiveMeaningMatcher | null,
    timeoutMs: number = MEANING_MATCH_TIMEOUT_MS,
): Promise<ObjectiveCoverageWithEngine> {
    const keyword = (fallbackReason: MeaningFallbackReason): ObjectiveCoverageWithEngine => ({
        ...computeObjectiveCoverage(points, segments, durationSeconds),
        engine: 'keyword',
        fallbackReason,
    });
    if (!matcher || !matcher.isReady()) return keyword('not_ready');

    const phrases = objectivePhrases(points);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const TIMED_OUT = Symbol('timeout');
    try {
        const outcome = await Promise.race([
            matcher.match(phrases, segments, { timeoutMs }),
            new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs); }),
        ]);
        if (outcome === TIMED_OUT) return keyword('timeout');
        if (!outcome || outcome.length !== points.length) return keyword('no_result');
        return { ...toObjectiveCoverageResult(points, outcome, durationSeconds), engine: 'nli' };
    } catch {
        return keyword('error');
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}
