import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { analyticsBuffer } from '../../AnalyticsBuffer';
import { EVENT_SCHEMAS, projectEventProps, isValidForEventField } from '../../telemetryAllowlist';
import { stripEnvelopeKeys, ENVELOPE_KEYS } from '../envelope';
import {
    beginJourney, beginRecordingAttempt, endRecordingAttempt, currentAttemptId,
    __resetJourneyIdentityForTests,
} from '../journeyIdentity';
import { emitRecordingIntent, markRuntimeReady, __resetJourneyEventsForTests } from '../journeyEvents';
import { emitTranscriptAuthority, __resetTranscriptAuthorityForTests } from '../transcriptAuthority';
import { emitCoverageEvaluation, __resetCoverageTelemetryForTests } from '../coverageTelemetry';
import { emitPracticeLoop, __resetPracticeLoopTelemetryForTests } from '../practiceLoopTelemetry';
import { emitFillerMeasurement } from '../fillerMeasurement';
import { emitRetentionObservation } from '../retentionObservation';
import { emitJourneyStep } from '../journeyStep';
import { emitFeedbackFieldState, __resetFeedbackTelemetryForTests } from '../feedbackTelemetry';
import { nextInitContext, noteEngineReady, __resetReinitObservationForTests } from '../reinitObservation';
import posthog from 'posthog-js';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn() }));

