/* @vitest-environment jsdom */
// #1476 PM disposition on 039043877 — SAME-ENTRY cross-tab writes, WITHOUT navigator.locks.
//
// Two tabs of one account write the SAME obligation's entry. localStorage has no compare-and-set, so a tab can read the
// entry, another tab can write it, and the first tab's merged write lands on top. These force that interleaving
// deterministically — the other tab's operation runs AFTER this tab's final fresh read and BEFORE its write — in both
// orders and with a newer tombstone, and state what survives.
//
// The contract proven is FAIL-CLOSED, SERVER-BACKED: a lost same-entry update may only (a) keep Start held longer
// (a lost release), (b) allow one more idempotent retry (a lost attempt count), or (c) re-surface a debt the server has
// already settled (a lowered tombstone). It can never HIDE an unpaid debt — entries are never deleted, a tombstone is
// written only after the server durably recorded the evaluation, and every Start re-hydrates the server's owed list —
// and the next pass heals each state. Each "tab" is its own module instance over the shared jsdom storage.
// Content-free: synthetic identifiers only.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}));

type Queue = typeof import('../progressReconcileQueue');
async function openTab(): Promise<Queue> {
    vi.resetModules();
    return import('../progressReconcileQueue');
}

const OWNER = 'owner-1476-same';
const SESSION = 'sess-1476-same-entry';
const T0 = '2026-09-23T12:00:00.000Z';
const T1 = '2026-09-23T12:00:05.000Z';
const T2 = '2026-09-23T12:00:10.000Z';
const ENTRY_PREFIX = 'ss_progress_reconcile_queue_v2|e|';
const TOMB_PREFIX = 'ss_progress_reconcile_queue_v2|t|';

