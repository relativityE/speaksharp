/* @vitest-environment jsdom */
// Cloud-test Case 10 (R5 dossier, "Request allowance and remaining bound") — OBSERVED mechanisms.
//
// tools/cloud-test/scripts/case10_request_bound.py declares a per-component request bound from supplied integers; its own
// unit tests check arithmetic only. These controls run the REAL product modules (recordingLease, recordProgress,
// progressDebtRetry) on fake timers behind an instrumented Supabase boundary that counts every request the moment it is
// transmitted — including requests that never settle and stay in flight — then run the real calculator CLI on a
// projection of the same scenario and require every observed count to fit its declared component. Worst cases are equal.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Reply = { data: unknown; error: unknown };
type Handler = (callIndex: number) => Promise<Reply>;

/** Every transmitted request, in order: `rpc:<fn>` or `from:<table>`. */
const sent: string[] = [];
/** Requests transmitted whose response never arrived. */
let inFlight = 0;
const handlers = new Map<string, Handler>();
const callsTo = new Map<string, number>();
const never = (): Promise<Reply> => new Promise(() => {});
const ok = (data: unknown): Promise<Reply> => Promise.resolve({ data, error: null });
const failed = (): Promise<Reply> => Promise.resolve({ data: null, error: { code: 'XX000', message: 'synthetic failure' } });

function transmit(name: string): Promise<Reply> {
    sent.push(name);
    const index = callsTo.get(name) ?? 0;
    callsTo.set(name, index + 1);
    const handler = handlers.get(name);
    if (!handler) throw new Error(`unexpected request ${name}: every request in a control must be declared`);
    inFlight++;
    return handler(index).then((reply) => { inFlight--; return reply; });
}

/** A PostgREST builder: chaining is local; the terminal read is the one transmitted request. */
const table = (name: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) chain[m] = () => chain;
    chain.maybeSingle = () => transmit(`from:${name}`);
    chain.single = () => transmit(`from:${name}`);
    return chain;
};
const rpc = (fn: string) => transmit(`rpc:${fn}`);
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc, from: (name: string) => table(name) }) }));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

const { analyticsBuffer } = await import('@/services/AnalyticsBuffer');
const lease = await import('@/services/recordingLease');
const { enqueueProgressReconcile, releaseProgressReconcileEntry } = await import('@/services/progress/progressReconcileQueue');
const { setOpenAttempt } = await import('@/services/progress/openAttempt');
const {
    attemptProgressDebtRound, reconcileProgressEvaluations, wireProgressEvaluationOnSave, PROGRESS_RPC_ATTEMPT_TIMEOUT_MS,
} = await import('@/services/progress/recordProgress');
const {
    scheduleProgressDebtRetry, PROGRESS_DEBT_RELEASE_BOUND_MS, __resetProgressDebtRetryForTests,
} = await import('@/services/progress/progressDebtRetry');

// A string path, not `new URL(..)`: under jsdom the global URL belongs to another realm.
const CALCULATOR = join(dirname(fileURLToPath(import.meta.url)), '../../../tools/cloud-test/scripts/case10_request_bound.py');
const OWNER = 'owner-case10-observed';

/** Every calculator input, at zero: a control sets only the inputs its scenario actually exercised. */
const ZERO = {
    snapshotSizes: [0, 0, 0, 0, 0, 0], leaseHeldIntervalsMs: [] as number[], scanObligationCounts: [] as number[],
    loadQueueSizes: [] as number[], saveEvaluationInvocations: 0, distinctRetryDebtsUpperBound: 0, historyQueryLifecycles: 0,
    recommendationSettlementInvocations: 0, leaseAcquisitions: 0, leaseConfirmations: 0, openAttemptAdvances: 0,
    cancelledAttempts: 0, localRetrySkips: 0, bootstrap: 0, auth: 0, navigation: 0, modelAcquisition: 0, preflights: 0,
    successorSave: 0, evidenceTail: 0,
};

/** The real calculator's declared components for a projection. A refusal fails the control; it never reads as zero. */
function declared(projection: Partial<typeof ZERO>): Record<string, number> {
    const dir = mkdtempSync(join(tmpdir(), 'case10-observed-'));
    try {
        const file = join(dir, 'projection.json');
        writeFileSync(file, JSON.stringify({ ...ZERO, ...projection }));
        const run = spawnSync('python3', ['-I', CALCULATOR, file], { encoding: 'utf8', timeout: 60_000 });
        if (run.status !== 0) throw new Error(`calculator refused (exit ${run.status}): ${run.stderr}`);
        return (JSON.parse(run.stdout) as { components: Record<string, number> }).components;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const count = (name: string) => sent.filter((s) => s === name).length;
const evaluations = () => count('rpc:record_progress_evaluation');

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    sent.length = 0;
    inFlight = 0;
    handlers.clear();
    callsTo.clear();
    lease.__resetTakeLeaseForTests();
    __resetProgressDebtRetryForTests();
    vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => undefined);
    // Nothing on these paths may reach the network outside the instrumented Supabase boundary.
    fetchSpy = vi.fn(() => Promise.reject(new Error('uninstrumented fetch')));
    vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
    const leaked = fetchSpy.mock.calls.length;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    if (leaked) throw new Error(`${leaked} uninstrumented fetch call(s): this traffic is not charged by the control`);
});

