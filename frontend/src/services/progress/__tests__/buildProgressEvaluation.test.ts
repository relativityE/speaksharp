import { describe, it, expect } from 'vitest';
import {
    buildProgressEvaluation,
    resolveComparisonRefs,
    progressCohortKey,
    PROGRESS_FORMULA_VERSION,
    PROGRESS_ELIGIBILITY,
    type SessionEvidence,
    type ProgressEvaluation,
} from '../buildProgressEvaluation';
import { computeClarityRaw } from '@/utils/sessionAnalysis';

/**
 * #1045 PR-B — the evaluation record is the audit trail. These tests pin the two properties that make
 * it trustworthy: EVERY completed session yields a record (an exclusion is never a dropped row), and an
 * ineligible record never carries evidence, cohort, or comparison references it has not earned.
 */

const ELIGIBLE: SessionEvidence = {
    sessionId: 's1',
    userId: 'u1',
    status: 'completed',
    durationSeconds: 120,
    wordCount: 300,
    hasTranscript: true,
    fillerCount: 9,
    errorMarkerCount: 1,
    wpm: 140,
    engine: 'private',
    engineVersion: 'whisper-base.en@v2',
    modelName: 'whisper-base.en',
    attributionStatus: 'verified',
};
const ev = (over: Partial<SessionEvidence> = {}): SessionEvidence => ({ ...ELIGIBLE, ...over });

describe('#1045 buildProgressEvaluation — eligibility gates and the audit trail', () => {
    it('an eligible session yields a complete, eligible record', () => {
        const r = buildProgressEvaluation(ev());
        expect(r.eligible).toBe(true);
        expect(r.exclusionReasons).toEqual([]);
        expect(r.formulaVersion).toBe(PROGRESS_FORMULA_VERSION);
        expect(r.snapshotOrigin).toBe('at_save');
        expect(r.clarityRaw).toBeCloseTo(
            computeClarityRaw({ wordCount: 300, fillerCount: 9, errorCount: 1, wpm: 140 }), 10);
        expect(r.cohortKey).toBe(progressCohortKey(ELIGIBLE));
    });

    it('ALWAYS records the audit facts, even when ineligible (an exclusion is never a dropped row)', () => {
        const r = buildProgressEvaluation(ev({ durationSeconds: 12, wordCount: 20 }));
        expect(r.eligible).toBe(false);
        // The facts needed to prove the decision later are all present:
        expect(r.sessionId).toBe('s1');
        expect(r.durationSeconds).toBe(12);
        expect(r.wordCount).toBe(20);
        expect(r.engine).toBe('private');
        expect(r.engineVersion).toBe('whisper-base.en@v2');
        expect(r.modelName).toBe('whisper-base.en');
        expect(r.attributionStatus).toBe('verified');
        expect(r.formulaVersion).toBe(PROGRESS_FORMULA_VERSION);
        expect(typeof r.clarityEvidenceAvailable).toBe('boolean');
    });

    it('an ineligible record carries NO evidence, cohort, or clarity value', () => {
        const r = buildProgressEvaluation(ev({ status: 'active' }));
        expect(r.eligible).toBe(false);
        expect(r.clarityRaw).toBeNull();
        expect(r.cohortKey).toBeNull();
        expect(r.fillerCount).toBeNull();
        expect(r.errorMarkerCount).toBeNull();
        expect(r.wpm).toBeNull();
    });

    it('records the exact deterministic reason for each gate', () => {
        expect(buildProgressEvaluation(ev({ status: 'failed' })).exclusionReasons).toContain('not_completed');
        expect(buildProgressEvaluation(ev({ durationSeconds: 29 })).exclusionReasons).toContain('too_short');
        expect(buildProgressEvaluation(ev({ wordCount: 74 })).exclusionReasons).toContain('too_few_words');
        expect(buildProgressEvaluation(ev({ hasTranscript: false })).exclusionReasons).toContain('no_transcript');
        expect(buildProgressEvaluation(ev({ wpm: null })).exclusionReasons).toContain('no_clarity_evidence');
        for (const st of ['pending', 'unverified', 'legacy_unknown', null]) {
            expect(buildProgressEvaluation(ev({ attributionStatus: st })).exclusionReasons)
                .toContain('unverified_attribution');
        }
    });

    it('the thresholds are exactly 30s and 75 words, and the boundary is inclusive', () => {
        expect(PROGRESS_ELIGIBILITY.MIN_DURATION_SECONDS).toBe(30);
        expect(PROGRESS_ELIGIBILITY.MIN_WORD_COUNT).toBe(75);
        expect(buildProgressEvaluation(ev({ durationSeconds: 30, wordCount: 75 })).eligible).toBe(true);
        expect(buildProgressEvaluation(ev({ durationSeconds: 29.99 })).eligible).toBe(false);
        expect(buildProgressEvaluation(ev({ wordCount: 74 })).eligible).toBe(false);
    });

    it('a genuine measured ZERO is valid evidence, not missing evidence', () => {
        const r = buildProgressEvaluation(ev({ fillerCount: 0, errorMarkerCount: 0 }));
        expect(r.eligible).toBe(true);
        expect(r.clarityEvidenceAvailable).toBe(true);
        expect(r.fillerCount).toBe(0);
    });

    it('reasons are deduplicated and ordered — the same session always yields the same record', () => {
        const a = buildProgressEvaluation(ev({ status: 'failed', durationSeconds: 1, wordCount: 1, hasTranscript: false }));
        const b = buildProgressEvaluation(ev({ status: 'failed', durationSeconds: 1, wordCount: 1, hasTranscript: false }));
        expect(a.exclusionReasons).toEqual(b.exclusionReasons);
        expect(a.exclusionReasons).toEqual([...a.exclusionReasons].sort());
        expect(new Set(a.exclusionReasons).size).toBe(a.exclusionReasons.length);
    });

    it('the cohort key includes model_name — version alone must not merge two models', () => {
        const a = progressCohortKey({ engine: 'private', engineVersion: 'v2', modelName: 'whisper-base.en' });
        const b = progressCohortKey({ engine: 'private', engineVersion: 'v2', modelName: 'whisper-small.en' });
        expect(a).not.toBe(b);
        expect(a).toContain(PROGRESS_FORMULA_VERSION);
    });

    it('is pure — the same input yields an identical record', () => {
        expect(buildProgressEvaluation(ev())).toEqual(buildProgressEvaluation(ev()));
    });
});

