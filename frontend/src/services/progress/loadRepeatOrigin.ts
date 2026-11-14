import { getSupabaseClient } from '@/lib/supabaseClient';
import { hasCompleteEligibleProgressEvidence, PROGRESS_FORMULA_VERSION } from './buildProgressEvaluation';
import type { StructuredTarget } from './progressPresentation';
import type { ProgressAttemptView, RepeatResultView } from './loadSessionProgress';

/**
 * Outcome 4, first increment — "the repeat shows what it repeated".
 *
 * When this session is the practice take that resolved a linked repeat, the server stored it as the attempt's
 * `practice_session_id` (`advance_recommendation_attempt`, 20260731130000). Only a RESOLVED attempt carries it: a
 * `completed` or `not_comparable` one. A pending attempt has none yet, and an abandoned one never gets one, so neither
 * makes this session a repeat.
 *
 *   - `none`: this session is not a linked repeat (or the link cannot be identified unambiguously) — show nothing;
 *   - `error`: a read failed — never shown as "not a repeat"; the caller offers a retry;
 *   - `repeat`: the original session, the stored target and outcome, and (completed only) the stored before → after
 *     under the same guards `loadRepeatResult` applies on the original session's Progress. A completed attempt whose
 *     next-comparable session is not THIS session never shows values: they would describe another take.
 *
 * AHT-01 hold: `loadSessionProgress.ts` and `ProgressPanel.tsx` are the files AHT-01's numeric check reads and pins by
 * git blob, so they stay byte-identical until that run is done. The pair guards and the value derivation below mirror
 * `loadRepeatResult` / `metricValue` there, and `loadRepeatOrigin.test.ts` runs both readers over the same rows so any
 * drift fails. Folding the two into one exported helper is the follow-up once AHT-01 has run.
 */
export type RepeatOriginView =
    | { status: 'none'; sessionId: string }
    | { status: 'error'; sessionId: string }
    | {
        status: 'repeat';
        sessionId: string;
        originalSessionId: string;
        /** The original session's stored `created_at`; null when it is missing or not a valid timestamp. */
        originalCreatedAt: string | null;
        target: StructuredTarget;
        lifecycle: 'completed' | 'not_comparable';
        outcome: ProgressAttemptView['outcome'];
        /** Present only for a `completed` attempt. */
        repeatResult: RepeatResultView | null;
    };

interface OriginAttemptRow {
    id: string;
    user_id: string;
    recommendation_id: string;
    lifecycle: ProgressAttemptView['lifecycle'];
    outcome: ProgressAttemptView['outcome'];
    practice_session_id: string | null;
    next_comparable_session_id: string | null;
}

interface OriginRecommendationRow {
    id: string;
    user_id: string;
    source_session_id: string;
    target_metric: StructuredTarget['metric'];
    target_direction: StructuredTarget['direction'];
    target_value: number;
    target_units: string;
    shown_text: string;
    source_metric_value: number | null;
}

/** The persisted evaluation columns the pair guards read (same names as `loadSessionProgress`'s EVAL_FIELDS). */
interface OriginEvalRow {
    session_id: string;
    eligible: boolean;
    clarity_raw: number | null;
    filler_count: number | null;
    error_marker_count: number | null;
    wpm: number | null;
    word_count: number | null;
    cohort_key: string | null;
}

const EVAL_FIELDS = 'session_id, eligible, clarity_raw, filler_count, error_marker_count, wpm, word_count, cohort_key';
const RECOMMENDATION_FIELDS = 'id, user_id, source_session_id, target_metric, target_direction, target_value, target_units, shown_text, source_metric_value';

const RESOLVED_LIFECYCLES = ['completed', 'not_comparable'] as const;
const METRICS: ReadonlyArray<StructuredTarget['metric']> = ['filler_rate', 'pace', 'clear_delivery'];
const DIRECTIONS: ReadonlyArray<StructuredTarget['direction']> = ['decrease', 'increase', 'maintain'];

