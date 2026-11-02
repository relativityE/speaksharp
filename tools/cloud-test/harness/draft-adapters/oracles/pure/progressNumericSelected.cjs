'use strict';
const PROGRESS_FORMULA_VERSION = 'clarity_v1';
function hasCompleteEligibleProgressEvidence(evaluation) {
    return evaluation.eligible
        && Number.isInteger(evaluation.wordCount) && evaluation.wordCount > 0
        && typeof evaluation.clarityRaw === 'number' && Number.isFinite(evaluation.clarityRaw)
        && Number.isInteger(evaluation.fillerCount) && evaluation.fillerCount >= 0
        && Number.isInteger(evaluation.errorMarkerCount) && evaluation.errorMarkerCount >= 0
        && typeof evaluation.wpm === 'number' && Number.isFinite(evaluation.wpm);
}
function metricValue(row, metric) {
    const value = metric === 'filler_rate'
        ? (Number.isInteger(row.word_count) && row.word_count > 0
            && Number.isInteger(row.filler_count) && row.filler_count >= 0
            ? (row.filler_count / row.word_count) * 100 : null)
        : metric === 'pace' ? row.wpm
            : row.clarity_raw;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function toEvaluation(row) {
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
async function loadRepeatResult(supabase, sessionId, sourceRow, recommendation, attempt) {
    const unavailable = { status: 'unavailable' };
    const nextId = attempt.next_comparable_session_id;
    const before = recommendation.source_metric_value;
    if (attempt.outcome !== 'moved' && attempt.outcome !== 'did_not_move')
        return unavailable;
    if (!nextId || nextId === sessionId || typeof before !== 'number' || !Number.isFinite(before))
        return unavailable;
    if (!sourceRow.cohort_key)
        return unavailable;
    const { data, error } = await supabase
        .from('session_progress_evaluations')
        .select(EVAL_FIELDS)
        .eq('session_id', nextId)
        .eq('formula_version', PROGRESS_FORMULA_VERSION)
        .maybeSingle();
    const next = data ?? null;
    if (error || !next || next.session_id !== nextId || !next.eligible || next.cohort_key !== sourceRow.cohort_key)
        return unavailable;
    // Parity with opening that session itself: evidence the normal loader calls incomplete is never shown here.
    if (!hasCompleteEligibleProgressEvidence(toEvaluation(next)))
        return unavailable;
    const after = metricValue(next, recommendation.target_metric);
    if (after === null)
        return unavailable;
    return {
        status: 'available',
        metric: recommendation.target_metric,
        direction: recommendation.target_direction,
        units: recommendation.target_units,
        before,
        after,
    };
}
const TARGET_METRIC_LABELS = {
    filler_rate: 'Filler rate', pace: 'Pace', clear_delivery: 'Clear delivery',
};
const MAX_REPEAT_VALUE_DIGITS = 6;
function formatRepeatValues(metric, before, after) {
    for (let digits = metric === 'filler_rate' ? 1 : 0; digits <= MAX_REPEAT_VALUE_DIGITS; digits += 1) {
        const pair = { before: before.toFixed(digits), after: after.toFixed(digits) };
        if (pair.before !== pair.after || before === after)
            return { ...pair, belowPrecision: false };
    }
    return { before: before.toFixed(MAX_REPEAT_VALUE_DIGITS), after: after.toFixed(MAX_REPEAT_VALUE_DIGITS), belowPrecision: true };
}

module.exports={PROGRESS_FORMULA_VERSION,hasCompleteEligibleProgressEvidence,metricValue,toEvaluation,EVAL_FIELDS,loadRepeatResult,TARGET_METRIC_LABELS,MAX_REPEAT_VALUE_DIGITS,formatRepeatValues};
