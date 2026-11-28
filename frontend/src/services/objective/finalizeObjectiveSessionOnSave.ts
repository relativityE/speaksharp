/**
 * #1046 G2 slice 3b-ii — Focus Points finalize orchestrator (headless).
 *
 * Runs AFTER a Private objective recording is saved: it turns the finished recording into a scored
 * Focus Points session by driving the three server steps + the local coverage matcher, in order:
 *   1. registerObjectiveSource  — stamp the recording objective-eligible (Edge Function; server-verified)
 *   2. startObjectiveSession     — create the immutable objective_session bound to the brief
 *   3. loadObjectiveBriefPoints  — read back the brief's points (with their ids) to score against
 *   4. computeObjectiveCoverage  — LOCAL keyword match: transcript segments → detection offsets
 *      (default-off `VITE_FOCUS_MEANING_MATCHER_ENABLED`: an on-device meaning match instead, only when the
 *      user's model is already loaded, capped at 3 s, falling back to the keyword match — see coverageForFinalize)
 *   5. finalizeObjectiveEvidence — record per-point verdicts (server derives detected/not_detected)
 *
 * Every step FAILS CLOSED: any failure returns `{ ok: false, stage, reason }` and the caller shows
 * honest "scoring unavailable" copy — it never fabricates a scored session and never throws (so it can
 * be fired from the save path without risking the normal save). Coverage matching stays on-device
 * (Private-only); the transcript never leaves the browser.
 *
 * This is the pure orchestration; the session lifecycle hooks it at the stop/save seam (separate change).
 */
import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';
import {
    registerObjectiveSource,
    startObjectiveSession,
    finalizeObjectiveEvidence,
} from './objectiveSessionService';
import {
    computeObjectiveCoverage,
    computeObjectiveCoverageWithMatcher,
    type CoverageEngine,
    type MeaningFallbackReason,
    type ObjectiveBriefPoint,
    type ObjectiveCoverageResult,
    type ObjectiveMeaningMatcher,
    type ObjectivePointCoverage,
    type TranscriptSegment,
} from './objectiveCoverage';
import { isFocusMeaningMatcherEnabled } from '@/config/focusMeaningMatcher';

export interface FinalizeObjectiveInput {
    projectId: string;
    briefId: string;
    /** The just-saved `sessions` row id (the verified-Private recording). */
    sourceSessionId: string;
    /** Stable key so a retry is idempotent server-side (use the recording id). */
    idempotencyKey: string;
    /** Timestamped transcript segments to match points against. */
    segments: TranscriptSegment[];
    /** Persisted recording duration — offsets are clamped into [0, floor(duration)]. */
    durationSeconds: number;
}

export type FinalizeObjectiveStage = 'register' | 'start' | 'load-points' | 'finalize';

export interface FinalizeObjectiveResult {
    ok: boolean;
    stage?: FinalizeObjectiveStage;
    reason?: string;
    objectiveSessionId?: string;
    evidenceCount?: number;
    coverage?: ObjectivePointCoverage[];
    /**
     * #1265: whether objective_source_recording registration DURABLY SUCCEEDED. This is the ONLY signal the
     * caller may use to decide Progress cohorting — it is preserved even when a LATER stage (start / load /
     * finalize) fails or throws. Do not infer registration from `ok` or `stage` (a throw loses the stage).
     * registered=true means the recording is a confirmed Focus Points source; registered=false means
     * failed/unconfirmed → Progress must NOT be evaluated for this take.
     */
    registered: boolean;
    /**
     * Default-off meaning matcher only (absent when `VITE_FOCUS_MEANING_MATCHER_ENABLED` is off, so the flag-off
     * result is exactly what it was). Which engine produced `coverage`.
     */
    engine?: CoverageEngine;
    /** Present when the flag is on but the verdict is keyword-based because the meaning matcher could not be used. */
    engineFallback?: MeaningFallbackReason;
}

/**
 * Read back the caller's own brief points (ids + label + cue), ordered by sort_order. objective_brief_point
 * is RLS owner-scoped + SELECT-granted to authenticated, so this returns only the caller's points.
 */
