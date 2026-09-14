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
/** When set, recommendation reads never settle — recommendation work has no deadline in production. */
let hangRecommendation = false;
const table = (name?: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'insert', 'upsert']) chain[m] = () => chain;
    chain.maybeSingle = () => (hangRecommendation && name === 'progress_recommendations'
        ? new Promise(() => {})
        : Promise.resolve({ data: null, error: null }));
    chain.single = async () => ({ data: null, error: null });
    return chain;
};
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc, from: (name: string) => table(name) }) }));
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
    PROGRESS_DEBT_ATTEMPT_BUDGET, __resetProgressDebtRetryForTests,
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
    hangRecommendation = false;
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

        // Retried IN-PAGE on the declared schedule, not once per load. The load round's failed attempt is a real,
        // persisted attempt and counts toward the entry's budget (Codex P1 4002335600).
        expect(evalCalls()).toBe(PROGRESS_DEBT_ATTEMPT_BUDGET);
        expect(result).toMatchObject({ resolved: 0, released: 1 });

        // ONE honest terminal state: Start is available — for the controller, the UI and a reload alike.
        expect(evaluateStartGate(OWNER, gate()).allowed).toBe(true);
        expect(gate()).toBeNull();
        expect(reconstructGateFromQueue(OWNER)).toBeNull();

        // …while the debt itself is NOT dropped.
        expect(getQueuedSessionIdsForUser(OWNER).sessionIds).toEqual([SESSION]);
        const entry = entryFor(SESSION);
        expect(typeof entry?.releasedAtIso).toBe('string');
        expect(entry?.attempts).toBe(PROGRESS_DEBT_ATTEMPT_BUDGET);

        const phases = debtEvents().map((e) => e.phase);
        expect(phases.filter((p) => p === 'attempt_failed')).toHaveLength(PROGRESS_DEBT_ATTEMPT_BUDGET);
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

// Codex P1 4002335597 on 7776a351: the final round re-read the queue and released EVERY unreleased entry, so debt that
// arrived during the schedule was released before it had been retried on its own budget.
describe('RWT-20 — each debt keeps its own retry budget', () => {
    it('debt arriving mid-schedule is not released with the older entry; it is released only after its own budget', async () => {
        arrangeReloadWithDebt();
        failRpc();
        const run = scheduleProgressDebtRetry(OWNER);

        // Just before the older entry's final retry, a newer save leaves debt of its own.
        await vi.advanceTimersByTimeAsync(sum(PROGRESS_DEBT_RETRY_DELAYS_MS) - 1);
        expect(enqueueProgressReconcile('sess-newer', OWNER, new Date().toISOString()).ok).toBe(true);
        await vi.advanceTimersByTimeAsync(10);

        // The older entry spent its budget and is released; the newer one has not been retried at all and still blocks.
        expect(typeof entryFor(SESSION)?.releasedAtIso).toBe('string');
        expect(entryFor('sess-newer')?.releasedAtIso).toBeUndefined();
        expect(evaluateStartGate(OWNER, null)).toMatchObject({ allowed: false, reason: 'queued_debt', sessionId: 'sess-newer' });

        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RELEASE_BOUND_MS);
        const result = await run;
        expect(result).toMatchObject({ resolved: 0, released: 2 });
        expect(entryFor('sess-newer')?.attempts).toBe(PROGRESS_DEBT_ATTEMPT_BUDGET);
        expect(typeof entryFor('sess-newer')?.releasedAtIso).toBe('string');
        expect(evalCalls()).toBe(2 * PROGRESS_DEBT_ATTEMPT_BUDGET);
    });
});