describe('#1045 resolveComparisonRefs — baseline and previous comparable', () => {
    const evalOf = (sessionId: string, over: Partial<ProgressEvaluation> = {}): ProgressEvaluation =>
        ({ ...buildProgressEvaluation(ev({ sessionId })), ...over });

    it('the FIRST eligible session in a cohort has no baseline — never a fabricated zero', () => {
        const refs = resolveComparisonRefs(evalOf('s1'), []);
        expect(refs.baselineSessionId).toBeNull();
        expect(refs.previousComparableSessionId).toBeNull();
    });

    it('baseline is the oldest eligible session; previous comparable is the most recent', () => {
        const prior = [evalOf('s1'), evalOf('s2'), evalOf('s3')]; // oldest first
        const refs = resolveComparisonRefs(evalOf('s4'), prior);
        expect(refs.baselineSessionId).toBe('s1');
        expect(refs.previousComparableSessionId).toBe('s3');
    });

    it('sessions from a DIFFERENT cohort are never comparable (engine/model/version change)', () => {
        const otherCohort = evalOf('s1', { cohortKey: 'cloud|v9|other-model|clarity_v1' });
        const refs = resolveComparisonRefs(evalOf('s2'), [otherCohort]);
        expect(refs.baselineSessionId).toBeNull();
        expect(refs.previousComparableSessionId).toBeNull();
    });

    it('an ineligible current session gets no references at all', () => {
        const current = buildProgressEvaluation(ev({ sessionId: 's9', wordCount: 10 }));
        const refs = resolveComparisonRefs(current, [evalOf('s1')]);
        expect(refs.baselineSessionId).toBeNull();
        expect(refs.previousComparableSessionId).toBeNull();
    });

    it('ineligible prior sessions are ignored when resolving the baseline', () => {
        const ineligiblePrior = buildProgressEvaluation(ev({ sessionId: 's0', wordCount: 5 }));
        const refs = resolveComparisonRefs(evalOf('s3'), [ineligiblePrior, evalOf('s1'), evalOf('s2')]);
        expect(refs.baselineSessionId).toBe('s1');
        expect(refs.previousComparableSessionId).toBe('s2');
    });

    it('the current session is never its own baseline', () => {
        const refs = resolveComparisonRefs(evalOf('s1'), [evalOf('s1')]);
        expect(refs.baselineSessionId).toBeNull();
    });
});