const leaseRpc = (fn: string) => transmit(`rpc:${fn}`);

describe('Case 10 observed: recording lease (recordingLease.ts)', () => {
    it('charges every periodic tick while the heartbeat RPC hangs, plus the immediate acquire, confirmations and release', async () => {
        handlers.set('rpc:acquire_recording_lease', () => ok({ acquired: true }));
        handlers.set('rpc:release_recording_lease', () => ok(null));
        let hang = false;
        handlers.set('rpc:heartbeat_recording_lease', () => (hang ? never() : ok({ valid: true })));

        expect((await lease.acquireTakeLease({ rpc: leaseRpc })).action).toBe('start');
        expect(await lease.confirmTakeLease({ rpc: leaseRpc })).toBe('held');
        expect(await lease.confirmTakeLease({ rpc: leaseRpc })).toBe('held');
        const immediateConfirmations = count('rpc:heartbeat_recording_lease');

        hang = true; // every periodic heartbeat now stays in flight; the interval does not wait for it
        lease.startLeaseHeartbeat(() => {}, { rpc: leaseRpc });
        await vi.advanceTimersByTimeAsync(62_000);
        await lease.releaseTakeLease({ rpc: leaseRpc });
        const periodic = count('rpc:heartbeat_recording_lease') - immediateConfirmations;

        expect(immediateConfirmations).toBe(2);
        expect(periodic).toBe(12);
        expect(inFlight).toBe(periodic);
        const bound = declared({ leaseHeldIntervalsMs: [62_000], leaseAcquisitions: 1, leaseConfirmations: 2 });
        expect(periodic).toBe(bound.heartbeat);
        expect(count('rpc:acquire_recording_lease') + count('rpc:release_recording_lease') + immediateConfirmations)
            .toBe(bound.leaseControl);
        expect(sent.length).toBe(bound.heartbeat + bound.leaseControl);
        // Falsifier: the dossier's tick-only term alone is exceeded by the traffic actually sent.
        expect(sent.length).toBeGreaterThan(bound.heartbeat);
    });

    it('a second take releases the first before acquiring, so each take costs one acquire and one release', async () => {
        handlers.set('rpc:acquire_recording_lease', () => ok({ acquired: true }));
        handlers.set('rpc:release_recording_lease', () => ok(null));
        await lease.acquireTakeLease({ rpc: leaseRpc });
        await lease.acquireTakeLease({ rpc: leaseRpc });
        await lease.releaseTakeLease({ rpc: leaseRpc });
        expect(sent).toEqual([
            'rpc:acquire_recording_lease', 'rpc:release_recording_lease', 'rpc:acquire_recording_lease', 'rpc:release_recording_lease',
        ]);
        expect(sent.length).toBe(declared({ leaseAcquisitions: 2 }).leaseControl);
    });
});

