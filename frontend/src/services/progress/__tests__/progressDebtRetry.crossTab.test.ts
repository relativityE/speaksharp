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
    return { push, queue, retry, record };
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
});
