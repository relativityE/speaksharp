/* @vitest-environment jsdom */
// RWT-20 CASUALTY at the product seam — reload with durable Progress debt whose reconciliation keeps failing.
//
// Real-world evidence (Production `1b311f9`, #1432 comment 5658930346): one queued entry blocked Start for ~88
// minutes across two authenticated loads. `useProgressReconciliation` reconstructed the blocked gate on every
// load and drained the queue exactly once, so a failing evaluation left the user locked out indefinitely under
// copy that promised an automatic retry.
//
// This drives the REAL hook, the REAL queue, the REAL store and the REAL gate evaluation. Only the auth/history
// providers and the network are mocked. Time is advanced with fake timers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionStore } from '@/stores/useSessionStore';
import { enqueueProgressReconcile, getQueuedSessionIdsForUser } from '@/services/progress/progressReconcileQueue';
import { evaluateStartGate } from '@/services/progress/progressStartGate';

const OWNER = 'owner-reload';
const SESSION = 'sess-reload-owed';

const authUser: { user: { id: string } | null } = { user: null };
vi.mock('../../contexts/AuthProvider', () => ({ useAuthProvider: () => authUser }));
const history: { data: unknown[] } = { data: [] };
vi.mock('../usePracticeHistory', () => ({ usePracticeHistory: () => history }));
const rpc = vi.fn();
const table = () => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'insert', 'upsert']) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.single = async () => ({ data: null, error: null });
    return chain;
};
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc, from: () => table() }) }));
vi.mock('@/lib/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}));

const { useProgressReconciliation } = await import('../useProgressReconciliation');

const gate = () => useSessionStore.getState().progressGate;
const evalCalls = () => rpc.mock.calls.filter((c) => c[0] === 'record_progress_evaluation').length;
/** Well past any reasonable bound, far short of the 88 minutes observed in Production. */
const TWO_MINUTES = 120_000;

beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    rpc.mockReset();
    authUser.user = null;
    history.data = [];
    useSessionStore.getState().setProgressGate(null);
    useSessionStore.getState().setProgressGateResolvedFor(null);
});
afterEach(() => { vi.useRealTimers(); });

async function reloadWithDebt() {
    expect(enqueueProgressReconcile(SESSION, OWNER, new Date(Date.now() - 60_000).toISOString()).ok).toBe(true);
    authUser.user = { id: OWNER };
    history.data = [{ id: SESSION, status: 'completed', attribution_status: 'verified', created_at: new Date().toISOString() }];
    renderHook(() => useProgressReconciliation());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

describe('RWT-20 — a failing reconciliation must not lock Start indefinitely', () => {
    it('save → reload → failed reconciliation → retry → terminal release of Start, debt preserved', async () => {
        rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'still failing' } });
        await reloadWithDebt();

        // The reload publishes the blocked gate from durable debt (#1354 behaviour, unchanged).
        expect(gate()).toMatchObject({ sessionId: SESSION, ownerId: OWNER, state: 'queued' });

        await act(async () => { await vi.advanceTimersByTimeAsync(TWO_MINUTES); });

        // Retried in-page — not exactly once per load.
        expect(evalCalls()).toBeGreaterThan(1);
        // Start is released for the controller's own decision, not just the rendered cue…
        expect(gate()).toBeNull();
        expect(evaluateStartGate(OWNER, gate()).allowed).toBe(true);
        // …and the unresolved debt is still durable.
        expect(getQueuedSessionIdsForUser(OWNER).sessionIds).toEqual([SESSION]);
    });

    it('POSITIVE CONTROL: a reconciliation that succeeds clears the debt and releases Start', async () => {
        rpc.mockResolvedValue({ data: 'eval-1', error: null });
        await reloadWithDebt();
        await act(async () => { await vi.advanceTimersByTimeAsync(TWO_MINUTES); });

        expect(gate()).toBeNull();
        expect(evaluateStartGate(OWNER, gate()).allowed).toBe(true);
        expect(getQueuedSessionIdsForUser(OWNER).sessionIds).toEqual([]);
    });
});
