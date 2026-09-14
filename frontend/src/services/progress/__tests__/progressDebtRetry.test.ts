/* @vitest-environment jsdom */
// RWT-20 — durable Progress debt must never lock Start indefinitely.
//
// THE DEFECT (real-world test on Production `1b311f9`, #1432 comments 5658786744 / 5658930346). One queue entry
// left by a saved take blocked Start for ~88 minutes across two authenticated page loads. The card promised
// "this will retry automatically", but the queue was drained ONCE per page load and never again: no retry, no
// terminal state, no telemetry. Every later load reconstructed the same blocked gate.
//
// THE CONTRACT these casualties hold:
//   1. reconciliation retries in-page with a BOUNDED, observable backoff;
//   2. after the bound there is ONE honest terminal state (released), persisted so a reload, the controller and
//      another tab all agree;
//   3. Start becomes available while the unresolved debt stays DURABLE and is still retried on later loads;
//   4. enqueue / attempt / success / failure / release are reported content-free, with a safe reason and age/latency.
//
// FAKE TIMERS ARE DELIBERATE: the schedule spans tens of seconds of backoff; time is advanced explicitly.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSessionStore } from '@/stores/useSessionStore';

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

const { analyticsBuffer } = await import('@/services/AnalyticsBuffer');
const { projectEventProps } = await import('@/services/telemetryAllowlist');
const {
    enqueueProgressReconcile, getQueuedSessionIdsForUser, readProgressReconcileQueue, PROGRESS_QUEUE_STORAGE_KEY,
} = await import('../progressReconcileQueue');
const { evaluateStartGate, reconstructGateFromQueue } = await import('../progressStartGate');
const { reconcileProgressEvaluations, wireProgressEvaluationOnSave } = await import('../recordProgress');
const {
    scheduleProgressDebtRetry, PROGRESS_DEBT_RETRY_DELAYS_MS, PROGRESS_DEBT_RELEASE_BOUND_MS,
    __resetProgressDebtRetryForTests,
} = await import('../progressDebtRetry');

const OWNER = 'owner-rwt20';
const OTHER = 'owner-other';
const SESSION = 'sess-rwt20-owed';
const ERROR_TEXT = 'db said something private';

const gate = () => useSessionStore.getState().progressGate;
const evalCalls = () => rpc.mock.calls.filter((c) => c[0] === 'record_progress_evaluation').length;
const failRpc = () => rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: ERROR_TEXT } });
const succeedRpc = () => rpc.mockResolvedValue({ data: 'eval-1', error: null });
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

let pushSpy: ReturnType<typeof vi.spyOn>;
const debtEvents = () => pushSpy.mock.calls
    .filter((c) => c[0] === 'progress_debt')
    .map((c) => (c[1] ?? {}) as Record<string, unknown>);
const entryFor = (sessionId: string) => {
    const read = readProgressReconcileQueue();
    if (!read.ok) throw new Error('queue unreadable in test');
    return read.entries.find((e) => e.sessionId === sessionId) as Record<string, unknown> | undefined;
};

/** The exact post-reload state: durable debt plus the gate `useProgressReconciliation` reconstructs from it. */
function arrangeReloadWithDebt(sessionId = SESSION, owner = OWNER) {
    expect(enqueueProgressReconcile(sessionId, owner, new Date(Date.now() - 60_000).toISOString()).ok).toBe(true);
    useSessionStore.getState().setProgressGate(reconstructGateFromQueue(owner));
    expect(gate()).toMatchObject({ sessionId, ownerId: owner, state: 'queued' });
}

beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    rpc.mockReset();
    __resetProgressDebtRetryForTests();
    useSessionStore.getState().setProgressGate(null);
    pushSpy = vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => undefined);
});
afterEach(() => {
    pushSpy.mockRestore();
    vi.useRealTimers();
});

