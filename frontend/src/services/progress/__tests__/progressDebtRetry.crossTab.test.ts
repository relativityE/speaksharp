/* @vitest-environment jsdom */
// RWT-20 — Codex P1 4003281159: retry ownership must be single-flight ACROSS TABS.
//
// Two tabs of the same account each run a retry schedule over one durable queue. An in-memory registry is per browsing
// context, so on #1463 head dba93fac both tabs attempted the same debt at once: persisted attempts jumped 0 → 2 → 4, the
// debt was released after two real retry opportunities, and a success produced two success events and two
// recommendation reconciliations.
//
// Each "tab" here loads its OWN module instances (registry, schedules, store, telemetry buffer) via `vi.resetModules()`.
// They share one localStorage, one clock, and one LockManager — as browsing contexts of one origin share Web Locks.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const rpc = vi.fn();
let recommendationReads = 0;
const table = (name: string) => {
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

/** Web Locks `request(name, { ifAvailable: true }, cb)`: grant if free, otherwise call back with `null`; hold until cb settles. */
class SharedLockManager {
    private readonly held = new Set<string>();
    async request(name: string, options: { ifAvailable?: boolean }, callback: (lock: { name: string } | null) => Promise<unknown>) {
        if (this.held.has(name)) {
            if (options.ifAvailable) return callback(null);
            throw new Error('queued lock requests are not modelled');
        }
        this.held.add(name);
        try {
            return await callback({ name });
        } finally {
            this.held.delete(name);
        }
    }
}

const OWNER = 'owner-cross-tab';
const SESSION = 'sess-cross-tab';
const PENDING_MS = 5_000;
const TAB_B_OFFSET_MS = 100;
/** Deterministic allowance for the scheduler's own re-check granularity when measuring the wall-clock Start bound. */
const TIMER_TOLERANCE_MS = 250;

async function openTab() {
    vi.resetModules();
    const { analyticsBuffer } = await import('@/services/AnalyticsBuffer');
    const push = vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => undefined);
    const queue = await import('../progressReconcileQueue');
    const retry = await import('../progressDebtRetry');
    const record = await import('../recordProgress');
    const gate = await import('../progressStartGate');
    const ownership = await import('../progressAttemptOwnership');
    return { push, queue, retry, record, gate, ownership };
}

beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    rpc.mockReset();
    recommendationReads = 0;
    Object.defineProperty(navigator, 'locks', { configurable: true, value: new SharedLockManager() });
});
afterEach(() => {
    Reflect.deleteProperty(navigator, 'locks');
    vi.restoreAllMocks();
    vi.useRealTimers();
});

async function twoTabs(outcome: 'fail' | 'succeed') {
    const tabA = await openTab();
    const tabB = await openTab();
    expect(tabA.retry.scheduleProgressDebtRetry).not.toBe(tabB.retry.scheduleProgressDebtRetry);
    expect(tabA.queue.enqueueProgressReconcile(SESSION, OWNER, new Date(Date.now() - 1_000).toISOString()).ok).toBe(true);

    const t0 = Date.now();
    let inFlight = 0;
    let maxConcurrent = 0;
    rpc.mockImplementation((name: string) => {
        if (name !== 'record_progress_evaluation') return Promise.resolve({ data: null, error: null });
        inFlight++;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        return new Promise((resolve) => setTimeout(() => {
            inFlight--;
            resolve(outcome === 'succeed'
                ? { data: 'eval-1', error: null }
                : { data: null, error: { code: 'XX000', message: 'still failing' } });
        }, PENDING_MS));
    });

    // Tab A (the writer) starts its schedule; tab B starts its own when the storage event reaches it.
    void tabA.retry.scheduleProgressDebtRetry(OWNER);
    await vi.advanceTimersByTimeAsync(TAB_B_OFFSET_MS);
    void tabB.retry.scheduleProgressDebtRetry(OWNER);

    const attemptTimes: number[] = [];
    let attemptsAtRelease = -1;
    let releasedAfter = -1;
    for (let i = 0; i < 480; i++) {
        await vi.advanceTimersByTimeAsync(250);
        const read = tabA.queue.readProgressReconcileQueue();
        const entry = read.ok ? read.entries.find((e) => e.sessionId === SESSION) : undefined;
        const at = entry?.lastAttemptAtIso ? Date.parse(entry.lastAttemptAtIso) - t0 : null;
        if (at !== null && attemptTimes[attemptTimes.length - 1] !== at) attemptTimes.push(at);
        if (releasedAfter < 0 && entry?.releasedAtIso) {
            releasedAfter = Date.now() - t0;
            attemptsAtRelease = entry.attempts ?? 0;
        }
    }
    const phases = [tabA, tabB].flatMap((tab) => tab.push.mock.calls
        .filter((c) => c[0] === 'progress_debt')
        .map((c) => (c[1] as { phase?: string }).phase));
    return { tabA, maxConcurrent, attemptTimes, attemptsAtRelease, releasedAfter, phases };
}

