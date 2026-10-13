/* @vitest-environment jsdom */
// #1258 RH-13 (PM 6155702425) — a successful save unlocks on DURABLE EVALUATION, not on downstream latency.
//
// `wireProgressEvaluationOnSave` awaited the recommendation and the "Practice this next" attempt advance before it
// returned `recorded`, so their round trips held "Finishing up" on Start (live run 38452954992). The correction:
//   • the attempt binding is readback-verified BEFORE anything non-blocking is published, and its failure blocks;
//   • the recommendation becomes a durable owner+session OBLIGATION under its own key, which shipped clients never
//     read, rewrite or clear, so an older tab cannot retire it;
//   • only then is the queue entry cleared and `recorded` returned; the downstream work runs afterwards;
//   • a late result retires only its own obligation generation and only its own attempt.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpeechRuntimeController } from '../../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';

type Res = { data: unknown; error: unknown };
type Deferred = { promise: Promise<Res>; resolve: (r: Res) => void };
const deferred = (): Deferred => {
    let resolve!: (r: Res) => void;
    const promise = new Promise<Res>((r) => { resolve = r; });
    return { promise, resolve };
};

/** Per-RPC behaviour; the default answers the evaluation with an id and every other call with an empty success. */
const rpcImpl = new Map<string, (args: Record<string, unknown>) => Promise<Res>>();
const rpc = vi.fn((fn: string, args: Record<string, unknown>) =>
    (rpcImpl.get(fn) ?? (async () => ({ data: fn === 'record_progress_evaluation' ? 'eval-1' : null, error: null })))(args));

const ELIGIBLE = {
    eligible: true, word_count: 120, filler_count: 3, error_marker_count: 0, wpm: 140, clarity_raw: 0.82,
    cohort_key: 'cohort-a', engine: 'private', engine_version: 'v2', model_name: 'm', attribution_status: 'verified',
};
/** Server state the readbacks see. `recRows` is the authority for "a recommendation exists for this session". */
let recRows: Set<string>;
let recReadError: unknown;
let evalRow: Record<string, unknown> | null;
let evalReadError: unknown;
function chain(table: string) {
    const filters: Record<string, unknown> = {};
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.eq = (col: string, v: unknown) => { filters[col] = v; return c; };
    c.maybeSingle = async () => {
        if (table === 'progress_recommendations') {
            if (recReadError) return { data: null, error: recReadError };
            const sid = String(filters.source_session_id);
            return { data: recRows.has(sid) ? { id: `rec-${sid}` } : null, error: null };
        }
        if (table === 'session_progress_evaluations') return { data: evalRow, error: evalReadError };
        return { data: null, error: null };
    };
    return c;
}
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc, from: (t: string) => chain(t) }) }));
const { finalizeObjectiveSessionOnSave } = vi.hoisted(() => ({ finalizeObjectiveSessionOnSave: vi.fn() }));
vi.mock('@/services/objective/finalizeObjectiveSessionOnSave', () => ({ finalizeObjectiveSessionOnSave }));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

const { wireProgressEvaluationOnSave, reconcileProgressEvaluations, attemptProgressDebtRound } = await import('../recordProgress');
const { evaluateDurableStartGate } = await import('../progressStartGate');
const { getQueuedSessionIdsForUser, PROGRESS_QUEUE_V2_PREFIX, PROGRESS_QUEUE_STORAGE_KEY } = await import('../progressReconcileQueue');
const { setOpenAttempt, getOpenAttemptForUser } = await import('../openAttempt');

const USER = 'user-1';
const N = 'sess-n';
const N1 = 'sess-n1';
/** The obligation's own storage namespace, spelled literally: it must never collide with the shipped queue's. */
const OBLIGATION_PREFIX: string = 'ss_progress_recommendation_owed_v1|';
const OPEN_ATTEMPT_KEY = 'ss_progress_open_attempt_v1';
const SAVE = (sessionId: string, userId: string | null = USER) =>
    ({ sessionId, status: 'completed', attributionStatus: 'verified', metricsPersisted: true, userId });

const obligationKeys = () => Object.keys(localStorage).filter((k) => k.startsWith(OBLIGATION_PREFIX));
const obligationFor = (sessionId: string) => obligationKeys().find((k) => k.endsWith(`|${encodeURIComponent(sessionId)}`));
const callsTo = (fn: string) => rpc.mock.calls.filter((c) => c[0] === fn);
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
/** Resolves with the outcome, or with 'HELD' when the call is still waiting after `ms` — i.e. downstream held the gate. */
const within = <T,>(p: Promise<T>, ms = 300): Promise<T | 'HELD'> =>
    Promise.race([p, new Promise<'HELD'>((r) => setTimeout(() => r('HELD'), ms))]);

