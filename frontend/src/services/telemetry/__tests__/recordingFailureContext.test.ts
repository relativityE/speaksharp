import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyRecordingFailureContext, captureRecordingFailureContext, recordingFailureContext } from '../recordingFailureContext';
import { __resetBootIdentityForTests, __resetJourneyIdentityForTests, beginJourney, beginRecordingAttempt, currentAttemptId, currentBootId, currentJourneyId } from '../journeyIdentity';

beforeEach(() => {
    __resetJourneyIdentityForTests();
    __resetBootIdentityForTests();
});

describe('recording failure correlation', () => {
    it('keeps the failed attempt after a different journey/attempt becomes current', () => {
        beginJourney();
        const failed = beginRecordingAttempt();
        const expected = { boot_id: currentBootId(), journey_id: currentJourneyId(), attempt_id: failed, attempt_seq: '1' };
        const snapshot = captureRecordingFailureContext();
        beginJourney();
        beginRecordingAttempt();
        expect(currentAttemptId()).not.toBe(failed);
        const setTag = vi.fn();
        applyRecordingFailureContext({ setTag }, snapshot);
        expect(Object.fromEntries(setTag.mock.calls)).toEqual(expected);
        expect(Object.isFrozen(snapshot)).toBe(true);
    });

    it('does not invent an attempt or ordinal before an accepted intent', () => {
        const tags = captureRecordingFailureContext();
        expect(tags.boot_id).toBe(currentBootId());
        expect(tags.journey_id).toBe(currentJourneyId());
        expect(tags).not.toHaveProperty('attempt_id');
        expect(tags).not.toHaveProperty('attempt_seq');
        expect(recordingFailureContext({})).toEqual({});
    });

    it.each(['user@example.com', 'Bearer secret', 'https://example.com/?token=secret', 'private transcript', 'a'.repeat(1000)])('rejects arbitrary correlation text: %s', value => {
        expect(recordingFailureContext({ bootId: value, journeyId: value, attemptId: value, attemptSeq: 1 })).toEqual({});
    });

    it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null])('rejects an invalid ordinal without retaining a partially bound attempt: %s', attemptSeq => {
        expect(recordingFailureContext({ attemptId: '00000000-0000-4000-8000-000000000001', attemptSeq })).toEqual({});
    });

    it('accepts generated fallback identities, without copying unrelated fields', () => {
        const input = { bootId: 'j-m1abc-abc123', journeyId: 'j-m2abc-def456', attemptId: 'j-m3abc-ghi789', attemptSeq: 2, message: 'private transcript', token: 'secret' };
        const tags = recordingFailureContext(input);
        expect(tags).toEqual({ boot_id: input.bootId, journey_id: input.journeyId, attempt_id: input.attemptId, attempt_seq: '2' });
        const setTag = vi.fn();
        applyRecordingFailureContext({ setTag }, tags);
        expect(JSON.stringify(setTag.mock.calls)).not.toMatch(/transcript|secret|message|token/);
    });

    it('leaves a pre-intent failure unattributed rather than borrowing a previous take', () => {
        beginJourney();
        beginRecordingAttempt();
        const setTag = vi.fn();
        applyRecordingFailureContext({ setTag }, null);
        expect(setTag).not.toHaveBeenCalled();
    });
});