const calls = () => (posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls;
const rows = (name: string) => calls().filter((c) => c[0] === name).map((c) => c[1] as Record<string, unknown>);
const drain = () => analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');

/** The real content from the PO's session. If any of this can travel, the contract has failed. */
const REAL_TRANSCRIPT =
    'so basically um I wanted to talk about the quarterly numbers and uh how the cache works';
const REAL_FEEDBACK =
    'I clicked on the mic to start. It downloaded but never auto-started. This was unexpected.';

beforeEach(() => {
    vi.clearAllMocks();
    __resetJourneyIdentityForTests();
    __resetJourneyEventsForTests();
    __resetTranscriptAuthorityForTests();
    __resetCoverageTelemetryForTests();
    __resetPracticeLoopTelemetryForTests();
    __resetFeedbackTelemetryForTests();
    __resetReinitObservationForTests();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    beginJourney();
});
afterEach(() => vi.useRealTimers());

describe('NEGATIVE CONTROL — MISSING: absence is reported as absence, never as a measurement', () => {
    it('an unmeasured value is null, and null is never coerced to a flattering zero', () => {
        emitTranscriptAuthority({ stage: 'save', authoritative: REAL_TRANSCRIPT });
        emitRetentionObservation({
            transcriptBearingBefore: 2, transcriptBearingAfter: null,
            contentFreeHistoryCount: 5, savedTranscriptState: null,
        });
        emitRecordingIntent({ kind: 'start', outcome: 'accepted', runtimeState: 'IDLE', modelReady: false });
        drain();

        // Each of these could have defaulted to 0/false and read as a real observation.
        expect(rows('transcript_authority')[0].rendered_word_count).toBeNull();
        expect(rows('transcript_authority')[0].digests_match).toBeNull();
        expect(rows('retention_observation')[0].expired_count).toBeNull();
        expect(rows('recording_intent')[0].ms_since_ready).toBeNull();
    });

    it('a producer that emits nothing leaves NO row — not an empty one', () => {
        emitCoverageEvaluation({
            pointsSupplied: 0, pointsEvaluated: 0, coveredThreshold: 0.7,
            partialThreshold: 0.34, transcriptWordCount: 0, observations: [],
        });
        drain();
        // A zero-point "evaluation" would appear in aggregates as a session that scored nothing.
        expect(rows('coverage_evaluation')).toHaveLength(0);
    });
});

describe('NEGATIVE CONTROL — CONTRADICTORY: both sides are recorded, neither is reconciled away', () => {
    it('a saved word count beside an empty screen survives as a contradiction', () => {
        emitTranscriptAuthority({
            stage: 'review_rendered', authoritative: REAL_TRANSCRIPT, rendered: '', persisted: true,
        });
        drain();
        const r = rows('transcript_authority')[0];
        expect(r.authoritative_word_count).toBeGreaterThan(0);
        expect(r.rendered_word_count).toBe(0);
        expect(r.digests_match).toBe(false);
        // Nothing "corrects" the pair into agreement — the disagreement IS the finding.
        expect(r.persisted).toBe(true);
    });

    it('a filler count the transcript cannot evidence is marked unobservable, not clean', () => {
        emitFillerMeasurement({
            candidateId: 'v2:base.en', detectorInputWords: 88, detectorInputFillers: 0,
            reportedFillers: 0, clarityScore: 90, durationSeconds: 90,
        });
        drain();
        expect(rows('filler_measurement')[0].completeness).toBe('unobservable');
    });

    it('a practice loop that rendered fallback copy is not reported as generated', () => {
        emitPracticeLoop({
            suggestionsPresent: false, whatWentWellSource: 'fallback', whatToImproveSource: 'fallback',
            rendered: true, nextActionPersisted: false, suppressionReason: 'no_suggestions',
        });
        drain();
        const r = rows('practice_loop')[0];
        expect(r.rendered).toBe(true);
        expect(r.what_went_well_source).toBe('fallback');
    });
});

describe('NEGATIVE CONTROL — STALE: an old mark yields null, never an age', () => {
    it('a readiness mark beyond the bound is refused', () => {
        vi.useFakeTimers();
        markRuntimeReady();
        vi.advanceTimersByTime(86_400_001);
        emitRecordingIntent({ kind: 'start', outcome: 'accepted', runtimeState: 'READY', modelReady: true });
        drain();
        expect(rows('recording_intent')[0].ms_since_ready).toBeNull();
    });

    it('a stale engine-readiness mark does not date the next initialization', () => {
        vi.useFakeTimers();
        noteEngineReady();
        vi.advanceTimersByTime(86_400_001);
        expect(nextInitContext().ms_since_previous_ready).toBeNull();
    });
});

describe('NEGATIVE CONTROL — DUPLICATED: a repeat is suppressed, a change never is', () => {
    it('identical observations collapse to one row', () => {
        for (let i = 0; i < 4; i += 1) {
            emitTranscriptAuthority({ stage: 'review_rendered', authoritative: 'a b c', rendered: 'a b c' });
            emitPracticeLoop({
                suggestionsPresent: true, whatWentWellSource: 'generated', whatToImproveSource: 'generated',
                rendered: true, nextActionPersisted: true, suppressionReason: 'none',
            });
            emitFeedbackFieldState({
                field: 'title', transition: 'entered', lengthBand: '10-39',
                blockers: [], submitEnabled: true,
            });
        }
        drain();
        expect(rows('transcript_authority')).toHaveLength(1);
        expect(rows('practice_loop')).toHaveLength(1);
        expect(rows('feedback_field')).toHaveLength(1);
    });

    it('suppression NEVER hides a change — the transcript vanishing must always emit', () => {
        emitTranscriptAuthority({ stage: 'review_rendered', authoritative: 'a b c', rendered: 'a b c' });
        emitTranscriptAuthority({ stage: 'review_rendered', authoritative: 'a b c', rendered: '' });
        drain();
        expect(rows('transcript_authority')).toHaveLength(2);
        expect(rows('transcript_authority')[1].transcript_visibly_present).toBe(false);
    });
});

describe('NEGATIVE CONTROL — OUT OF ORDER: an event keeps the state it was PRODUCED in', () => {
    it('a queued save is filed under the take it belonged to, not the take that follows', () => {
        const first = beginRecordingAttempt();
        analyticsBuffer.ready = false;
        emitTranscriptAuthority({ stage: 'save', authoritative: REAL_TRANSCRIPT, persisted: true });

        endRecordingAttempt();
        const second = beginRecordingAttempt();
        expect(second).not.toBe(first);
        expect(currentAttemptId()).toBe(second);

        analyticsBuffer.ready = true;
        drain();
        // Rebuilding the envelope at send would file take 1's save under take 2, and nothing about the
        // event would look wrong afterwards.
        expect(rows('transcript_authority')[0].attempt_id).toBe(first);
    });

    it('a journey boundary resets attempt ordinals and init sequence together', () => {
        beginRecordingAttempt();
        nextInitContext();
        nextInitContext();
        beginJourney();
        // A second visit inheriting the first visit's counters looks like a defect and is not.
        expect(currentAttemptId()).toBeNull();
        expect(nextInitContext().init_sequence).toBe(1);
    });
});

describe('NEGATIVE CONTROL — CONTENT: real session material cannot reach the wire', () => {
    it('no #1259 producer carries transcript, feedback, point or topic text', () => {
        emitTranscriptAuthority({ stage: 'finalize', authoritative: REAL_TRANSCRIPT, rendered: REAL_TRANSCRIPT });
        emitCoverageEvaluation({
            pointsSupplied: 1, pointsEvaluated: 1, coveredThreshold: 0.7, partialThreshold: 0.34,
            transcriptWordCount: 16,
            observations: [{ position: 0, matchRatio: 0.9, keywordCount: 3, verdict: 'covered', latched: false }],
        });
        emitFillerMeasurement({
            candidateId: 'v2:base.en', detectorInputWords: 16, detectorInputFillers: 2,
            reportedFillers: 2, clarityScore: 80, durationSeconds: 30,
        });
        emitFeedbackFieldState({
            field: 'description', transition: 'entered', lengthBand: '40-199',
            blockers: [], submitEnabled: true,
        });
        emitJourneyStep({ step: 'route_change', fromRoute: '/practice', toRoute: '/analytics/9f2c4b1e8a7d' });
        drain();

        const everything = JSON.stringify(calls().map(([, props]) => stripEnvelopeKeys(props as Record<string, unknown>)));
        for (const fragment of [
            'basically', 'quarterly', 'numbers', 'cache', 'um', 'uh',
            'clicked', 'downloaded', 'auto-started', 'unexpected', '9f2c4b1e',
        ]) {
            expect(everything.includes(`"${fragment}"`), `"${fragment}" reached the wire`).toBe(false);
        }
        expect(everything).not.toContain(REAL_TRANSCRIPT.slice(0, 20));
        expect(everything).not.toContain(REAL_FEEDBACK.slice(0, 20));
    });

    it('EVERY governed event refuses prose in EVERY declared string field', () => {
        // A blanket sweep rather than a per-event list: a field added later without a shape rule would
        // otherwise ship whatever a producer passed, and no existing test would notice.
        // SHORT prose matters here. The long samples are rejected by the length bound on `slug`, so a
        // sweep using only those passes even with the pattern widened to accept anything — it proves
        // the cap, not the shape. `SHORT_PROSE` fits well inside every bound, so only the pattern can
        // reject it.
        const SHORT_PROSE = 'um so the cache';
        // A route-shaped probe too: `route` fields accept a leading slash by design, so a prose probe
        // never exercises them and a widened route rule — one that let query strings through — passed
        // this sweep unnoticed. Query strings are where identifiers and typed content live.
        const ROUTE_WITH_QUERY = '/practice?goal=my+private+topic';
        for (const [event, schema] of Object.entries(EVENT_SCHEMAS)) {
            for (const field of Object.keys(schema)) {
                for (const probe of [REAL_TRANSCRIPT, REAL_FEEDBACK, SHORT_PROSE, ROUTE_WITH_QUERY]) {
                    expect(
                        isValidForEventField(event, field, probe),
                        `${event}.${field} accepted prose: "${probe.slice(0, 20)}…"`,
                    ).toBe(false);
                }
            }
        }
    });

    it('a producer cannot forge the envelope, including the correlation identity', () => {
        const forged = Object.fromEntries(ENVELOPE_KEYS.map((k) => [k, 'forged']));
        expect(stripEnvelopeKeys({ ...forged, stage: 'save' })).toEqual({ stage: 'save' });
    });

    it('an UNGOVERNED event ships no properties at all', () => {
        const { props, dropped } = projectEventProps('not_a_real_event', { anything: REAL_TRANSCRIPT });
        expect(props).toEqual({});
        expect(dropped).toEqual(['anything']);
    });
});
