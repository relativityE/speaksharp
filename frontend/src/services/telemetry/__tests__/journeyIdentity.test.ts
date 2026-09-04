import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
    currentJourneyId, beginJourney, currentAttemptId, currentAttemptSeq,
    beginRecordingAttempt, endRecordingAttempt, __resetJourneyIdentityForTests,
} from '../journeyIdentity';
import { buildEnvelope, ENVELOPE_KEYS, stripEnvelopeKeys } from '../envelope';
import { analyticsBuffer } from '../../AnalyticsBuffer';
import posthog from 'posthog-js';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn() }));

const lastPayload = (): Record<string, unknown> => {
    const calls = (posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    return calls[calls.length - 1][1] as Record<string, unknown>;
};

beforeEach(() => {
    vi.clearAllMocks();
    __resetJourneyIdentityForTests();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
});

describe('journey identity — scopes', () => {
    it('mints a journey lazily and keeps it stable across reads', () => {
        const a = currentJourneyId();
        expect(a).toBeTruthy();
        expect(currentJourneyId()).toBe(a);
    });

    it('beginJourney starts a NEW journey and clears any open attempt', () => {
        const first = currentJourneyId();
        beginRecordingAttempt();
        expect(currentAttemptId()).not.toBeNull();

        const second = beginJourney();
        expect(second).not.toBe(first);
        // An attempt belongs to the journey it started in. Carrying it across would join a take to a
        // visit it did not happen in — the exact false join this identity exists to prevent.
        expect(currentAttemptId()).toBeNull();
        expect(currentAttemptSeq()).toBe(0);
    });

    it('reports no open attempt as null rather than inventing one', () => {
        expect(currentAttemptId()).toBeNull();
        expect(currentAttemptSeq()).toBe(0);
        beginRecordingAttempt();
        endRecordingAttempt();
        expect(currentAttemptId()).toBeNull();
    });

    it('F01 — a second take is distinguishable from the first by ordinal AND identity', () => {
        beginJourney();
        const first = beginRecordingAttempt();
        expect(currentAttemptSeq()).toBe(1);
        endRecordingAttempt();

        const second = beginRecordingAttempt();
        expect(currentAttemptSeq()).toBe(2);
        // Both facts are needed: the ordinal survives even if the first attempt's events were lost,
        // and distinct ids keep two takes from collapsing into one when both did arrive.
        expect(second).not.toBe(first);
    });

    it('an attempt always belongs to a journey, even when none was read first', () => {
        __resetJourneyIdentityForTests();
        beginRecordingAttempt();
        expect(currentJourneyId()).toBeTruthy();
    });
});

describe('journey identity — at the capture boundary', () => {
    it('the envelope owns the correlation keys, so a producer cannot forge them', () => {
        for (const k of ['journey_id', 'attempt_id', 'attempt_seq']) {
            expect(ENVELOPE_KEYS).toContain(k);
        }
        const stripped = stripEnvelopeKeys({
            journey_id: 'forged', attempt_id: 'forged', attempt_seq: 99, mode: 'private',
        });
        expect(stripped).toEqual({ mode: 'private' });
    });

    it('every captured event carries the journey, and the open attempt when there is one', () => {
        beginJourney();
        analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');
        expect(lastPayload().journey_id).toBe(currentJourneyId());
        expect(lastPayload().attempt_id).toBeNull();
        expect(lastPayload().attempt_seq).toBe(0);

        const attempt = beginRecordingAttempt();
        analyticsBuffer.push('session_saved', { mode: 'private' }, 'CRITICAL');
        expect(lastPayload().attempt_id).toBe(attempt);
        expect(lastPayload().attempt_seq).toBe(1);
    });

    it('NEGATIVE CONTROL — a queued event keeps the attempt it was PUSHED in, not the one live at send', () => {
        beginJourney();
        const first = beginRecordingAttempt();

        // Queue it while attempt 1 is open, without draining.
        analyticsBuffer.ready = false;
        analyticsBuffer.push('session_saved', { mode: 'private' });

        // The user starts a second take before the queue drains.
        endRecordingAttempt();
        const second = beginRecordingAttempt();
        expect(second).not.toBe(first);

        analyticsBuffer.ready = true;
        analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL'); // drains the queue first

        const events = (posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls;
        const saved = events.find((c) => c[0] === 'session_saved')?.[1] as Record<string, unknown>;
        // Rebuilding the envelope at send would file take 1's save under take 2 — and nothing about the
        // event would look wrong afterwards. This is the same drift `candidate_id` was already snapshot
        // against, and it is why the identity is read at push.
        expect(saved.attempt_id).toBe(first);
        expect(saved.attempt_seq).toBe(1);
    });

    it('a v4 side-channel event now carries the identity too', () => {
        beginJourney();
        analyticsBuffer.push('private_stt_v4_ready', { variant: 'base_q4' }, 'CRITICAL');
        expect(lastPayload().journey_id).toBe(currentJourneyId());
        expect(lastPayload().variant).toBe('base_q4');
    });

    it('buildEnvelope reports the identity with no sources configured at all', () => {
        beginJourney();
        const env = buildEnvelope();
        expect(env.journey_id).toBe(currentJourneyId());
        expect(env.attempt_id).toBeNull();
    });
});
