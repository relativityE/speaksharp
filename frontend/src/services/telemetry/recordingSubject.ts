/**
 * #1421 P1 `3984043475`, Option A — THE TAKE'S IMMUTABLE SUBJECT IDENTITY.
 *
 * The governed envelope owns `boot_id`, `journey_id`, `attempt_id` and `attempt_seq` and stamps whatever is
 * AMBIENT when an event is pushed. That is right for every ordinary event, and it must stay that way: a producer
 * that could supply those keys could claim a journey it does not belong to.
 *
 * A terminal attribution receipt is different. The server verdict can settle after the ambient identity has
 * moved on — a Retry Save after the attempt ended, or a reload into a new boot — and a receipt stamped with that
 * later ambient identity would describe the wrong take. So the receipt names its SUBJECT in separate governed
 * fields, captured here while that take was the open attempt, frozen, and never re-derived.
 *
 * The values are the same opaque tab-local correlation ids the envelope already carries: no session id, no
 * account id, no content.
 */
import { currentAttemptId, currentAttemptSeq, currentBootId, currentJourneyId } from './journeyIdentity';

export type RecordingSubject = Readonly<{
    subject_boot_id: string;
    subject_journey_id: string;
    subject_attempt_id: string;
    subject_attempt_seq: number;
}>;

/** The governed slug shape (`telemetryAllowlist` SLUG), bounded to the 64-character slug maximum. */
const SUBJECT_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const SUBJECT_KEYS = ['subject_boot_id', 'subject_journey_id', 'subject_attempt_id', 'subject_attempt_seq'] as const;

/**
 * The exact shape or nothing. Missing, extra, mistyped or malformed values are not repaired — an identity that
 * cannot be stated plainly cannot bind a verdict to a take, so it is absent.
 */
export function sanitizeRecordingSubject(raw: unknown): RecordingSubject | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length !== SUBJECT_KEYS.length || !SUBJECT_KEYS.every((key) => keys.includes(key))) return null;
    const { subject_boot_id, subject_journey_id, subject_attempt_id, subject_attempt_seq } = record;
    for (const id of [subject_boot_id, subject_journey_id, subject_attempt_id]) {
        if (typeof id !== 'string' || !SUBJECT_ID.test(id)) return null;
    }
    if (typeof subject_attempt_seq !== 'number' || !Number.isInteger(subject_attempt_seq) || subject_attempt_seq < 1) {
        return null;
    }
    return Object.freeze({
        subject_boot_id: subject_boot_id as string,
        subject_journey_id: subject_journey_id as string,
        subject_attempt_id: subject_attempt_id as string,
        subject_attempt_seq,
    });
}

/**
 * Snapshot the OPEN attempt. With no open attempt there is no take to name, so there is no subject — never a
 * fabricated one.
 */
export function captureRecordingSubject(): RecordingSubject | null {
    const attemptId = currentAttemptId();
    if (attemptId === null) return null;
    return sanitizeRecordingSubject({
        subject_boot_id: currentBootId(),
        subject_journey_id: currentJourneyId(),
        subject_attempt_id: attemptId,
        subject_attempt_seq: currentAttemptSeq(),
    });
}
