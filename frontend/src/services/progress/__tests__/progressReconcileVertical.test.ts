/* @vitest-environment jsdom */
// #1354 ACCEPTANCE CASE 3 (VERTICAL) — the real save-failure-to-reconciliation journey.
//
// WHY THIS FILE EXISTS SEPARATELY FROM progressReconcileGate.test.ts. Those tests begin from a
// manually enqueued debt and a manually published gate, so they prove reconciliation behaviour but
// NOT the acceptance journey: nothing there shows that the real completion path actually CREATES a
// readback-verified debt for the exact owner/session, or that the gate the user sees comes from the
// production seam rather than the test's own hand.
//
// Here the ONLY seam that is mocked is the Supabase client. `wireProgressEvaluationOnSave`,
// `recordProgressEvaluationWithRetry`, the durable queue, the controller's completion path, the
// controller's Start guard and the reconciler all run for real.
//
// REAL TIMERS ARE DELIBERATE. `recordProgressEvaluationWithRetry` backs off with a real
// `setTimeout` (250ms then 500ms), so exhausting the three bounded attempts costs ~750ms of genuine
// production backoff. This file must therefore NEVER install fake timers, and must never be folded
// into the fake-timer controller suite — awaiting that real backoff under fake timers hangs the test
// and poisons every test after it. Nothing here sleeps or asserts on wall-clock duration; every wait
// is an await on a production promise.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpeechRuntimeController } from '../../SpeechRuntimeController';
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
vi.mock('@/lib/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}));

const { reconcileProgressEvaluations } = await import('../recordProgress');
const { getQueuedSessionIdsForUser } = await import('../progressReconcileQueue');

const OWNER = 'user-vertical-1';
const SESSION = 'sess-vertical-1';

/** The real completion path and the real Start guard, on a genuine prototype instance. */
interface Ctl {
    startRecording: () => Promise<void>;
    ensureReady: ReturnType<typeof vi.fn>;
    completeProgressForRecording: (
        ctx: { mode: 'open_mic' },
        sessionId: string,
        attributionStatus: string | undefined,
        metricsPersisted: boolean,
    ) => Promise<{ kind: string; reason?: string }>;
}
function makeController(userId: string | null): Ctl {
    const c = Object.create(SpeechRuntimeController.prototype) as unknown as Ctl;
    const raw = c as unknown as Record<string, unknown>;
    raw.capturedUserId = userId;
    raw.pendingAttributionRetry = null;
    raw.pendingFullSaveRetry = null;
    raw.recordingStartedUnresolved = false;
    c.ensureReady = vi.fn().mockResolvedValue(undefined);
    return c;
}

/** Count every transition of the visible gate from blocked to released — an unlock. */
function countUnlocks(): () => number {
    let unlocks = 0;
    let previous = useSessionStore.getState().progressGate;
    const stop = useSessionStore.subscribe((s) => {
        const next = s.progressGate;
        if (previous && !next) unlocks += 1;
        previous = next;
    });
    return () => { stop(); return unlocks; };
}

const evalCalls = () => rpc.mock.calls.filter(([fn]) => fn === 'record_progress_evaluation');

beforeEach(() => {
    localStorage.clear();
    rpc.mockReset();
    useSessionStore.getState().setProgressGate(null);
});

describe('a real Progress failure creates durable debt, blocks Start, and one real retry unlocks', () => {
    it('drives save failure to reconciliation and unlocks exactly once', async () => {
        const controller = makeController(OWNER);
        const unlocks = countUnlocks();

        // ── 1. The real completion path, with metrics ALREADY durably persisted and attribution
        // terminal. Only the Progress evaluation RPC fails, so the session and its metrics are
        // untouched by what follows.
        rpc.mockResolvedValue({ data: null, error: { message: 'transient' } });

        const outcome = await controller.completeProgressForRecording(
            { mode: 'open_mic' }, SESSION, 'verified', true,
        );

        // Exactly the three bounded attempts were spent — no more, no fewer.
        expect(evalCalls()).toHaveLength(3);
        expect(outcome.kind, 'a verified durable debt is `queued`, never `recorded`').toBe('queued');

        // The save journey issued NO compensating or rollback call: the only RPC the Progress failure
        // provoked was the evaluation itself, so the saved session and metrics remain durable.
        expect(rpc.mock.calls.every(([fn]) => fn === 'record_progress_evaluation')).toBe(true);

        // ── 2. The debt is REAL and readback-verified, for this exact owner and session.
        const queued = getQueuedSessionIdsForUser(OWNER);
        expect(queued.ok).toBe(true);
        expect(queued.sessionIds).toEqual([SESSION]);
        expect(getQueuedSessionIdsForUser('someone-else').sessionIds ?? []).toEqual([]);

        // ── 3. The gate the USER sees was published by the production seam, not by this test.
        expect(useSessionStore.getState().progressGate).toMatchObject({
            sessionId: SESSION, ownerId: OWNER, state: 'queued',
        });

        // ── 4. Direct Start is refused BEFORE any recording side effect — a disabled button is a cue,
        // not a gate, so this drives the real controller entry.
        await controller.startRecording();
        expect(useSessionStore.getState().sttStatus.type).toBe('error');
        expect(useSessionStore.getState().sttStatus.message ?? '').toMatch(/retry|couldn.t finish saving/i);
        expect(controller.ensureReady, 'Start must not reach any lifecycle work').not.toHaveBeenCalled();

        // ── 5. The REAL reconciler, with the evaluation now succeeding.
        rpc.mockResolvedValue({ data: 'eval-vertical-1', error: null });
        const result = await reconcileProgressEvaluations(OWNER, []);

        // One terminal evaluation, a VERIFIED exact-debt clear, and the same-tab gate released.
        expect(result.queueDrained).toBe(1);
        expect(getQueuedSessionIdsForUser(OWNER).sessionIds).toEqual([]);
        expect(useSessionStore.getState().progressGate, 'the writer tab must not stay stale').toBeNull();
        expect(unlocks(), 'exactly one unlock').toBe(1);
    });

    it('CONTROL: a retry that still fails leaves both the debt and the gate blocked', async () => {
        const controller = makeController(OWNER);
        rpc.mockResolvedValue({ data: null, error: { message: 'transient' } });
        await controller.completeProgressForRecording({ mode: 'open_mic' }, SESSION, 'verified', true);

        const unlocks = countUnlocks();
        const result = await reconcileProgressEvaluations(OWNER, []); // still failing
        expect(result.queueDrained).toBe(0);
        expect(getQueuedSessionIdsForUser(OWNER).sessionIds).toEqual([SESSION]);
        expect(useSessionStore.getState().progressGate).toMatchObject({ sessionId: SESSION, state: 'queued' });
        expect(unlocks()).toBe(0);
    });

    it('CONTROL: a successful evaluation whose queue clear FAILS must not drain and must not unlock', async () => {
        const controller = makeController(OWNER);
        rpc.mockResolvedValue({ data: null, error: { message: 'transient' } });
        await controller.completeProgressForRecording({ mode: 'open_mic' }, SESSION, 'verified', true);

        const unlocks = countUnlocks();
        rpc.mockResolvedValue({ data: 'eval-vertical-1', error: null });
        // The entry cannot be removed, so the debt survives the next reload.
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
        const result = await reconcileProgressEvaluations(OWNER, []);
        vi.restoreAllMocks();

        expect(result.queueDrained, 'an unverified clear is not a drain').toBe(0);
        expect(useSessionStore.getState().progressGate, 'must stay blocked').not.toBeNull();
        expect(unlocks()).toBe(0);
    });

    it('CONTROL: an enqueue that cannot be VERIFIED is unresolved, never queued', async () => {
        // `queued` may only be claimed when the entry is confirmed present by readback. A swallowed
        // storage failure here would promise a retry that can never run, and the durable debt the
        // reconciler later drains would not exist at all.
        const controller = makeController(OWNER);
        rpc.mockResolvedValue({ data: null, error: { message: 'transient' } });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });

        const outcome = await controller.completeProgressForRecording(
            { mode: 'open_mic' }, SESSION, 'verified', true,
        );
        vi.restoreAllMocks();

        expect(outcome).toMatchObject({ kind: 'unresolved', reason: 'queue_unavailable' });
        expect(getQueuedSessionIdsForUser(OWNER).sessionIds ?? []).toEqual([]);
        expect(useSessionStore.getState().progressGate).toMatchObject({ sessionId: SESSION, state: 'unresolved' });
    });

    it('CONTROL: without an owner the debt cannot be recorded, so the outcome is unresolved, not queued', async () => {
        // `queued` promises a retry. With no owner there is nowhere to queue, so promising one would be
        // a lie that unblocks nothing safely.
        const controller = makeController(null);
        rpc.mockResolvedValue({ data: null, error: { message: 'transient' } });
        const outcome = await controller.completeProgressForRecording(
            { mode: 'open_mic' }, SESSION, 'verified', true,
        );
        expect(outcome).toMatchObject({ kind: 'unresolved', reason: 'queue_unavailable' });
        expect(useSessionStore.getState().progressGate).toMatchObject({ sessionId: SESSION, state: 'unresolved' });
    });
});
