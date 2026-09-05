import { vi, describe, it, expect, beforeEach } from 'vitest';
import { analyticsBuffer } from '../../AnalyticsBuffer';
import { emitCoverageEvaluation, EVALUATOR_VERSION, __resetCoverageTelemetryForTests } from '../coverageTelemetry';
import { emitPracticeLoop, __resetPracticeLoopTelemetryForTests } from '../practiceLoopTelemetry';
import { deriveFocusCoverage } from '@/utils/focusCoverage';
import { projectEventProps } from '../../telemetryAllowlist';
import { beginJourney, __resetJourneyIdentityForTests } from '../journeyIdentity';
import posthog from 'posthog-js';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn() }));

const rows = (name: string) => (posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .filter((c) => c[0] === name).map((c) => c[1] as Record<string, unknown>);
const drain = () => analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');

beforeEach(() => {
    vi.clearAllMocks();
    __resetCoverageTelemetryForTests();
    __resetPracticeLoopTelemetryForTests();
    __resetJourneyIdentityForTests();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    beginJourney();
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
        deriveFocusCoverage(['quarterly revenue growth'], 'we talked about quarterly revenue growth today', 60);
        drain();
        const evaluation = rows('coverage_evaluation')[0];
        expect(evaluation).toBeTruthy();
        expect(evaluation.evaluator_version).toBe(EVALUATOR_VERSION);
        expect(evaluation.covered_threshold).toBe(0.7);
        expect(evaluation.partial_threshold).toBe(0.34);
        expect(evaluation.points_evaluated).toBe(1);
        expect(rows('coverage_point')[0].keyword_count).toBeGreaterThan(0);
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
            suggestionsPresent: true, whatWentWellSource: 'generated', whatToImproveSource: 'generated',
            rendered: true, nextActionPersisted: true, suppressionReason: 'none',
        });
        drain();
        const serialized = JSON.stringify(rows('practice_loop')[0]);
        expect(serialized).not.toContain('nice work');
        expect(serialized).not.toMatch(/[a-z]{4,}\s[a-z]{4,}\s[a-z]{4,}/i);
    });
});
