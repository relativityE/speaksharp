/* @vitest-environment jsdom */
// #1476 (PM ACCEPT 5682368544) — per-entry v2 storage: mixed-version compatibility, retirement tombstones, owner-scoped
// corruption, crash-safe migration and clears, collision-safe keys, and the cross-tab listener's keys.
//
// Each "tab" loads its OWN module instance (`vi.resetModules()`) over the one shared jsdom localStorage, as browsing
// contexts of one origin share storage. A tab running the OLD code is modelled by writing the v1 aggregate directly,
// exactly as that code does. Content-free: synthetic session and owner identifiers only.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}));

type Queue = typeof import('../progressReconcileQueue');

async function openTab(): Promise<Queue> {
    vi.resetModules();
    return import('../progressReconcileQueue');
}

const OWNER = 'owner-1476';
const OTHER = 'owner-1476-other';
const A = 'sess-1476-a';
const B = 'sess-1476-b';
const C = 'sess-1476-c';
const T0 = '2026-09-15T12:00:00.000Z';
const T1 = '2026-09-15T12:00:05.000Z';
const T2 = '2026-09-15T12:00:10.000Z';
const V1 = 'ss_progress_reconcile_queue_v1';

/** What a tab still running the pre-#1476 code writes: the whole array under the v1 key. */
const oldTabWritesV1 = (entries: unknown[]) => localStorage.setItem(V1, JSON.stringify(entries));

