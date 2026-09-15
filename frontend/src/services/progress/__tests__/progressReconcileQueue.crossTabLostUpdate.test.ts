/* @vitest-environment jsdom */
// #1476 — two same-account tabs must not overwrite each other's pending Progress debt.
//
// The durable queue (`progressReconcileQueue.ts`) is one localStorage value holding every owner's entries. Each mutation
// reads the whole array, computes the next array, writes it back, and reads back to confirm ONLY ITS OWN entry. Browsing
// contexts of one origin run concurrently, so another tab can write between a tab's read and its write; the stale write
// then silently erases that other tab's change while both tabs' own readbacks still report `verified`.
//
// Each "tab" loads its OWN module instance (`vi.resetModules()`) over the one shared jsdom localStorage, as browsing
// contexts share storage. The interleaving is forced deterministically: a one-shot hook runs the other tab's operation
// immediately after this tab's queue READ returns and before its WRITE. The hook matches every key under the queue
// prefix and each scenario asserts it fired, so a storage design that stops reading the shared array cannot pass by
// accident. Content-free: synthetic session and owner identifiers only.
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
const SESSION_A = 'sess-1476-tab-a';
const SESSION_B = 'sess-1476-tab-b';
const NOW = '2026-09-15T12:00:00.000Z';
const LATER = '2026-09-15T12:00:05.000Z';
const QUEUE_KEY_PREFIX = 'ss_progress_reconcile_queue';

/**
 * Run `interleave` exactly once, right after the next read of any queue key RETURNS — i.e. after this tab has read the
 * queue and before it writes. The value already read stays stale, which is precisely the cross-tab race.
 */
function interleaveAfterNextQueueRead(interleave: () => void): { fired: () => boolean } {
    const original = Storage.prototype.getItem;
    let armed = true;
    let didFire = false;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
        const value = original.call(this, key);
        if (armed && typeof key === 'string' && key.startsWith(QUEUE_KEY_PREFIX)) {
            armed = false;
            didFire = true;
            interleave();
        }
        return value;
    });
    return { fired: () => didFire };
}

const entriesFor = (tab: Queue) => {
    const read = tab.getQueueEntriesForUser(OWNER);
    if (!read.ok) throw new Error(`queue unreadable: ${read.failure}`);
    return [...read.entries].sort((x, y) => x.sessionId.localeCompare(y.sessionId));
};
const sessionIds = (tab: Queue) => entriesFor(tab).map((e) => e.sessionId);

beforeEach(() => {
    localStorage.clear();
});
afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
});

