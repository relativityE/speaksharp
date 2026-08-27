/* @vitest-environment jsdom */
// #1354 cross-tab/reload slice — Start reads the VERIFIED DURABLE QUEUE fresh on every attempt.
//
// WHY NOT THE STORE. The store gate is per-tab and can be stale. Browser `storage` events notify OTHER
// tabs and never the writer, so a second already-open tab would never see debt another tab queued.
// Enforcement therefore cannot depend on event delivery — it re-reads the durable queue every time.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    evaluateDurableStartGate, evaluateStartGate, startGateMessage,
    reconstructGateFromQueue, subscribeCrossTabProgressGate, PROGRESS_QUEUE_STORAGE_KEY,
} from '../progressStartGate';
import { enqueueProgressReconcile, readProgressReconcileQueue } from '../progressReconcileQueue';

// #1354: point at the canonical export rather than repeating the literal — a test copy is a
// third authority for the same key, free to drift from the one the writer actually uses.
const KEY = PROGRESS_QUEUE_STORAGE_KEY;
const OWNER = 'user-1';
const OTHER = 'user-2';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('durable debt blocks its exact owner only', () => {
    it('no debt allows Start', () => {
        expect(evaluateDurableStartGate(OWNER)).toEqual({ allowed: true });
    });

    it('this owner\'s debt blocks', () => {
        enqueueProgressReconcile('s1', OWNER, 'now');
        expect(evaluateDurableStartGate(OWNER)).toEqual({ allowed: false, reason: 'queued_debt', sessionId: 's1' });
    });

    it('ANOTHER owner\'s debt does not block the current user', () => {
        enqueueProgressReconcile('s-other', OTHER, 'now');
        expect(evaluateDurableStartGate(OWNER)).toEqual({ allowed: true });
        // ...and still blocks the account it belongs to.
        expect(evaluateDurableStartGate(OTHER).allowed).toBe(false);
    });

    it('CROSS-TAB: debt written by another tab blocks WITHOUT any storage event', () => {
        // Simulates a second already-open tab: the queue changed underneath it and no event was
        // delivered to this one. A store-only gate would never notice.
        localStorage.setItem(KEY, JSON.stringify([{ sessionId: 's-elsewhere', userId: OWNER, enqueuedAtIso: 'now' }]));
        expect(evaluateDurableStartGate(OWNER)).toEqual({ allowed: false, reason: 'queued_debt', sessionId: 's-elsewhere' });
    });
});

describe('an unknown owner cannot be scoped', () => {
    it('no owner means no DURABLE verdict — debt belongs to an account', () => {
        // We cannot ask "does this user owe anything" without a user. Blocking here would strand a
        // signed-out or pre-auth surface on another account's debt; the seam already fails closed on a
        // save with no owner (`queue_unavailable`), which is where that case belongs.
        enqueueProgressReconcile('s-someone-else', OTHER, 'now');
        expect(evaluateDurableStartGate(null)).toEqual({ allowed: true });
        expect(evaluateDurableStartGate(undefined)).toEqual({ allowed: true });
    });

    it('but an in-flight gate with no owner still blocks that same ownerless context', () => {
        expect(evaluateStartGate(null, { sessionId: 's1', ownerId: null, state: 'resolving' }))
            .toEqual({ allowed: false, reason: 'in_flight', sessionId: 's1' });
    });
});

describe('unreadable queues FAIL CLOSED', () => {
    it('a corrupt queue blocks', () => {
        localStorage.setItem(KEY, 'not json{');
        expect(evaluateDurableStartGate(OWNER)).toEqual({ allowed: false, reason: 'queue_unreadable', failure: 'corrupt' });
    });

    it('unavailable storage blocks', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        expect(evaluateDurableStartGate(OWNER)).toEqual({ allowed: false, reason: 'queue_unreadable', failure: 'storage_unavailable' });
    });

    it('"we could not tell" is never "there is no debt"', () => {
        localStorage.setItem(KEY, JSON.stringify([{ sessionId: 42 }]));
        expect(evaluateDurableStartGate(OWNER).allowed).toBe(false);
    });
});