const sessionIds = (tab: Queue, owner = OWNER) => {
    const read = tab.getQueueEntriesForUser(owner);
    if (!read.ok) throw new Error(`queue unreadable for ${owner}: ${read.failure}`);
    return read.entries.map((e) => e.sessionId).sort();
};
const entry = (tab: Queue, session: string, owner = OWNER) => {
    const read = tab.getQueueEntriesForUser(owner);
    if (!read.ok) throw new Error(`queue unreadable: ${read.failure}`);
    return read.entries.find((e) => e.sessionId === session);
};

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('#1476 — v1 → v2 migration is idempotent and crash-safe', () => {
    it('v1 debt is visible before any write; a mutation copies every entry to its own verified key and RETAINS v1 (PM RETURN P1-A)', async () => {
        oldTabWritesV1([
            { sessionId: A, userId: OWNER, enqueuedAtIso: T0, attempts: 2 },
            { sessionId: B, userId: OTHER, enqueuedAtIso: T0 },
        ]);
        const tab = await openTab();
        expect(sessionIds(tab)).toEqual([A]);
        expect(sessionIds(tab, OTHER)).toEqual([B]);

        expect(tab.enqueueProgressReconcile(C, OWNER, T1)).toEqual({ ok: true, verified: true });

        expect(localStorage.getItem(V1), 'v1 is retained as a compatibility source while old writers may exist').not.toBeNull();
        expect(JSON.parse(localStorage.getItem(tab.progressQueueEntryKey(OWNER, A)) as string)).toMatchObject({ attempts: 2 });
        expect(localStorage.getItem(tab.progressQueueEntryKey(OTHER, B)), 'another owner\'s debt is migrated, not dropped').not.toBeNull();
        expect(sessionIds(await openTab())).toEqual([A, C]);
    });

    it('CASUALTY: an interrupted migration (a v2 copy fails) loses no debt, and the next mutation finishes the copy', async () => {
        oldTabWritesV1([{ sessionId: A, userId: OWNER, enqueuedAtIso: T0 }, { sessionId: B, userId: OWNER, enqueuedAtIso: T0 }]);
        const tab = await openTab();
        const realSet = Storage.prototype.setItem;
        const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
            if (key === tab.progressQueueEntryKey(OWNER, B)) throw new Error('storage blocked');
            return realSet.call(this, key, value);
        });

        const interrupted = tab.enqueueProgressReconcile(C, OWNER, T1);
        expect(interrupted.ok, 'a migration that could not finish is not reported as success').toBe(false);
        expect(sessionIds(tab), 'both halves of the move are readable, nothing is lost').toEqual([A, B]);

        refuse.mockRestore();
        expect(tab.enqueueProgressReconcile(C, OWNER, T1).ok).toBe(true);
        expect(localStorage.getItem(tab.progressQueueEntryKey(OWNER, B)), 'the next mutation finishes the copy').not.toBeNull();
        expect(sessionIds(await openTab())).toEqual([A, B, C]);
    });

    it('CASUALTY: a still-open OLD tab writing its stale v1 copy after migration never resurrects debt this tab retired', async () => {
        const tab = await openTab();
        expect(tab.enqueueProgressReconcile(A, OWNER, T0).ok).toBe(true);
        expect(tab.enqueueProgressReconcile(B, OWNER, T0).ok).toBe(true);
        // The old tab read both entries BEFORE this tab retired A, and writes that view back afterwards.
        const staleView = [{ sessionId: A, userId: OWNER, enqueuedAtIso: T0 }, { sessionId: B, userId: OWNER, enqueuedAtIso: T0 }];

        expect(tab.clearProgressReconcileEntry(A, OWNER)).toEqual({ ok: true, verified: true });
        oldTabWritesV1(staleView);

        expect(sessionIds(tab), 'the stale copy is not read back into the queue').toEqual([B]);
        expect(tab.recordProgressReconcileAttempt(B, OWNER, T1).ok).toBe(true); // runs the migration
        expect(sessionIds(await openTab())).toEqual([B]);
        // A clear is tombstone-only (Codex P1s on 4dd2bbb2): the retired entry is retained, and the migration must not
        // have replaced it with a live copy.
        expect(JSON.parse(localStorage.getItem(tab.progressQueueEntryKey(OWNER, A)) as string).enqueuedAtIso,
            'the retained A is still the retired T0 obligation, not a re-created live one').toBe(T0);
    });

    it('CASUALTY: a stale v1 copy never lowers attempts or undoes a release already recorded in v2', async () => {
        const tab = await openTab();
        expect(tab.enqueueProgressReconcile(A, OWNER, T0).ok).toBe(true);
        expect(tab.recordProgressReconcileAttempt(A, OWNER, T1).ok).toBe(true);
        expect(tab.recordProgressReconcileAttempt(A, OWNER, T1).ok).toBe(true);
        expect(tab.releaseProgressReconcileEntry(A, OWNER, T2).ok).toBe(true);

        oldTabWritesV1([{ sessionId: A, userId: OWNER, enqueuedAtIso: T0, attempts: 0 }]);
        expect(entry(tab, A)).toMatchObject({ attempts: 2, releasedAtIso: T2 });

        expect(tab.enqueueProgressReconcile(B, OWNER, T1).ok).toBe(true); // migrates the stale copy
        expect(entry(await openTab(), A)).toMatchObject({ attempts: 2, releasedAtIso: T2 });
    });

    it('CONTROL: a genuinely NEW obligation for a retired session (newer enqueue time) is not hidden by the tombstone', async () => {
        const tab = await openTab();
        expect(tab.enqueueProgressReconcile(A, OWNER, T0).ok).toBe(true);
        expect(tab.clearProgressReconcileEntry(A, OWNER).ok).toBe(true);

        expect(tab.enqueueProgressReconcile(A, OWNER, T2)).toEqual({ ok: true, verified: true });
        oldTabWritesV1([{ sessionId: A, userId: OWNER, enqueuedAtIso: T0 }]);

        expect(sessionIds(await openTab())).toEqual([A]);
        expect(entry(await openTab(), A)?.enqueuedAtIso).toBe(T2);
    });
});

