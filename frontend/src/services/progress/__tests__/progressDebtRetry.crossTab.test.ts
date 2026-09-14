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

async function openTab() {
    vi.resetModules();
    const { analyticsBuffer } = await import('@/services/AnalyticsBuffer');
    const push = vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => undefined);
    const queue = await import('../progressReconcileQueue');
    const retry = await import('../progressDebtRetry');
    const record = await import('../recordProgress');
    const gate = await import('../progressStartGate');
    return { push, queue, retry, record, gate };
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

        const first = tab.retry.scheduleProgressDebtRetry(OWNER);
        const firstOutcome = first.then(() => 'resolved', () => 'rejected');
        await vi.advanceTimersByTimeAsync(3_000);
        expect(await firstOutcome).toBe('rejected');
        expect(calls).toBe(1);

        // The next schedule for the same owner and debt attempts it again: nothing was left owned or in flight.
        void tab.retry.scheduleProgressDebtRetry(OWNER);
        await vi.advanceTimersByTimeAsync(3_000);
        expect(calls).toBe(2);
        const read = tab.queue.readProgressReconcileQueue();
        expect(read.ok && read.entries.find((e) => e.sessionId === SESSION)?.attempts).toBe(1);
    });

    // Codex P1 4003555358: the write-ahead SAVE evaluation ran outside cross-tab ownership, so another tab's lock-owned
    // retry could evaluate the same debt at the same time — overlapping RPCs and, on success, duplicate side effects.
    async function saveInTabAWhileTabBRetries(outcome: 'fail' | 'succeed') {
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
        rpc.mockImplementation((name: string, args: unknown) => {
            if (name !== 'record_progress_evaluation') return Promise.resolve({ data: null, error: null });
            if (JSON.stringify(args ?? {}).includes(OTHER)) {
                if (otherFirstCallMs < 0) otherFirstCallMs = Date.now() - t0;
                return Promise.resolve(failed);
            }
            inFlightForSession++;
            evaluatorCallsForSession++;
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
        return { tabA, maxConcurrentForSession, evaluatorCallsForSession, otherFirstCallMs, saveOutcome, saveSettledMs, phases };
    }

    it('X5 a failing save and another tab\'s retry never evaluate one debt together; a different debt still progresses', async () => {
        const { tabA, maxConcurrentForSession, otherFirstCallMs, saveOutcome, saveSettledMs, phases } = await saveInTabAWhileTabBRetries('fail');

        expect(maxConcurrentForSession).toBe(1);
        expect(saveOutcome).toEqual({ kind: 'queued' });
        expect(otherFirstCallMs).toBeGreaterThanOrEqual(0);
        expect(otherFirstCallMs).toBeLessThan(saveSettledMs); // the other debt is not held behind this one's ownership
        const read = tabA.queue.readProgressReconcileQueue();
        const entry = read.ok ? read.entries.find((e) => e.sessionId === SESSION) : undefined;
        expect(entry?.attempts).toBe(tabA.retry.PROGRESS_DEBT_ATTEMPT_BUDGET);
        expect(phases.filter((p) => p === 'attempt_succeeded')).toHaveLength(0);
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