/** Fail every write to keys matching `match`; everything else is untouched. */
function failWritesTo(match: (key: string) => boolean): void {
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
        if (match(k)) throw new Error('QuotaExceededError');
        return real.call(this, k, v);
    });
}
const acceptAttempt = (attemptId: string, sourceSessionId: string, userId = USER, acceptedAtIso = '2026-10-13T10:00:00.000Z') =>
    expect(setOpenAttempt({ attemptId, userId, sourceSessionId, acceptedAtIso } as Parameters<typeof setOpenAttempt>[0])).toBe(true);

/** Hold the recommendation RPC; on release it creates the row (the server's own uniqueness makes repeats no-ops). */
function holdRecommendation(): Deferred[] {
    const held: Deferred[] = [];
    rpcImpl.set('record_progress_recommendation', (args) => {
        const d = deferred();
        held.push(d);
        return d.promise.then((r) => { if (!r.error) recRows.add(String(args.p_source_session_id)); return r; });
    });
    return held;
}
const recommendationSucceeds = () => rpcImpl.set('record_progress_recommendation', async (args) => {
    recRows.add(String(args.p_source_session_id));
    return { data: `rec-${String(args.p_source_session_id)}`, error: null };
});

beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    rpc.mockClear();
    rpcImpl.clear();
    recRows = new Set();
    recReadError = null;
    evalRow = { ...ELIGIBLE };
    evalReadError = null;
    recommendationSucceeds();
    rpcImpl.set('advance_recommendation_attempt', async () => ({ data: 'moved', error: null }));
    useSessionStore.getState().setProgressGate(null);
});

describe('B1 — a held recommendation never holds the successful-save unlock', () => {
    it('returns `recorded` while the recommendation is still in flight, with the obligation durably written', async () => {
        const held = holdRecommendation();
        const outcome = await within(wireProgressEvaluationOnSave(SAVE(N)));
        expect(outcome, 'the save waited on the recommendation round trip').toEqual({ kind: 'recorded' });
        expect(getQueuedSessionIdsForUser(USER).sessionIds, 'the evaluation debt is retired').toEqual([]);
        expect(evaluateDurableStartGate(USER)).toEqual({ allowed: true });
        expect(obligationFor(N), 'the recommendation is still owed, durably').toBeDefined();

        await settle();
        held[0].resolve({ data: `rec-${N}`, error: null });
        await settle();
        expect(callsTo('record_progress_recommendation')).toHaveLength(1);
        expect(recRows.has(N)).toBe(true);
        expect(obligationFor(N), 'a confirmed recommendation retires its obligation').toBeUndefined();
    });
});

describe('B2/B10 — an interrupted recommendation survives older clients and is recovered on the next load', () => {
    it('old-client queue clear and v1 rewrite leave the obligation; the next load creates it once and retires it', async () => {
        holdRecommendation(); // never released: the page "closes" with the recommendation in flight
        expect(await within(wireProgressEvaluationOnSave(SAVE(N)))).toEqual({ kind: 'recorded' });
        expect(obligationFor(N)).toBeDefined();

        // A shipped (older) tab: its load round clears/tombstones every queue key, and it rewrites the v1 aggregate.
        for (const k of Object.keys(localStorage).filter((key) => key.startsWith(PROGRESS_QUEUE_V2_PREFIX))) localStorage.removeItem(k);
        localStorage.setItem(PROGRESS_QUEUE_STORAGE_KEY, JSON.stringify([]));
        expect(OBLIGATION_PREFIX.startsWith(PROGRESS_QUEUE_V2_PREFIX) || OBLIGATION_PREFIX === PROGRESS_QUEUE_STORAGE_KEY).toBe(false);
        expect(obligationFor(N), 'an older client cannot see, rewrite or retire the obligation').toBeDefined();
        expect(evaluateDurableStartGate(USER), 'and the obligation never holds Start').toEqual({ allowed: true });

        // Next load on a new client.
        recommendationSucceeds();
        await reconcileProgressEvaluations(USER, []);
        expect(recRows.has(N)).toBe(true);
        expect(obligationFor(N), 'recovered and retired').toBeUndefined();
    });
});

