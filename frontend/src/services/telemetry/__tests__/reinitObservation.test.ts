import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    noteEngineReady, noteEngineTeardown, nextInitContext, __resetReinitObservationForTests,
} from '../reinitObservation';
import { beginJourney, __resetJourneyIdentityForTests } from '../journeyIdentity';
import { sanitizePrivateTelemetryProps } from '@/services/transcription/privateTelemetrySanitizer';

beforeEach(() => {
    __resetReinitObservationForTests();
    __resetJourneyIdentityForTests();
});
afterEach(() => vi.useRealTimers());

describe('F15 — repeated initialization, and why', () => {
    it('THE LIVE SESSION SHAPE: three inits in one journey, ordinals 1, 2, 3', () => {
        // Production shows exactly this — 134s, then 12ms, then 1ms — with nothing to tell the three
        // apart. The ordinal is what turns "three setups" into "the third setup".
        expect(nextInitContext().init_sequence).toBe(1);
        expect(nextInitContext().init_sequence).toBe(2);
        expect(nextInitContext().init_sequence).toBe(3);
    });

    it('a first load reports NO previous readiness rather than a fabricated interval', () => {
        const ctx = nextInitContext();
        expect(ctx.ms_since_previous_ready).toBeNull();
        expect(ctx.previous_teardown_cause).toBeNull();
    });

    it('separates a re-init one second after readiness from an idle reclamation', () => {
        vi.useFakeTimers();
        noteEngineReady();
        vi.advanceTimersByTime(1_000);
        expect(nextInitContext().ms_since_previous_ready).toBe(1_000);

        noteEngineReady();
        vi.advanceTimersByTime(300_000);
        // Same event, same ordinal arithmetic — only the interval distinguishes a defect from a
        // reclamation working as designed.
        expect(nextInitContext().ms_since_previous_ready).toBe(300_000);
    });

    it('carries the cause the runtime gave for the previous teardown', () => {
        noteEngineReady();
        noteEngineTeardown('TERMINATED');
        expect(nextInitContext().previous_teardown_cause).toBe('TERMINATED');
    });

    it('a stale mark yields null, not an age', () => {
        vi.useFakeTimers();
        noteEngineReady();
        vi.advanceTimersByTime(86_400_001);
        expect(nextInitContext().ms_since_previous_ready).toBeNull();
    });

    it('ordinals are PER JOURNEY — a second visit does not inherit the first visit’s count', () => {
        nextInitContext();
        nextInitContext();
        beginJourney();
        // Without the reset a second visit's first load reports as the third, which looks like a
        // defect and is not.
        expect(nextInitContext().init_sequence).toBe(1);
    });

    it('every field survives the Private allowlist — an unlisted key ships nothing', () => {
        const kept = sanitizePrivateTelemetryProps({
            init_sequence: 3, ms_since_previous_ready: 1_000, previous_teardown_cause: 'TERMINATED',
        });
        expect(kept).toEqual({
            init_sequence: 3, ms_since_previous_ready: 1_000, previous_teardown_cause: 'TERMINATED',
        });
    });
});