export async function loadObjectiveBriefPoints(briefId: string): Promise<ObjectiveBriefPoint[] | null> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('objective_brief_point')
        .select('id, label, cue, sort_order')
        .eq('brief_id', briefId)
        .order('sort_order', { ascending: true });
    if (error) {
        logger.warn({ error }, '[finalizeObjective] loadObjectiveBriefPoints failed');
        return null;
    }
    return (data as { id: string; label: string; cue: string | null }[] | null)?.map((p) => ({
        id: p.id,
        label: p.label,
        cue: p.cue,
    })) ?? [];
}

/**
 * The page's meaning matcher, ONLY if the user's opt-in already created it. Imported lazily so a flag-off build
 * never loads the module, and peeked (never created) so the Stop path cannot construct a worker or start a
 * download. Readiness is checked by `computeObjectiveCoverageWithMatcher`.
 */
async function existingMeaningMatcher(): Promise<ObjectiveMeaningMatcher | null> {
    const { peekMeaningMatcher } = await import('./meaning/MeaningMatcher');
    return peekMeaningMatcher();
}

type CoverageForFinalize = ObjectiveCoverageResult & { engine?: CoverageEngine; engineFallback?: MeaningFallbackReason };

async function coverageForFinalize(
    points: ObjectiveBriefPoint[],
    segments: TranscriptSegment[],
    durationSeconds: number,
): Promise<CoverageForFinalize> {
    if (!isFocusMeaningMatcherEnabled()) return computeObjectiveCoverage(points, segments, durationSeconds);
    let matcher: ObjectiveMeaningMatcher | null = null;
    try {
        matcher = await existingMeaningMatcher();
    } catch (err) {
        logger.warn({ err }, '[finalizeObjective] meaning matcher unavailable; using keyword verdict');
    }
    const result = await computeObjectiveCoverageWithMatcher(points, segments, durationSeconds, matcher);
    return {
        coverage: result.coverage,
        signals: result.signals,
        engine: result.engine,
        ...(result.fallbackReason ? { engineFallback: result.fallbackReason } : {}),
    };
}

export async function finalizeObjectiveSessionOnSave(
    input: FinalizeObjectiveInput,
): Promise<FinalizeObjectiveResult> {
    // #1265: registration success is tracked EXPLICITLY so it survives a later-stage failure or throw.
    let registered = false;
    try {
        const register = await registerObjectiveSource(input.sourceSessionId);
        if (!register.ok) return { ok: false, stage: 'register', reason: register.reason, registered: false };
        registered = true; // objective_source_recording is now durably present

        const started = await startObjectiveSession({
            projectId: input.projectId,
            briefId: input.briefId,
            sourceSessionId: input.sourceSessionId,
            idempotencyKey: input.idempotencyKey,
        });
        if (!started.ok || !started.sessionId) return { ok: false, stage: 'start', reason: started.reason, registered };

        const points = await loadObjectiveBriefPoints(input.briefId);
        if (!points || points.length === 0) return { ok: false, stage: 'load-points', reason: 'error', registered };

        // Flag off: the keyword matcher, exactly as before. Flag on: the meaning matcher if (and only if) it is
        // already ready, capped at MEANING_MATCH_TIMEOUT_MS, else the keyword verdict with the reason.
        const { coverage, signals, engine, engineFallback } = await coverageForFinalize(points, input.segments, input.durationSeconds);

        const evidenceCount = await finalizeObjectiveEvidence(started.sessionId, signals);
        if (evidenceCount === null) return { ok: false, stage: 'finalize', reason: 'error', registered };

        return {
            ok: true, objectiveSessionId: started.sessionId, evidenceCount, coverage, registered,
            ...(engine ? { engine } : {}),
            ...(engineFallback ? { engineFallback } : {}),
        };
    } catch (err) {
        logger.warn({ err }, '[finalizeObjective] orchestrator threw (non-fatal)');
        // registration state is preserved across the throw — a throw AFTER a successful register still
        // reports registered=true so the caller evaluates Progress; a throw BEFORE reports registered=false.
        return { ok: false, reason: 'error', registered };
    }
}
