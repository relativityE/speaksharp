/**
 * #1045 — durable, owner-scoped queue of sessions whose Progress evaluation could not be recorded at save
 * time (a transient RPC failure, or a tab closed mid-request). Persisted in localStorage so a closed tab or
 * a longer outage does not permanently drop the immutable record: the entries are drained on the next
 * authenticated load (see `reconcileProgressEvaluations`).
 *
 * The RPC is idempotent per `(session, formula_version)`, so re-recording a session already recorded is a
 * harmless no-op — the queue never risks a duplicate.
 */
import logger from '@/lib/logger';

const KEY = 'ss_progress_reconcile_queue_v1';

interface QueueEntry {
    sessionId: string;
    userId: string;
    /** ms epoch as a string is avoided — kept as a plain field only for observability, never for ordering. */
    enqueuedAtIso: string;
}

function readAll(): QueueEntry[] {
    if (typeof localStorage === 'undefined') return [];
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.sessionId === 'string' && typeof e.userId === 'string') : [];
    } catch (err) {
        logger.warn({ err }, '[progress] reconcile queue read failed');
        return [];
    }
}

function writeAll(entries: QueueEntry[]): void {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(KEY, JSON.stringify(entries));
    } catch (err) {
        logger.warn({ err }, '[progress] reconcile queue write failed');
    }
}

/** Owner-scoped enqueue. No-op if the same (session,user) pair is already queued. */
export function enqueueProgressReconcile(sessionId: string, userId: string, nowIso: string): void {
    if (!sessionId || !userId) return;
    const all = readAll();
    if (all.some((e) => e.sessionId === sessionId && e.userId === userId)) return;
    all.push({ sessionId, userId, enqueuedAtIso: nowIso });
    writeAll(all);
}

/** The session ids queued for THIS user (owner-scoped — never drains another account's entries). */
export function getQueuedSessionIdsForUser(userId: string): string[] {
    return readAll().filter((e) => e.userId === userId).map((e) => e.sessionId);
}

/** Remove a resolved (session,user) entry once its evaluation has been durably recorded. */
export function clearProgressReconcileEntry(sessionId: string, userId: string): void {
    const all = readAll();
    const next = all.filter((e) => !(e.sessionId === sessionId && e.userId === userId));
    if (next.length !== all.length) writeAll(next);
}
