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
    const phrases = points.map((p) => [p.label, p.cue].filter((s) => (s ?? '').trim() !== '').join(' '));
    const matched = mapTalkingPointCoverage(phrases, segments);

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
