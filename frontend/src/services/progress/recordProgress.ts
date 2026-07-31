/**
 * #1045 — the consumer that connects the Progress records to the real save journey.
 *
 * Thin wrappers over the guarded RPCs. All authority lives in the database (ownership, eligibility, the
 * clarity computation, lifecycle transitions) — these functions pass only ids, so a compromised or buggy
 * client can neither claim another user's session nor self-assert eligibility.
 *
 * WHEN TO CALL `recordProgressEvaluation`: ONLY after a session is fully persisted with its delivery
 * metrics AND its attribution has resolved to `verified`. Calling earlier would write an immutable
 * `ineligible / no_clarity_evidence` row that could never be corrected. `wireProgressEvaluationOnSave`
 * below is the single, deliberate seam; it is a no-op unless the save reached that state.
 */
import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';

/** Record (or return the existing) Progress evaluation for a completed, metrics-persisted session. */
export async function recordProgressEvaluation(sessionId: string): Promise<string | null> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('record_progress_evaluation', { p_session_id: sessionId });
    if (error) {
        // Progress recording must NEVER break the save journey — log and move on.
        logger.warn({ error, sessionId }, '[progress] record_progress_evaluation failed (non-fatal)');
        return null;
    }
    return (data as string | null) ?? null;
}

/** Create the immutable recommendation tied to an eligible evaluation of the caller's own session. */
export async function recordProgressRecommendation(args: {
    sourceSessionId: string;
    targetMetric: 'filler_rate' | 'pace' | 'clear_delivery';
    targetDirection: 'decrease' | 'increase' | 'maintain';
    targetValue: number;
    targetUnits: string;
    sourceMetricValue: number;
    shownText: string;
}): Promise<string | null> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('record_progress_recommendation', {
        p_source_session_id: args.sourceSessionId,
        p_target_metric: args.targetMetric,
        p_target_direction: args.targetDirection,
        p_target_value: args.targetValue,
        p_target_units: args.targetUnits,
        p_source_metric_value: args.sourceMetricValue,
        p_shown_text: args.shownText,
    });
    if (error) { logger.warn({ error }, '[progress] record_progress_recommendation failed'); return null; }
    return (data as string | null) ?? null;
}

/** Accept a recommendation ("Practice this next"): create one pending attempt. */
export async function recordRecommendationAttempt(recommendationId: string): Promise<string | null> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('record_recommendation_attempt', {
        p_recommendation_id: recommendationId,
    });
    if (error) { logger.warn({ error }, '[progress] record_recommendation_attempt failed'); return null; }
    return (data as string | null) ?? null;
}

/** Advance an attempt through a validated lifecycle transition (identity never rewritten server-side). */
export async function advanceRecommendationAttempt(args: {
    attemptId: string;
    lifecycle: 'completed' | 'not_comparable' | 'abandoned';
    practiceSessionId?: string | null;
    nextComparableSessionId?: string | null;
    outcome?: 'moved' | 'did_not_move' | 'not_comparable' | 'not_completed' | null;
}): Promise<boolean> {
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc('advance_recommendation_attempt', {
        p_attempt_id: args.attemptId,
        p_lifecycle: args.lifecycle,
        p_practice_session_id: args.practiceSessionId ?? null,
        p_next_comparable_session_id: args.nextComparableSessionId ?? null,
        p_outcome: args.outcome ?? null,
    });
    if (error) { logger.warn({ error }, '[progress] advance_recommendation_attempt failed'); return false; }
    return true;
}

/**
 * The single deliberate wiring seam. Call this from the save flow ONLY once a completed session has its
 * delivery metrics persisted and `attribution_status = 'verified'`. It is intentionally guarded so it can
 * be invoked defensively without risking a premature, immutable ineligible record.
 */
export async function wireProgressEvaluationOnSave(ctx: {
    sessionId: string | null | undefined;
    status: string | null | undefined;
    attributionStatus: string | null | undefined;
    metricsPersisted: boolean;
}): Promise<void> {
    if (!ctx.sessionId) return;
    if (ctx.status !== 'completed') return;
    if (!ctx.metricsPersisted) return;
    if (ctx.attributionStatus !== 'verified') return; // an ineligible eval would be immutable — skip
    await recordProgressEvaluation(ctx.sessionId);
}
