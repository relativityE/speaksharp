/**
 * TEMPORARY #1476 MIXED-VERSION COMPATIBILITY SIGNAL — remove ONLY after a separately approved rollout horizon.
 *
 * Codex P1 on 4dd2bbb2 (line 403), PM decision option (a): a tab still running the pre-#1476 code reads and subscribes
 * ONLY to the v1 aggregate key. If a new tab recorded Progress debt under its v2 entry key alone, that old tab would
 * find no debt on its fresh Start read and admit another recording while reconciliation is still owed.
 *
 * So every v2 enqueue ALSO publishes the obligation into the v1 aggregate, in exactly the shape the old reader
 * accepts, and verifies it by readback. The contract is deliberately narrow and honest:
 *  - v2 stays AUTHORITATIVE. This is a signal for old readers, never a second source of truth for new code (new code
 *    already merges v1 with v2 and tombstones retire the copy).
 *  - A signal that cannot be written, or is overwritten before readback, is NOT verified, and the enqueue must not
 *    report verified success. The v1 read-modify-write can still race an old tab's own write-back — the defect #1476
 *    fixes for new code — which is why the readback, not the write, decides.
 *  - The copy is only ever unreleased debt: an old tab that sees it holds its own Start until its own reconcile
 *    clears it. That errs closed.
 */
import logger from '@/lib/logger';

type Obligation = { sessionId: string; userId: string; enqueuedAtIso: string };
type Result = { ok: true; verified: true } | { ok: false; failure: 'corrupt' | 'write_failed' | 'readback_failed' };

const hasObligation = (value: unknown, o: Obligation): boolean =>
    Array.isArray(value) && value.some((e: unknown) => {
        const r = e as Partial<Obligation> | null;
        return !!r && typeof r === 'object' && r.sessionId === o.sessionId && r.userId === o.userId;
    });

/** Publish `o` into the v1 aggregate under `v1Key` and confirm by readback that an old reader will see it. */
export function publishV1CompatSignal(v1Key: string, o: Obligation): Result {
    let current: unknown[];
    try {
        const raw = localStorage.getItem(v1Key);
        const parsed: unknown = raw === null ? [] : JSON.parse(raw);
        if (!Array.isArray(parsed)) return { ok: false, failure: 'corrupt' };
        current = parsed;
    } catch {
        return { ok: false, failure: 'corrupt' };
    }
    if (!hasObligation(current, o)) {
        try {
            localStorage.setItem(v1Key, JSON.stringify([...current, { sessionId: o.sessionId, userId: o.userId, enqueuedAtIso: o.enqueuedAtIso }]));
        } catch (err) {
            logger.warn({ err }, '[progress] v1 compatibility signal write failed');
            return { ok: false, failure: 'write_failed' };
        }
    }
    try {
        const raw = localStorage.getItem(v1Key);
        return raw !== null && hasObligation(JSON.parse(raw), o) ? { ok: true, verified: true } : { ok: false, failure: 'readback_failed' };
    } catch {
        return { ok: false, failure: 'readback_failed' };
    }
}
