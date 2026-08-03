import { getSupabaseClient } from '@/lib/supabaseClient';
import { PROGRESS_FORMULA_VERSION, type ExclusionReason, type ProgressEvaluation } from './buildProgressEvaluation';
import { describeDirection, buildTakeaways, type DirectionResult, type Takeaways } from './progressPresentation';

export type ProgressAttemptView = {
    id: string;
    lifecycle: 'pending' | 'completed' | 'not_comparable' | 'abandoned';
    outcome: 'moved' | 'did_not_move' | 'not_comparable' | 'not_completed' | null;
};

export type SessionProgressResult =
    | { status: 'insufficient'; sessionId: string }
    | { status: 'ineligible'; sessionId: string; reasons: string[] }
    | { status: 'unavailable'; sessionId: string; message: string }
    | { status: 'error'; sessionId: string; message: string }
    | {
        status: 'eligible';
        sessionId: string;
        comparison: 'baseline' | 'previous' | 'restarted';
        direction: DirectionResult;
        takeaways: Takeaways;
        recommendationId: string | null;
        latestAttempt: ProgressAttemptView | null;
    };

interface EvalRow {
    session_id: string;
    eligible: boolean;
    exclusion_reasons: ExclusionReason[] | null;
    clarity_raw: number | null;
    filler_count: number | null;
    wpm: number | null;
    word_count: number | null;
    cohort_key: string | null;
    baseline_session_id: string | null;
    previous_comparable_session_id: string | null;
}

function toEvaluation(row: EvalRow): ProgressEvaluation {
    return {
        sessionId: row.session_id, userId: '', formulaVersion: PROGRESS_FORMULA_VERSION,
        snapshotOrigin: 'at_save', durationSeconds: 0, wordCount: row.word_count ?? 0,
        clarityEvidenceAvailable: row.eligible, engine: null, engineVersion: null, modelName: null,
        attributionStatus: null, eligible: row.eligible, exclusionReasons: row.exclusion_reasons ?? [],
        clarityRaw: row.clarity_raw, fillerCount: row.filler_count, errorMarkerCount: null,
        wpm: row.wpm, cohortKey: row.cohort_key,
    };
}

const EVAL_FIELDS = 'session_id, eligible, exclusion_reasons, clarity_raw, filler_count, wpm, word_count, cohort_key, baseline_session_id, previous_comparable_session_id';

/** Read only persisted server-selected references. Client history/order is never comparison authority. */
export async function loadSessionProgress(sessionId: string): Promise<SessionProgressResult> {
    const supabase = getSupabaseClient();
    const { data: currentData, error: currentError } = await supabase
        .from('session_progress_evaluations')
        .select(EVAL_FIELDS)
        .eq('session_id', sessionId)
        .eq('formula_version', PROGRESS_FORMULA_VERSION)
        .maybeSingle();

    if (currentError) return { status: 'error', sessionId, message: 'Progress could not be loaded.' };
    if (!currentData) return { status: 'insufficient', sessionId };
    const currentRow = currentData as EvalRow;
    if (!currentRow.eligible) {
        return { status: 'ineligible', sessionId, reasons: currentRow.exclusion_reasons ?? [] };
    }

    const referenceIds = [...new Set([
        currentRow.baseline_session_id,
        currentRow.previous_comparable_session_id,
    ].filter((id): id is string => !!id))];
    let references: EvalRow[] = [];
    if (referenceIds.length) {
        const { data, error } = await supabase
            .from('session_progress_evaluations')
            .select(EVAL_FIELDS)
            .eq('formula_version', PROGRESS_FORMULA_VERSION)
            .in('session_id', referenceIds);
        if (error || !data) return { status: 'error', sessionId, message: 'Progress comparisons could not be loaded.' };
        references = data as EvalRow[];
    }

    // Persisted ids are authoritative, but incompatible references still fail closed before arithmetic.
    const validReference = (row: EvalRow, expectedId: string | null): boolean =>
        !!expectedId && row.session_id === expectedId && row.session_id !== sessionId
        && row.eligible && row.cohort_key === currentRow.cohort_key;
    const referenceFor = (expectedId: string | null): EvalRow | null => {
        const matches = references.filter((row) => validReference(row, expectedId));
        return matches.length === 1 ? matches[0] : null;
    };
    // On the second eligible cohort session, the persisted baseline and previous ids
    // legitimately name the same sole prior evaluation. Validate that row once, then
    // allow it to serve both persisted roles.
    const baselineRow = referenceFor(currentRow.baseline_session_id);
    const previousRow = referenceFor(currentRow.previous_comparable_session_id);
    const current = toEvaluation(currentRow);
    const baseline = baselineRow ? toEvaluation(baselineRow) : null;
    const previous = previousRow ? toEvaluation(previousRow) : null;
    let comparison: 'baseline' | 'previous' | 'restarted';
    if (previous) {
        comparison = 'previous';
    } else if (currentRow.baseline_session_id || currentRow.previous_comparable_session_id) {
        comparison = 'restarted';
    } else {
        const { data: sessionRow, error: sessionError } = await supabase
            .from('sessions')
            .select('created_at')
            .eq('id', sessionId)
            .maybeSingle();
        if (sessionError || !(sessionRow as { created_at?: string } | null)?.created_at) {
            return { status: 'error', sessionId, message: 'Comparison history could not be verified.' };
        }
        const createdAt = (sessionRow as { created_at: string }).created_at;
        const { data: priorRows, error: priorError } = await supabase
            .from('sessions')
            .select('id, session_progress_evaluations!inner(cohort_key)')
            .lt('created_at', createdAt)
            .eq('session_progress_evaluations.formula_version', PROGRESS_FORMULA_VERSION)
            .eq('session_progress_evaluations.eligible', true)
            .neq('session_progress_evaluations.cohort_key', currentRow.cohort_key)
            .limit(1);
        if (priorError || !priorRows) return { status: 'error', sessionId, message: 'Comparison history could not be verified.' };
        comparison = priorRows.length > 0 ? 'restarted' : 'baseline';
    }

    const { data: rec, error: recError } = await supabase
        .from('progress_recommendations')
        .select('id')
        .eq('source_session_id', sessionId)
        .eq('formula_version', PROGRESS_FORMULA_VERSION)
        .maybeSingle();
    if (recError) return { status: 'error', sessionId, message: 'Your next action could not be loaded.' };
    const recommendationId = (rec as { id?: string } | null)?.id ?? null;
    if (!recommendationId) {
        return { status: 'unavailable', sessionId, message: 'Your next action is not available yet. Retry to check again.' };
    }

    let latestAttempt: ProgressAttemptView | null = null;
    if (recommendationId) {
        const { data: attempt, error: attemptError } = await supabase
            .from('progress_recommendation_attempts')
            .select('id, lifecycle, outcome')
            .eq('recommendation_id', recommendationId)
            .order('accepted_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (attemptError) return { status: 'error', sessionId, message: 'Your repeat outcome could not be loaded.' };
        latestAttempt = (attempt as ProgressAttemptView | null) ?? null;
    }

    return {
        status: 'eligible', sessionId, comparison,
        direction: comparison === 'restarted'
            ? { direction: 'baseline', deltaPoints: null, reason: null, text: 'Comparison restarted for this recording setup.' }
            : describeDirection(current, baseline),
        takeaways: buildTakeaways(current, previous), recommendationId, latestAttempt,
    };
}
