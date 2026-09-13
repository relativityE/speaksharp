/**
 * #1421 P1 `3984043475`, Option A — THE TAKE'S IMMUTABLE SUBJECT IDENTITY.
 *
 * The governed envelope owns `boot_id`, `journey_id`, `attempt_id` and `attempt_seq` and stamps whatever is
 * AMBIENT at push time. A terminal attribution receipt can settle after that ambient identity has moved on —
 * a Retry Save after the attempt ended, or a reload into a new boot — so the receipt must name the take whose
 * server verdict settled by carrying a snapshot captured while that take was the open attempt. These cases pin
 * what the snapshot is, when it is absent, that it cannot drift, and that only its exact shape is accepted.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
    __resetBootIdentityForTests,
    __resetJourneyIdentityForTests,
    beginJourney,
    beginRecordingAttempt,
    currentBootId,
    endRecordingAttempt,
} from '../journeyIdentity';
import { captureRecordingSubject, sanitizeRecordingSubject } from '../recordingSubject';

beforeEach(() => {
    __resetBootIdentityForTests();
    __resetJourneyIdentityForTests();
});

describe('#1421 P1 `3984043475` Option A — the take subject snapshot', () => {
    it('POSITIVE CONTROL: captures the boot, journey, attempt and ordinal of the OPEN attempt', () => {
        const journey = beginJourney();
        const attempt = beginRecordingAttempt();
        expect(captureRecordingSubject()).toEqual({
            subject_boot_id: currentBootId(),
            subject_journey_id: journey,
            subject_attempt_id: attempt,
            subject_attempt_seq: 1,
        });
    });

    it('CASUALTY: with no open attempt there is no subject — never a fabricated identity', () => {
        beginJourney();
        expect(captureRecordingSubject()).toBeNull();
    });

    it('CASUALTY: the snapshot does not move when the ambient attempt ends, a new take begins, or the journey changes', () => {
        beginJourney();
        beginRecordingAttempt();
        const subject = captureRecordingSubject();
        expect(subject).not.toBeNull();
        const before = { ...subject };
        endRecordingAttempt();
        beginRecordingAttempt();
        beginJourney();
        expect(subject, 'the snapshot names the take it was captured for').toEqual(before);
        expect(Object.isFrozen(subject)).toBe(true);
    });

    it('CASUALTY: the sanitizer accepts only the exact governed shape — missing, malformed, extra or legacy HOLDs', () => {
        beginJourney();
        beginRecordingAttempt();
        const good = captureRecordingSubject();
        expect(good).not.toBeNull();
        expect(sanitizeRecordingSubject({ ...good })).toEqual(good);

        const missingBoot: Record<string, unknown> = { ...good };
        delete missingBoot.subject_boot_id;
        const bad: unknown[] = [
            null,
            undefined,
            'j-1-2',
            [],
            {},
            missingBoot,
            { ...good, subject_attempt_seq: 0 },
            { ...good, subject_attempt_seq: 1.5 },
            { ...good, subject_attempt_seq: '1' },
            { ...good, subject_boot_id: '' },
            { ...good, subject_journey_id: 'has spaces' },
            { ...good, subject_attempt_id: 'a'.repeat(65) },
            { ...good, smuggled: 'extra key' },
        ];
        for (const raw of bad) {
            expect(sanitizeRecordingSubject(raw), `rejects ${JSON.stringify(raw)}`).toBeNull();
        }
    });
});