describe('in-flight evaluations are owner-scoped', () => {
    it('an in-flight evaluation for THIS owner blocks', () => {
        const v = evaluateStartGate(OWNER, { sessionId: 's1', ownerId: OWNER, state: 'resolving' });
        expect(v).toEqual({ allowed: false, reason: 'in_flight', sessionId: 's1' });
    });

    it('a PREVIOUS account\'s in-flight gate must not block the new owner', () => {
        // Switching accounts must invalidate the former owner's in-flight result.
        expect(evaluateStartGate(OWNER, { sessionId: 's-old', ownerId: OTHER, state: 'resolving' }))
            .toEqual({ allowed: true });
    });

    it('the gate STATE survives into the verdict, so each situation gets its own message', () => {
        // Collapsing resolving/queued/unresolved into one reason lost the actionable distinction.
        const mk = (state: 'resolving' | 'queued' | 'unresolved') =>
            evaluateStartGate(OWNER, { sessionId: 's1', ownerId: OWNER, state });
        expect(mk('resolving')).toEqual({ allowed: false, reason: 'in_flight', sessionId: 's1' });
        expect(mk('queued')).toEqual({ allowed: false, reason: 'queued_debt', sessionId: 's1' });
        expect(mk('unresolved')).toEqual({ allowed: false, reason: 'unresolved_evidence', sessionId: 's1' });
        expect(new Set([
            startGateMessage(mk('resolving')), startGateMessage(mk('queued')), startGateMessage(mk('unresolved')),
        ]).size, 'three distinct messages').toBe(3);
    });

    it('durable debt takes precedence over the in-flight signal', () => {
        enqueueProgressReconcile('s-debt', OWNER, 'now');
        const v = evaluateStartGate(OWNER, { sessionId: 's1', ownerId: OWNER, state: 'resolving' });
        expect(v.allowed).toBe(false);
        expect(v.allowed === false && v.reason).toBe('queued_debt');
    });

    it('an unreadable queue blocks even when nothing is in flight', () => {
        localStorage.setItem(KEY, '{bad');
        expect(evaluateStartGate(OWNER, null).allowed).toBe(false);
    });
});

describe('messages are actionable and content-free', () => {
    it.each([
        [{ allowed: false, reason: 'in_flight', sessionId: 's1' }, /one moment/i],
        [{ allowed: false, reason: 'queued_debt', sessionId: 's1' }, /retry automatically/i],
        [{ allowed: false, reason: 'queue_unreadable', failure: 'corrupt' }, /reload to retry/i],
    ])('%o produces actionable copy', (verdict, re) => {
        const msg = startGateMessage(verdict as never);
        expect(msg).toMatch(re);
        expect(msg).not.toContain('s1');
        expect(msg).not.toContain('user-');
    });

    it('an allowed verdict has no message', () => {
        expect(startGateMessage({ allowed: true })).toBeNull();
    });
});

describe('reload reconstruction and cross-tab reaction', () => {
    it('RELOAD: a queue with debt reconstructs a blocked gate', () => {
        enqueueProgressReconcile('s-debt', OWNER, 'now');
        expect(reconstructGateFromQueue(OWNER)).toEqual({ sessionId: 's-debt', ownerId: OWNER, state: 'queued' });
    });

    it('RELOAD: an empty queue reconstructs no gate', () => {
        expect(reconstructGateFromQueue(OWNER)).toBeNull();
    });

    it('RELOAD: an UNREADABLE queue reconstructs a blocked gate, not an unlocked one', () => {
        localStorage.setItem(KEY, '{corrupt');
        const g = reconstructGateFromQueue(OWNER);
        expect(g?.state).toBe('unresolved');
    });

    it('RELOAD: another owner\'s debt reconstructs nothing for this user', () => {
        enqueueProgressReconcile('s-other', OTHER, 'now');
        expect(reconstructGateFromQueue(OWNER)).toBeNull();
    });

    it('never invents an in-flight state — only durable debt is reconstructable', () => {
        enqueueProgressReconcile('s-debt', OWNER, 'now');
        expect(reconstructGateFromQueue(OWNER)?.state).not.toBe('resolving');
    });

    it('CROSS-TAB: a storage event for the queue key republishes the gate', () => {
        const published: unknown[] = [];
        const unsub = subscribeCrossTabProgressGate(() => OWNER, (g) => published.push(g));
        enqueueProgressReconcile('s-from-other-tab', OWNER, 'now');
        window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
        expect(published).toEqual([{ sessionId: 's-from-other-tab', ownerId: OWNER, state: 'queued' }]);
        unsub();
    });

    it('CROSS-TAB: an unrelated key is ignored', () => {
        const published: unknown[] = [];
        const unsub = subscribeCrossTabProgressGate(() => OWNER, (g) => published.push(g));
        window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }));
        expect(published).toEqual([]);
        unsub();
    });

    it('CROSS-TAB: a whole-storage clear (key === null) is honoured', () => {
        const published: unknown[] = [];
        const unsub = subscribeCrossTabProgressGate(() => OWNER, (g) => published.push(g));
        window.dispatchEvent(new StorageEvent('storage', { key: null }));
        expect(published).toEqual([null]);
        unsub();
    });

    it('CROSS-TAB: unsubscribing stops republishing', () => {
        const published: unknown[] = [];
        const unsub = subscribeCrossTabProgressGate(() => OWNER, (g) => published.push(g));
        unsub();
        window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
        expect(published).toEqual([]);
    });

    it('ENFORCEMENT does not depend on the event: Start blocks even with no listener at all', () => {
        // The writer never receives its own storage event, so a second tab that missed the notification
        // must still be blocked by the fresh durable read.
        enqueueProgressReconcile('s-silent', OWNER, 'now');
        expect(evaluateStartGate(OWNER, null).allowed).toBe(false);
    });
});