describe('#1476 PM RETURN on cd79ba3f — the migration races other tabs without losing, regressing or resurrecting debt', () => {
    /** Run `act` once, right after this tab's migration snapshot has read v1 (the last read of `takeSnapshot`). */
    const afterSnapshotReadsV1 = (act: () => void) => {
        const realGet = Storage.prototype.getItem;
        const hook = { fired: false };
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
            const value = realGet.call(this, key);
            if (!hook.fired && key === V1) { hook.fired = true; act(); }
            return value;
        });
        return hook;
    };
    const rawEntry = (tab: Queue, session: string) => localStorage.getItem(tab.progressQueueEntryKey(OWNER, session));

    it('P1-A CASUALTY: an old tab\'s v1 write landing after the snapshot is never deleted, and a later mutation migrates it', async () => {
        const tab = await openTab();
        oldTabWritesV1([{ sessionId: A, userId: OWNER, enqueuedAtIso: T0 }]);
        // The old tab writes a distinct obligation B right after this tab copied A to v2 — before any cleanup could run.
        const realSet = Storage.prototype.setItem;
        const hook = { fired: false };
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
            realSet.call(this, key, value);
            if (!hook.fired && key === tab.progressQueueEntryKey(OWNER, A)) {
                hook.fired = true;
                realSet.call(this, V1, JSON.stringify([
                    { sessionId: A, userId: OWNER, enqueuedAtIso: T0 },
                    { sessionId: B, userId: OWNER, enqueuedAtIso: T1 },
                ]));
            }
        });

        const result = tab.enqueueProgressReconcile(C, OWNER, T2);
        vi.restoreAllMocks();
        expect(hook.fired, 'the interleave was actually exercised').toBe(true);
        expect(result).toEqual({ ok: true, verified: true });
        expect(sessionIds(await openTab()), 'both obligations remain readable').toEqual([A, B, C]);

        expect(tab.recordProgressReconcileAttempt(C, OWNER, T2).ok).toBe(true); // a later v2 mutation
        expect(rawEntry(tab, B), 'the late obligation is migrated to its own v2 key').not.toBeNull();
        expect(sessionIds(await openTab())).toEqual([A, B, C]);
    });

    it('P1-B1 CASUALTY: snapshot → concurrent attempt increment → migration write: attempts never decrease', async () => {
        const tab = await openTab();
        expect(tab.enqueueProgressReconcile(A, OWNER, T0).ok).toBe(true);
        expect(tab.recordProgressReconcileAttempt(A, OWNER, T1).ok).toBe(true);                // v2 A: attempts 1
        oldTabWritesV1([{ sessionId: A, userId: OWNER, enqueuedAtIso: T0, attempts: 2 }]);    // v1 contributes attempts 2
        const hook = afterSnapshotReadsV1(() => localStorage.setItem(tab.progressQueueEntryKey(OWNER, A), JSON.stringify(
            { sessionId: A, userId: OWNER, enqueuedAtIso: T0, attempts: 5, lastAttemptAtIso: T2 })));

        expect(tab.enqueueProgressReconcile(B, OWNER, T1).ok).toBe(true);
        vi.restoreAllMocks();
        expect(hook.fired, 'the interleave was actually exercised').toBe(true);
        expect(entry(await openTab(), A)?.attempts).toBe(5);
    });

    it('P1-B2 CASUALTY: snapshot → concurrent release → migration write: the release is never undone', async () => {
        const tab = await openTab();
        expect(tab.enqueueProgressReconcile(A, OWNER, T0).ok).toBe(true);
        oldTabWritesV1([{ sessionId: A, userId: OWNER, enqueuedAtIso: T0, attempts: 2 }]);
        const hook = afterSnapshotReadsV1(() => localStorage.setItem(tab.progressQueueEntryKey(OWNER, A), JSON.stringify(
            { sessionId: A, userId: OWNER, enqueuedAtIso: T0, releasedAtIso: T2 })));

        expect(tab.enqueueProgressReconcile(B, OWNER, T1).ok).toBe(true);
        vi.restoreAllMocks();
        expect(hook.fired, 'the interleave was actually exercised').toBe(true);
        expect(entry(await openTab(), A)).toMatchObject({ attempts: 2, releasedAtIso: T2 });
    });

    it('P1-B3 CASUALTY: snapshot → concurrent clear → migration write: retired debt stays retired and is not materialized', async () => {
        const tab = await openTab();
        oldTabWritesV1([{ sessionId: A, userId: OWNER, enqueuedAtIso: T0 }]);
        const other = await openTab();
        const hook = afterSnapshotReadsV1(() => {
            // Another new-code tab clears A: tombstone first, then entry removal (its real order).
            localStorage.setItem(`ss_progress_reconcile_queue_v2|t|${encodeURIComponent(OWNER)}|${encodeURIComponent(A)}`,
                JSON.stringify({ sessionId: A, userId: OWNER, clearedThroughIso: T0 }));
            localStorage.removeItem(other.progressQueueEntryKey(OWNER, A));
        });

        expect(tab.enqueueProgressReconcile(B, OWNER, T1).ok).toBe(true);
        vi.restoreAllMocks();
        expect(hook.fired, 'the interleave was actually exercised').toBe(true);
        expect(rawEntry(tab, A), 'the migration did not materialize retired debt').toBeNull();
        expect(sessionIds(await openTab())).toEqual([B]);
    });

    it('P1-B4 CASUALTY: after that clear race, a genuinely newer obligation for the same pair stays visible', async () => {
        const tab = await openTab();
        oldTabWritesV1([{ sessionId: A, userId: OWNER, enqueuedAtIso: T0 }]);
        // An interrupted clear: the tombstone landed, the stale raw v2 entry was never removed.
        localStorage.setItem(`ss_progress_reconcile_queue_v2|t|${encodeURIComponent(OWNER)}|${encodeURIComponent(A)}`,
            JSON.stringify({ sessionId: A, userId: OWNER, clearedThroughIso: T0 }));
        localStorage.setItem(tab.progressQueueEntryKey(OWNER, A), JSON.stringify({ sessionId: A, userId: OWNER, enqueuedAtIso: T0 }));
        expect(sessionIds(tab), 'precondition: A is retired').toEqual([]);

        expect(tab.enqueueProgressReconcile(A, OWNER, T2).ok).toBe(true); // a genuinely NEWER obligation
        expect(entry(await openTab(), A)?.enqueuedAtIso, 'not merged into the tombstoned stale entry').toBe(T2);
        expect(sessionIds(await openTab())).toEqual([A]);
    });
});

