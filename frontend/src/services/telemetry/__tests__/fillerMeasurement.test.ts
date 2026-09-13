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
            // #1421: producers must state it; the stop path is the only real one and it is `pending`.
            attributionState: 'pending',
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
            // #1421: producers must state it; the stop path is the only real one and it is `pending`.
            attributionState: 'pending',
        });
        drain();
        expect(rows()[0].completeness).toBe('complete');
        expect(rows()[0].unavailable_reason).toBeNull();
    });

    it('silence is its own answer, not an unobservable measurement', () => {
        emitFillerMeasurement({
            candidateId: 'v2:base.en', detectorInputWords: 0, detectorInputFillers: 0,
            reportedFillers: 0, clarityScore: null, durationSeconds: 5,
            // #1421: producers must state it; the stop path is the only real one and it is `pending`.
            attributionState: 'pending',
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
            // #1421: producers must state it; the stop path is the only real one and it is `pending`.
            attributionState: 'pending',
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

/**
 * #1421 P1 — A FILLER ROW IS NOT EVIDENCE OF CANDIDATE ATTRIBUTION.
 *
 * The measurement is produced inside `stopRecording()` at the point the save-selected transcript is
 * known — BEFORE the first `completeSession()` and long before `attestSessionEngine()`. It therefore
 * carries the candidate the engine had resolved, not one any persistence confirmed. A take whose
 * completion or attribution later failed had already published a row naming that candidate, and
 * nothing downstream could distinguish it from a confirmed one.
 *
 * These assert at the FINAL CONSUMER — the payload `posthog.capture` receives, after the real
 * `projectEventProps` governed projection — because the defect is about what a reader of the wire can
 * conclude, and a call-site assertion would prove nothing about what survives the boundary.
 */
describe('#1421 attribution_state travels to the wire and is bounded', () => {
    const measurement = (attributionState: 'pending' | 'verified') => {
        emitFillerMeasurement({
            candidateId: 'moonshine:streaming-medium', detectorInputWords: 40,
            detectorInputFillers: 3, reportedFillers: 3, clarityScore: null,
            durationSeconds: 12, attributionState,
        });
        drain();
    };

    it('CASUALTY: the stop path\'s measurement reaches the wire as PENDING, never verified', () => {
        /**
         * `pending` is the only value the stop path produces, and it is a REQUIRED field, so a producer
         * cannot omit its way into `verified`. What this pins is that the distinction survives the
         * governed projection rather than being dropped as an unknown property — the exact failure that
         * put `expected_candidate_id` on no wire at all on this same lane.
         */
        measurement('pending');

        const row = rows()[0];
        expect(row, 'the governed projection kept the field').toHaveProperty('attribution_state');
        // Failed persistence or attestation cannot retroactively qualify this row, because the row
        // never claimed to be qualified in the first place.
        expect(row.attribution_state, 'the stop path publishes pending').toBe('pending');
        // The measurement itself is still real: the guard is about attribution, not about the numbers.
        expect(row.detector_input_fillers).toBe(3);
        expect(row.candidate_id_observed).toBe('moonshine:streaming-medium');
    });

    it('POSITIVE CONTROL: verified is representable, so pending is a real distinction', () => {
        // Without this the first case would pass against a field hardcoded to one value, which would
        // prove the projection kept a constant rather than kept a discriminator.
        measurement('verified');

        expect(rows()[0].attribution_state).toBe('verified');
    });

    it('CASUALTY: an out-of-vocabulary attribution state never reaches the wire', () => {
        /**
         * The vocabulary is closed at the allowlist, so `verified` cannot be smuggled in under another
         * spelling and a future producer cannot invent a third state that reads as confirmation.
         *
         * Asserted through the REAL emit and the REAL send boundary, not by calling the projector
         * directly — an earlier version of this case did that and passed vacuously, because the
         * direct call dropped the field for a valid value too. Opening the allowlist rule from
         * `enumOf` to a free slug now fails this case, which is what makes it evidence.
         */
        emitFillerMeasurement({
            candidateId: 'v2:base.en', detectorInputWords: 10, detectorInputFillers: 1,
            reportedFillers: 1, clarityScore: null, durationSeconds: 5,
            attributionState: 'attested_by_caller' as unknown as 'pending',
        });
        drain();

        const row = rows()[0];
        expect(row, 'the event itself still reached the consumer').toBeDefined();
        expect(row.attribution_state,
            'an unrecognised state is dropped, not forwarded as if it meant something')
            .toBeUndefined();
    });
});
