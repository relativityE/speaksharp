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
 *  - Each copy carries the v2 state (attempts, release). An old tab that sees an unreleased copy holds its own Start
 *    until its own reconcile clears it, and a live v2 obligation an old tab already removed from v1 is re-published
 *    until new code reconciles it. Both err closed; a re-evaluation is idempotent server-side.
 */
import logger from '@/lib/logger';

type Obligation = { sessionId: string; userId: string; enqueuedAtIso: string; attempts?: number; lastAttemptAtIso?: string; releasedAtIso?: string };
type Result = { ok: true; verified: true } | { ok: false; failure: 'corrupt' | 'write_failed' | 'readback_failed' | 'storage_unavailable' };

const PUBLISH_PASSES = 3;

const same = (e: unknown, o: Obligation): boolean => {
    const r = e as Partial<Obligation> | null;
    return !!r && typeof r === 'object' && r.sessionId === o.sessionId && r.userId === o.userId;
};

function readV1(v1Key: string): unknown[] | 'corrupt' | 'unavailable' {
    try {
        const raw = localStorage.getItem(v1Key);
        if (raw === null) return [];
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : 'corrupt';
    } catch (err) {
        return err instanceof SyntaxError ? 'corrupt' : 'unavailable';
    }
}

/**
 * Publish every LIVE v2 obligation into the v1 aggregate under `v1Key`, and verify an old reader will see them all.
 *
 * Codex P1 on d0a2fb01 — PRESERVE THE UNION. The v1 aggregate is a shared read/modify/write: tab B can compose from
 * a stale array, tab A can publish and verify A, and B's write then erases A while B verifies only B. So each pass
 * writes the UNION of the current v1 entries and every live v2 obligation (all owners), and the readback verifies
 * that EVERY obligation live at readback time is present — not merely this tab's own. A tab whose stale write erased
 * another's signal therefore sees the gap and republishes; concurrent new tabs converge on the union, or report
 * unverified after the bounded passes. Existing v1 entries (an old tab's own data) are never modified or removed.
 *
 * `liveObligations` must read v2 FRESH on every call (null when it cannot be read).
 */
export function publishV1CompatSignal(v1Key: string, liveObligations: () => Obligation[] | null): Result {
    for (let pass = 0; pass < PUBLISH_PASSES; pass++) {
        const live = liveObligations();
        if (live === null) return { ok: false, failure: 'storage_unavailable' };
        const current = readV1(v1Key);
        if (current === 'corrupt') return { ok: false, failure: 'corrupt' };
        if (current === 'unavailable') return { ok: false, failure: 'storage_unavailable' };
        const missing = live.filter((o) => !current.some((e) => same(e, o)));
        if (missing.length > 0) {
            try {
                localStorage.setItem(v1Key, JSON.stringify([...current, ...missing]));
            } catch (err) {
                logger.warn({ err }, '[progress] v1 compatibility signal write failed');
                return { ok: false, failure: 'write_failed' };
            }
        }
        const after = readV1(v1Key);
        const liveNow = liveObligations();
        if (after === 'corrupt' || after === 'unavailable' || liveNow === null) continue;
        if (liveNow.every((o) => after.some((e) => same(e, o)))) return { ok: true, verified: true };
    }
    return { ok: false, failure: 'readback_failed' };
}
