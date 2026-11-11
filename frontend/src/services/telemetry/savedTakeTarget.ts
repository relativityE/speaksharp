/**
 * AHT-01 (PO decision, 2026-11-10, Option 1) — WHICH TAKE'S REVIEW IS ON SCREEN.
 *
 * A's review is retained until B actually records (#1422), so A's late coaching may legitimately appear on it while B's
 * accepted Start is still preparing. The ambient attempt has already moved to B by then, so it cannot say whose review
 * showed the coaching. The take that SAVED a session can: the controller publishes each saved session together with that
 * take's frozen recording subject (#1421 Option A), and the review card looks its session up here when it is seen.
 *
 * Tab-local and content-free: the session id is only the lookup key and never leaves this module; what a reader gets back
 * is the opaque attempt id the governed envelope already carries. No subject, no entry — the target is then absent (the
 * readback HOLDs), never inferred from the ambient attempt or the request's origin.
 */
import type { RecordingSubject } from './recordingSubject';

const MAX_TAKES = 16;
const takeBySession = new Map<string, string>();

/** Record the take that saved `sessionId`. A later save of the same session (a recovered save) names the same take. */
export function noteSavedTake(sessionId: string | null | undefined, subject: RecordingSubject | null | undefined): void {
    if (!sessionId || !subject?.subject_attempt_id) return;
    takeBySession.delete(sessionId);
    takeBySession.set(sessionId, subject.subject_attempt_id);
    while (takeBySession.size > MAX_TAKES) {
        const oldest = takeBySession.keys().next().value;
        if (oldest === undefined) break;
        takeBySession.delete(oldest);
    }
}

/** The opaque attempt id of the take that saved `sessionId` in this tab, or null when this tab did not save it. */
export function savedTakeAttempt(sessionId: string | null | undefined): string | null {
    return sessionId ? takeBySession.get(sessionId) ?? null : null;
}

/** Test seam only. */
export function __resetSavedTakesForTests(): void {
    takeBySession.clear();
}
