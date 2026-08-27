/**
 * #1045 — durable, owner-scoped queue of sessions whose Progress evaluation could not be recorded at save
 * time (a transient RPC failure, or a tab closed mid-request). Persisted in localStorage so a closed tab or
 * a longer outage does not permanently drop the immutable record: the entries are drained on the next
 * authenticated load (see `reconcileProgressEvaluations`).
 *
 * The RPC is idempotent per `(session, formula_version)`, so re-recording a session already recorded is a
 * harmless no-op — the queue never risks a duplicate.
 *
 * #1354 — EVERY OPERATION REPORTS A VERIFIED RESULT.
 *
 * The previous version returned `void` from all three operations and swallowed storage failures, so a
 * caller holding a `userId` could not tell a durable enqueue from a silently dropped one. That is what
 * made `queued` unsafe to report: it promised a retry that might never have been recorded. Worse,
 * `readAll` returned `[]` for BOTH "no storage" and "corrupt contents", so an unreadable queue was
 * indistinguishable from an empty one — the same silent-empty class that hid two earlier defects.
 *
 * Now: writes are confirmed by READBACK, reads distinguish unavailable/corrupt from empty, and any
 * failure is reported so the caller can fail closed and keep the recorder blocked.
 */
import logger from '@/lib/logger';

/**
 * #1354: the SINGLE definition of the durable queue's storage key. It was previously declared here
 * AND again in `progressStartGate.ts`; two production authorities for one key can drift, and a
 * cross-tab listener filtering on a key the writer no longer uses would silently stop firing.
 */
export const PROGRESS_QUEUE_STORAGE_KEY = 'ss_progress_reconcile_queue_v1';
const KEY = PROGRESS_QUEUE_STORAGE_KEY;

interface QueueEntry {
    sessionId: string;
    userId: string;
    /** ms epoch as a string is avoided — kept as a plain field only for observability, never for ordering. */
    enqueuedAtIso: string;
}

export type QueueFailure =
    | 'storage_unavailable'
    | 'corrupt'
    | 'write_failed'
    | 'readback_failed';

export type QueueReadResult =
    | { ok: true; entries: QueueEntry[] }
    | { ok: false; failure: QueueFailure };

export type QueueWriteResult =
    | { ok: true; verified: true }
    | { ok: false; failure: QueueFailure };

/**
 * Read the queue, distinguishing UNAVAILABLE and CORRUPT from genuinely EMPTY.
 *
 * A single malformed entry makes the whole read `corrupt` rather than silently dropping it: a dropped
 * entry is a lost Progress debt, and losing it quietly is exactly what lets a later recording proceed
 * against evidence that will never be reconciled.
 */
export function readProgressReconcileQueue(): QueueReadResult {
    if (typeof localStorage === 'undefined') return { ok: false, failure: 'storage_unavailable' };
    let raw: string | null;
    try {
        raw = localStorage.getItem(KEY);
    } catch (err) {
        logger.warn({ err }, '[progress] reconcile queue read failed');
        return { ok: false, failure: 'storage_unavailable' };
    }
    // ONLY a genuinely ABSENT key is an empty queue. `!raw` also caught the empty STRING, so a
    // truncated or partially-written value reported a readable, empty queue — JSON.parse and entry
    // validation never ran, and the Start gate unlocked on storage we could not actually read.
    // Verified reachable: with `''` stored, the read returned ok:true and the durable gate allowed.
    // `''` must reach JSON.parse, become `corrupt`, and fail closed like any other unreadable value.
    if (raw === null) return { ok: true, entries: [] };
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        logger.warn({ err }, '[progress] reconcile queue parse failed');
        return { ok: false, failure: 'corrupt' };
    }
    if (!Array.isArray(parsed)) return { ok: false, failure: 'corrupt' };
    const valid = (e: unknown): e is QueueEntry =>
        !!e && typeof e === 'object'
        && typeof (e as QueueEntry).sessionId === 'string' && (e as QueueEntry).sessionId !== ''
        && typeof (e as QueueEntry).userId === 'string' && (e as QueueEntry).userId !== '';
    if (!parsed.every(valid)) return { ok: false, failure: 'corrupt' };
    return { ok: true, entries: parsed };
}

/** Write, then READ BACK and confirm. A write that cannot be verified is not a durable write. */
function writeVerified(entries: QueueEntry[], expect: (e: QueueEntry[]) => boolean): QueueWriteResult {
    if (typeof localStorage === 'undefined') return { ok: false, failure: 'storage_unavailable' };
    try {
        localStorage.setItem(KEY, JSON.stringify(entries));
    } catch (err) {
        logger.warn({ err }, '[progress] reconcile queue write failed');
        return { ok: false, failure: 'write_failed' };
    }
    const back = readProgressReconcileQueue();
    if (!back.ok) return { ok: false, failure: 'readback_failed' };
    if (!expect(back.entries)) return { ok: false, failure: 'readback_failed' };
    return { ok: true, verified: true };
}

/**
 * Owner-scoped enqueue, VERIFIED.
 *
 * `ok` means the exact (session, user) entry is present in storage after the call — either it was
 * already there, or the write was confirmed by readback. Anything else is a failure the caller must
 * treat as "not durably queued".
 */
export function enqueueProgressReconcile(sessionId: string, userId: string, nowIso: string): QueueWriteResult {
    if (!sessionId || !userId) return { ok: false, failure: 'write_failed' };
    const current = readProgressReconcileQueue();
    if (!current.ok) return { ok: false, failure: current.failure };
    const has = (list: QueueEntry[]) => list.some((e) => e.sessionId === sessionId && e.userId === userId);
    // Already queued is a durable success: the debt is recorded, which is all `queued` claims.
    if (has(current.entries)) return { ok: true, verified: true };
    return writeVerified([...current.entries, { sessionId, userId, enqueuedAtIso: nowIso }], has);
}

/** The session ids queued for THIS user (owner-scoped — never drains another account's entries). */
export function getQueuedSessionIdsForUser(userId: string): QueueReadResult & { sessionIds?: string[] } {
    const res = readProgressReconcileQueue();
    if (!res.ok) return res;
    return { ...res, sessionIds: res.entries.filter((e) => e.userId === userId).map((e) => e.sessionId) };
}

/** Remove a resolved (session,user) entry once its evaluation is durably recorded — VERIFIED. */
export function clearProgressReconcileEntry(sessionId: string, userId: string): QueueWriteResult {
    const current = readProgressReconcileQueue();
    if (!current.ok) return { ok: false, failure: current.failure };
    const next = current.entries.filter((e) => !(e.sessionId === sessionId && e.userId === userId));
    if (next.length === current.entries.length) return { ok: true, verified: true }; // nothing to remove
    return writeVerified(next, (list) => !list.some((e) => e.sessionId === sessionId && e.userId === userId));
}
