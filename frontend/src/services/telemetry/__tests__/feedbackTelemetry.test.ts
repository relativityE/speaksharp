import { vi, describe, it, expect, beforeEach } from 'vitest';
import { analyticsBuffer } from '../../AnalyticsBuffer';
import {
    submitBlockers, lengthBand, emitFeedbackFieldState, emitFeedbackSubmit,
    __resetFeedbackTelemetryForTests,
} from '../feedbackTelemetry';
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
    __resetFeedbackTelemetryForTests();
    __resetJourneyIdentityForTests();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    beginJourney();
});

describe('F09 — which of the four conditions kept Send grey', () => {
    it('names EVERY unmet condition, not just the first', () => {
        // The button is a single boolean, so the user learns nothing from it. A list is the only shape
        // that answers "no matter what I type, it stays grey".
        expect(submitBlockers({ kind: '', titleLength: 0, descriptionLength: 0, isSubmitting: false }))
            .toEqual(['kind_missing', 'title_too_short', 'description_too_short']);
    });

    it('a nearly-complete form reports only what is still missing', () => {
        expect(submitBlockers({ kind: 'bug', titleLength: 12, descriptionLength: 9, isSubmitting: false }))
            .toEqual(['description_too_short']);
    });

    it('the exact boundaries match the gate — 4 and 10, not 3 and 9', () => {
        expect(submitBlockers({ kind: 'bug', titleLength: 3, descriptionLength: 10, isSubmitting: false }))
            .toEqual(['title_too_short']);
        expect(submitBlockers({ kind: 'bug', titleLength: 4, descriptionLength: 10, isSubmitting: false }))
            .toEqual([]);
    });

    it('an in-flight submit is a blocker in its own right', () => {
        expect(submitBlockers({ kind: 'bug', titleLength: 9, descriptionLength: 20, isSubmitting: true }))
            .toEqual(['already_submitting']);
    });

    it('a refused submit is recorded WITH its reason — silence is what we had before', () => {
        emitFeedbackSubmit({ outcome: 'refused_by_gate', blockers: ['description_too_short'] });
        drain();
        expect(rows('feedback_submit')[0]).toMatchObject({
            outcome: 'refused_by_gate', submit_blockers: ['description_too_short'],
        });
    });

    it('a storage failure is distinguishable from never having tried', () => {
        emitFeedbackSubmit({ outcome: 'storage_failed', acknowledgementVisible: false });
        drain();
        // `report_issue_submitted` fires only on success, so both previously produced no event at all.
        expect(rows('feedback_submit')[0]).toMatchObject({
            outcome: 'storage_failed', acknowledgement_visible: false,
        });
    });
});

describe('F09 — a field that empties itself', () => {
    it('distinguishes an UNEXPECTED clear from a field that was always empty', () => {
        emitFeedbackFieldState({
            field: 'title', transition: 'entered', lengthBand: lengthBand(12),
            blockers: [], submitEnabled: true,
        });
        emitFeedbackFieldState({
            field: 'title', transition: 'unexpected_clear', lengthBand: lengthBand(0),
            blockers: ['title_too_short'], submitEnabled: false,
        });
        drain();
        expect(rows('feedback_field').map((r) => r.transition)).toEqual(['entered', 'unexpected_clear']);
    });

    it('typing is not an event — only a CHANGE of state is', () => {
        for (let i = 0; i < 5; i += 1) {
            emitFeedbackFieldState({
                field: 'description', transition: 'entered', lengthBand: lengthBand(50),
                blockers: [], submitEnabled: true,
            });
        }
        drain();
        expect(rows('feedback_field')).toHaveLength(1);
    });
});

describe('F09 — the text never travels', () => {
    it('bands the length instead of counting it', () => {
        expect(lengthBand(0)).toBe('0');
        expect(lengthBand(3)).toBe('1-3');
        expect(lengthBand(9)).toBe('4-9');
        expect(lengthBand(39)).toBe('10-39');
        expect(lengthBand(199)).toBe('40-199');
        expect(lengthBand(5000)).toBe('200+');
    });

    it('the PO’s actual words could not ride any approved field', () => {
        const real = 'I clicked on the mic to start. It downloaded but never auto-started.';
        const { props, dropped } = projectEventProps('feedback_field', {
            field: 'description', transition: 'entered', length_band: real.length.toString(),
            submit_blockers: ['description_too_short'], submit_enabled: false,
        });
        // A raw length is not a band, so the enum refuses it — the shape rule is what stops a caller
        // sending a precise count that narrows a short field's content.
        expect(dropped).toContain('length_band');
        expect(JSON.stringify(props)).not.toContain('mic');
    });

    it('an invented blocker is rejected by the schema', () => {
        const { dropped } = projectEventProps('feedback_submit', {
            outcome: 'refused_by_gate', submit_blockers: ['title_too_short', 'made_up_reason'],
        });
        expect(dropped).toContain('submit_blockers');
    });

    it('every emitted field survives its schema', () => {
        expect(projectEventProps('feedback_field', {
            field: 'title', transition: 'unexpected_clear', length_band: '0',
            submit_blockers: ['title_too_short'], submit_enabled: false,
        }).dropped).toEqual([]);
        expect(projectEventProps('feedback_submit', {
            outcome: 'storage_ok', submit_blockers: [], acknowledgement_visible: true,
        }).dropped).toEqual([]);
    });
});

describe('#1259 — an observer that can break the product is worse than no observer', () => {
    it('every #1259 emitter survives a transport that throws', async () => {
        // This is not hypothetical: adding unguarded emits to the Report Issue dialog broke feedback
        // submission outright, and `practiceSurfaceReporting.integration.test.tsx` — which mocks the
        // transport to throw on purpose — caught it. The guard belongs in the emitters, not in each
        // call site's memory.
        const boom = vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => {
            throw new Error('analytics transport down');
        });
        const { emitJourneyStep } = await import('../journeyStep');
        const { emitRecordingIntent, emitStageLatency } = await import('../journeyEvents');
        const { emitTranscriptAuthority } = await import('../transcriptAuthority');
        const { emitCoverageEvaluation } = await import('../coverageTelemetry');
        const { emitPracticeLoop } = await import('../practiceLoopTelemetry');

        expect(() => emitJourneyStep({ step: 'cta_click', ctaId: 'x' })).not.toThrow();
        expect(() => emitRecordingIntent({
            kind: 'start', outcome: 'accepted', runtimeState: 'READY', modelReady: true,
        })).not.toThrow();
        expect(() => emitStageLatency('ready_to_intent', 10)).not.toThrow();
        expect(() => emitTranscriptAuthority({ stage: 'save', authoritative: 'a b c' })).not.toThrow();
        expect(() => emitCoverageEvaluation({
            pointsSupplied: 1, pointsEvaluated: 1, coveredThreshold: 0.7, partialThreshold: 0.34,
            transcriptWordCount: 3,
            observations: [{ position: 0, matchRatio: 1, keywordCount: 1, verdict: 'covered', latched: false }],
        })).not.toThrow();
        expect(() => emitPracticeLoop({
            suggestionsPresent: false, whatWentWellSource: 'fallback', whatToImproveSource: 'fallback',
            rendered: true, nextActionPersisted: false, suppressionReason: 'no_suggestions',
        })).not.toThrow();
        expect(() => emitFeedbackSubmit({ outcome: 'attempted' })).not.toThrow();

        expect(boom).toHaveBeenCalled();   // the transport really was throwing
        boom.mockRestore();
    });
});