describe('B3 — only an evidentiary outcome retires the obligation', () => {
    it('a failed recommendation keeps the obligation (non-blocking) for the next load', async () => {
        rpcImpl.set('record_progress_recommendation', async () => ({ data: null, error: { message: 'x' } }));
        expect(await within(wireProgressEvaluationOnSave(SAVE(N)))).toEqual({ kind: 'recorded' });
        await settle();
        expect(obligationFor(N)).toBeDefined();
        expect(evaluateDurableStartGate(USER)).toEqual({ allowed: true });
    });

    it('a lost success (RPC error, row present on readback) is recorded and retires it', async () => {
        rpcImpl.set('record_progress_recommendation', async (args) => {
            recRows.add(String(args.p_source_session_id));
            return { data: null, error: { message: 'connection reset' } };
        });
        await wireProgressEvaluationOnSave(SAVE(N));
        await settle();
        expect(obligationFor(N)).toBeUndefined();
    });

    it('an authoritative ineligible evaluation is terminal and retires it', async () => {
        evalRow = { ...ELIGIBLE, eligible: false };
        await wireProgressEvaluationOnSave(SAVE(N));
        await settle();
        expect(callsTo('record_progress_recommendation')).toHaveLength(0);
        expect(obligationFor(N)).toBeUndefined();
    });

    it.each([
        ['an evaluation read error', () => { evalReadError = { message: 'x' }; }],
        ['an absent evaluation', () => { evalRow = null; }],
        ['a failed recommendation readback', () => { recReadError = { message: 'x' }; }],
    ])('%s is failed, never a reason to clear', async (_label, arrange) => {
        arrange(); // only the downstream reads see it: the evaluation itself is an RPC and is still recorded
        expect(await wireProgressEvaluationOnSave(SAVE(N))).toEqual({ kind: 'recorded' });
        await settle();
        expect(obligationFor(N), 'unconfirmed after the save').toBeDefined();
        await reconcileProgressEvaluations(USER, []);
        expect(obligationFor(N), 'and still retryable after the next load').toBeDefined();
    });
});

describe('B4 — a failed obligation write keeps Start blocked, and downstream still runs', () => {
    it('is unresolved, leaves the queue entry blocking, and still dispatches the recommendation', async () => {
        failWritesTo((k) => k.startsWith(OBLIGATION_PREFIX));
        const outcome = await within(wireProgressEvaluationOnSave(SAVE(N)));
        expect(outcome).toEqual({ kind: 'unresolved', reason: 'queue_unavailable' });
        expect(getQueuedSessionIdsForUser(USER).sessionIds).toEqual([N]);
        expect(evaluateDurableStartGate(USER)).toMatchObject({ allowed: false, reason: 'queued_debt' });
        await settle();
        expect(callsTo('record_progress_recommendation'), 'downstream is caught, not dropped').toHaveLength(1);
    });
});

describe('B5 — the attempt is bound before anything non-blocking is published, and a failed bind blocks', () => {
    it('a failed binding is unresolved: nothing published, nothing advanced, and the debt keeps blocking', async () => {
        acceptAttempt('att-1', 'sess-source');
        failWritesTo((k) => k === OPEN_ATTEMPT_KEY);
        const outcome = await within(wireProgressEvaluationOnSave(SAVE(N)));
        expect(outcome).toEqual({ kind: 'unresolved', reason: 'attempt_binding_unavailable' });
        expect(getQueuedSessionIdsForUser(USER).sessionIds, 'the obligation keeps blocking').toEqual([N]);
        expect(evaluateDurableStartGate(USER)).toMatchObject({ allowed: false, reason: 'queued_debt' });
        expect(obligationFor(N), 'no non-blocking marker before the binding').toBeUndefined();
        await settle();
        expect(callsTo('advance_recommendation_attempt')).toHaveLength(0);
        expect(getOpenAttemptForUser(USER)?.resolutionSessionId).toBeUndefined();

        // A retry round while the binding still cannot be written retires nothing.
        await attemptProgressDebtRound(USER, 'retry');
        expect(getQueuedSessionIdsForUser(USER).sessionIds).toEqual([N]);

        // Storage recovers: the round binds the attempt to N — the take saved after acceptance — before it clears.
        vi.restoreAllMocks();
        await attemptProgressDebtRound(USER, 'retry');
        expect(getQueuedSessionIdsForUser(USER).sessionIds).toEqual([]);
        await settle();
        expect(callsTo('advance_recommendation_attempt').map((c) => c[1].p_practice_session_id)).toEqual([N]);
    });

    it('binds BEFORE publishing: the open attempt names N by the time the queue entry is gone', async () => {
        acceptAttempt('att-b5-order', 'sess-source');
        // The clear is published as the queue TOMBSTONE write: by then the binding must already be durable.
        const realSet = Storage.prototype.setItem;
        let boundWhenCleared: string | undefined | null = null;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
            if (k.startsWith(`${PROGRESS_QUEUE_V2_PREFIX}t|`) && boundWhenCleared === null) boundWhenCleared = getOpenAttemptForUser(USER)?.resolutionSessionId;
            return realSet.call(this, k, v);
        });
        rpcImpl.set('advance_recommendation_attempt', () => deferred().promise);
        expect(await within(wireProgressEvaluationOnSave(SAVE(N)))).toEqual({ kind: 'recorded' });
        expect(boundWhenCleared).toBe(N);
    });
});