describe('RWT-20 casualty — save → reload → failed reconciliation → retry → terminal release', () => {
    it('releases Start after the bounded retries while the unresolved debt stays durable', async () => {
        arrangeReloadWithDebt();
        failRpc();

        // The one on-load reconciliation round fails: Start is still (correctly) blocked at this point.
        await reconcileProgressEvaluations(OWNER, []);
        expect(evaluateStartGate(OWNER, gate()).allowed).toBe(false);

        const run = scheduleProgressDebtRetry(OWNER);
        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RELEASE_BOUND_MS);
        const result = await run;

        // Retried IN-PAGE on the declared schedule, not once per load.
        expect(evalCalls()).toBe(1 + PROGRESS_DEBT_RETRY_DELAYS_MS.length);
        expect(result).toMatchObject({ resolved: 0, released: 1 });

        // ONE honest terminal state: Start is available — for the controller, the UI and a reload alike.
        expect(evaluateStartGate(OWNER, gate()).allowed).toBe(true);
        expect(gate()).toBeNull();
        expect(reconstructGateFromQueue(OWNER)).toBeNull();

        // …while the debt itself is NOT dropped.
        expect(getQueuedSessionIdsForUser(OWNER).sessionIds).toEqual([SESSION]);
        const entry = entryFor(SESSION);
        expect(typeof entry?.releasedAtIso).toBe('string');
        expect(entry?.attempts).toBe(1 + PROGRESS_DEBT_RETRY_DELAYS_MS.length);

        const phases = debtEvents().map((e) => e.phase);
        expect(phases.filter((p) => p === 'attempt_failed')).toHaveLength(1 + PROGRESS_DEBT_RETRY_DELAYS_MS.length);
        expect(phases.filter((p) => p === 'released')).toHaveLength(1);
        expect(phases).not.toContain('attempt_succeeded');
    });

    it('is BOUNDED: nothing is released before the last scheduled retry, and release lands at the bound', async () => {
        arrangeReloadWithDebt();
        failRpc();

        const run = scheduleProgressDebtRetry(OWNER);
        await vi.advanceTimersByTimeAsync(sum(PROGRESS_DEBT_RETRY_DELAYS_MS) - 1);
        expect(gate()).toMatchObject({ sessionId: SESSION, state: 'queued' });
        expect(debtEvents().some((e) => e.phase === 'released')).toBe(false);

        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RELEASE_BOUND_MS);
        await run;
        expect(gate()).toBeNull();
        expect(PROGRESS_DEBT_RELEASE_BOUND_MS).toBeGreaterThanOrEqual(sum(PROGRESS_DEBT_RETRY_DELAYS_MS));
        expect(PROGRESS_DEBT_RELEASE_BOUND_MS).toBeLessThanOrEqual(120_000);
    });

    it('a retry that SUCCEEDS mid-schedule resolves the debt, releases Start, and stops retrying', async () => {
        arrangeReloadWithDebt();
        rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: ERROR_TEXT } });
        succeedRpc();

        const run = scheduleProgressDebtRetry(OWNER);
        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RETRY_DELAYS_MS[0] + PROGRESS_DEBT_RETRY_DELAYS_MS[1]);
        const callsAtResolution = evalCalls();
        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RELEASE_BOUND_MS);
        const result = await run;

        expect(result).toMatchObject({ resolved: 1, released: 0 });
        expect(getQueuedSessionIdsForUser(OWNER).sessionIds).toEqual([]);
        expect(gate()).toBeNull();
        expect(evalCalls()).toBe(callsAtResolution);
        const phases = debtEvents().map((e) => e.phase);
        expect(phases).toContain('attempt_succeeded');
        expect(phases).not.toContain('released');
    });
});