describe('#1354: an EMPTY RAW VALUE is unreadable, not an empty queue', () => {
    // THE REACHABLE FAIL-OPEN. The reader used `if (!raw) return { ok: true, entries: [] }`, which
    // treats the empty STRING the same as an absent key. A truncated or partially-written value
    // therefore reported a readable, EMPTY queue — JSON.parse and entry validation never ran — and the
    // durable Start gate unlocked on storage it could not actually read.
    //
    // Verified before fixing: with `''` stored, the read returned ok:true and the gate returned
    // allowed:true. `''` must instead reach JSON.parse, become `corrupt`, and fail closed.
    it('an empty stored value reads as CORRUPT, never as an empty queue', () => {
        localStorage.setItem(KEY, '');
        const res = readProgressReconcileQueue();
        expect(res.ok).toBe(false);
        expect(res.ok ? null : res.failure).toBe('corrupt');
    });

    it('and the durable Start decision therefore BLOCKS', () => {
        localStorage.setItem(KEY, '');
        expect(evaluateDurableStartGate('u1').allowed).toBe(false);
    });

    it('an ABSENT key is still a genuinely empty queue', () => {
        // The guard must narrow to `null` only — it must not start blocking first-run users who have
        // simply never queued anything.
        localStorage.removeItem(KEY);
        expect(readProgressReconcileQueue().ok).toBe(true);
        expect(evaluateDurableStartGate('u1').allowed).toBe(true);
    });
});

describe('#1354: a degenerate queue entry fails CLOSED', () => {
    // HONEST SCOPE. These are CHARACTERIZATION tests. They do NOT close the empty-value fail-open —
    // that is the raw-value case in the describe above, at the reader. This block covers a DIFFERENT
    // and currently UNREACHABLE condition: a blank entry id. Mutating `ids.length > 0` back to
    // `if (ids[0])` fails nothing here, because a blank id makes the reader return `corrupt` before
    // the presence check runs, and whitespace is truthy either way.
    //
    // The `ids.length > 0` form is retained purely as harmless defence in depth — the Start authority
    // should not depend on another module's validation to fail closed — and is deliberately NOT
    // presented as a falsified check.
    it('an entry whose id is blank blocks (via the corrupt-read route)', () => {
        localStorage.setItem(KEY, JSON.stringify([{ sessionId: '', userId: 'u1', enqueuedAtIso: 'x' }]));
        expect(evaluateDurableStartGate('u1').allowed).toBe(false);
    });

    it('an entry whose id is whitespace blocks (via the debt route)', () => {
        localStorage.setItem(KEY, JSON.stringify([{ sessionId: '   ', userId: 'u1', enqueuedAtIso: 'x' }]));
        expect(evaluateDurableStartGate('u1').allowed).toBe(false);
    });
});