// Codex P1 4002335600 on 7776a351: every page load restarted the full schedule, ignoring the persisted attempts and
// clock, so repeated reloads could keep Start held indefinitely.
describe('RWT-20 — a reload resumes the persisted budget and clock', () => {
    it('a budget already spent before the reload releases Start without another hold', async () => {
        localStorage.setItem(PROGRESS_QUEUE_STORAGE_KEY, JSON.stringify([{
            sessionId: SESSION,
            userId: OWNER,
            enqueuedAtIso: new Date(Date.now() - 3_600_000).toISOString(),
            attempts: PROGRESS_DEBT_ATTEMPT_BUDGET,
            lastAttemptAtIso: new Date(Date.now() - 600_000).toISOString(),
        }]));
        useSessionStore.getState().setProgressGate(reconstructGateFromQueue(OWNER));
        failRpc();

        const run = scheduleProgressDebtRetry(OWNER);
        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RETRY_DELAYS_MS[0] - 1);
        expect(evaluateStartGate(OWNER, gate()).allowed).toBe(true);

        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RELEASE_BOUND_MS);
        expect(await run).toMatchObject({ released: 1 });
        expect(evalCalls()).toBe(0);
    });

    it('the persisted clock is resumed: a retry already waiting before the reload fires on its original schedule', async () => {
        // Two attempts failed; the last one 15 s before this page loaded, so its 20 s backoff has 5 s left.
        const elapsed = 15_000;
        localStorage.setItem(PROGRESS_QUEUE_STORAGE_KEY, JSON.stringify([{
            sessionId: SESSION,
            userId: OWNER,
            enqueuedAtIso: new Date(Date.now() - 60_000).toISOString(),
            attempts: PROGRESS_DEBT_ATTEMPT_BUDGET - 1,
            lastAttemptAtIso: new Date(Date.now() - elapsed).toISOString(),
        }]));
        useSessionStore.getState().setProgressGate(reconstructGateFromQueue(OWNER));
        failRpc();

        const run = scheduleProgressDebtRetry(OWNER);
        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RETRY_DELAYS_MS[PROGRESS_DEBT_ATTEMPT_BUDGET - 1] - elapsed + 10);
        expect(evalCalls()).toBe(1);
        expect(evaluateStartGate(OWNER, gate()).allowed).toBe(true);

        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RELEASE_BOUND_MS);
        expect(await run).toMatchObject({ released: 1 });
        expect(evalCalls()).toBe(1);
    });

    it('run → reload mid-budget → resume: the reloaded page spends only the remaining budget, on the persisted clock', async () => {
        arrangeReloadWithDebt();
        failRpc();
        void scheduleProgressDebtRetry(OWNER);

        // First page: one retry fails and is persisted.
        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RETRY_DELAYS_MS[0] + 1);
        expect(entryFor(SESSION)?.attempts).toBe(1);

        // Reload: the page's timers and in-memory schedule are gone; only storage survives. The reloaded page runs its
        // load round and then the retry schedule, exactly as `useProgressReconciliation` does.
        vi.clearAllTimers();
        __resetProgressDebtRetryForTests();
        const reloadedAt = Date.now();
        await reconcileProgressEvaluations(OWNER, []);
        expect(entryFor(SESSION)?.attempts).toBe(2);
        const run = scheduleProgressDebtRetry(OWNER);

        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RETRY_DELAYS_MS[2] - 1);
        expect(evaluateStartGate(OWNER, null).allowed).toBe(false); // still inside its last backoff
        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RELEASE_BOUND_MS);
        expect(await run).toMatchObject({ released: 1 });

        // Budget resumed, not restarted: three attempts in total, released one backoff after the reload's attempt.
        expect(evalCalls()).toBe(PROGRESS_DEBT_ATTEMPT_BUDGET);
        const releasedAt = Date.parse(entryFor(SESSION)?.releasedAtIso as string);
        expect(releasedAt - reloadedAt).toBeLessThanOrEqual(PROGRESS_DEBT_RETRY_DELAYS_MS[2] + 1_000);
    });
});

