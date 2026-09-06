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

describe('F09 — which condition kept Send grey, on the form that ships', () => {
    it('names EVERY unmet condition, not just the first', () => {
        // The button is a single boolean, so the user learns nothing from it. A list is the only shape
        // that answers "no matter what I type, it stays grey".
        expect(submitBlockers({ type: null, bodyLength: 0, isSubmitting: false }))
            .toEqual(['type_missing', 'body_empty']);
    });

    it('a nearly-complete form reports only what is still missing', () => {
        expect(submitBlockers({ type: 'broke', bodyLength: 0, isSubmitting: false }))
            .toEqual(['body_empty']);
        expect(submitBlockers({ type: null, bodyLength: 12, isSubmitting: false }))
            .toEqual(['type_missing']);
    });

    it('the boundary matches the gate — ONE character is enough, and zero is not', () => {
        // The shipped gate is `body.trim().length > 0`. The old 4-and-10 thresholds belonged to a title
        // and description that no longer exist, so asserting them proved a screen nobody sees.
        expect(submitBlockers({ type: 'broke', bodyLength: 0, isSubmitting: false })).toEqual(['body_empty']);
        expect(submitBlockers({ type: 'broke', bodyLength: 1, isSubmitting: false })).toEqual([]);
    });

    it('an in-flight submit is a blocker in its own right', () => {
        expect(submitBlockers({ type: 'broke', bodyLength: 20, isSubmitting: true }))
            .toEqual(['already_submitting']);
    });

    it('a refused submit is recorded WITH its reason — silence is what we had before', () => {
        emitFeedbackSubmit({ outcome: 'refused_by_gate', blockers: ['body_empty'] });
        drain();
        expect(rows('feedback_submit')[0]).toMatchObject({
            outcome: 'refused_by_gate', submit_blockers: ['body_empty'],
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
            field: 'body', transition: 'entered', lengthBand: lengthBand(12),
            blockers: [], submitEnabled: true, feedbackType: 'broke',
        });
        emitFeedbackFieldState({
            field: 'body', transition: 'unexpected_clear', lengthBand: lengthBand(0),
            blockers: ['body_empty'], submitEnabled: false, feedbackType: 'broke',
        });
        drain();
        expect(rows('feedback_field').map((r) => r.transition)).toEqual(['entered', 'unexpected_clear']);
    });

    it('typing is not an event — only a CHANGE of state is', () => {
        for (let i = 0; i < 5; i += 1) {
            emitFeedbackFieldState({
                field: 'body', transition: 'entered', lengthBand: lengthBand(50),
                blockers: [], submitEnabled: true, feedbackType: 'idea',
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
            field: 'body', transition: 'entered', length_band: real.length.toString(),
            submit_blockers: ['body_empty'], submit_enabled: false, feedback_type: 'broke',
        });
        // A raw length is not a band, so the enum refuses it — the shape rule is what stops a caller
        // sending a precise count that narrows a short field's content.
        expect(dropped).toContain('length_band');
        expect(JSON.stringify(props)).not.toContain('mic');
    });

    it('an invented blocker is rejected by the schema', () => {
        const { dropped } = projectEventProps('feedback_submit', {
            outcome: 'refused_by_gate', submit_blockers: ['body_empty', 'made_up_reason'],
        });
        expect(dropped).toContain('submit_blockers');
    });

    it('every emitted field survives its schema', () => {
        expect(projectEventProps('feedback_field', {
            field: 'body', transition: 'unexpected_clear', length_band: '0',
            submit_blockers: ['body_empty'], submit_enabled: false, feedback_type: 'broke',
        }).dropped).toEqual([]);
        // 'none' is the not-yet-chosen sentinel, and it has to survive the schema like any other member.
        expect(projectEventProps('feedback_field', {
            field: 'type', transition: 'cleared', length_band: '0',
            submit_blockers: ['type_missing', 'body_empty'], submit_enabled: false, feedback_type: 'none',
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

describe('#1259 item 5 — the instrument matches the form that shipped', () => {
    it('no part of the retired form survives in the contract', () => {
        // The module described `kind`/`title`/`description` and blocked on `title_too_short`. #1416
        // replaced that form with one question, four answers and a message box. An instrument aimed at a
        // screen nobody sees reports nothing, and feedback is the only channel that would tell us the
        // product is failing - so the retired vocabulary must not come back by copy-paste.
        const retired = ['title_too_short', 'description_too_short', 'kind_missing'];
        for (const name of retired) {
            const { dropped } = projectEventProps('feedback_submit', {
                outcome: 'refused_by_gate', submit_blockers: [name],
            });
            expect(dropped, `${name} must no longer be an accepted blocker`).toContain('submit_blockers');
        }
        for (const field of ['title', 'description', 'kind', 'category', 'impact']) {
            const { dropped } = projectEventProps('feedback_field', {
                field, transition: 'entered', length_band: '0',
                submit_blockers: [], submit_enabled: false, feedback_type: 'none',
            });
            expect(dropped, `${field} must no longer be an accepted field`).toContain('field');
        }
    });

    it('every answer the dialog offers is reportable', () => {
        // If a type the user can pick is not in the schema, that type's feedback is silently unattributed.
        for (const t of ['broke', 'confused', 'idea', 'praise']) {
            const { dropped } = projectEventProps('feedback_field', {
                field: 'type', transition: 'entered', length_band: '0',
                submit_blockers: ['body_empty'], submit_enabled: false, feedback_type: t,
            });
            expect(dropped, `${t} must be reportable`).toEqual([]);
        }
    });
});
