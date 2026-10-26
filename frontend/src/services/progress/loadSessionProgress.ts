import { getSupabaseClient } from '@/lib/supabaseClient';
import { hasCompleteEligibleProgressEvidence, PROGRESS_FORMULA_VERSION, type ExclusionReason, type ProgressEvaluation } from './buildProgressEvaluation';
import { describeDirection, buildTakeaways, type DirectionResult, type Takeaways } from './progressPresentation';
import { reconcileProgressRecommendation } from './recordProgress';

export type ProgressAttemptView = {
    id: string;
    lifecycle: 'pending' | 'completed' | 'not_comparable' | 'abandoned';
    outcome: 'moved' | 'did_not_move' | 'not_comparable' | 'not_completed' | null;
};

/**
 * #1548 — the linked repeat's same-target result, in the server's own terms.
 *
 * `before` is the recommendation's persisted `source_metric_value`. `after` is the value the server derived for
 * the attempt's persisted `next_comparable_session_id` (`advance_recommendation_attempt`, 20260731130000): that
 * session's evaluation for the same formula version, eligible, in the source session's cohort; filler_rate is
 * filler_count / word_count × 100 (percent of words), pace is wpm, clear_delivery is clarity_raw. Units are the
 * stored target units. Present only for a resolved `completed` attempt; any missing, deleted, non-finite or
 * incompatible evidence is `unavailable` — never a zero, never another session chosen by client history.
 */
export type RepeatResultView =
    | {
        status: 'available';
        metric: Takeaways['target']['metric'];
        direction: Takeaways['target']['direction'];
        units: string;
        before: number;
        after: number;
    }
    | { status: 'unavailable' };

/**
 * Inspectable evidence behind a displayed movement: exactly which validated session it was measured
 * against, in which recording cohort/mode, the raw inputs, and their units. A headline number the user
 * cannot inspect is not defensible; this makes the comparison auditable without exposing any transcript.
 * Present only when a real previous-vs-current comparison was made (null for baseline/restarted states).
 */
export interface ProgressDisclosure {
    /** The server-validated comparable session the movement was measured against. */
    referenceSessionId: string;
    /** How that reference is named to the user (headline reference). */
    referenceRole: 'previous comparable session';
    /** True when the previous comparable session is also the first-session baseline. */
    alsoFirstComparable: boolean;
    /** The recording cohort/mode both sessions share (a comparison is only valid within one cohort). */
    cohortKey: string;
    /** Input: this session's clear-delivery points (unrounded). */
    currentClarityPoints: number;
    /** Input: the reference session's clear-delivery points (unrounded). */
    referenceClarityPoints: number;
    /** Signed movement in points (current − reference). */
    deltaPoints: number;
    /** Signed relative movement in percent; null when the reference points are zero. */
    deltaPercent: number | null;
    /** Units of the inputs/points. */
    units: 'clear-delivery points';
}

export type SessionProgressResult =
    | { status: 'insufficient'; sessionId: string }
    | { status: 'ineligible'; sessionId: string; reasons: ExclusionReason[] }
    | { status: 'unavailable'; sessionId: string; message: string }
    | { status: 'error'; sessionId: string; message: string }
    | {
        status: 'eligible';
        sessionId: string;
        comparison: 'baseline' | 'previous' | 'restarted';
        direction: DirectionResult;
        /** Quiet long-term context; the headline always uses the previous comparable session. */
        baselineContext: string;
        /** Inspectable evidence behind the displayed movement; null unless a real comparison was made. */
        disclosure: ProgressDisclosure | null;
        takeaways: Takeaways;
        recommendationId: string | null;
        latestAttempt: ProgressAttemptView | null;
        /** Null/absent unless the latest attempt is a resolved `completed` one. */
        repeatResult?: RepeatResultView | null;
    };

interface EvalRow {
    session_id: string;
    eligible: boolean;
    exclusion_reasons: ExclusionReason[] | null;
    clarity_raw: number | null;
    filler_count: number | null;
    error_marker_count: number | null;
    wpm: number | null;
    word_count: number | null;
    cohort_key: string | null;
    baseline_session_id: string | null;
    previous_comparable_session_id: string | null;
}