describe('#1476 Codex findings on cca8076f', () => {
    const TOMB = (owner: string, session: string) =>
        `ss_progress_reconcile_queue_v2|t|${encodeURIComponent(owner)}|${encodeURIComponent(session)}`;

    it('P1 CASUALTY: a newer obligation another tab enqueues after the clear\'s tombstone is not deleted by the clear', async () => {
        const tab = await openTab();
        expect(tab.enqueueProgressReconcile(A, OWNER, T0).ok).toBe(true);
        // Right after this clear writes its tombstone (covering T0), another tab enqueues a genuinely newer A at T2.
        const realSet = Storage.prototype.setItem;
        const hook = { fired: false };
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
            realSet.call(this, key, value);
            if (!hook.fired && key === TOMB(OWNER, A)) {
                hook.fired = true;
                realSet.call(this, tab.progressQueueEntryKey(OWNER, A), JSON.stringify({ sessionId: A, userId: OWNER, enqueuedAtIso: T2 }));
            }
        });

        const cleared = tab.clearProgressReconcileEntry(A, OWNER);
        vi.restoreAllMocks();
        expect(hook.fired, 'the interleave was actually exercised').toBe(true);
        expect(cleared, 'the T0 obligation is retired, which is all this clear claims').toEqual({ ok: true, verified: true });
        expect(entry(await openTab(), A)?.enqueuedAtIso, 'the newer T2 debt survives').toBe(T2);
    });

    it('P1 CONTROL: a clear retires the obligation (hidden, never deleted), and a later newer enqueue is visible', async () => {
        const tab = await openTab();
        expect(tab.enqueueProgressReconcile(A, OWNER, T0).ok).toBe(true);
        expect(tab.clearProgressReconcileEntry(A, OWNER)).toEqual({ ok: true, verified: true });
        expect(sessionIds(await openTab()), 'retired').toEqual([]);
        expect(tab.enqueueProgressReconcile(A, OWNER, T2).ok).toBe(true);
        expect(entry(await openTab(), A)?.enqueuedAtIso).toBe(T2);
    });

    it.each([
        ['an undecodable owner', 'ss_progress_reconcile_queue_v2|e|%E0%A4%A|sess-x'],
        ['a missing owner', 'ss_progress_reconcile_queue_v2|e||sess-x'],
    ])('P2 CASUALTY: a v2 key with %s cannot be attributed, so it fails closed for EVERY owner', async (_label, key) => {
        const tab = await openTab();
        expect(tab.enqueueProgressReconcile(A, OWNER, T0).ok).toBe(true);
        localStorage.setItem(key, JSON.stringify({ sessionId: 'sess-x', userId: 'owner-x', enqueuedAtIso: T0 }));
        const read = (await openTab()).getQueueEntriesForUser(OWNER);
        expect(read.ok, 'an unattributable debt may be this owner\'s: the Start gate must not read the queue as clean').toBe(false);
        expect(read).toMatchObject({ failure: 'corrupt' });
    });

    it('P2 CONTROL: a malformed key whose OWNER decodes still blocks only that owner', async () => {
        const tab = await openTab();
        expect(tab.enqueueProgressReconcile(A, OWNER, T0).ok).toBe(true);
        localStorage.setItem(`ss_progress_reconcile_queue_v2|e|${encodeURIComponent(OTHER)}`, JSON.stringify({ userId: OTHER }));
        expect(sessionIds(await openTab()), 'this owner is unaffected').toEqual([A]);
        expect((await openTab()).getQueueEntriesForUser(OTHER)).toMatchObject({ ok: false, failure: 'corrupt' });
    });
});