describe('RWT-20 — one tab owns a debt attempt at a time (Codex 4003281159)', () => {
    it('X1 failing debt: tabs never attempt it together, the budget keeps its spacing, and it is released once', async () => {
        const { tabA, maxConcurrent, attemptTimes, attemptsAtRelease, releasedAfter, phases } = await twoTabs('fail');
        const { PROGRESS_DEBT_ATTEMPT_BUDGET, PROGRESS_DEBT_RETRY_DELAYS_MS, PROGRESS_DEBT_RELEASE_BOUND_MS } = tabA.retry;

        expect(maxConcurrent).toBe(1);
        expect(attemptTimes).toHaveLength(PROGRESS_DEBT_ATTEMPT_BUDGET);
        for (let i = 1; i < attemptTimes.length; i++) {
            expect(attemptTimes[i] - attemptTimes[i - 1]).toBeGreaterThanOrEqual(PROGRESS_DEBT_RETRY_DELAYS_MS[i]);
        }
        expect(attemptsAtRelease).toBe(PROGRESS_DEBT_ATTEMPT_BUDGET);
        expect(releasedAfter).toBeGreaterThan(0);
        expect(releasedAfter).toBeLessThanOrEqual(PROGRESS_DEBT_RELEASE_BOUND_MS);
        expect(phases.filter((p) => p === 'attempt_failed')).toHaveLength(PROGRESS_DEBT_ATTEMPT_BUDGET);
        expect(phases.filter((p) => p === 'released')).toHaveLength(1);
    });

    it('X2 succeeding debt: one attempt, one success event and one recommendation reconciliation across both tabs', async () => {
        const { tabA, maxConcurrent, phases } = await twoTabs('succeed');

        expect(maxConcurrent).toBe(1);
        expect(phases.filter((p) => p === 'attempt_succeeded')).toHaveLength(1);
        expect(recommendationReads).toBe(1);
        expect(tabA.queue.getQueuedSessionIdsForUser(OWNER).sessionIds).toEqual([]);
    });

    it('without Web Locks: no crash, and a tab\'s load and retry rounds still never attempt one debt together', async () => {
        // The residual without Web Locks is cross-tab only (P2 #1399 5661248198); same-tab single-flight must hold.
        Reflect.deleteProperty(navigator, 'locks');
        const tab = await openTab();
        expect(tab.queue.enqueueProgressReconcile(SESSION, OWNER, new Date(Date.now() - 1_000).toISOString()).ok).toBe(true);
        let inFlight = 0;
        let maxConcurrent = 0;
        rpc.mockImplementation((name: string) => {
            if (name !== 'record_progress_evaluation') return Promise.resolve({ data: null, error: null });
            inFlight++;
            maxConcurrent = Math.max(maxConcurrent, inFlight);
            return new Promise((resolve) => setTimeout(() => {
                inFlight--;
                resolve({ data: null, error: { code: 'XX000', message: 'still failing' } });
            }, PENDING_MS));
        });

        const load = tab.record.reconcileProgressEvaluations(OWNER, []);
        const schedule = tab.retry.scheduleProgressDebtRetry(OWNER);
        await vi.advanceTimersByTimeAsync(120_000);

        await expect(load).resolves.toMatchObject({ queueDrained: 0 });
        await expect(schedule).resolves.toMatchObject({ released: 1 });
        expect(maxConcurrent).toBe(1);
    });

    // Codex-review P1 on d98d68a7 (PM RETURN 5661399676): another tab's load attempt owned a SPENT debt's lock while this
    // tab's schedule tried to release it. The release came back `skipped`, nothing else was pending, and the schedule
    // returned — leaving the debt unreleased and Start held until reload.
    it('X3 a release that loses the lock to another tab\'s attempt is retried: exactly one release, and Start is allowed', async () => {
        const tabB = await openTab();
        const tabA = await openTab();
        const { PROGRESS_DEBT_ATTEMPT_BUDGET, PROGRESS_DEBT_RELEASE_BOUND_MS } = tabA.retry;
        const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
        localStorage.setItem(tabA.queue.PROGRESS_QUEUE_STORAGE_KEY, JSON.stringify([{
            sessionId: SESSION, userId: OWNER, enqueuedAtIso: iso(3_600_000),
            attempts: PROGRESS_DEBT_ATTEMPT_BUDGET, lastAttemptAtIso: iso(600_000),
        }]));
        rpc.mockImplementation((name: string) => {
            if (name !== 'record_progress_evaluation') return Promise.resolve({ data: null, error: null });
            return new Promise((resolve) => setTimeout(() => resolve({ data: null, error: { code: 'XX000', message: 'still failing' } }), PENDING_MS));
        });

        // Tab B authenticates: its load round attempts the spent debt and owns its lock for that attempt.
        const t0 = Date.now();
        const loadInB = tabB.record.reconcileProgressEvaluations(OWNER, []);
        await vi.advanceTimersByTimeAsync(TAB_B_OFFSET_MS);
        // Tab A's schedule tries to release the spent debt while B owns it.
        let resultInA: unknown = null;
        let settledAfter = -1;
        void tabA.retry.scheduleProgressDebtRetry(OWNER).then((result) => {
            resultInA = result;
            settledAfter = Date.now() - t0;
        });
        await vi.advanceTimersByTimeAsync(20_000);
        await loadInB;

        expect(resultInA).toEqual({ resolved: 0, released: 1 });
        expect(settledAfter).toBeGreaterThan(0);
        expect(settledAfter).toBeLessThanOrEqual(PROGRESS_DEBT_RELEASE_BOUND_MS);
        const read = tabA.queue.readProgressReconcileQueue();
        expect(read.ok && read.entries.find((e) => e.sessionId === SESSION)?.releasedAtIso).toBeTruthy();
        expect(tabA.gate.evaluateDurableStartGate(OWNER).allowed).toBe(true);
        const released = [tabA, tabB].flatMap((tab) => tab.push.mock.calls
            .filter((c) => c[0] === 'progress_debt' && (c[1] as { phase?: string }).phase === 'released'));
        expect(released).toHaveLength(1);
    });

    it('X4 an attempt that throws under ownership strands neither the lock nor the in-tab guard', async () => {
        const tab = await openTab();
        expect(tab.queue.enqueueProgressReconcile(SESSION, OWNER, new Date(Date.now() - 1_000).toISOString()).ok).toBe(true);
        let calls = 0;
        rpc.mockImplementation((name: string) => {
            if (name !== 'record_progress_evaluation') return Promise.resolve({ data: null, error: null });
            calls++;
            return calls === 1
                ? Promise.reject(new Error('transport threw'))
                : Promise.resolve({ data: null, error: { code: 'XX000', message: 'still failing' } });
        });

        const attempts = () => {
            const read = tab.queue.readProgressReconcileQueue();
            return read.ok ? read.entries.find((e) => e.sessionId === SESSION)?.attempts : undefined;
        };
        void tab.retry.scheduleProgressDebtRetry(OWNER);
        await vi.advanceTimersByTimeAsync(3_000);
        expect(calls).toBe(1);
        // The throw is a failed attempt, not the end of the schedule (Codex 4004302937)…
        expect(attempts()).toBe(1);

        // …and the same schedule attempts the debt again at its next due time: nothing was left owned or in flight.
        await vi.advanceTimersByTimeAsync(8_000);
        expect(calls).toBe(2);
        expect(attempts()).toBe(2);
    });

    // Codex P1 4003555358: the write-ahead SAVE evaluation ran outside cross-tab ownership, so another tab's lock-owned
    // retry could evaluate the same debt at the same time — overlapping RPCs and, on success, duplicate side effects.
    async function saveInTabAWhileTabBRetries(outcome: 'fail' | 'succeed' | 'hang') {
        const tabA = await openTab();
        const tabB = await openTab();
        const OTHER = 'sess-other-debt';
        expect(tabB.queue.enqueueProgressReconcile(OTHER, OWNER, new Date(Date.now() - 1_000).toISOString()).ok).toBe(true);
        const failed = { data: null, error: { code: 'XX000', message: 'still failing' } };
        const t0 = Date.now();
        let inFlightForSession = 0;
        let maxConcurrentForSession = 0;
        let evaluatorCallsForSession = 0;
        let otherFirstCallMs = -1;
        const sessionCallTimes: number[] = [];
        rpc.mockImplementation((name: string, args: unknown) => {
            if (name !== 'record_progress_evaluation') return Promise.resolve({ data: null, error: null });
            if (JSON.stringify(args ?? {}).includes(OTHER)) {
                if (otherFirstCallMs < 0) otherFirstCallMs = Date.now() - t0;
                return Promise.resolve(failed);
            }
            sessionCallTimes.push(Date.now() - t0);
            evaluatorCallsForSession++;
            // Codex 4007557650: every evaluation hangs, so each attempt ends only at its own deadline.
            if (outcome === 'hang') return new Promise(() => undefined);
            inFlightForSession++;
            maxConcurrentForSession = Math.max(maxConcurrentForSession, inFlightForSession);
            return new Promise((resolve) => setTimeout(() => {
                inFlightForSession--;
                resolve(outcome === 'succeed' ? { data: 'eval-1', error: null } : failed);
            }, PENDING_MS));
        });

        // Tab A saves: the obligation is written ahead, then A evaluates. Tab B sees the debt and runs its retry schedule.
        let saveOutcome: unknown = null;
        let saveSettledMs = -1;
        void tabA.record.wireProgressEvaluationOnSave({
            sessionId: SESSION, status: 'completed', attributionStatus: 'verified', metricsPersisted: true, userId: OWNER,
        }).then((result) => {
            saveOutcome = result;
            saveSettledMs = Date.now() - t0;
        });
        await vi.advanceTimersByTimeAsync(TAB_B_OFFSET_MS);
        void tabB.retry.scheduleProgressDebtRetry(OWNER);
        await vi.advanceTimersByTimeAsync(120_000);

        const phases = [tabA, tabB].flatMap((tab) => tab.push.mock.calls
            .filter((c) => c[0] === 'progress_debt')
            .map((c) => (c[1] as { phase?: string }).phase));
        const read = tabA.queue.readProgressReconcileQueue();
        const entry = read.ok ? read.entries.find((e) => e.sessionId === SESSION) : undefined;
        const releasedAfterMs = entry?.releasedAtIso ? Date.parse(entry.releasedAtIso) - t0 : -1;
        // The save's attempts run under its own ownership and end before it settles; later calls are tab B's retries.
        const retryCallTimes = sessionCallTimes.filter((ms) => ms >= saveSettledMs);
        return {
            tabA, maxConcurrentForSession, evaluatorCallsForSession, otherFirstCallMs, saveOutcome, saveSettledMs, phases,
            entry, releasedAfterMs, retryCallTimes,
        };
    }

    // PM RETURN 5668213021: under contention the 60 s Start bound wins over the attempt count. Measured from tab B's
    // schedule first seeing the debt: Start is released by the bound, the debt stays durable, and no retry is launched
    // whose maximum completion would pass the bound.
    function expectStartReleasedWithinBound(run: Awaited<ReturnType<typeof saveInTabAWhileTabBRetries>>) {
        const { PROGRESS_DEBT_RELEASE_BOUND_MS, PROGRESS_DEBT_ATTEMPT_BUDGET } = run.tabA.retry;
        const boundAt = TAB_B_OFFSET_MS + PROGRESS_DEBT_RELEASE_BOUND_MS + TIMER_TOLERANCE_MS;
        expect(run.releasedAfterMs).toBeGreaterThan(0);
        expect(run.releasedAfterMs).toBeLessThanOrEqual(boundAt);
        expect(run.entry).toBeDefined(); // released, never cleared: the debt stays durable
        expect(run.retryCallTimes.length).toBeGreaterThanOrEqual(1);
        expect(run.entry?.attempts).toBe(run.retryCallTimes.length);
        expect(run.entry?.attempts).toBeLessThanOrEqual(PROGRESS_DEBT_ATTEMPT_BUDGET);
        for (const ms of run.retryCallTimes) {
            expect(ms + run.tabA.record.PROGRESS_RPC_ATTEMPT_TIMEOUT_MS).toBeLessThanOrEqual(boundAt);
        }
    }

    it('X5 a failing save and another tab\'s retry never evaluate one debt together; a different debt still progresses', async () => {
        const run = await saveInTabAWhileTabBRetries('fail');

        expect(run.maxConcurrentForSession).toBe(1);
        expect(run.saveOutcome).toEqual({ kind: 'queued' });
        expect(run.otherFirstCallMs).toBeGreaterThanOrEqual(0);
        expect(run.otherFirstCallMs).toBeLessThan(run.saveSettledMs); // the other debt is not held behind this one's ownership
        expectStartReleasedWithinBound(run);
        expect(run.phases.filter((p) => p === 'attempt_succeeded')).toHaveLength(0);
        expect(recommendationReads).toBe(0);
    });

    it('X5b Codex 4007557650: a save whose attempts all hang holds ownership ~30 s, yet the other tab still releases Start within the bound', async () => {
        const run = await saveInTabAWhileTabBRetries('hang');

        expect(run.saveOutcome).toEqual({ kind: 'queued' });
        expect(run.saveSettledMs).toBeGreaterThanOrEqual(3 * run.tabA.record.PROGRESS_RPC_ATTEMPT_TIMEOUT_MS);
        expectStartReleasedWithinBound(run);
        expect(recommendationReads).toBe(0);
    });

    it('X6 a succeeding save is the only evaluation of its debt: no retry success and one recommendation reconciliation', async () => {
        const { maxConcurrentForSession, evaluatorCallsForSession, saveOutcome, phases } = await saveInTabAWhileTabBRetries('succeed');

        expect(maxConcurrentForSession).toBe(1);
        expect(evaluatorCallsForSession).toBe(1); // the retry that acquires later re-reads, finds the debt gone, and calls nothing
        expect(saveOutcome).toEqual({ kind: 'recorded' });
        expect(phases.filter((p) => p === 'attempt_succeeded')).toHaveLength(0);
        expect(recommendationReads).toBe(1);
    });
});

