/**
 * #1421 P1 `3984043475`, Option A — the recovery draft preserves the take subject, validated at BOTH the write
 * and the read boundary, and a draft that carries none stays recoverable for the user while contributing no
 * qualifying model evidence.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getSessionRecoveryDraft, saveSessionRecoveryDraft } from '../sessionRecoveryDraft';

const KEY = 'speaksharp_unsaved_session_draft';
const SUBJECT = Object.freeze({
    subject_boot_id: 'j-boot-1',
    subject_journey_id: 'j-journey-1',
    subject_attempt_id: 'j-attempt-1',
    subject_attempt_seq: 2,
});
const base = {
    sessionId: 's-1',
    userId: 'u-1',
    recoveryState: 'active_interrupted' as const,
    durationSeconds: 30,
    mode: 'unknown' as const,
    metrics: {},
};

beforeEach(() => {
    window.localStorage.clear();
});

describe('#1421 P1 Option A — the recovery draft carries the take subject', () => {
    it('POSITIVE CONTROL: a valid subject round-trips', () => {
        saveSessionRecoveryDraft({ ...base, subject: SUBJECT });
        expect(getSessionRecoveryDraft()?.subject).toEqual(SUBJECT);
    });

    it('CASUALTY (write): a malformed subject is not persisted', () => {
        saveSessionRecoveryDraft({ ...base, subject: { ...SUBJECT, subject_attempt_seq: 0 } });
        const draft = getSessionRecoveryDraft();
        expect(draft?.sessionId, 'the draft itself is still written').toBe('s-1');
        expect(draft?.subject).toBeNull();
    });

    it('CASUALTY (read): a tampered stored subject is dropped while the draft stays recoverable', () => {
        saveSessionRecoveryDraft({ ...base, subject: SUBJECT });
        const stored = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
        stored.subject = { ...SUBJECT, subject_journey_id: 'bad value!' };
        window.localStorage.setItem(KEY, JSON.stringify(stored));
        const draft = getSessionRecoveryDraft();
        expect(draft?.sessionId).toBe('s-1');
        expect(draft?.subject).toBeNull();
    });

    it('CASUALTY (legacy): a draft written without a subject is recoverable but names no take', () => {
        saveSessionRecoveryDraft({ ...base });
        const draft = getSessionRecoveryDraft();
        expect(draft?.sessionId).toBe('s-1');
        expect(draft?.subject).toBeNull();
    });
});
