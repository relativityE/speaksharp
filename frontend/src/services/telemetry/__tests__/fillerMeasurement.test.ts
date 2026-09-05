import { vi, describe, it, expect, beforeEach } from 'vitest';
import { analyticsBuffer } from '../../AnalyticsBuffer';
import { emitFillerMeasurement, resolveCompleteness } from '../fillerMeasurement';
import { projectEventProps } from '../../telemetryAllowlist';
import { beginJourney, __resetJourneyIdentityForTests } from '../journeyIdentity';
import posthog from 'posthog-js';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn() }));

const rows = () => (posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .filter((c) => c[0] === 'filler_measurement').map((c) => c[1] as Record<string, unknown>);
const drain = () => analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');

beforeEach(() => {
    vi.clearAllMocks();
    __resetJourneyIdentityForTests();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    beginJourney();
});

describe('F13 — a zero that cannot be verified is not a zero', () => {
    it("THE LIVE SESSION: 88 words, zero fillers, reported as UNOBSERVABLE not clean", () => {
        // These are the PO's real numbers. The counter was not broken — it counted what it was given,
        // and what it was given had no fillers in it.
        emitFillerMeasurement({
            candidateId: 'v2:base.en', detectorInputWords: 88, detectorInputFillers: 0,
            reportedFillers: 0, clarityScore: 90, durationSeconds: 90,
        });
        drain();
        const r = rows()[0];
        expect(r.completeness).toBe('unobservable');
        expect(r.unavailable_reason).toBe('no_filler_tokens_in_transcript');
        // The reported zero is still carried — it is what the user was shown, and the point is that it
        // now travels WITH the fact that it could not be verified.
        expect(r.reported_fillers).toBe(0);
        expect(r.detector_input_words).toBe(88);
    });

    it('a transcript that DOES contain fillers yields a complete measurement', () => {
        emitFillerMeasurement({
            candidateId: 'v2:base.en', detectorInputWords: 88, detectorInputFillers: 7,
            reportedFillers: 7, clarityScore: 71, durationSeconds: 90,
        });
        drain();
        expect(rows()[0].completeness).toBe('complete');
        expect(rows()[0].unavailable_reason).toBeNull();
    });

    it('silence is its own answer, not an unobservable measurement', () => {
        emitFillerMeasurement({
            candidateId: 'v2:base.en', detectorInputWords: 0, detectorInputFillers: 0,
            reportedFillers: 0, clarityScore: null, durationSeconds: 5,
        });
        drain();
        expect(rows()[0].completeness).toBe('no_speech');
        expect(rows()[0].unavailable_reason).toBe('no_transcribed_speech');
    });

    it('THE TRAP: agreement between two counters over the same transcript is not evidence', () => {
        // `measureFillerDivergence` compares a LIVE count and a RECOUNT — both computed from the same
        // text. On a stripped transcript both are 0, they agree perfectly, and `match: true` reads as
        // confirmation. Completeness is deliberately NOT derived from that agreement.
        expect(resolveCompleteness(88, 0)).toBe('unobservable');
        // ...and it stays unobservable however emphatically the counters agree, because the question is
        // whether the transcript could evidence a filler at all.
        expect(resolveCompleteness(1, 0)).toBe('unobservable');
        expect(resolveCompleteness(0, 0)).toBe('no_speech');
        expect(resolveCompleteness(88, 1)).toBe('complete');
    });

    it('carries no transcript text and no filler words', () => {
        emitFillerMeasurement({
            candidateId: 'v2:base.en', detectorInputWords: 88, detectorInputFillers: 0,
            reportedFillers: 0, clarityScore: 90, durationSeconds: 90,
        });
        drain();
        const serialized = JSON.stringify(rows()[0]);
        for (const word of ['um', 'uh', 'basically', 'transcript']) {
            expect(serialized.includes(`"${word}"`)).toBe(false);
        }
    });

    it('every field survives the schema', () => {
        const { props, dropped } = projectEventProps('filler_measurement', {
            candidate_id_observed: 'v2:base.en', detector_input_words: 88, detector_input_fillers: 0,
            reported_fillers: 0, clarity_score: 90, duration_seconds: 90,
            completeness: 'unobservable', unavailable_reason: 'no_filler_tokens_in_transcript',
        });
        expect(dropped).toEqual([]);
        expect(Object.keys(props)).toHaveLength(8);
    });
});