// PM RETURN 5668961740 / Codex 4008444044 (reproduced on 244c6c47: Start never allowed in 600 s, 2,400 lock requests).
// Lock ownership governs the queue write, not the user's wait: another tab owning a debt's attempt lock forever must not
// hold this tab's Start past the bound, and this tab must not write the shared queue or poll the lock indefinitely.
describe('RWT-20 C2 — a lock that never grants cannot hold Start past the bound', () => {
    const HORIZON_MS = 600_000;

    async function whileAnotherTabOwnsTheLock(lockHeldForever: boolean) {
        const tabA = await openTab();
        const tabB = await openTab();
        expect(tabA.queue.enqueueProgressReconcile(SESSION, OWNER, new Date(Date.now() - 1_000).toISOString()).ok).toBe(true);
        rpc.mockImplementation((name: string) => Promise.resolve(name === 'record_progress_evaluation'
            ? { data: null, error: { code: 'XX000', message: 'still failing' } }
            : { data: null, error: null }));
        if (lockHeldForever) {
            // Tab A owns the debt's attempt lock and never lets go: a stalled or frozen context.
            void tabA.ownership.withAttemptOwnership(OWNER, SESSION, () => new Promise(() => undefined));
            await vi.advanceTimersByTimeAsync(0);
        }
        const requestSpy = vi.spyOn(navigator.locks as unknown as SharedLockManager, 'request');
        const writeSpy = vi.spyOn(Storage.prototype, 'setItem');
        const t0 = Date.now();
        let settledAtMs = -1;
        void tabB.retry.scheduleProgressDebtRetry(OWNER).then(() => { settledAtMs = Date.now() - t0; });
        let startAllowedAtMs = -1;
        let lockRequestsWhenAllowed = -1;
        for (let t = 0; t < HORIZON_MS; t += 250) {
            await vi.advanceTimersByTimeAsync(250);
            if (startAllowedAtMs < 0 && tabB.gate.evaluateStartGate(OWNER, null).allowed) {
                startAllowedAtMs = Date.now() - t0;
                lockRequestsWhenAllowed = requestSpy.mock.calls.length;
            }
        }
        const read = tabB.queue.readProgressReconcileQueue();
        return {
            tabB,
            startAllowedAtMs,
            settledAtMs,
            lockRequestsAfterAllowed: requestSpy.mock.calls.length - lockRequestsWhenAllowed,
            // #1476: the queue lives in per-entry v2 keys; the v1 aggregate is still what an older tab writes. Both count.
            queueWrites: writeSpy.mock.calls.filter((c) => c[0] === tabB.queue.PROGRESS_QUEUE_STORAGE_KEY
                || String(c[0]).startsWith(tabB.queue.PROGRESS_QUEUE_V2_PREFIX)).length,
            entry: read.ok ? read.entries.find((e) => e.sessionId === SESSION) : undefined,
            evaluatorCalls: rpc.mock.calls.filter((c) => c[0] === 'record_progress_evaluation').length,
        };
    }

    it('C2 lock held forever by another tab: Start is allowed by the bound, the debt stays durable and unwritten, and polling stops', async () => {
        const run = await whileAnotherTabOwnsTheLock(true);
        const { PROGRESS_DEBT_RELEASE_BOUND_MS } = run.tabB.retry;

        expect(run.startAllowedAtMs).toBeGreaterThan(0);
        expect(run.startAllowedAtMs).toBeLessThanOrEqual(PROGRESS_DEBT_RELEASE_BOUND_MS + TIMER_TOLERANCE_MS);
        // The visible gate the hook rebuilds when the schedule settles agrees with the controller's decision.
        expect(run.tabB.gate.reconstructGateFromQueue(OWNER)).toBeNull();
        expect(run.settledAtMs).toBeGreaterThan(0);
        expect(run.settledAtMs).toBeLessThanOrEqual(PROGRESS_DEBT_RELEASE_BOUND_MS + TIMER_TOLERANCE_MS);
        expect(run.lockRequestsAfterAllowed).toBe(0);
        // No unlocked read/modify/write of the shared queue, and nothing claimed: the entry is exactly as it was.
        expect(run.queueWrites).toBe(0);
        expect(run.entry).toMatchObject({ sessionId: SESSION, userId: OWNER });
        expect(run.entry?.releasedAtIso).toBeUndefined();
        expect(run.entry?.attempts).toBeUndefined();
        expect(run.evaluatorCalls).toBe(0);
    });

    it('CONTROL: with a healthy lock the same debt spends its retries and is released durably within the bound', async () => {
        const run = await whileAnotherTabOwnsTheLock(false);
        const { PROGRESS_DEBT_RELEASE_BOUND_MS, PROGRESS_DEBT_ATTEMPT_BUDGET } = run.tabB.retry;

        expect(run.startAllowedAtMs).toBeGreaterThan(0);
        expect(run.startAllowedAtMs).toBeLessThanOrEqual(PROGRESS_DEBT_RELEASE_BOUND_MS);
        expect(run.evaluatorCalls).toBe(PROGRESS_DEBT_ATTEMPT_BUDGET);
        expect(run.entry?.attempts).toBe(PROGRESS_DEBT_ATTEMPT_BUDGET);
        expect(typeof run.entry?.releasedAtIso).toBe('string');
        expect(run.lockRequestsAfterAllowed).toBe(0);
    });
});