describe('Case 10 observed: Progress evaluation and debt (recordProgress.ts, progressDebtRetry.ts)', () => {
    const save = (sessionId: string) => wireProgressEvaluationOnSave({
        sessionId, status: 'completed', attributionStatus: 'verified', metricsPersisted: true, userId: OWNER,
        takeStartedAtIso: new Date(Date.now() - 30_000).toISOString(),
    });

    it('a save sends three evaluation attempts; a timed-out attempt is not cancelled and stays in flight', async () => {
        handlers.set('rpc:record_progress_evaluation', never);
        const outcome = save('sess-hung-save');
        await vi.advanceTimersByTimeAsync(3 * PROGRESS_RPC_ATTEMPT_TIMEOUT_MS + 250 + 500 + 1);
        expect(await outcome).toEqual({ kind: 'queued' });
        expect(evaluations()).toBe(3);
        expect(inFlight).toBe(3);
        expect(evaluations()).toBe(declared({ saveEvaluationInvocations: 1 }).evaluation);
    });

    it('every authenticated load attempts every owed entry, released ones included, and each load is charged again', async () => {
        handlers.set('rpc:record_progress_evaluation', failed);
        const at = new Date(Date.now() - 60_000).toISOString();
        for (const id of ['sess-a', 'sess-b', 'sess-c']) expect(enqueueProgressReconcile(id, OWNER, at).ok).toBe(true);
        for (const id of ['sess-a', 'sess-b']) expect(releaseProgressReconcileEntry(id, OWNER, at).ok).toBe(true);

        await reconcileProgressEvaluations(OWNER, []);
        expect(evaluations()).toBe(3);
        await reconcileProgressEvaluations(OWNER, []);
        expect(evaluations()).toBe(6);
        expect(sent.length).toBe(declared({ loadQueueSizes: [3, 3] }).evaluation);
    });

    /** One owed debt, chased by the in-page schedule until it releases; returns the declared three-attempt budget. */
    async function chaseOneDebt(reply: Handler): Promise<number> {
        handlers.set('rpc:record_progress_evaluation', reply);
        expect(enqueueProgressReconcile('sess-retry', OWNER, new Date(Date.now() - 60_000).toISOString()).ok).toBe(true);
        const run = scheduleProgressDebtRetry(OWNER);
        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RELEASE_BOUND_MS + 5_000);
        expect((await run).released).toBe(1);
        return declared({ distinctRetryDebtsUpperBound: 1 }).evaluation;
    }

    it('the in-page retry schedule spends exactly the three-attempt budget on a failing debt', async () => {
        const budget = await chaseOneDebt(failed);
        expect(evaluations()).toBe(budget);
    });

    it('a hung debt stays within the budget, and every hung attempt was sent and is charged though never answered', async () => {
        const budget = await chaseOneDebt(never);
        expect(evaluations()).toBeGreaterThan(0);
        expect(evaluations()).toBeLessThanOrEqual(budget);
        expect(inFlight).toBe(evaluations());
    });

    it('a local recheck while another trigger holds the debt sends nothing', async () => {
        handlers.set('rpc:record_progress_evaluation', never);
        expect(enqueueProgressReconcile('sess-skip', OWNER, new Date(Date.now() - 60_000).toISOString()).ok).toBe(true);
        const load = attemptProgressDebtRound(OWNER, 'load');
        await vi.advanceTimersByTimeAsync(0);
        expect(evaluations()).toBe(1);

        const skipped = await attemptProgressDebtRound(OWNER, 'retry', new Set(['sess-skip']));
        expect(skipped.attempted.size).toBe(0);
        // The schedule's first retry falls due at 2 s and then rechecks every 250 ms while the load attempt is in flight.
        const run = scheduleProgressDebtRetry(OWNER);
        await vi.advanceTimersByTimeAsync(PROGRESS_RPC_ATTEMPT_TIMEOUT_MS - 1_000);
        expect(evaluations()).toBe(1);
        expect(declared({ loadQueueSizes: [1], localRetrySkips: 30 }).evaluation).toBe(evaluations());

        await vi.advanceTimersByTimeAsync(PROGRESS_DEBT_RELEASE_BOUND_MS + 5_000);
        await Promise.all([load, run]);
    });

    it('a recorded save settles its recommendation with exactly four requests', async () => {
        handlers.set('rpc:record_progress_evaluation', () => ok('eval-1'));
        handlers.set('from:progress_recommendations', (i) => ok(i === 0 ? null : { id: 'rec-1' }));
        handlers.set('from:session_progress_evaluations', () => ok({
            eligible: true, word_count: 120, filler_count: 3, error_marker_count: 0, wpm: 140, clarity_raw: 0.9,
            cohort_key: 'freeform', engine: 'native', engine_version: '1', model_name: 'unit', attribution_status: 'verified',
        }));
        handlers.set('rpc:record_progress_recommendation', () => ok('rec-1'));

        expect(await save('sess-recorded')).toEqual({ kind: 'recorded' });
        await vi.advanceTimersByTimeAsync(0);
        const settlement = sent.filter((s) => s !== 'rpc:record_progress_evaluation');
        expect(settlement).toEqual([
            'from:progress_recommendations', 'from:session_progress_evaluations',
            'rpc:record_progress_recommendation', 'from:progress_recommendations',
        ]);
        const bound = declared({ saveEvaluationInvocations: 1, recommendationSettlementInvocations: 1 });
        expect(settlement.length).toBe(bound.recommendation);
        expect(evaluations()).toBeLessThanOrEqual(bound.evaluation);
    });

    it('advancing a bound open attempt costs up to three requests on its worst path', async () => {
        handlers.set('rpc:advance_recommendation_attempt', (i) => Promise.resolve({
            data: null,
            error: { code: '22023', message: i === 0 ? 'outcome mismatch: use not_comparable' : 'attempt already resolved' },
        }));
        handlers.set('from:progress_recommendation_attempts', () => ok(null));
        expect(setOpenAttempt({ attemptId: 'att-1', userId: OWNER, sourceSessionId: 'sess-source', resolutionSessionId: 'sess-repeat' }))
            .toBe(true);

        await reconcileProgressEvaluations(OWNER, []);
        expect(sent).toEqual([
            'rpc:advance_recommendation_attempt', 'rpc:advance_recommendation_attempt', 'from:progress_recommendation_attempts',
        ]);
        expect(sent.length).toBe(declared({ openAttemptAdvances: 1 }).attemptAdvance);
    });
});