describe('RWT-20 — unresolved debt stays durable after release', () => {
    it('released debt is retried on the next load and cleared ONLY when the evaluation succeeds', async () => {
        arrangeReloadWithDebt();
        failRpc();
        const run = scheduleProgressDebtRetry(OWNER);
        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RELEASE_BOUND_MS);
        await run;
        expect(typeof entryFor(SESSION)?.releasedAtIso).toBe('string');

        // Next load, still failing: the entry survives and Start is NOT re-locked.
        const before = evalCalls();
        await reconcileProgressEvaluations(OWNER, []);
        expect(evalCalls()).toBe(before + 1);
        expect(getQueuedSessionIdsForUser(OWNER).sessionIds).toEqual([SESSION]);
        expect(evaluateStartGate(OWNER, reconstructGateFromQueue(OWNER)).allowed).toBe(true);

        // A later load that succeeds finally retires it.
        succeedRpc();
        const drained = await reconcileProgressEvaluations(OWNER, []);
        expect(drained.queueDrained).toBe(1);
        expect(getQueuedSessionIdsForUser(OWNER).sessionIds).toEqual([]);
    });

    it('a NEW unreleased debt still blocks Start even when an older released one exists', async () => {
        arrangeReloadWithDebt();
        failRpc();
        const run = scheduleProgressDebtRetry(OWNER);
        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RELEASE_BOUND_MS);
        await run;

        expect(enqueueProgressReconcile('sess-newer', OWNER, new Date().toISOString()).ok).toBe(true);
        const verdict = evaluateStartGate(OWNER, null);
        expect(verdict).toMatchObject({ allowed: false, reason: 'queued_debt', sessionId: 'sess-newer' });
    });

    it('an UNREADABLE queue still fails closed — RWT-20 releases only real queued debt', async () => {
        localStorage.setItem(PROGRESS_QUEUE_STORAGE_KEY, '{not json');
        failRpc();
        const run = scheduleProgressDebtRetry(OWNER);
        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RELEASE_BOUND_MS);
        const result = await run;

        expect(result).toMatchObject({ resolved: 0, released: 0 });
        expect(evaluateStartGate(OWNER, null)).toMatchObject({ allowed: false, reason: 'queue_unreadable' });
    });

    it('another owner\'s debt is neither retried nor released by this owner\'s schedule', async () => {
        arrangeReloadWithDebt(SESSION, OTHER);
        useSessionStore.getState().setProgressGate(null);
        failRpc();
        const run = scheduleProgressDebtRetry(OWNER);
        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RELEASE_BOUND_MS);
        await run;

        expect(evalCalls()).toBe(0);
        expect(entryFor(SESSION)?.releasedAtIso).toBeUndefined();
        expect(evaluateStartGate(OTHER, null)).toMatchObject({ allowed: false, reason: 'queued_debt' });
    });
});

describe('RWT-20 — single flight', () => {
    it('concurrent triggers share one schedule instead of multiplying attempts', async () => {
        arrangeReloadWithDebt();
        failRpc();
        const a = scheduleProgressDebtRetry(OWNER);
        const b = scheduleProgressDebtRetry(OWNER);
        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RELEASE_BOUND_MS);
        await Promise.all([a, b]);

        expect(evalCalls()).toBe(PROGRESS_DEBT_RETRY_DELAYS_MS.length);
        expect(debtEvents().filter((e) => e.phase === 'released')).toHaveLength(1);
    });
});

describe('RWT-20 — telemetry is observable AND content-free', () => {
    it('every progress_debt event survives the governed schema and carries no ids or error text', async () => {
        arrangeReloadWithDebt();
        failRpc();
        const run = scheduleProgressDebtRetry(OWNER);
        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RELEASE_BOUND_MS);
        await run;

        const events = debtEvents();
        expect(events.length).toBeGreaterThan(0);
        for (const props of events) {
            const { dropped } = projectEventProps('progress_debt', props);
            expect(dropped).toEqual([]);
            const wire = JSON.stringify(props);
            expect(wire).not.toContain(SESSION);
            expect(wire).not.toContain(OWNER);
            expect(wire).not.toContain(ERROR_TEXT);
            expect(typeof props.age_ms).toBe('number');
        }
        const failed = events.find((e) => e.phase === 'attempt_failed');
        expect(failed).toMatchObject({ trigger: 'retry', reason: 'rpc_error' });
        expect(typeof failed?.latency_ms).toBe('number');
        expect(typeof failed?.attempt).toBe('number');
    });

    it('a save whose evaluation fails reports the durable debt as ENQUEUED (content-free)', async () => {
        failRpc();
        const pending = wireProgressEvaluationOnSave({
            sessionId: SESSION, status: 'completed', attributionStatus: 'verified', metricsPersisted: true, userId: OWNER,
        });
        await vi.advanceTimersByTimeAsync(5_000);
        const outcome = await pending;

        expect(outcome).toEqual({ kind: 'queued' });
        const enqueued = debtEvents().filter((e) => e.phase === 'enqueued');
        expect(enqueued).toHaveLength(1);
        expect(enqueued[0]).toMatchObject({ trigger: 'save', reason: 'rpc_error' });
        expect(projectEventProps('progress_debt', enqueued[0]).dropped).toEqual([]);
    });

    it('a save whose evaluation SUCCEEDS reports no debt at all', async () => {
        succeedRpc();
        const pending = wireProgressEvaluationOnSave({
            sessionId: SESSION, status: 'completed', attributionStatus: 'verified', metricsPersisted: true, userId: OWNER,
        });
        await vi.advanceTimersByTimeAsync(5_000);
        expect(await pending).toEqual({ kind: 'recorded' });
        expect(debtEvents()).toEqual([]);
    });
});
