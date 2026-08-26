/* @vitest-environment jsdom */
// #1354 subtask A — the queue reports VERIFIED results, and `queued` is only claimable when the debt
// is genuinely durable.
//
// THE DEFECT THIS CLOSES. Every operation returned `void` and the storage writer swallowed failures, so
// holding a `userId` did not prove anything was queued. `queued` therefore promised a retry that might
// never have been recorded. Separately, the reader returned `[]` for BOTH "no storage" and "corrupt
// contents", making an unreadable queue indistinguishable from an empty one — the same silent-empty
// class that hid two earlier defects in this ticket.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    enqueueProgressReconcile, clearProgressReconcileEntry,
    getQueuedSessionIdsForUser, readProgressReconcileQueue,
} from '../progressReconcileQueue';

const KEY = 'ss_progress_reconcile_queue_v1';
const USER = 'user-1';
const SESSION = 'session-1';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('enqueue is VERIFIED, not assumed', () => {
    it('a successful enqueue is confirmed by readback', () => {
        const r = enqueueProgressReconcile(SESSION, USER, '2026-01-01T00:00:00Z');
        expect(r).toEqual({ ok: true, verified: true });
        expect(getQueuedSessionIdsForUser(USER).sessionIds).toEqual([SESSION]);
    });

    it('an ALREADY-QUEUED entry is a durable success, not a duplicate write', () => {
        enqueueProgressReconcile(SESSION, USER, '2026-01-01T00:00:00Z');
        const again = enqueueProgressReconcile(SESSION, USER, '2026-01-02T00:00:00Z');
        expect(again).toEqual({ ok: true, verified: true });
        expect(getQueuedSessionIdsForUser(USER).sessionIds).toEqual([SESSION]); // idempotent
    });

    it('a WRITE FAILURE is reported, never swallowed', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
        const r = enqueueProgressReconcile(SESSION, USER, '2026-01-01T00:00:00Z');
        expect(r.ok).toBe(false);
        expect(r.ok === false && r.failure).toBe('write_failed');
    });

    it('a write that does not READ BACK is reported as readback_failed', () => {
        // The write appears to succeed but the entry is not actually there — a silently dropped write.
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { /* accepted and discarded */ });
        const r = enqueueProgressReconcile(SESSION, USER, '2026-01-01T00:00:00Z');
        expect(r.ok).toBe(false);
        expect(r.ok === false && r.failure).toBe('readback_failed');
    });

    it('a CORRUPT queue blocks enqueue rather than overwriting unknown debts', () => {
        localStorage.setItem(KEY, '{not json');
        const r = enqueueProgressReconcile(SESSION, USER, '2026-01-01T00:00:00Z');
        expect(r.ok).toBe(false);
        expect(r.ok === false && r.failure).toBe('corrupt');
    });

    it('a missing session or user cannot be queued', () => {
        expect(enqueueProgressReconcile('', USER, 'now').ok).toBe(false);
        expect(enqueueProgressReconcile(SESSION, '', 'now').ok).toBe(false);
    });
});

describe('reads distinguish UNAVAILABLE and CORRUPT from EMPTY', () => {
    it('an empty queue is ok with no entries', () => {
        expect(readProgressReconcileQueue()).toEqual({ ok: true, entries: [] });
    });

    it('unparseable contents are CORRUPT, not empty', () => {
        localStorage.setItem(KEY, 'nonsense{');
        expect(readProgressReconcileQueue()).toEqual({ ok: false, failure: 'corrupt' });
    });

    it('a non-array payload is CORRUPT, not empty', () => {
        localStorage.setItem(KEY, JSON.stringify({ sessionId: SESSION }));
        expect(readProgressReconcileQueue()).toEqual({ ok: false, failure: 'corrupt' });
    });

    it('ONE malformed entry makes the whole read corrupt — a dropped entry is a lost debt', () => {
        localStorage.setItem(KEY, JSON.stringify([
            { sessionId: SESSION, userId: USER, enqueuedAtIso: 'x' },
            { sessionId: 42 },
        ]));
        expect(readProgressReconcileQueue()).toEqual({ ok: false, failure: 'corrupt' });
    });

    it('a throwing getItem is storage_unavailable, not empty', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        expect(readProgressReconcileQueue()).toEqual({ ok: false, failure: 'storage_unavailable' });
    });

    it('an unreadable queue does not report session ids', () => {
        localStorage.setItem(KEY, 'nope{');
        const r = getQueuedSessionIdsForUser(USER);
        expect(r.ok).toBe(false);
        expect(r.sessionIds).toBeUndefined();
    });

    it('reads stay owner-scoped', () => {
        enqueueProgressReconcile(SESSION, USER, 'now');
        enqueueProgressReconcile('other-session', 'user-2', 'now');
        expect(getQueuedSessionIdsForUser(USER).sessionIds).toEqual([SESSION]);
        expect(getQueuedSessionIdsForUser('user-2').sessionIds).toEqual(['other-session']);
    });
});

describe('clear is VERIFIED', () => {
    it('removing an entry is confirmed by readback', () => {
        enqueueProgressReconcile(SESSION, USER, 'now');
        expect(clearProgressReconcileEntry(SESSION, USER)).toEqual({ ok: true, verified: true });
        expect(getQueuedSessionIdsForUser(USER).sessionIds).toEqual([]);
    });

    it('clearing something absent is a success — there is no debt to remove', () => {
        expect(clearProgressReconcileEntry(SESSION, USER)).toEqual({ ok: true, verified: true });
    });

    it('a FAILED clear is reported, so a stale debt is never assumed gone', () => {
        enqueueProgressReconcile(SESSION, USER, 'now');
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
        const r = clearProgressReconcileEntry(SESSION, USER);
        expect(r.ok).toBe(false);
        expect(r.ok === false && r.failure).toBe('write_failed');
    });

    it('clear only removes the MATCHING owner/session pair', () => {
        enqueueProgressReconcile(SESSION, USER, 'now');
        enqueueProgressReconcile(SESSION, 'user-2', 'now');
        clearProgressReconcileEntry(SESSION, USER);
        expect(getQueuedSessionIdsForUser(USER).sessionIds).toEqual([]);
        expect(getQueuedSessionIdsForUser('user-2').sessionIds).toEqual([SESSION]);
    });
});