/** Read only this owner's persisted attempt for this exact session. Client history/order is never link authority. */
export async function loadRepeatOrigin(sessionId: string, userId: string): Promise<RepeatOriginView> {
    const none: RepeatOriginView = { status: 'none', sessionId };
    const failed: RepeatOriginView = { status: 'error', sessionId };
    if (!sessionId || !userId) return none;
    const supabase = getSupabaseClient();

    const { data: attemptData, error: attemptError } = await supabase
        .from('progress_recommendation_attempts')
        .select('id, user_id, recommendation_id, lifecycle, outcome, practice_session_id, next_comparable_session_id')
        .eq('practice_session_id', sessionId)
        .eq('user_id', userId)
        .in('lifecycle', [...RESOLVED_LIFECYCLES]);
    if (attemptError || !Array.isArray(attemptData)) return failed;
    // RLS already limits reads to the owner; the row checks repeat every filter so a wider read can never match.
    const attempts = (attemptData as OriginAttemptRow[]).filter((row) => row.user_id === userId
        && row.practice_session_id === sessionId
        && (RESOLVED_LIFECYCLES as readonly string[]).includes(row.lifecycle));
    // One take resolves one attempt. Two attempts naming the same take cannot say which original it repeated.
    if (attempts.length !== 1) return none;
    const attempt = attempts[0];

    const { data: recData, error: recError } = await supabase
        .from('progress_recommendations')
        .select(RECOMMENDATION_FIELDS)
        .eq('id', attempt.recommendation_id)
        .eq('formula_version', PROGRESS_FORMULA_VERSION)
        .maybeSingle();
    if (recError) return failed;
    const recommendation = (recData as OriginRecommendationRow | null) ?? null;
    if (!recommendation
        || recommendation.id !== attempt.recommendation_id
        || recommendation.user_id !== userId
        || !recommendation.source_session_id
        || recommendation.source_session_id === sessionId
        || !METRICS.includes(recommendation.target_metric)
        || !DIRECTIONS.includes(recommendation.target_direction)
        || !Number.isFinite(recommendation.target_value)
        || typeof recommendation.target_units !== 'string'
        || recommendation.target_units.trim().length === 0
        || typeof recommendation.shown_text !== 'string'
        || recommendation.shown_text.trim().length === 0) return none;
    const originalSessionId = recommendation.source_session_id;

    const { data: originalData, error: originalError } = await supabase
        .from('sessions')
        .select('id, created_at')
        .eq('id', originalSessionId)
        .maybeSingle();
    if (originalError) return failed;
    const original = (originalData as { id: string; created_at: string | null } | null) ?? null;
    // The original is the attempt's own parent (cascade-deleted with it), so a missing row is not a repeat we can link.
    if (!original || original.id !== originalSessionId) return none;
    const originalCreatedAt = typeof original.created_at === 'string' && Number.isFinite(Date.parse(original.created_at))
        ? original.created_at : null;

    const target: StructuredTarget = {
        metric: recommendation.target_metric,
        direction: recommendation.target_direction,
        targetValue: recommendation.target_value,
        units: recommendation.target_units,
    };
    const base = {
        status: 'repeat' as const, sessionId, originalSessionId, originalCreatedAt, target,
        outcome: attempt.outcome,
    };
    if (attempt.lifecycle === 'not_comparable') return { ...base, lifecycle: 'not_comparable', repeatResult: null };

    return { ...base, lifecycle: 'completed', repeatResult: await completedRepeatResult(supabase, sessionId, originalSessionId, recommendation, attempt) };
}

/** The server's derivation of a session's value for the recommendation metric (`advance_recommendation_attempt`). */
function metricValue(row: OriginEvalRow, metric: StructuredTarget['metric']): number | null {
    const value = metric === 'filler_rate'
        ? (Number.isInteger(row.word_count) && (row.word_count as number) > 0
            && Number.isInteger(row.filler_count) && (row.filler_count as number) >= 0
            ? ((row.filler_count as number) / (row.word_count as number)) * 100 : null)
        : metric === 'pace' ? row.wpm
            : row.clarity_raw;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const completeEvidence = (row: OriginEvalRow): boolean => hasCompleteEligibleProgressEvidence({
    eligible: row.eligible, wordCount: row.word_count ?? 0, clarityRaw: row.clarity_raw, fillerCount: row.filler_count,
    errorMarkerCount: row.error_marker_count, wpm: row.wpm,
});

/**
 * The stored before → after for a completed attempt, only when its persisted next-comparable session is THIS session.
 * `before` is the recommendation's persisted `source_metric_value`; `after` is derived from this session's evaluation
 * for the same formula version, eligible, complete, and in the original session's cohort. Any read error or failed
 * guard is `unavailable` — never a zero, never another session.
 */
async function completedRepeatResult(
    supabase: ReturnType<typeof getSupabaseClient>,
    sessionId: string,
    originalSessionId: string,
    recommendation: OriginRecommendationRow,
    attempt: OriginAttemptRow,
): Promise<RepeatResultView> {
    const unavailable: RepeatResultView = { status: 'unavailable' };
    const before = recommendation.source_metric_value;
    if (attempt.outcome !== 'moved' && attempt.outcome !== 'did_not_move') return unavailable;
    if (attempt.next_comparable_session_id !== sessionId || sessionId === originalSessionId) return unavailable;
    if (typeof before !== 'number' || !Number.isFinite(before)) return unavailable;
    const { data, error } = await supabase
        .from('session_progress_evaluations')
        .select(EVAL_FIELDS)
        .eq('formula_version', PROGRESS_FORMULA_VERSION)
        .in('session_id', [originalSessionId, sessionId]);
    if (error || !Array.isArray(data)) return unavailable;
    const rows = data as OriginEvalRow[];
    const only = (id: string): OriginEvalRow | null => {
        const matches = rows.filter((row) => row.session_id === id);
        return matches.length === 1 ? matches[0] : null;
    };
    const source = only(originalSessionId);
    const next = only(sessionId);
    // The original's own Progress shows no comparison at all over incomplete evidence, so neither does its repeat.
    if (!source || !completeEvidence(source) || !source.cohort_key) return unavailable;
    if (!next || !next.eligible || next.cohort_key !== source.cohort_key) return unavailable;
    // Parity with opening this session's own Progress: evidence the normal loader calls incomplete is never shown here.
    if (!completeEvidence(next)) return unavailable;
    const after = metricValue(next, recommendation.target_metric);
    if (after === null) return unavailable;
    return {
        status: 'available',
        metric: recommendation.target_metric,
        direction: recommendation.target_direction,
        units: recommendation.target_units,
        before,
        after,
    };
}
