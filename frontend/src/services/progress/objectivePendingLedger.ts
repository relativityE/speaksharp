/**
 * #1265 — durable, owner-scoped ledger of Focus Points (objective) recordings whose Progress evaluation
 * is DEFERRED until their `objective_source_recording` registration is durably present. FP intent is
 * recorded here at save time (synchronously, before the async finalize), so:
 *
 *  - the mode-ambiguous active-era sweep NEVER stamps a pending Focus Points session as `freeform`
 *    (it skips any id in this ledger), and
 *  - the mode-aware retry path evaluates a ledger session EXACTLY ONCE, and only after registration is
 *    confirmed (queried against `objective_source_recording` — the sole classification authority), so a
 *    failed/unconfirmed registration remains NO evaluation across reloads.
 *
 * This ledger is a RETRY/INTENT record, NOT a classifier: the practice mode is still decided server-side
 * by `objective_source_recording`. It never adds a mode column and never couples to attribution.
 */
import logger from '@/lib/logger';

const KEY = 'ss_objective_pending_ledger_v1';

interface LedgerEntry {
    sessionId: string;
    userId: string;
    markedAtIso: string; // observability only; never used for ordering or classification
}

function readAll(): LedgerEntry[] {
    if (typeof localStorage === 'undefined') return [];
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.filter((e) => e && typeof e.sessionId === 'string' && typeof e.userId === 'string')
            : [];
    } catch (err) {
        logger.warn({ err }, '[progress] objective-pending ledger read failed');
        return [];
    }
}

function writeAll(entries: LedgerEntry[]): void {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(KEY, JSON.stringify(entries));
    } catch (err) {
        logger.warn({ err }, '[progress] objective-pending ledger write failed');
    }
}

/** Owner-scoped mark. No-op if the same (session,user) pair is already pending. */
export function markObjectivePending(sessionId: string, userId: string, nowIso: string): void {
    if (!sessionId || !userId) return;
    const all = readAll();
    if (all.some((e) => e.sessionId === sessionId && e.userId === userId)) return;
    all.push({ sessionId, userId, markedAtIso: nowIso });
    writeAll(all);
}

/** The Focus Points session ids awaiting registration for THIS user (owner-scoped). */
export function getObjectivePendingForUser(userId: string): string[] {
    return readAll().filter((e) => e.userId === userId).map((e) => e.sessionId);
}

/** Remove an entry once its objective evaluation has been durably recorded. */
export function clearObjectivePending(sessionId: string, userId: string): void {
    const all = readAll();
    const next = all.filter((e) => !(e.sessionId === sessionId && e.userId === userId));
    if (next.length !== all.length) writeAll(next);
}
