/**
 * #1593 (Sam, saved-review subject) — the saved take's frozen subject is published paired with its session, a review can
 * only name the subject published for THAT review session, and the pairing is retired with the take (new objective set)
 * and with the account (`resetSession`, which `AuthProvider` runs on an account change).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { reviewSubjectFor, useSessionStore, type CompletedSessionSubject } from '@/stores/useSessionStore';

const SUBJECT_A = Object.freeze({
    subject_boot_id: 'boot-1', subject_journey_id: 'journey-1', subject_attempt_id: 'attempt-a', subject_attempt_seq: 1,
});
const PAIRED_A: CompletedSessionSubject = { sessionId: 'session-a', subject: SUBJECT_A };

describe('reviewSubjectFor — a review names only the subject published for its own session', () => {
    it('the paired subject for the reviewed session', () => {
        expect(reviewSubjectFor('session-a', PAIRED_A)).toEqual(SUBJECT_A);
    });

    it('B\'s review never takes A\'s subject; no review, or no pairing, is unknown', () => {
        expect(reviewSubjectFor('session-b', PAIRED_A)).toBeNull();
        expect(reviewSubjectFor(null, PAIRED_A)).toBeNull();
        expect(reviewSubjectFor(undefined, PAIRED_A)).toBeNull();
        expect(reviewSubjectFor('session-a', null)).toBeNull();
    });
});

describe('completedSessionSubject is retired with the take and with the account', () => {
    beforeEach(() => useSessionStore.getState().resetSession());

    it('starts unknown', () => {
        expect(useSessionStore.getState().completedSessionSubject).toBeNull();
    });

    it('an account change (whole-store reset) clears the binding', () => {
        useSessionStore.getState().setCompletedSessionSubject(PAIRED_A);
        useSessionStore.getState().resetSession();
        expect(useSessionStore.getState().completedSessionSubject).toBeNull();
    });

    it('a new objective set retires the finished take\'s binding with its session id', () => {
        const store = useSessionStore.getState();
        store.setCompletedSessionId('session-a');
        store.setCompletedSessionSubject(PAIRED_A);
        store.resetForNewObjectiveSet();
        expect({
            id: useSessionStore.getState().completedSessionId,
            subject: useSessionStore.getState().completedSessionSubject,
        }).toEqual({ id: null, subject: null });
    });
});
