/* @vitest-environment jsdom */
// #1354 ACCEPTANCE CASE 3 — retry / reconciliation.
//
// A technical Progress failure must keep the session and metrics saved, leave a DURABLE retry item,
// and keep Start blocked. A successful retry must then write or confirm exactly one terminal
// evaluation, clear the matching gate, and re-enable Start — but ONLY after the queue clear is
// VERIFIED. Reporting a drain while the entry is still in storage would unlock the recorder on a debt
// that survives the next reload.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSessionStore } from '@/stores/useSessionStore';

const rpc = vi.fn();
const table = () => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'insert', 'upsert']) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.single = async () => ({ data: null, error: null });
    return chain;
};
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc, from: () => table() }) }));

const { reconcileProgressEvaluations } = await import('../recordProgress');
const { enqueueProgressReconcile, getQueuedSessionIdsForUser } = await import('../progressReconcileQueue');

const OWNER = 'user-1';
const SESSION = 'sess-failed';

beforeEach(() => {
    localStorage.clear();
    rpc.mockReset();
    vi.restoreAllMocks();
    useSessionStore.getState().setProgressGate(null);
});

describe('a successful same-tab retry clears the VISIBLE gate', () => {
    it('reconciliation that records the evaluation clears the queue AND the gate', async () => {
        // Arrange the exact post-failure state: durable debt + a visible blocked gate.
        expect(enqueueProgressReconcile(SESSION, OWNER, 'now').ok).toBe(true);
        useSessionStore.getState().setProgressGate({ sessionId: SESSION, ownerId: OWNER, state: 'queued' });

        rpc.mockResolvedValue({ data: 'eval-1', error: null }); // the retry succeeds

        const result = await reconcileProgressEvaluations(OWNER, []);

        expect(result.queueDrained).toBe(1);
        expect(getQueuedSessionIdsForUser(OWNER).sessionIds).toEqual([]);
        // THE POINT: the user must be able to record again. A stale visible gate strands them.
        expect(useSessionStore.getState().progressGate).toBeNull();
    });

    it('a retry that still FAILS keeps the debt and keeps the gate blocked', async () => {
        expect(enqueueProgressReconcile(SESSION, OWNER, 'now').ok).toBe(true);
        useSessionStore.getState().setProgressGate({ sessionId: SESSION, ownerId: OWNER, state: 'queued' });

        rpc.mockResolvedValue({ data: null, error: null }); // still failing

        const result = await reconcileProgressEvaluations(OWNER, []);

        expect(result.queueDrained).toBe(0);
        expect(getQueuedSessionIdsForUser(OWNER).sessionIds).toEqual([SESSION]);
        expect(useSessionStore.getState().progressGate).toMatchObject({ sessionId: SESSION, state: 'queued' });
    });

    it('an UNVERIFIED queue clear must NOT count as drained and must NOT unlock', async () => {
        // The evaluation succeeded, but the entry could not be removed from storage. The debt survives
        // the next reload, so reporting a clean drain here would unlock on a debt that still exists.
        expect(enqueueProgressReconcile(SESSION, OWNER, 'now').ok).toBe(true);
        useSessionStore.getState().setProgressGate({ sessionId: SESSION, ownerId: OWNER, state: 'queued' });

        rpc.mockResolvedValue({ data: 'eval-1', error: null });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });

        const result = await reconcileProgressEvaluations(OWNER, []);

        expect(result.queueDrained, 'an unverified clear is not a drain').toBe(0);
        expect(useSessionStore.getState().progressGate, 'must stay blocked').not.toBeNull();
    });

    it('reconciliation only clears the gate belonging to THIS owner and session', async () => {
        expect(enqueueProgressReconcile(SESSION, OWNER, 'now').ok).toBe(true);
        // A different session's gate is live; draining SESSION must not unlock it.
        useSessionStore.getState().setProgressGate({ sessionId: 'other-session', ownerId: OWNER, state: 'queued' });

        rpc.mockResolvedValue({ data: 'eval-1', error: null });
        await reconcileProgressEvaluations(OWNER, []);

        expect(useSessionStore.getState().progressGate)
            .toMatchObject({ sessionId: 'other-session', state: 'queued' });
    });

    it('another OWNER\'s reconciliation cannot clear this user\'s gate', async () => {
        expect(enqueueProgressReconcile(SESSION, 'user-2', 'now').ok).toBe(true);
        useSessionStore.getState().setProgressGate({ sessionId: SESSION, ownerId: OWNER, state: 'queued' });

        rpc.mockResolvedValue({ data: 'eval-1', error: null });
        await reconcileProgressEvaluations('user-2', []);

        expect(useSessionStore.getState().progressGate).toMatchObject({ sessionId: SESSION, ownerId: OWNER });
    });
});
