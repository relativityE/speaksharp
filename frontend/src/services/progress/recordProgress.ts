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
import { PROGRESS_FORMULA_VERSION, type ProgressEvaluation } from './buildProgressEvaluation';
import { buildTakeaways } from './progressPresentation';

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

/**
 * Create the immutable recommendation tied to an eligible evaluation of the caller's own session. The
 * source metric value is NOT passed — the RPC DERIVES it from the persisted evaluation, so a later
 * comparison is always against the number the evaluation actually recorded (never a client value).
 */
export async function recordProgressRecommendation(args: {
    sourceSessionId: string;
    targetMetric: 'filler_rate' | 'pace' | 'clear_delivery';
    targetDirection: 'decrease' | 'increase' | 'maintain';
    targetValue: number;
    targetUnits: string;
    shownText: string;
}): Promise<string | null> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('record_progress_recommendation', {
        p_source_session_id: args.sourceSessionId,
        p_target_metric: args.targetMetric,
        p_target_direction: args.targetDirection,
        p_target_value: args.targetValue,
        p_target_units: args.targetUnits,
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

/** #1033 attribution reaches a TERMINAL state at `verified` or `unverified` (`pending` is not terminal). */
function isTerminalAttribution(status: string | null | undefined): boolean {
    return status === 'verified' || status === 'unverified';
}

/**
 * Record the evaluation, retrying a NONFATAL failure a few times. Progress recording must never break the
 * save journey, but a transient RPC error must not silently drop the record either. The RPC is idempotent
 * per (session, formula_version), so a retry can never create a duplicate.
 */
async function recordProgressEvaluationWithRetry(sessionId: string, attempts = 3): Promise<string | null> {
    for (let i = 0; i < attempts; i++) {
        const id = await recordProgressEvaluation(sessionId);
        if (id) return id;
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
    return null;
}

/**
 * If the persisted evaluation is ELIGIBLE, derive the deterministic recommendation from it and record it.
 * The action (metric + direction + target + copy) comes from the provisional policy in
 * `buildTakeaways`; the SOURCE metric value is derived server-side by the RPC. No-op when the evaluation
 * is missing or ineligible (an ineligible session has no comparison and no action to record).
 */
async function recordRecommendationForEvaluation(sessionId: string): Promise<void> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('session_progress_evaluations')
        .select('eligible, word_count, filler_count, wpm, clarity_raw, cohort_key, engine, engine_version, model_name, attribution_status')
        .eq('session_id', sessionId)
        .eq('formula_version', PROGRESS_FORMULA_VERSION)
        .maybeSingle();
    if (error || !data || !data.eligible) return;

    const current: ProgressEvaluation = {
        sessionId,
        userId: '',
        formulaVersion: PROGRESS_FORMULA_VERSION,
        snapshotOrigin: 'at_save',
        durationSeconds: 0,
        wordCount: data.word_count ?? 0,
        clarityEvidenceAvailable: true,
        engine: data.engine ?? null,
        engineVersion: data.engine_version ?? null,
        modelName: data.model_name ?? null,
        attributionStatus: data.attribution_status ?? null,
        eligible: true,
        exclusionReasons: [],
        clarityRaw: data.clarity_raw ?? null,
        fillerCount: data.filler_count ?? null,
        errorMarkerCount: null,
        wpm: data.wpm ?? null,
        cohortKey: data.cohort_key ?? null,
    };

    const { target, practiceThisNext } = buildTakeaways(current, null);
    await recordProgressRecommendation({
        sourceSessionId: sessionId,
        targetMetric: target.metric,
        targetDirection: target.direction,
        targetValue: target.targetValue,
        targetUnits: target.units,
        shownText: practiceThisNext,
    });
}

/**
 * The single deliberate wiring seam into the completed-session save journey. Call this once the session's
 * delivery metrics are persisted AND its attribution has reached a TERMINAL state (`verified` or
 * `unverified`) — NOT while attribution is still `pending`, which would write a premature immutable row.
 *
 * Every completed future session then receives a record: an ELIGIBLE evaluation (verified) OR an
 * AUDITABLE EXCLUSION (e.g. unverified → `unverified_attribution`). The RPC decides eligibility and is
 * idempotent, so this may be invoked defensively (including from attribution-retry resolution).
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
    if (!isTerminalAttribution(ctx.attributionStatus)) return; // still pending — defer, do not write early
    const evalId = await recordProgressEvaluationWithRetry(ctx.sessionId);
    if (!evalId) return;
    await recordRecommendationForEvaluation(ctx.sessionId);
}