interface RecommendationRow {
    id: string;
    target_metric: Takeaways['target']['metric'];
    target_direction: Takeaways['target']['direction'];
    target_value: number;
    target_units: string;
    shown_text: string;
    source_metric_value: number | null;
}

interface AttemptRow extends ProgressAttemptView {
    next_comparable_session_id: string | null;
}

/** The server's derivation of a session's value for the recommendation metric; null when it cannot be derived. */
function metricValue(row: EvalRow, metric: Takeaways['target']['metric']): number | null {
    const value = metric === 'filler_rate'
        ? (Number.isInteger(row.word_count) && (row.word_count as number) > 0
            && Number.isInteger(row.filler_count) && (row.filler_count as number) >= 0
            ? ((row.filler_count as number) / (row.word_count as number)) * 100 : null)
        : metric === 'pace' ? row.wpm
            : row.clarity_raw;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toEvaluation(row: EvalRow): ProgressEvaluation {
    return {
        sessionId: row.session_id, userId: '', formulaVersion: PROGRESS_FORMULA_VERSION,
        snapshotOrigin: 'at_save', durationSeconds: 0, wordCount: row.word_count ?? 0,
        clarityEvidenceAvailable: row.eligible, engine: null, engineVersion: null, modelName: null,
        attributionStatus: null, eligible: row.eligible, exclusionReasons: row.exclusion_reasons ?? [],
        clarityRaw: row.clarity_raw, fillerCount: row.filler_count, errorMarkerCount: row.error_marker_count,
        wpm: row.wpm, cohortKey: row.cohort_key,
    };
}

const EVAL_FIELDS = 'session_id, eligible, exclusion_reasons, clarity_raw, filler_count, error_marker_count, wpm, word_count, cohort_key, baseline_session_id, previous_comparable_session_id';
const RECOMMENDATION_FIELDS = 'id, target_metric, target_direction, target_value, target_units, shown_text, source_metric_value';

/** Mirrors PostgreSQL tuple ordering: (created_at, session_id) < (current.created_at, current.session_id). */
function isEarlierSession(
    candidate: { id: string; createdAt: number },
    current: { id: string; createdAt: number },
): boolean {
    return candidate.createdAt < current.createdAt
        || (candidate.createdAt === current.createdAt && candidate.id < current.id);
}

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

    const chronology = new Map<string, number>();
    if (referenceIds.length) {
        const chronologyIds = [sessionId, ...referenceIds];
        const { data, error } = await supabase
            .from('sessions')
            .select('id, created_at')
            .in('id', chronologyIds);
        if (error || !data) return { status: 'error', sessionId, message: 'Comparison chronology could not be verified.' };
        const chronologyCounts = new Map<string, number>();
        for (const row of data as Array<{ id: string; created_at: string | null }>) {
            chronologyCounts.set(row.id, (chronologyCounts.get(row.id) ?? 0) + 1);
            const timestamp = typeof row.created_at === 'string' ? Date.parse(row.created_at) : NaN;
            if (Number.isFinite(timestamp)) chronology.set(row.id, timestamp);
            else chronology.delete(row.id);
        }
        for (const [id, count] of chronologyCounts) {
            if (count !== 1) chronology.delete(id); // ambiguous server rows fail closed
        }
    }

    // Persisted ids are authoritative, but incompatible references still fail closed before arithmetic.
    const validReference = (row: EvalRow, expectedId: string | null): boolean =>
        !!expectedId && row.session_id === expectedId && row.session_id !== sessionId
        && row.eligible && row.cohort_key === currentRow.cohort_key
        && hasCompleteEligibleProgressEvidence(toEvaluation(row))
        && chronology.has(sessionId) && chronology.has(row.session_id)
        && isEarlierSession(
            { id: row.session_id, createdAt: chronology.get(row.session_id) as number },
            { id: sessionId, createdAt: chronology.get(sessionId) as number },
        );
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
    if (!hasCompleteEligibleProgressEvidence(current)) {
        return { status: 'unavailable', sessionId, message: 'Progress evidence is incomplete for this session.' };
    }
    let comparison: 'baseline' | 'previous' | 'restarted';
    // Retention can NULL/delete the referenced baseline while a later previous row survives. Without the
    // baseline, the stored direction chain is incomplete: never turn `describeDirection(current, null)`
    // into a fabricated "baseline established" claim or let the surviving previous row imply movement.
    const baselineReferenceMissing = !!currentRow.baseline_session_id && !baseline;
    if (baselineReferenceMissing) {
        comparison = 'restarted';
    } else if (previous) {
        comparison = 'previous';
    } else if (currentRow.baseline_session_id || currentRow.previous_comparable_session_id) {
        comparison = 'restarted';
    } else {
        const { data: sessionRow, error: sessionError } = await supabase
            .from('sessions')
            .select('id, created_at')
            .eq('id', sessionId)
            .maybeSingle();
        if (sessionError || !(sessionRow as { created_at?: string } | null)?.created_at) {
            return { status: 'error', sessionId, message: 'Comparison history could not be verified.' };
        }
        const createdAt = (sessionRow as { created_at: string }).created_at;
        const { data: priorRows, error: priorError } = await supabase
            .from('sessions')
            // #1258 F1: `session_progress_evaluations` has three FKs to `sessions` (session_id, baseline, previous);
            // an unhinted embed is ambiguous to PostgREST (PGRST201) and failed every first eligible session.
            .select('id, session_progress_evaluations!session_id!inner(cohort_key)')
            // PostgREST equivalent of the server's deterministic tuple comparator. A same-timestamp,
            // lower UUID is a real predecessor; self and higher UUIDs are not.
            .or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${sessionId})`)
            .eq('session_progress_evaluations.formula_version', PROGRESS_FORMULA_VERSION)
            .eq('session_progress_evaluations.eligible', true)
            .neq('session_progress_evaluations.cohort_key', currentRow.cohort_key)
            .limit(1);
        if (priorError || !priorRows) return { status: 'error', sessionId, message: 'Comparison history could not be verified.' };
        comparison = priorRows.length > 0 ? 'restarted' : 'baseline';
    }

    const { data: rec, error: recError } = await supabase
        .from('progress_recommendations')
        .select(RECOMMENDATION_FIELDS)
        .eq('source_session_id', sessionId)
        .eq('formula_version', PROGRESS_FORMULA_VERSION)
        .maybeSingle();
    if (recError) return { status: 'error', sessionId, message: 'Your next action could not be loaded.' };
    let recommendationRow = rec as RecommendationRow | null;
    let recommendationId = recommendationRow?.id ?? null;
    if (!recommendationId) {
        recommendationId = await reconcileProgressRecommendation(sessionId);
        if (!recommendationId) {
            return { status: 'unavailable', sessionId, message: 'Your next action is not available yet. Retry to check again.' };
        }
        const { data: recovered, error: recoveredError } = await supabase
            .from('progress_recommendations')
            .select(RECOMMENDATION_FIELDS)
            .eq('source_session_id', sessionId)
            .eq('formula_version', PROGRESS_FORMULA_VERSION)
            .maybeSingle();
        if (recoveredError || !recovered) {
            return { status: 'unavailable', sessionId, message: 'Your next action is not available yet. Retry to check again.' };
        }
        recommendationRow = recovered as RecommendationRow;
    }

    if (!recommendationRow
        || recommendationRow.id !== recommendationId
        || !['filler_rate', 'pace', 'clear_delivery'].includes(recommendationRow.target_metric)
        || !['decrease', 'increase', 'maintain'].includes(recommendationRow.target_direction)
        || !Number.isFinite(recommendationRow.target_value)
        || recommendationRow.target_units.trim().length === 0
        || recommendationRow.shown_text.trim().length === 0) {
        return { status: 'unavailable', sessionId, message: 'Your next action is not available yet. Retry to check again.' };
    }

    let latestAttempt: ProgressAttemptView | null = null;
    let repeatResult: RepeatResultView | null = null;
    if (recommendationId) {
        const { data: attempt, error: attemptError } = await supabase
            .from('progress_recommendation_attempts')
            .select('id, lifecycle, outcome, next_comparable_session_id')
            .eq('recommendation_id', recommendationId)
            .order('accepted_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (attemptError) return { status: 'error', sessionId, message: 'Your repeat outcome could not be loaded.' };
        const attemptRow = (attempt as AttemptRow | null) ?? null;
        latestAttempt = attemptRow ? { id: attemptRow.id, lifecycle: attemptRow.lifecycle, outcome: attemptRow.outcome } : null;
        if (attemptRow?.lifecycle === 'completed') {
            repeatResult = await loadRepeatResult(supabase, sessionId, currentRow, recommendationRow, attemptRow);
        }
    }

    const direction = comparison === 'restarted'
        ? { direction: 'baseline', deltaPoints: null, deltaPercent: null, reason: null, text: 'Comparison restarted for this recording setup.' } as const
        : describeDirection(current, comparison === 'previous' ? previous : null);
    const baselineContext = comparison === 'restarted'
        ? 'A new first comparable session will set the baseline context.'
        : comparison === 'baseline'
            ? 'This is your first comparable session.'
            : baseline && previous && baseline.sessionId === previous.sessionId
                ? 'Your previous comparable session is also your first-session baseline.'
                : baseline
                    ? describeDirection(current, baseline, { referenceLabel: 'first comparable session' }).text
                    : 'Baseline context is unavailable.';
    const computedTakeaways = buildTakeaways(current, comparison === 'restarted' ? null : previous);
    const takeaways: Takeaways = {
        ...computedTakeaways,
        practiceThisNext: recommendationRow.shown_text,
        target: {
            metric: recommendationRow.target_metric,
            direction: recommendationRow.target_direction,
            targetValue: recommendationRow.target_value,
            units: recommendationRow.target_units,
        },
    };

    // Inspectable evidence for a REAL comparison only. Baseline/restarted states have no defensible
    // reference to disclose, so the disclosure is null and the UI shows none.
    const disclosure: ProgressDisclosure | null =
        comparison === 'previous' && previous && previous.clarityRaw !== null && current.clarityRaw !== null && current.cohortKey
            ? {
                referenceSessionId: previous.sessionId,
                referenceRole: 'previous comparable session',
                alsoFirstComparable: !!(baseline && baseline.sessionId === previous.sessionId),
                cohortKey: current.cohortKey,
                currentClarityPoints: current.clarityRaw,
                referenceClarityPoints: previous.clarityRaw,
                deltaPoints: current.clarityRaw - previous.clarityRaw,
                deltaPercent: direction.deltaPercent,
                units: 'clear-delivery points',
            }
            : null;

    return {
        status: 'eligible', sessionId, comparison,
        direction,
        baselineContext,
        disclosure,
        takeaways,
        recommendationId,
        latestAttempt,
        repeatResult,
    };
}

/**
 * Reads the completed attempt's persisted next-comparable evaluation and applies the server's pair guards
 * (same formula version, eligible, same cohort as the source session, a different session). A read error or any
 * failed guard is `unavailable`: the rest of Progress still renders, and no number is shown.
 */
async function loadRepeatResult(
    supabase: ReturnType<typeof getSupabaseClient>,
    sessionId: string,
    sourceRow: EvalRow,
    recommendation: RecommendationRow,
    attempt: AttemptRow,
): Promise<RepeatResultView> {
    const unavailable: RepeatResultView = { status: 'unavailable' };
    const nextId = attempt.next_comparable_session_id;
    const before = recommendation.source_metric_value;
    if (attempt.outcome !== 'moved' && attempt.outcome !== 'did_not_move') return unavailable;
    if (!nextId || nextId === sessionId || typeof before !== 'number' || !Number.isFinite(before)) return unavailable;
    if (!sourceRow.cohort_key) return unavailable;
    const { data, error } = await supabase
        .from('session_progress_evaluations')
        .select(EVAL_FIELDS)
        .eq('session_id', nextId)
        .eq('formula_version', PROGRESS_FORMULA_VERSION)
        .maybeSingle();
    const next = (data as EvalRow | null) ?? null;
    if (error || !next || next.session_id !== nextId || !next.eligible || next.cohort_key !== sourceRow.cohort_key) return unavailable;
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