describe('#1476 Codex P1s on 4dd2bbb2 — no v2 delete races', () => {
    it('P1 (line 453) CASUALTY: a newer enqueue landing at ANY point during a clear survives it', async () => {
        const tab = await openTab();
        expect(tab.enqueueProgressReconcile(A, OWNER, T0).ok).toBe(true);
        // The worst interleave for check-then-remove: the newer obligation lands on the clear's own final read of
        // the entry key, i.e. after any re-check and before any removal.
        const realGet = Storage.prototype.getItem;
        const realSet = Storage.prototype.setItem;
        const hook = { fired: false, tombSeen: false };
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
            realSet.call(this, key, value);
            if (key.includes('|t|')) hook.tombSeen = true;
        });
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
            const value = realGet.call(this, key);
            if (!hook.fired && hook.tombSeen && key === tab.progressQueueEntryKey(OWNER, A)) {
                hook.fired = true;
                realSet.call(this, key, JSON.stringify({ sessionId: A, userId: OWNER, enqueuedAtIso: T2 }));
            }
            return value;
        });

        const cleared = tab.clearProgressReconcileEntry(A, OWNER);
        vi.restoreAllMocks();
        expect(hook.fired, 'the interleave was actually exercised').toBe(true);
        expect(cleared).toEqual({ ok: true, verified: true });
        expect(entry(await openTab(), A)?.enqueuedAtIso, 'the newer T2 debt survives').toBe(T2);
    });

    it('P1 (line 175) CASUALTY: a key removed by another tab mid-enumeration never hides this owner\'s debt', async () => {
        const tab = await openTab();
        // Storage order is exactly [victim, this owner's debt]: another owner's tombstone, then A.
        const victim = `ss_progress_reconcile_queue_v2|t|${encodeURIComponent(OTHER)}|${encodeURIComponent(B)}`;
        localStorage.setItem(victim, JSON.stringify({ sessionId: B, userId: OTHER, clearedThroughIso: T0 }));
        // The debt lives in v2 ONLY (written directly): a v1 compatibility copy would mask a skipped v2 key.
        localStorage.setItem(tab.progressQueueEntryKey(OWNER, A), JSON.stringify({ sessionId: A, userId: OWNER, enqueuedAtIso: T0 }));
        expect(localStorage.getItem(V1), 'precondition: no v1 copy to fall back on').toBeNull();
        const order = [...Array(localStorage.length).keys()].map((i) => localStorage.key(i) as string)
            .filter((k) => k.startsWith('ss_progress_reconcile_queue_v2|')); // the enumeration only walks v2 keys
        expect(order, 'precondition: the removed key sits immediately before this owner\'s debt').toEqual([victim, tab.progressQueueEntryKey(OWNER, A)]);

        // While this tab enumerates, another tab removes that earlier key: every later key shifts down one index.
        const realKey = Storage.prototype.key;
        const hook = { fired: false };
        vi.spyOn(Storage.prototype, 'key').mockImplementation(function (this: Storage, i: number) {
            const k = realKey.call(this, i);
            if (!hook.fired && k === victim) { hook.fired = true; localStorage.removeItem(victim); }
            return k;
        });
        const read = tab.getQueueEntriesForUser(OWNER);
        vi.restoreAllMocks();
        expect(hook.fired, 'the interleave was actually exercised').toBe(true);
        // Either the debt is read, or the read fails closed — never an empty "clean" queue.
        const outcome = read.ok ? read.entries.map((e) => e.sessionId) : read.failure;
        expect([[A], 'storage_unavailable']).toContainEqual(outcome);
    });
});

