/**
 * #1258 (CLI Dev producer gap 6037347459; contract 6037393538) — WHICH SAVED TAKE A COACHING EVENT BELONGS TO.
 *
 * The `practice_loop_review_*` events emit after Stop, when the envelope's `attempt_id` is already cleared, and they
 * may never carry a session id (telemetryAllowlist: no session id crosses the analytics boundary). So they name the
 * take the same way `model_attribution_receipt` does: by the frozen `subject_*` identity captured while that take
 * was recording. The controller registers the subject against the saved session id at the moment the id is
 * published; the coaching card looks it up by that id. Tab memory only — never persisted, never sent as an id.
 *
 * A session this tab did not record (reload, revisit, another tab) has no subject, and the fields are OMITTED: the
 * readback then HOLDs rather than guessing the take.
 */
import { sanitizeRecordingSubject, type RecordingSubject } from './recordingSubject';

/** A handful of recent saves is all a tab can review; the bound keeps the map from growing with a long session. */
const MAX_REMEMBERED = 20;
const subjects = new Map<string, RecordingSubject>();

export function rememberReviewSubject(sessionId: string | null | undefined, subject: unknown): void {
    const take = sanitizeRecordingSubject(subject);
    if (!sessionId || !take) return;
    subjects.delete(sessionId);
    subjects.set(sessionId, take);
    while (subjects.size > MAX_REMEMBERED) subjects.delete(subjects.keys().next().value as string);
}

export function reviewSubjectFor(sessionId: string | null | undefined): RecordingSubject | null {
    return sessionId ? subjects.get(sessionId) ?? null : null;
}

/**
 * One logical review lifecycle (the automatic first request, or one manual press) per value. Its requested event and
 * its terminal outcome carry the same number, so a readback can pair them and count distinct generations.
 */
export const REVIEW_REQUEST_SEQ_MAX = 1000;
let requestSeq = 0;
export function nextReviewRequestSeq(): number {
    requestSeq = requestSeq >= REVIEW_REQUEST_SEQ_MAX ? 1 : requestSeq + 1;
    return requestSeq;
}

export function __resetReviewSubjectsForTests(): void {
    subjects.clear();
    requestSeq = 0;
}
