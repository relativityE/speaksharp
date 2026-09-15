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
    it('v1 debt is visible before any write; a mutation moves every entry to its own key and removes v1 only after verifying them', async () => {
        oldTabWritesV1([
            { sessionId: A, userId: OWNER, enqueuedAtIso: T0, attempts: 2 },
            { sessionId: B, userId: OTHER, enqueuedAtIso: T0 },
        ]);
        const tab = await openTab();
        expect(sessionIds(tab)).toEqual([A]);
        expect(sessionIds(tab, OTHER)).toEqual([B]);

        expect(tab.enqueueProgressReconcile(C, OWNER, T1)).toEqual({ ok: true, verified: true });

        expect(localStorage.getItem(V1), 'v1 is removed once every copy is verified').toBeNull();
        expect(JSON.parse(localStorage.getItem(tab.progressQueueEntryKey(OWNER, A)) as string)).toMatchObject({ attempts: 2 });
        expect(localStorage.getItem(tab.progressQueueEntryKey(OTHER, B)), 'another owner\'s debt is migrated, not dropped').not.toBeNull();
        expect(sessionIds(await openTab())).toEqual([A, C]);
    });

    it('CASUALTY: an interrupted migration (v1 removal fails) loses no debt, and the next mutation finishes the move', async () => {
        oldTabWritesV1([{ sessionId: A, userId: OWNER, enqueuedAtIso: T0 }, { sessionId: B, userId: OWNER, enqueuedAtIso: T0 }]);
        const tab = await openTab();
        const realRemove = Storage.prototype.removeItem;
        const refuse = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
            if (key === V1) throw new Error('storage blocked');
            return realRemove.call(this, key);
        });

        const interrupted = tab.enqueueProgressReconcile(C, OWNER, T1);
        expect(interrupted.ok, 'a migration that could not finish is not reported as success').toBe(false);
        expect(sessionIds(tab), 'both halves of the move are readable, nothing is lost').toEqual([A, B]);

        refuse.mockRestore();
        expect(tab.enqueueProgressReconcile(C, OWNER, T1).ok).toBe(true);
        expect(localStorage.getItem(V1)).toBeNull();
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
        expect(localStorage.getItem(tab.progressQueueEntryKey(OWNER, A)), 'migration did not re-create the retired entry').toBeNull();
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

describe('#1476 — a clear retires the obligation before it removes the entry', () => {
    it('CASUALTY: a clear interrupted after its tombstone is written still leaves the debt retired', async () => {
        const tab = await openTab();
        expect(tab.enqueueProgressReconcile(A, OWNER, T0).ok).toBe(true);
        expect(tab.enqueueProgressReconcile(B, OWNER, T0).ok).toBe(true);
        const realRemove = Storage.prototype.removeItem;
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
            if (key === tab.progressQueueEntryKey(OWNER, A)) throw new Error('crash mid-clear');
            return realRemove.call(this, key);
        });

        expect(tab.clearProgressReconcileEntry(A, OWNER).ok, 'the incomplete clear is reported, never assumed').toBe(false);
        vi.restoreAllMocks();

        expect(localStorage.getItem(tab.progressQueueEntryKey(OWNER, A)), 'the entry key is still physically present').not.toBeNull();
        expect(sessionIds(await openTab()), 'but the obligation is retired, and the sibling is untouched').toEqual([B]);
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