describe('#1476 Codex P1 on 4dd2bbb2 (line 403) — a still-open PRE-UPGRADE tab sees debt a new tab records', () => {
    /** The ACTUAL pre-#1476 reader (verbatim from main), loaded as its own tab over the same storage. */
    async function openOldTab() {
        vi.resetModules();
        return import('./fixtures/progressReconcileQueue.pre1476');
    }

    it('CONTROL: a v2-era enqueue publishes a v1 signal the old reader sees before Start (empty v1 beforehand)', async () => {
        const oldTab = await openOldTab();
        expect(oldTab.getQueueEntriesForUser(OWNER), 'precondition: the old tab sees a clean queue').toEqual({ ok: true, entries: [] });

        const tab = await openTab();
        expect(tab.enqueueProgressReconcile(A, OWNER, T0)).toEqual({ ok: true, verified: true });

        const seen = (await openOldTab()).getQueueEntriesForUser(OWNER);
        expect(seen.ok, 'the old reader can read the queue').toBe(true);
        const pending = seen.ok ? seen.entries.filter((e) => e.sessionId === A && e.releasedAtIso === undefined) : [];
        expect(pending, 'an unreleased A holds the OLD tab\'s Start too').toHaveLength(1);
    });

    it('CASUALTY: if the v1 signal cannot be written, the enqueue is NOT reported verified (v2 debt still recorded)', async () => {
        const tab = await openTab();
        const realSet = Storage.prototype.setItem;
        const hook = { fired: false };
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
            if (key === V1) { hook.fired = true; throw new Error('quota'); }
            return realSet.call(this, key, value);
        });
        const result = tab.enqueueProgressReconcile(A, OWNER, T0);
        vi.restoreAllMocks();
        expect(hook.fired, 'the compatibility write was attempted').toBe(true);
        expect(result.ok, 'no verified success without the old readers\' signal').toBe(false);
        expect(sessionIds(await openTab()), 'the authoritative v2 debt is still recorded').toEqual([A]);
    });

    it('CASUALTY: if an old tab immediately overwrites the v1 signal, the enqueue is NOT reported verified', async () => {
        const tab = await openTab();
        const realSet = Storage.prototype.setItem;
        const hook = { fired: false };
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
            realSet.call(this, key, value);
            if (!hook.fired && key === V1) { hook.fired = true; realSet.call(this, V1, JSON.stringify([])); } // old tab's stale write-back
        });
        const result = tab.enqueueProgressReconcile(A, OWNER, T0);
        vi.restoreAllMocks();
        expect(hook.fired, 'the interleave was actually exercised').toBe(true);
        expect(result.ok, 'an overwritten signal is not a verified one').toBe(false);
        expect(sessionIds(await openTab()), 'the authoritative v2 debt is still recorded').toEqual([A]);
    });
});

describe('#1476 — a clear retires the obligation before it removes the entry', () => {
    it('CASUALTY: a clear whose tombstone write fails is reported, and the debt stays owed (the sibling untouched)', async () => {
        // The tombstone is the ONLY write a clear makes (Codex P1s on 4dd2bbb2), so it is the only place it can fail.
        const tab = await openTab();
        expect(tab.enqueueProgressReconcile(A, OWNER, T0).ok).toBe(true);
        expect(tab.enqueueProgressReconcile(B, OWNER, T0).ok).toBe(true);
        const realSet = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
            if (key.includes('|t|')) throw new Error('crash mid-clear');
            return realSet.call(this, key, value);
        });

        expect(tab.clearProgressReconcileEntry(A, OWNER).ok, 'the incomplete clear is reported, never assumed').toBe(false);
        vi.restoreAllMocks();
        expect(sessionIds(await openTab()), 'nothing was retired: A is still owed, and B is untouched').toEqual([A, B]);
    });

    it('CONTROL: a completed clear leaves the entry physically present but retired, and the sibling untouched', async () => {
        const tab = await openTab();
        expect(tab.enqueueProgressReconcile(A, OWNER, T0).ok).toBe(true);
        expect(tab.enqueueProgressReconcile(B, OWNER, T0).ok).toBe(true);
        expect(tab.clearProgressReconcileEntry(A, OWNER)).toEqual({ ok: true, verified: true });
        expect(localStorage.getItem(tab.progressQueueEntryKey(OWNER, A)), 'never deleted').not.toBeNull();
        expect(sessionIds(await openTab())).toEqual([B]);
    });
});

