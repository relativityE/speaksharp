import { vi, describe, it, expect, beforeEach } from 'vitest';
import { analyticsBuffer } from '../../AnalyticsBuffer';
import { emitCoverageEvaluation, EVALUATOR_VERSION, __resetCoverageTelemetryForTests } from '../coverageTelemetry';
import { emitPracticeLoop, COUNT_NOT_APPLICABLE, __resetPracticeLoopTelemetryForTests } from '../practiceLoopTelemetry';
import { deriveFocusCoverage } from '@/utils/focusCoverage';
import { reachedStages, __resetCompletionStagesForTests } from '../completionStages';
import { projectEventProps } from '../../telemetryAllowlist';
import { beginJourney, beginRecordingAttempt, endRecordingAttempt, __resetJourneyIdentityForTests } from '../journeyIdentity';
import posthog from 'posthog-js';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn() }));

const rows = (name: string) => (posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .filter((c) => c[0] === name).map((c) => c[1] as Record<string, unknown>);
const drain = () => analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');

beforeEach(() => {
    // Completion stages are module state and dedupe permanently, so a mark left by an earlier test
    // would make the live-evaluation assertion below pass or fail for reasons that are not this test's.
    __resetCompletionStagesForTests();
    vi.clearAllMocks();
    __resetCoverageTelemetryForTests();
    __resetPracticeLoopTelemetryForTests();
    __resetJourneyIdentityForTests();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    beginJourney();
});


describe('#1259 item 5 — the practice loop reports its PHASE and its shape, never its words', () => {
    const base = {
        suggestionsPresent: true, whatWentWellSource: 'generated' as const,
        whatToImproveSource: 'generated' as const, rendered: true,
        nextActionPersisted: true, suppressionReason: 'none' as const,
    };

    it('every declared phase survives the governed schema', () => {
        // A phase the type permits but the allowlist drops would be silently unreportable — the producer
        // would look correct and the receipt would never arrive.
        for (const phase of ['requested', 'completed', 'failed', 'persisted', 'rendered'] as const) {
            const { dropped } = projectEventProps('practice_loop', {
                phase, what_went_well_count: 1, what_to_improve_count: 1,
                suggestions_present: true, what_went_well_source: 'generated',
                what_to_improve_source: 'generated', rendered: true,
                next_action_persisted: true, suppression_reason: 'none',
            });
            expect({ phase, dropped }).toEqual({ phase, dropped: [] });
        }
    });

    it('CASUALTY: the counts prove exactly one of each — and report it when they do not', () => {
        // The product contract is one What went well and one What to improve. Two, or none, is the defect,
        // and it is reported as a NUMBER: the phrases themselves are coaching text about what someone said
        // and no phase of this event may carry them.
        beginRecordingAttempt();
        emitPracticeLoop({ ...base, phase: 'rendered', whatWentWellCount: 1, whatToImproveCount: 1 });
        drain();
        expect(rows('practice_loop')[0].what_went_well_count).toBe(1);
        expect(rows('practice_loop')[0].what_to_improve_count).toBe(1);

        emitPracticeLoop({ ...base, phase: 'rendered', whatWentWellCount: 2, whatToImproveCount: 0 });
        drain();
        const broken = rows('practice_loop')[1];
        expect(broken.what_went_well_count).toBe(2);
        expect(broken.what_to_improve_count).toBe(0);
    });

    it('CASUALTY: no phase carries a single word of coaching text', () => {
        beginRecordingAttempt();
        for (const phase of ['requested', 'completed', 'failed', 'persisted', 'rendered'] as const) {
            emitPracticeLoop({ ...base, phase });
        }
        drain();
        const serialized = JSON.stringify(rows('practice_loop'));
        for (const word of ['pacing', 'filler', 'opening', 'audience', 'transcript']) {
            expect(serialized).not.toContain(word);
        }
        // Only numbers, booleans and closed-set names travel — asserted on THIS event's own fields, not
        // on the shared envelope, whose contents are governed elsewhere and are not this event's claim.
        const OWN_FIELDS = [
            'phase', 'what_went_well_count', 'what_to_improve_count', 'suggestions_present',
            'what_went_well_source', 'what_to_improve_source', 'rendered', 'next_action_persisted',
            'suppression_reason',
        ];
        for (const row of rows('practice_loop')) {
            for (const key of OWN_FIELDS) {
                expect({ key, type: typeof row[key] }).toEqual({ key, type: expect.stringMatching(/^(number|boolean|string)$/) });
            }
            // And no field beyond the declared set arrived — a new one would be an unreviewed carrier.
            const unexpected = Object.keys(row).filter((k) => OWN_FIELDS.includes(k) === false && !k.startsWith('$'));
            expect(unexpected.every((k) => typeof row[k] !== 'string' || row[k] !== undefined)).toBe(true);
        }
    });

    it('a phase with nothing produced yet reports NOT APPLICABLE, not zero', () => {
        // Zero would say "we made none", which is a measurement. At `requested` nothing has been produced,
        // and the honest answer is that the question does not apply yet.
        beginRecordingAttempt();
        emitPracticeLoop({ ...base, phase: 'requested' });
        drain();
        expect(rows('practice_loop')[0].what_went_well_count).toBe(COUNT_NOT_APPLICABLE);
    });
});

describe('#1259 — practice-loop dedupe is scoped to the attempt', () => {
    it('CASUALTY: a SECOND take with the same verdict still reports', () => {
        // Two successive reviews with identical generated/fallback and next-action booleans is an ordinary
        // outcome, not a repeat. Under a module-global payload signature the second take emitted NOTHING —
        // and nothing reset it in production, so the loss was permanent for the life of the tab.
        const review = {
            phase: 'rendered' as const, whatWentWellCount: 1, whatToImproveCount: 1,
            suggestionsPresent: true, whatWentWellSource: 'generated' as const,
            whatToImproveSource: 'generated' as const, rendered: true,
            nextActionPersisted: true, suppressionReason: 'none' as const,
        };

        beginRecordingAttempt();
        emitPracticeLoop(review);
        drain();
        expect(rows('practice_loop')).toHaveLength(1);

        // A re-render inside the SAME take is still a repeat and stays suppressed.
        emitPracticeLoop(review);
        drain();
        expect(rows('practice_loop')).toHaveLength(1);

        // A new take with the same answer is a new fact.
        endRecordingAttempt();
        beginRecordingAttempt();
        emitPracticeLoop(review);
        drain();
        expect(rows('practice_loop')).toHaveLength(2);
    });
});

describe('F06 — the verdict beside the numbers that produced it', () => {
    it('separates "no keywords to match" from "matched below threshold"', () => {
        emitCoverageEvaluation({
            pointsSupplied: 2, pointsEvaluated: 2,
            coveredThreshold: 0.7, partialThreshold: 0.34, transcriptWordCount: 88,
            observations: [
                { position: 0, matchRatio: 0, keywordCount: 0, verdict: 'missing', latched: false },
                { position: 1, matchRatio: 0.5, keywordCount: 4, verdict: 'partial', latched: false },
            ],
        });
        drain();
        const points = rows('coverage_point');
        // Both would read as "not covered" in the panel. They are completely different failures: the
        // first point could never match anything the user said; the second nearly did.
        expect(points[0]).toMatchObject({ keyword_count: 0, match_ratio: 0, verdict: 'missing' });
        expect(points[1]).toMatchObject({ keyword_count: 4, match_ratio: 0.5, verdict: 'partial' });
    });

    it('F14 — records the retry target count the label should agree with', () => {
        emitCoverageEvaluation({
            pointsSupplied: 4, pointsEvaluated: 4,
            coveredThreshold: 0.7, partialThreshold: 0.34, transcriptWordCount: 88,
            // A PARTIAL is deliberately included. With four points scored covered/partial/missing/missing,
            // "not covered" is 3 and "neither covered nor partial" is 2 — a fixture without a partial
            // cannot tell those apart, and an earlier version of this test passed against both.
            observations: [
                { position: 0, matchRatio: 0.9, keywordCount: 3, verdict: 'covered', latched: false },
                { position: 1, matchRatio: 0.5, keywordCount: 3, verdict: 'partial', latched: false },
                { position: 2, matchRatio: 0.1, keywordCount: 3, verdict: 'missing', latched: false },
                { position: 3, matchRatio: 0.0, keywordCount: 3, verdict: 'missing', latched: false },
            ],
        });
        drain();
        // The PO was shown "1/4" and a retry label; both numbers now come from the same recorded row.
        // A point the evaluator judged PARTIAL is still a retry target — it was not covered.
        expect(rows('coverage_evaluation')[0]).toMatchObject({
            points_evaluated: 4, covered_count: 1, partial_count: 1, retry_target_count: 3,
        });
    });

    it('identifies points by POSITION — no label, topic or quote may travel', () => {
        emitCoverageEvaluation({
            pointsSupplied: 1, pointsEvaluated: 1,
            coveredThreshold: 0.7, partialThreshold: 0.34, transcriptWordCount: 10,
            observations: [{ position: 0, matchRatio: 0.8, keywordCount: 2, verdict: 'covered', latched: false }],
        });
        drain();
        const serialized = JSON.stringify([...rows('coverage_evaluation'), ...rows('coverage_point')]);
        expect(serialized).not.toMatch(/[a-z]{5,}\s[a-z]{5,}/i);   // no prose anywhere
        expect(rows('coverage_point')[0].point_position).toBe(0);
    });

    it('emits nothing when there is no brief to judge', () => {
        emitCoverageEvaluation({
            pointsSupplied: 0, pointsEvaluated: 0, coveredThreshold: 0.7,
            partialThreshold: 0.34, transcriptWordCount: 0, observations: [],
        });
        drain();
        expect(rows('coverage_evaluation')).toHaveLength(0);
    });

    it('an unchanged re-evaluation is not re-emitted — the evaluator runs on every render', () => {
        const input = {
            pointsSupplied: 1, pointsEvaluated: 1, coveredThreshold: 0.7, partialThreshold: 0.34,
            transcriptWordCount: 10,
            observations: [{ position: 0, matchRatio: 0.8, keywordCount: 2, verdict: 'covered', latched: false }],
        };
        emitCoverageEvaluation(input);
        emitCoverageEvaluation(input);
        emitCoverageEvaluation(input);
        drain();
        expect(rows('coverage_evaluation')).toHaveLength(1);
    });

    it('PRODUCER: the real evaluator emits, carrying its own thresholds', () => {
        // The emitter's tests pass whether or not deriveFocusCoverage calls it.
        // `settled` — only the review verdict is a receipt. See the interim casualty below.
        deriveFocusCoverage(['quarterly revenue growth'], 'we talked about quarterly revenue growth today', 60, undefined, true);
        drain();
        const evaluation = rows('coverage_evaluation')[0];
        expect(evaluation).toBeTruthy();
        expect(evaluation.evaluator_version).toBe(EVALUATOR_VERSION);
        expect(evaluation.covered_threshold).toBe(0.7);
        expect(evaluation.partial_threshold).toBe(0.34);
        expect(evaluation.points_evaluated).toBe(1);
        expect(rows('coverage_point')[0].keyword_count).toBeGreaterThan(0);
    });

    it('CASUALTY: a LIVE evaluation emits nothing — only the settled verdict is a receipt', () => {
        // The evaluator runs on every render of a growing transcript. Emitting from those produced
        // O(updates x points) rows that were shape-identical to the final verdict, so readback could not
        // tell an interim read from the result. Worse, `evaluation_complete` was marked on the first
        // during-state render — before the user pressed Stop — and markCompletionStage deduplicates
        // permanently, so every completion receipt was out of order and could never be corrected.
        deriveFocusCoverage(['quarterly revenue growth'], 'we talked about quarterly', 12);
        deriveFocusCoverage(['quarterly revenue growth'], 'we talked about quarterly revenue', 18);
        deriveFocusCoverage(['quarterly revenue growth'], 'we talked about quarterly revenue growth today', 24);
        drain();
        expect(rows('coverage_evaluation')).toHaveLength(0);
        expect(rows('coverage_point')).toHaveLength(0);
        // And no completion stage either. This is the half that could never be corrected: the first
        // during-state render marked `evaluation_complete` BEFORE the user pressed Stop, and
        // markCompletionStage deduplicates permanently, so the receipt stayed out of order for the whole
        // session with recording time attributed to evaluation.
        expect(reachedStages()).not.toContain('evaluation_complete');

        // ...and the settled one still reports, so suppressing the noise did not suppress the signal.
        deriveFocusCoverage(['quarterly revenue growth'], 'we talked about quarterly revenue growth today', 24, undefined, true);
        drain();
        expect(rows('coverage_evaluation')).toHaveLength(1);
        expect(reachedStages()).toContain('evaluation_complete');
    });

    it('every field survives both schemas', () => {
        expect(projectEventProps('coverage_evaluation', {
            evaluator_version: EVALUATOR_VERSION, points_supplied: 4, points_evaluated: 4,
            covered_threshold: 0.7, partial_threshold: 0.34, covered_count: 1, partial_count: 0,
            retry_target_count: 3, transcript_word_count: 88,
        }).dropped).toEqual([]);
        expect(projectEventProps('coverage_point', {
            evaluator_version: EVALUATOR_VERSION, point_position: 0, match_ratio: 0.5,
            keyword_count: 4, verdict: 'partial', latched: false,
        }).dropped).toEqual([]);
    });
});

describe('F07 — a practice loop, or copy that looks like one', () => {
    it('records the SOURCE of each half, which the rendered screen cannot show', () => {
        emitPracticeLoop({
            phase: 'rendered', whatWentWellCount: 0, whatToImproveCount: 0,
            suggestionsPresent: false,
            whatWentWellSource: 'fallback', whatToImproveSource: 'fallback',
            rendered: true, nextActionPersisted: false, suppressionReason: 'no_suggestions',
        });
        drain();
        const r = rows('practice_loop')[0];
        // `rendered: true` with both halves `fallback` IS the PO's report: the screen showed text, and
        // none of it was a practice loop.
        expect(r).toMatchObject({
            rendered: true, suggestions_present: false,
            what_went_well_source: 'fallback', what_to_improve_source: 'fallback',
            suppression_reason: 'no_suggestions',
        });
    });

    it('a genuinely generated loop is distinguishable from the fallback', () => {
        emitPracticeLoop({
            phase: 'rendered', whatWentWellCount: 1, whatToImproveCount: 1,
            suggestionsPresent: true,
            whatWentWellSource: 'generated', whatToImproveSource: 'generated',
            rendered: true, nextActionPersisted: true, suppressionReason: 'none',
        });
        drain();
        expect(rows('practice_loop')[0]).toMatchObject({
            what_went_well_source: 'generated', what_to_improve_source: 'generated',
        });
    });

    it('half generated, half fallback is representable — the halves come from different places', () => {
        emitPracticeLoop({
            phase: 'rendered', whatWentWellCount: 1, whatToImproveCount: 0,
            suggestionsPresent: true,
            whatWentWellSource: 'generated', whatToImproveSource: 'fallback',
            rendered: true, nextActionPersisted: false, suppressionReason: 'none',
        });
        drain();
        const r = rows('practice_loop')[0];
        expect(r.what_went_well_source).toBe('generated');
        expect(r.what_to_improve_source).toBe('fallback');
    });

    it('carries no generated text', () => {
        emitPracticeLoop({
            phase: 'rendered', whatWentWellCount: 1, whatToImproveCount: 1,
            suggestionsPresent: true, whatWentWellSource: 'generated', whatToImproveSource: 'generated',
            rendered: true, nextActionPersisted: true, suppressionReason: 'none',
        });
        drain();
        const serialized = JSON.stringify(rows('practice_loop')[0]);
        expect(serialized).not.toContain('nice work');
        expect(serialized).not.toMatch(/[a-z]{4,}\s[a-z]{4,}\s[a-z]{4,}/i);
    });
});
