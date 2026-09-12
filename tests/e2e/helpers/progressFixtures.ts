/**
 * #1427 / #1047 U3 — the eligible Progress readback fixture, as its own module.
 *
 * It lived inside the spec, which is how it drifted: `hasCompleteEligibleProgressEvidence` gained a
 * required `errorMarkerCount`, the fixture never grew the matching `error_marker_count`, and the
 * journey resolved `unavailable` before it ever reached the progress-direction assertions. The gate was
 * right; the fixture was incomplete, and nothing connected the two.
 *
 * Extracted here so a unit test can run the PRODUCTION predicate over this exact object. A fixture that
 * cannot satisfy the gate it is meant to pass through is a broken fixture, and that is now a fast local
 * failure instead of a red E2E shard.
 *
 * Deliberately free of Playwright imports so it is loadable from vitest.
 */

export interface ProgressEvaluationFixtureRow {
    session_id: string;
    eligible: boolean;
    exclusion_reasons: string[];
    clarity_raw: number;
    filler_count: number;
    /**
     * REQUIRED. `hasCompleteEligibleProgressEvidence` demands an integer >= 0; an absent field reads as
     * `undefined`, fails `Number.isInteger`, and silently downgrades the journey to `unavailable`.
     */
    error_marker_count: number;
    wpm: number;
    word_count: number;
    cohort_key: string;
    baseline_session_id: string | null;
    previous_comparable_session_id: string | null;
    formula_version: string;
}

export function eligibleProgressTruth(sessionId: string, referenceId: string) {
    const current: ProgressEvaluationFixtureRow = {
        session_id: sessionId,
        eligible: true,
        exclusion_reasons: [],
        clarity_raw: 88,
        filler_count: 4,
        error_marker_count: 0,
        wpm: 142,
        word_count: 245,
        cohort_key: 'private|v2|base|clarity_v1',
        baseline_session_id: referenceId,
        previous_comparable_session_id: referenceId,
        formula_version: 'clarity_v1',
    };
    const reference: ProgressEvaluationFixtureRow = {
        ...current,
        session_id: referenceId,
        clarity_raw: 82,
        filler_count: 7,
        wpm: 136,
        baseline_session_id: null,
        previous_comparable_session_id: null,
    };
    return {
        evaluations: [current, reference],
        recommendations: [{
            id: 'recommendation-u3',
            source_session_id: sessionId,
            formula_version: 'clarity_v1',
            target_metric: 'filler_rate',
            target_direction: 'decrease',
            target_value: 2,
            target_units: 'percent of words',
            shown_text: 'Close the next attempt with the requested decision and owner.',
        }],
        attempts: [] as unknown[],
        chronology: [
            { id: referenceId, created_at: '2025-01-17T13:00:00.000Z' },
            { id: sessionId, created_at: '2025-01-17T14:00:00.000Z' },
        ],
    };
}

/**
 * Comparison-eligible fixture used by the Practice Focus repeat journey. It lives beside the U3 fixture
 * so both real E2E payloads are type-checked and exercised through the production completeness gate.
 */
export function eligibleRepeatProgress(sessionId: string, referenceId: string) {
    const current: ProgressEvaluationFixtureRow = {
        session_id: sessionId,
        eligible: true,
        exclusion_reasons: [],
        clarity_raw: 88,
        filler_count: 4,
        error_marker_count: 0,
        wpm: 142,
        word_count: 245,
        cohort_key: 'private|v2|base|clarity_v1',
        baseline_session_id: referenceId,
        previous_comparable_session_id: referenceId,
        formula_version: 'clarity_v1',
    };
    const reference: ProgressEvaluationFixtureRow = {
        ...current,
        session_id: referenceId,
        clarity_raw: 82,
        filler_count: 7,
        wpm: 136,
        baseline_session_id: null,
        previous_comparable_session_id: null,
    };
    return {
        evaluations: [current, reference],
        recommendations: [{
            id: 'pf-repeat-recommendation',
            source_session_id: sessionId,
            formula_version: 'clarity_v1',
            target_metric: 'filler_rate',
            target_direction: 'decrease',
            target_value: 3,
            target_units: 'percent of words',
            shown_text: 'Cut filler words toward 3%',
        }],
        attempts: [] as unknown[],
        chronology: [
            { id: referenceId, created_at: '2025-01-31T13:00:00.000Z' },
            { id: sessionId, created_at: '2025-02-01T14:00:00.000Z' },
        ],
    };
}