describe('B6 — rapid N then N+1: one advance, bound to N', () => {
    it('N+1 joins N\'s in-flight advance instead of rebinding or advancing again', async () => {
        acceptAttempt('att-b6', 'sess-source');
        const advance = deferred();
        rpcImpl.set('advance_recommendation_attempt', () => advance.promise);
        expect(await within(wireProgressEvaluationOnSave(SAVE(N))), 'the held advance held the save').toEqual({ kind: 'recorded' });
        expect(await within(wireProgressEvaluationOnSave(SAVE(N1)))).toEqual({ kind: 'recorded' });
        await settle();
        const advances = callsTo('advance_recommendation_attempt');
        expect(advances).toHaveLength(1);
        expect(advances[0][1]).toMatchObject({ p_attempt_id: 'att-b6', p_practice_session_id: N });
        expect(getOpenAttemptForUser(USER)?.resolutionSessionId).toBe(N);

        advance.resolve({ data: 'moved', error: null });
        await settle();
        expect(getOpenAttemptForUser(USER), 'resolved exactly once and closed').toBeNull();
        expect(recRows.has(N1), 'N+1 still gets its own recommendation').toBe(true);
    });
});

describe('B7 — a late result never erases another owner\'s or a newer attempt', () => {
    it('owner A\'s late advance leaves owner B\'s newly accepted attempt in place', async () => {
        acceptAttempt('att-a', 'sess-source');
        const advance = deferred();
        rpcImpl.set('advance_recommendation_attempt', () => advance.promise);
        await wireProgressEvaluationOnSave(SAVE(N));
        await settle();
        // Account switch: owner B accepts their own recommendation while A's advance is still held.
        acceptAttempt('att-b', 'sess-b-source', 'user-2');
        advance.resolve({ data: 'moved', error: null });
        await settle();
        expect(getOpenAttemptForUser('user-2')?.attemptId).toBe('att-b');
    });

    it('a late recommendation result does not retire a NEWER obligation generation for the same session', async () => {
        const held = holdRecommendation();
        await wireProgressEvaluationOnSave(SAVE(N));
        const first = localStorage.getItem(obligationFor(N)!);
        // A later save of the same session (retry path) writes a newer generation.
        await wireProgressEvaluationOnSave(SAVE(N));
        const second = localStorage.getItem(obligationFor(N)!);
        expect(second).not.toBe(first);
        held[0].resolve({ data: null, error: { message: 'lost' } }); // the first generation's result arrives late, failed
        await settle();
        expect(localStorage.getItem(obligationFor(N)!)).toBe(second);
    });
});

describe('B8 — failure paths publish nothing and dispatch nothing', () => {
    it('a failed evaluation with a durable queue is queued: no obligation, no recommendation', async () => {
        rpcImpl.set('record_progress_evaluation', async () => ({ data: null, error: { message: 'x' } }));
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            const outcome = await wireProgressEvaluationOnSave(SAVE(N));
            expect(outcome).toEqual({ kind: 'queued' });
        } finally { vi.useRealTimers(); }
        expect(obligationFor(N)).toBeUndefined();
        expect(callsTo('record_progress_recommendation')).toHaveLength(0);
    });
});

describe('B11 — controller parity: with downstream held, Start is open and nothing says "Finishing up"', () => {
    interface Ctl {
        completeProgressForRecording: (ctx: unknown, sessionId: string, attribution: string, metricsPersisted: boolean, canPublish: () => boolean) => Promise<{ kind: string }>;
    }
    const makeController = (): Ctl => {
        const c = Object.create(SpeechRuntimeController.prototype) as unknown as Ctl & Record<string, unknown>;
        c.capturedUserId = USER;
        return c;
    };
    it.each([
        ['Open Mic', { mode: 'open_mic' }],
        ['Focus Points', { mode: 'focus_points', brief: { projectId: 'p', briefId: 'b' }, segments: [], durationSeconds: 10 }],
    ])('%s', async (_label, ctx) => {
        finalizeObjectiveSessionOnSave.mockResolvedValue({ ok: true, registered: true, coverage: null });
        acceptAttempt(`att-b11-${String((ctx as { mode: string }).mode)}`, 'sess-source');
        holdRecommendation();
        rpcImpl.set('advance_recommendation_attempt', () => deferred().promise);
        const outcome = await within(makeController().completeProgressForRecording(ctx, N, 'verified', true, () => true));
        expect(outcome).toEqual({ kind: 'recorded' });
        expect(useSessionStore.getState().progressGate, 'no "Finishing up" while downstream is in flight').toBeNull();
        expect(evaluateDurableStartGate(USER)).toEqual({ allowed: true });
    });
});