// Codex P1 4002546939 on a04262c2: retry rounds joined the owner-wide load round. That round serially awaits every
// retained (released) entry, each up to its RPC deadline, plus recommendation work that has no deadline, so unrelated
// retained entries could push new debt past the release bound or suspend it indefinitely.
describe('RWT-20 — the release bound is isolated from retained entries and recommendation work', () => {
    const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
    const retained = (sessionId: string) => ({
        sessionId,
        userId: OWNER,
        enqueuedAtIso: iso(3_600_000),
        attempts: PROGRESS_DEBT_ATTEMPT_BUDGET,
        lastAttemptAtIso: iso(600_000),
        releasedAtIso: iso(500_000),
    });
    const failed = { data: null, error: { code: 'XX000', message: ERROR_TEXT } };
    const forSession = (args: unknown, sessionId: string) => JSON.stringify(args ?? {}).includes(sessionId);
    async function msUntilReleased(sessionId: string, t0: number, maxSeconds: number): Promise<number> {
        for (let s = 1; s <= maxSeconds; s++) {
            await vi.advanceTimersByTimeAsync(1_000);
            if (entryFor(sessionId)?.releasedAtIso) return Date.now() - t0;
        }
        return -1;
    }

    it('retained entries whose evaluations never settle do not push new debt past the release bound', async () => {
        localStorage.setItem(PROGRESS_QUEUE_STORAGE_KEY, JSON.stringify([
            ...Array.from({ length: 6 }, (_, i) => retained(`retained-${i}`)),
            { sessionId: SESSION, userId: OWNER, enqueuedAtIso: iso(1_000) },
        ]));
        useSessionStore.getState().setProgressGate(reconstructGateFromQueue(OWNER));
        rpc.mockImplementation((name: string, args: unknown) => {
            if (name !== 'record_progress_evaluation') return Promise.resolve({ data: null, error: null });
            return forSession(args, 'retained-') ? new Promise(() => {}) : Promise.resolve(failed);
        });

        const t0 = Date.now();
        void reconcileProgressEvaluations(OWNER, []); // the reload's load round, as useProgressReconciliation runs it
        void scheduleProgressDebtRetry(OWNER);
        const releasedAfter = await msUntilReleased(SESSION, t0, 240);

        expect(releasedAfter).toBeGreaterThan(0);
        expect(releasedAfter).toBeLessThanOrEqual(PROGRESS_DEBT_RELEASE_BOUND_MS);
    });

    it('recommendation work that never settles on a retained entry does not hold new debt', async () => {
        localStorage.setItem(PROGRESS_QUEUE_STORAGE_KEY, JSON.stringify([
            retained('retained-ok'),
            { sessionId: SESSION, userId: OWNER, enqueuedAtIso: iso(1_000) },
        ]));
        useSessionStore.getState().setProgressGate(reconstructGateFromQueue(OWNER));
        hangRecommendation = true;
        rpc.mockImplementation((name: string, args: unknown) => {
            if (name !== 'record_progress_evaluation') return Promise.resolve({ data: null, error: null });
            return forSession(args, 'retained-ok') ? Promise.resolve({ data: 'eval-ok', error: null }) : Promise.resolve(failed);
        });

        const t0 = Date.now();
        void reconcileProgressEvaluations(OWNER, []);
        void scheduleProgressDebtRetry(OWNER);
        const releasedAfter = await msUntilReleased(SESSION, t0, 600);

        expect(releasedAfter).toBeGreaterThan(0);
        expect(releasedAfter).toBeLessThanOrEqual(PROGRESS_DEBT_RELEASE_BOUND_MS);
    });

    it('a retry that drains one debt while its recommendation work never settles still releases the other', async () => {
        expect(enqueueProgressReconcile(SESSION, OWNER, iso(1_000)).ok).toBe(true);
        expect(enqueueProgressReconcile('sess-still-failing', OWNER, iso(1_000)).ok).toBe(true);
        useSessionStore.getState().setProgressGate(reconstructGateFromQueue(OWNER));
        hangRecommendation = true;
        rpc.mockImplementation((name: string, args: unknown) => {
            if (name !== 'record_progress_evaluation') return Promise.resolve({ data: null, error: null });
            return forSession(args, SESSION) ? Promise.resolve({ data: 'eval-1', error: null }) : Promise.resolve(failed);
        });

        const t0 = Date.now();
        void scheduleProgressDebtRetry(OWNER);
        const releasedAfter = await msUntilReleased('sess-still-failing', t0, 600);

        expect(getQueuedSessionIdsForUser(OWNER).sessionIds).not.toContain(SESSION);
        expect(releasedAfter).toBeGreaterThan(0);
        expect(releasedAfter).toBeLessThanOrEqual(PROGRESS_DEBT_RELEASE_BOUND_MS);
    });
});