describe('#1476 — corruption fails closed for its owner and never hides or deletes a valid sibling', () => {
    it('another owner\'s unreadable entry does not block this owner, and blocks its own owner', async () => {
        const tab = await openTab();
        expect(tab.enqueueProgressReconcile(A, OWNER, T0).ok).toBe(true);
        localStorage.setItem(tab.progressQueueEntryKey(OTHER, B), '{not json');

        expect(tab.getQueueEntriesForUser(OWNER)).toMatchObject({ ok: true });
        expect(sessionIds(tab)).toEqual([A]);
        expect(tab.getQueueEntriesForUser(OTHER)).toEqual({ ok: false, failure: 'corrupt' });
        expect(tab.readProgressReconcileQueue(), 'the whole-queue read still reports it').toEqual({ ok: false, failure: 'corrupt' });

        expect(tab.enqueueProgressReconcile(C, OWNER, T1).ok).toBe(true);
        expect(localStorage.getItem(tab.progressQueueEntryKey(OTHER, B)), 'the unreadable entry is never deleted').toBe('{not json');
    });

    it('an unreadable entry for THIS owner blocks this owner without dropping its readable siblings', async () => {
        const tab = await openTab();
        expect(tab.enqueueProgressReconcile(A, OWNER, T0).ok).toBe(true);
        localStorage.setItem(tab.progressQueueEntryKey(OWNER, B), JSON.stringify({ sessionId: B, userId: OWNER, attempts: -1 }));

        expect(tab.getQueueEntriesForUser(OWNER)).toEqual({ ok: false, failure: 'corrupt' });
        expect(tab.enqueueProgressReconcile(C, OWNER, T1)).toEqual({ ok: false, failure: 'corrupt' });
        expect(localStorage.getItem(tab.progressQueueEntryKey(OWNER, A)), 'the valid sibling is untouched').not.toBeNull();
    });

    it('an entry key whose value names a different owner or session is unreadable, not re-attributed', async () => {
        const tab = await openTab();
        localStorage.setItem(tab.progressQueueEntryKey(OWNER, A), JSON.stringify({ sessionId: B, userId: OTHER, enqueuedAtIso: T0 }));
        expect(tab.getQueueEntriesForUser(OWNER)).toEqual({ ok: false, failure: 'corrupt' });
        expect(tab.getQueueEntriesForUser(OTHER)).toMatchObject({ ok: true, entries: [] });
    });

    it('CONTROL: an unreadable v1 value cannot be attributed, so it still blocks every owner and is never overwritten', async () => {
        localStorage.setItem(V1, '{not json');
        const tab = await openTab();
        expect(tab.getQueueEntriesForUser(OWNER)).toEqual({ ok: false, failure: 'corrupt' });
        expect(tab.enqueueProgressReconcile(A, OWNER, T0)).toEqual({ ok: false, failure: 'corrupt' });
        expect(localStorage.getItem(V1)).toBe('{not json');
    });
});

describe('#1476 — keys', () => {
    it('owner and session values containing the separator never share a key', async () => {
        const tab = await openTab();
        expect(tab.progressQueueEntryKey('a|b', 'c')).not.toBe(tab.progressQueueEntryKey('a', 'b|c'));
        expect(tab.enqueueProgressReconcile('c', 'a|b', T0).ok).toBe(true);
        expect(tab.enqueueProgressReconcile('b|c', 'a', T0).ok).toBe(true);
        expect(sessionIds(tab, 'a|b')).toEqual(['c']);
        expect(sessionIds(tab, 'a')).toEqual(['b|c']);
    });

    it('the cross-tab listener wakes on a v2 entry key, the v1 key and a full clear, and ignores unrelated keys', async () => {
        vi.resetModules();
        const queue = await import('../progressReconcileQueue');
        const gate = await import('../progressStartGate');
        const publish = vi.fn();
        const unsubscribe = gate.subscribeCrossTabProgressGate(() => OWNER, publish);
        try {
            window.dispatchEvent(new StorageEvent('storage', { key: 'speaksharp_active_session_lock' }));
            expect(publish).not.toHaveBeenCalled();
            window.dispatchEvent(new StorageEvent('storage', { key: queue.progressQueueEntryKey(OWNER, A) }));
            window.dispatchEvent(new StorageEvent('storage', { key: queue.PROGRESS_QUEUE_STORAGE_KEY }));
            window.dispatchEvent(new StorageEvent('storage', { key: null }));
            expect(publish).toHaveBeenCalledTimes(3);
        } finally {
            unsubscribe();
        }
    });
});