describe('#1476 — cross-tab pending Progress debt is never lost', () => {
    it('X1 CASUALTY: two tabs enqueuing different sessions at once both keep their debt, and a reloaded tab recovers both', async () => {
        const tabA = await openTab();
        const tabB = await openTab();
        let resultA: ReturnType<Queue['enqueueProgressReconcile']> | undefined;
        const hook = interleaveAfterNextQueueRead(() => {
            resultA = tabA.enqueueProgressReconcile(SESSION_A, OWNER, NOW);
        });

        const resultB = tabB.enqueueProgressReconcile(SESSION_B, OWNER, NOW);

        expect(hook.fired()).toBe(true);
        expect(resultA).toEqual({ ok: true, verified: true });
        expect(resultB).toEqual({ ok: true, verified: true });
        expect(sessionIds(tabA)).toEqual([SESSION_A, SESSION_B]);
        const reloaded = await openTab();
        expect(sessionIds(reloaded)).toEqual([SESSION_A, SESSION_B]);
    });

    it('X2 CASUALTY: a tab recording a retry attempt does not erase a session another tab just enqueued', async () => {
        const tabA = await openTab();
        const tabB = await openTab();
        expect(tabA.enqueueProgressReconcile(SESSION_A, OWNER, NOW).ok).toBe(true);
        const hook = interleaveAfterNextQueueRead(() => {
            expect(tabB.enqueueProgressReconcile(SESSION_B, OWNER, NOW).ok).toBe(true);
        });

        const attempt = tabA.recordProgressReconcileAttempt(SESSION_A, OWNER, LATER);

        expect(hook.fired()).toBe(true);
        expect(attempt.ok).toBe(true);
        const entries = entriesFor(tabA);
        expect(entries.map((e) => e.sessionId)).toEqual([SESSION_A, SESSION_B]);
        expect(entries.find((e) => e.sessionId === SESSION_A)?.attempts).toBe(1);
    });

    it('X3 CASUALTY: a tab releasing its debt\'s Start hold does not erase a session another tab just enqueued', async () => {
        const tabA = await openTab();
        const tabB = await openTab();
        expect(tabA.enqueueProgressReconcile(SESSION_A, OWNER, NOW).ok).toBe(true);
        const hook = interleaveAfterNextQueueRead(() => {
            expect(tabB.enqueueProgressReconcile(SESSION_B, OWNER, NOW).ok).toBe(true);
        });

        const released = tabA.releaseProgressReconcileEntry(SESSION_A, OWNER, LATER);

        expect(hook.fired()).toBe(true);
        expect(released.ok).toBe(true);
        const entries = entriesFor(tabA);
        expect(entries.map((e) => e.sessionId)).toEqual([SESSION_A, SESSION_B]);
        expect(typeof entries.find((e) => e.sessionId === SESSION_A)?.releasedAtIso).toBe('string');
        expect(entries.find((e) => e.sessionId === SESSION_B)?.releasedAtIso).toBeUndefined();
    });

    it('X4 CASUALTY: a tab retiring its recorded debt does not erase a session another tab just enqueued', async () => {
        const tabA = await openTab();
        const tabB = await openTab();
        expect(tabA.enqueueProgressReconcile(SESSION_A, OWNER, NOW).ok).toBe(true);
        const hook = interleaveAfterNextQueueRead(() => {
            expect(tabB.enqueueProgressReconcile(SESSION_B, OWNER, NOW).ok).toBe(true);
        });

        const cleared = tabA.clearProgressReconcileEntry(SESSION_A, OWNER);

        expect(hook.fired()).toBe(true);
        expect(cleared.ok).toBe(true);
        expect(sessionIds(tabA)).toEqual([SESSION_B]);
    });

    it('X5 CASUALTY: an attempt recorded in one tab does not undo another tab\'s release of a different debt', async () => {
        const tabA = await openTab();
        const tabB = await openTab();
        expect(tabA.enqueueProgressReconcile(SESSION_A, OWNER, NOW).ok).toBe(true);
        expect(tabA.enqueueProgressReconcile(SESSION_B, OWNER, NOW).ok).toBe(true);
        const hook = interleaveAfterNextQueueRead(() => {
            expect(tabB.releaseProgressReconcileEntry(SESSION_B, OWNER, LATER).ok).toBe(true);
        });

        expect(tabA.recordProgressReconcileAttempt(SESSION_A, OWNER, LATER).ok).toBe(true);

        expect(hook.fired()).toBe(true);
        const entries = entriesFor(tabA);
        expect(entries.find((e) => e.sessionId === SESSION_A)?.attempts).toBe(1);
        expect(typeof entries.find((e) => e.sessionId === SESSION_B)?.releasedAtIso).toBe('string');
    });

    it('CONTROL: sequential writes from two tabs keep both entries', async () => {
        const tabA = await openTab();
        const tabB = await openTab();
        expect(tabA.enqueueProgressReconcile(SESSION_A, OWNER, NOW).ok).toBe(true);
        expect(tabB.enqueueProgressReconcile(SESSION_B, OWNER, NOW).ok).toBe(true);
        expect(sessionIds(tabA)).toEqual([SESSION_A, SESSION_B]);
    });

    it('CONTROL: both tabs enqueuing the SAME session produce one entry (idempotent)', async () => {
        const tabA = await openTab();
        const tabB = await openTab();
        const hook = interleaveAfterNextQueueRead(() => {
            expect(tabA.enqueueProgressReconcile(SESSION_A, OWNER, NOW).ok).toBe(true);
        });
        expect(tabB.enqueueProgressReconcile(SESSION_A, OWNER, LATER).ok).toBe(true);
        expect(hook.fired()).toBe(true);
        expect(sessionIds(tabA)).toEqual([SESSION_A]);
    });

    it('CONTROL: another account\'s entries are never read or retired by this owner', async () => {
        const tabA = await openTab();
        expect(tabA.enqueueProgressReconcile(SESSION_A, 'owner-other', NOW).ok).toBe(true);
        expect(tabA.enqueueProgressReconcile(SESSION_B, OWNER, NOW).ok).toBe(true);
        expect(tabA.clearProgressReconcileEntry(SESSION_B, OWNER).ok).toBe(true);
        expect(sessionIds(tabA)).toEqual([]);
        const other = tabA.getQueueEntriesForUser('owner-other');
        expect(other.ok && other.entries.map((e) => e.sessionId)).toEqual([SESSION_A]);
    });
});
