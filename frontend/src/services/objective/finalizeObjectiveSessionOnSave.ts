/**
 * #1046 G2 slice 3b-ii — Focus Points finalize orchestrator (headless).
 *
 * Runs AFTER a Private objective recording is saved: it turns the finished recording into a scored
 * Focus Points session by driving the three server steps + the local coverage matcher, in order:
 *   1. registerObjectiveSource  — stamp the recording objective-eligible (Edge Function; server-verified)
 *   2. startObjectiveSession     — create the immutable objective_session bound to the brief
 *   3. loadObjectiveBriefPoints  — read back the brief's points (with their ids) to score against
 *   4. computeObjectiveCoverage  — LOCAL keyword match: transcript segments → detection offsets
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
    type ObjectiveBriefPoint,
    type ObjectivePointCoverage,
    type TranscriptSegment,
} from './objectiveCoverage';

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

export async function finalizeObjectiveSessionOnSave(
    input: FinalizeObjectiveInput,
): Promise<FinalizeObjectiveResult> {
    try {
        const register = await registerObjectiveSource(input.sourceSessionId);
        if (!register.ok) return { ok: false, stage: 'register', reason: register.reason };

        const started = await startObjectiveSession({
            projectId: input.projectId,
            briefId: input.briefId,
            sourceSessionId: input.sourceSessionId,
            idempotencyKey: input.idempotencyKey,
        });
        if (!started.ok || !started.sessionId) return { ok: false, stage: 'start', reason: started.reason };

        const points = await loadObjectiveBriefPoints(input.briefId);
        if (!points || points.length === 0) return { ok: false, stage: 'load-points', reason: 'error' };

        const { coverage, signals } = computeObjectiveCoverage(points, input.segments, input.durationSeconds);

        const evidenceCount = await finalizeObjectiveEvidence(started.sessionId, signals);
        if (evidenceCount === null) return { ok: false, stage: 'finalize', reason: 'error' };

        return { ok: true, objectiveSessionId: started.sessionId, evidenceCount, coverage };
    } catch (err) {
        logger.warn({ err }, '[finalizeObjective] orchestrator threw (non-fatal)');
        return { ok: false, reason: 'error' };
    }
}
