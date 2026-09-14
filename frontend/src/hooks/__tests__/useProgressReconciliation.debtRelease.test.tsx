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
import {
    enqueueProgressReconcile, getQueuedSessionIdsForUser, PROGRESS_QUEUE_STORAGE_KEY,
} from '@/services/progress/progressReconcileQueue';
import { evaluateStartGate } from '@/services/progress/progressStartGate';
import type { ProgressEvaluationOutcome } from '@/services/progress/recordProgress';

const OWNER = 'owner-reload';
const OTHER = 'owner-other';
const SESSION = 'sess-reload-owed';

const authUser: { user: { id: string } | null } = { user: null };
vi.mock('../../contexts/AuthProvider', () => ({ useAuthProvider: () => authUser }));
const history: { data: unknown[] } = { data: [] };
vi.mock('../usePracticeHistory', () => ({ usePracticeHistory: () => history }));
const rpc = vi.fn();
/** Recommendation reconciliations started (each begins by reading `progress_recommendations`). */
let recommendationReads = 0;
const table = (name?: string) => {
    if (name === 'progress_recommendations') recommendationReads++;
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'insert', 'upsert']) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.single = async () => ({ data: null, error: null });
    return chain;
};
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc, from: (name: string) => table(name) }) }));
vi.mock('@/lib/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}));

const { useProgressReconciliation } = await import('../useProgressReconciliation');
const { wireProgressEvaluationOnSave, progressOutcomeAllowsNextRecording } = await import('@/services/progress/recordProgress');
const {
    scheduleProgressDebtRetry, PROGRESS_DEBT_ATTEMPT_BUDGET, __resetProgressDebtRetryForTests,
} = await import('@/services/progress/progressDebtRetry');
const { analyticsBuffer } = await import('@/services/AnalyticsBuffer');

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
    __resetProgressDebtRetryForTests();
    recommendationReads = 0;
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

// Codex P1 4003102441 on 43386de2: tab B can clear a debt while tab A is still evaluating it. A's late `queued` result is
// then published, the follow-on schedule finds nothing owed and returns, and nothing rebuilds the visible gate — so the
// controller's `evaluateStartGate` blocks Start on that stale in-memory gate forever, although nothing is owed.
describe('RWT-20 — a settled retry schedule rebuilds the visible gate from the durable queue', () => {
    const failed = { data: null, error: { code: 'XX000', message: 'still failing' } };
    const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

    /** Tab A's controller: the exact publication rule of `SpeechRuntimeController.applyProgressGate`. */
    function applyProgressGateAsController(sessionId: string, owner: string, outcome: ProgressEvaluationOutcome): boolean {
        const store = useSessionStore.getState();
        const live = store.progressGate;
        const isOurs = !!live && live.sessionId === sessionId && live.ownerId === owner;
        if (progressOutcomeAllowsNextRecording(outcome)) {
            if (isOurs) store.setProgressGate(null);
            return false;
        }
        if (live && !isOurs) return false;
        store.setProgressGate({ sessionId, ownerId: owner, state: outcome.kind === 'queued' ? 'queued' : 'unresolved' });
        return true;
    }

    async function mountFor(owner: string) {
        authUser.user = { id: owner };
        const hook = renderHook(() => useProgressReconciliation());
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        return hook;
    }

    it('tab B clears the debt while tab A is evaluating; A\'s late `queued` result does not lock Start', async () => {
        const push = vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => undefined);
        await mountFor(OWNER);
        expect(gate()).toBeNull();

        let evaluationCalls = 0;
        rpc.mockImplementation((name: string) => {
            if (name !== 'record_progress_evaluation') return Promise.resolve({ data: null, error: null });
            evaluationCalls++;
            // Call 2 is tab B's retry and succeeds. Tab A's own save attempts never settle; each ends at its deadline.
            return evaluationCalls === 2 ? Promise.resolve({ data: 'eval-1', error: null }) : new Promise(() => {});
        });

        // Tab A: the controller marks the save in flight, then the real save path writes the obligation and evaluates.
        useSessionStore.getState().setProgressGate({ sessionId: SESSION, ownerId: OWNER, state: 'resolving' });
        let published = false;
        void wireProgressEvaluationOnSave({
            sessionId: SESSION, status: 'completed', attributionStatus: 'verified', metricsPersisted: true, userId: OWNER,
        }).then((outcome) => {
            expect(outcome).toEqual({ kind: 'queued' });
            published = applyProgressGateAsController(SESSION, OWNER, outcome);
        });
        expect(getQueuedSessionIdsForUser(OWNER).sessionIds).toEqual([SESSION]);

        // Tab B: its retry succeeds and clears the durable entry. (In a real second tab, A's storage listener rebuilds A's
        // gate from the emptied queue; here the shared store reaches the same null through B's gate release.)
        void scheduleProgressDebtRetry(OWNER);
        await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
        expect(getQueuedSessionIdsForUser(OWNER).sessionIds).toEqual([]);
        expect(gate()).toBeNull();

        // Tab A's three attempts time out; it publishes its earlier `queued` result, and the hook's schedule settles.
        await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
        expect(published).toBe(true);

        expect(getQueuedSessionIdsForUser(OWNER).sessionIds).toEqual([]);
        expect(gate()).toBeNull();
        expect(evaluateStartGate(OWNER, gate()).allowed).toBe(true);
        const phases = push.mock.calls.filter((c) => c[0] === 'progress_debt').map((c) => (c[1] as { phase?: string }).phase);
        expect(phases.filter((p) => p === 'attempt_succeeded')).toHaveLength(1);
        expect(recommendationReads).toBe(1);
        push.mockRestore();
    });

    it('debt still blocking when the schedule settles keeps the visible gate on that debt', async () => {
        await mountFor(OWNER);
        // Another tab's debt has spent its budget, and this tab cannot record its release: it keeps blocking.
        localStorage.setItem(PROGRESS_QUEUE_STORAGE_KEY, JSON.stringify([{
            sessionId: 'sess-newer', userId: OWNER, enqueuedAtIso: iso(3_600_000),
            attempts: PROGRESS_DEBT_ATTEMPT_BUDGET, lastAttemptAtIso: iso(600_000),
        }]));
        const realSet = Storage.prototype.setItem;
        const refuseRelease = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
            if (key === PROGRESS_QUEUE_STORAGE_KEY && value.includes('releasedAtIso')) throw new Error('quota exceeded');
            return realSet.call(this, key, value);
        });

        act(() => { expect(applyProgressGateAsController(SESSION, OWNER, { kind: 'queued' })).toBe(true); });
        await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
        refuseRelease.mockRestore();

        expect(gate()).toMatchObject({ sessionId: 'sess-newer', ownerId: OWNER, state: 'queued' });
        expect(evaluateStartGate(OWNER, gate())).toMatchObject({ allowed: false, sessionId: 'sess-newer' });
    });

    it('an unreadable queue when the schedule settles leaves Start fail-closed as unresolved', async () => {
        await mountFor(OWNER);
        localStorage.setItem(PROGRESS_QUEUE_STORAGE_KEY, '{not json');

        act(() => { expect(applyProgressGateAsController(SESSION, OWNER, { kind: 'queued' })).toBe(true); });
        await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

        expect(gate()).toMatchObject({ ownerId: OWNER, state: 'unresolved' });
        expect(evaluateStartGate(OWNER, gate()).allowed).toBe(false);
    });

    it('a settlement that outlives its owner publishes nothing for that owner', async () => {
        const { rerender } = await mountFor(OWNER);
        rpc.mockResolvedValue(failed);
        expect(enqueueProgressReconcile(SESSION, OWNER, iso(0)).ok).toBe(true);
        act(() => { expect(applyProgressGateAsController(SESSION, OWNER, { kind: 'queued' })).toBe(true); });
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });

        // The account switches before OWNER's schedule settles; OTHER owes nothing.
        authUser.user = { id: OTHER };
        rerender();
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });
        expect(gate()).toBeNull();

        // OWNER's schedule then settles with a non-empty answer (its queue became unreadable before the next retry).
        localStorage.setItem(PROGRESS_QUEUE_STORAGE_KEY, '{not json');
        await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

        expect(gate()?.ownerId ?? null).not.toBe(OWNER);
    });
});