/** Run `other` once, immediately BEFORE this tab's next write to a key with `prefix` — after its final fresh read. */
function interleaveBeforeNextWrite(prefix: string, other: () => void): { fired: () => boolean } {
    const original = Storage.prototype.setItem;
    let armed = true;
    let didFire = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
        if (armed && key.startsWith(prefix)) {
            armed = false;
            didFire = true;
            other();
        }
        return original.call(this, key, value);
    });
    return { fired: () => didFire };
}
const entryOf = (q: Queue) => {
    const r = q.getQueueEntriesForUser(OWNER);
    if (!r.ok) throw new Error(r.failure);
    return r.entries.find((e) => e.sessionId === SESSION);
};

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('#1476 same-entry interleavings without navigator.locks', () => {
    it('PRECONDITION: this environment has no Web Locks, so nothing serializes the tabs\' writes', () => {
        expect((globalThis.navigator as Navigator & { locks?: unknown }).locks).toBeUndefined();
    });

    it('ORDER 1 — A records an attempt, B releases between A\'s read and write: the release is lost, Start stays HELD (fail-closed), and the next release heals it', async () => {
        const a = await openTab();
        expect(a.enqueueProgressReconcile(SESSION, OWNER, T0).ok).toBe(true);
        const b = await openTab();
        const hook = interleaveBeforeNextWrite(ENTRY_PREFIX, () => { expect(b.releaseProgressReconcileEntry(SESSION, OWNER, T1).ok).toBe(true); });
        const aWrite = a.recordProgressReconcileAttempt(SESSION, OWNER, T1);
        vi.restoreAllMocks();
        expect(hook.fired(), 'the interleaving happened').toBe(true);
        expect(aWrite.ok, 'A\'s own readback still verifies').toBe(true);

        const after = entryOf(a);
        expect(after, 'the debt is NOT hidden').toBeDefined();
        expect(after?.releasedAtIso, 'B\'s release was overwritten: Start stays held — the fail-closed direction').toBeUndefined();
        expect(b.releaseProgressReconcileEntry(SESSION, OWNER, T2).ok).toBe(true);
        expect(entryOf(a)?.releasedAtIso, 'the next release pass heals it').toBe(T2);
    });

    it('ORDER 2 — A releases, B records an attempt between A\'s read and write: the attempt count may drop by one (one extra idempotent retry), the release and the debt survive', async () => {
        const a = await openTab();
        expect(a.enqueueProgressReconcile(SESSION, OWNER, T0).ok).toBe(true);
        const b = await openTab();
        const hook = interleaveBeforeNextWrite(ENTRY_PREFIX, () => { expect(b.recordProgressReconcileAttempt(SESSION, OWNER, T1).ok).toBe(true); });
        expect(a.releaseProgressReconcileEntry(SESSION, OWNER, T1).ok).toBe(true);
        vi.restoreAllMocks();
        expect(hook.fired()).toBe(true);

        const after = entryOf(a);
        expect(after, 'the debt is NOT hidden').toBeDefined();
        expect(after?.releasedAtIso).toBe(T1);
        expect(after?.attempts, 'B\'s one attempt was overwritten: exactly one extra idempotent retry, nothing else').toBeUndefined();
    });

    it('NEWER TOMBSTONE — A clears an older view while B clears a newer re-enqueue of the same session: a lowered tombstone can only RE-SURFACE a settled debt, never hide an unpaid one', async () => {
        const a = await openTab();
        expect(a.enqueueProgressReconcile(SESSION, OWNER, T0).ok).toBe(true);
        const b = await openTab();
        // Between A's final fresh tombstone read and its tombstone write, B retires the T0 view, the server re-lists the
        // session (re-enqueued at T2), and B clears that too — B's tombstone is NEWER than the one A is about to write.
        const hook = interleaveBeforeNextWrite(TOMB_PREFIX, () => {
            expect(b.clearProgressReconcileEntry(SESSION, OWNER).ok).toBe(true);
            expect(b.enqueueProgressReconcile(SESSION, OWNER, T2).ok).toBe(true);
            expect(b.clearProgressReconcileEntry(SESSION, OWNER).ok).toBe(true);
        });
        a.clearProgressReconcileEntry(SESSION, OWNER);
        vi.restoreAllMocks();
        expect(hook.fired()).toBe(true);

        // Whatever A's stale tombstone did, the outcome is one of the two safe states: retired (both clears held), or the
        // settled T2 debt visible again (a lowered tombstone) — which only holds Start until the next pass re-clears it.
        const visible = entryOf(a);
        expect(visible?.enqueuedAtIso, 'A\'s older tombstone landed last: the SETTLED re-enqueue re-surfaces (held, not hidden)').toBe(T2);
        expect(a.clearProgressReconcileEntry(SESSION, OWNER).ok).toBe(true);
        expect(entryOf(a), 'the next clear pass heals it').toBeUndefined();
    });

    it('COVERING TOMBSTONE — the only way to hide a live entry is a CLEAR, and a clear follows a server-recorded evaluation (so what is hidden is settled)', async () => {
        const a = await openTab();
        expect(a.enqueueProgressReconcile(SESSION, OWNER, T0).ok).toBe(true);
        const b = await openTab();
        // Tab B writes an entry for the same session while tab A retires it: A's tombstone covers B's entry.
        const hook = interleaveBeforeNextWrite(TOMB_PREFIX, () => { expect(b.enqueueProgressReconcile(SESSION, OWNER, T1).ok).toBe(true); });
        a.clearProgressReconcileEntry(SESSION, OWNER);
        vi.restoreAllMocks();
        expect(hook.fired()).toBe(true);
        expect(entryOf(a), 'the covering state: locally hidden').toBeUndefined();
        // What makes this safe is not a later server restoration (the pre-apply server has no obligations RPC): it is
        // that `clearProgressReconcileEntry` is called ONLY after `record_progress_evaluation` returned an id for this
        // session — proven on both real call sites in recordProgress.tombstoneInvariant1476.test.ts, pre-apply schema —
        // and an evaluated session is never owed again. B's entry for the SAME session is that settled obligation.
    });
});
