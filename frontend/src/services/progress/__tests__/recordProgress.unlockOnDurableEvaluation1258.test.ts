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
const { getQueuedSessionIdsForUser, enqueueProgressReconcile, PROGRESS_QUEUE_V2_PREFIX, PROGRESS_QUEUE_STORAGE_KEY } = await import('../progressReconcileQueue');
const { setOpenAttempt, getOpenAttemptForUser } = await import('../openAttempt');
const { recordRecommendationObligation } = await import('../progressRecommendationObligation');

const USER = 'user-1';
const N = 'sess-n';
const N1 = 'sess-n1';
/** The obligation's own storage namespace, spelled literally: it must never collide with the shipped queue's. */
const OBLIGATION_PREFIX: string = 'ss_progress_recommendation_owed_v1|';
const OPEN_ATTEMPT_KEY = 'ss_progress_open_attempt_v1';
/** The take's recording start defaults to AFTER the default acceptance (10:00), as for a take this page started. */
const SAVE = (sessionId: string, userId: string | null = USER, takeStartedAtIso: string | null = '2026-10-13T11:00:00.000Z') =>
    ({ sessionId, status: 'completed', attributionStatus: 'verified', metricsPersisted: true, userId, takeStartedAtIso });

const obligationKeys = () => Object.keys(localStorage).filter((k) => k.startsWith(OBLIGATION_PREFIX));
/** Every generation key this owner holds for one take (`…|<owner>|<session>|<generation>`). */
const obligationsFor = (sessionId: string, userId = USER) => {
    const base = `${OBLIGATION_PREFIX}${encodeURIComponent(userId)}|${encodeURIComponent(sessionId)}`;
    return obligationKeys().filter((k) => k === base || k.startsWith(`${base}|`));
};
/** The generations still owed for one take, read from the stored values (independent of the key layout). */
const generationsFor = (sessionId: string) =>
    obligationsFor(sessionId).map((k) => (JSON.parse(localStorage.getItem(k) ?? '{}') as { generation?: string }).generation);
const obligationFor = (sessionId: string) => obligationsFor(sessionId)[0];
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

describe('Codex P1 r4272602941 — a not-due attempt is never bound or advanced downstream', () => {
    it('save path: an attempt accepted AFTER this save began is left for the take that follows it', async () => {
        acceptAttempt('att-p1-save', 'sess-source', USER, '2099-01-01T00:00:00.000Z');
        expect(await within(wireProgressEvaluationOnSave(SAVE(N)))).toEqual({ kind: 'recorded' });
        await settle();
        expect(callsTo('advance_recommendation_attempt'), 'no advance for a take the attempt does not belong to').toHaveLength(0);
        expect(getOpenAttemptForUser(USER)?.resolutionSessionId, 'and no binding to it').toBeUndefined();
    });

    it('round path: a queued take enqueued BEFORE acceptance is retired without binding or advancing the attempt', async () => {
        enqueueProgressReconcile('sess-old', USER, '2026-10-13T09:00:00.000Z');
        acceptAttempt('att-p1-round', 'sess-source', USER, '2026-10-13T10:00:00.000Z');
        await attemptProgressDebtRound(USER, 'retry');
        await settle();
        expect(getQueuedSessionIdsForUser(USER).sessionIds).toEqual([]);
        expect(callsTo('advance_recommendation_attempt')).toHaveLength(0);
        expect(getOpenAttemptForUser(USER)?.resolutionSessionId).toBeUndefined();
    });
});

describe('Codex P1 r4273828969 — acceptance is compared with the TAKE\'S START, not the late Progress seam', () => {
    it('save path: a take that STARTED before acceptance is not bound, even though its Progress seam runs after it', async () => {
        acceptAttempt('att-c1-save', 'sess-source', USER, '2026-10-14T10:00:00.000Z');
        // The take started at 09:59 (before acceptance); its seam runs "now" (long after) — the old boundary.
        expect(await within(wireProgressEvaluationOnSave(SAVE(N, USER, '2026-10-14T09:59:00.000Z')))).toEqual({ kind: 'recorded' });
        await settle();
        expect(getOpenAttemptForUser(USER)?.resolutionSessionId, 'a pre-acceptance take is never the practice take').toBeUndefined();
        expect(callsTo('advance_recommendation_attempt')).toHaveLength(0);
    });

    it('save path: a take that started AFTER acceptance is bound', async () => {
        acceptAttempt('att-c1-after', 'sess-source', USER, '2026-10-14T10:00:00.000Z');
        expect(await within(wireProgressEvaluationOnSave(SAVE(N, USER, '2026-10-14T10:01:00.000Z')))).toEqual({ kind: 'recorded' });
        await settle();
        // Bound to N and resolved against N (the resolved attempt is then cleared from the handoff).
        expect(callsTo('advance_recommendation_attempt').map((c) => c[1].p_practice_session_id)).toEqual([N]);
    });

    it('round path: a queued take enqueued after acceptance but STARTED before it is not bound', async () => {
        enqueueProgressReconcile('sess-pre', USER, '2026-10-14T10:00:30.000Z', '2026-10-14T09:59:00.000Z');
        acceptAttempt('att-c1-round', 'sess-source', USER, '2026-10-14T10:00:00.000Z');
        await attemptProgressDebtRound(USER, 'retry');
        await settle();
        expect(getQueuedSessionIdsForUser(USER).sessionIds).toEqual([]);
        expect(getOpenAttemptForUser(USER)?.resolutionSessionId).toBeUndefined();
        expect(callsTo('advance_recommendation_attempt')).toHaveLength(0);
    });
});

describe('PM 6174115505 — an UNKNOWN take start fails closed (never guessed from the seam or the enqueue stamp)', () => {
    it('save path: a take whose start is unknown (e.g. completed after a reload) is not bound', async () => {
        acceptAttempt('att-unknown-save', 'sess-source');
        expect(await within(wireProgressEvaluationOnSave(SAVE(N, USER, null)))).toEqual({ kind: 'recorded' });
        await settle();
        expect(getOpenAttemptForUser(USER)?.resolutionSessionId).toBeUndefined();
        expect(callsTo('advance_recommendation_attempt')).toHaveLength(0);
    });
    it('round path: a queued take with no recorded start is not bound, even when queued after acceptance', async () => {
        acceptAttempt('att-unknown-round', 'sess-source', USER, '2026-10-13T10:00:00.000Z');
        enqueueProgressReconcile('sess-nostart', USER, '2026-10-13T12:00:00.000Z');
        await attemptProgressDebtRound(USER, 'retry');
        await settle();
        expect(getQueuedSessionIdsForUser(USER).sessionIds).toEqual([]);
        expect(getOpenAttemptForUser(USER)?.resolutionSessionId).toBeUndefined();
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

    // PM 6156497917 (P1): a TERMINAL late result for generation G1 reaches its clear exactly when another context publishes
    // G2 for the same take. A read-check-remove of one shared key deleted G2 here. G2 must survive and be recoverable.
    it.each([
        ['an ordinary terminal success', (args: Record<string, unknown>) => {
            recRows.add(String(args.p_source_session_id));
            return { data: `rec-${String(args.p_source_session_id)}`, error: null };
        }],
        ['a lost success (RPC error, row present on readback)', (args: Record<string, unknown>) => {
            recRows.add(String(args.p_source_session_id));
            return { data: null, error: { message: 'connection reset' } };
        }],
    ])('G2 published at G1\'s clear boundary survives %s and is recovered on the next load', async (_label, answer) => {
        const g1 = deferred();
        rpcImpl.set('record_progress_recommendation', async (args) => { await g1.promise; return answer(args); });
        expect(await within(wireProgressEvaluationOnSave(SAVE(N)))).toEqual({ kind: 'recorded' });
        const [g1Key] = obligationsFor(N);
        expect(g1Key).toBeDefined();

        // At the instant G1's settlement retires its obligation, another context writes G2 for the same take.
        let g2: string | undefined;
        let g2Published = false;
        const realRemove = Storage.prototype.removeItem;
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, k: string) {
            if (k.startsWith(OBLIGATION_PREFIX) && !g2Published) {
                g2Published = true;
                const written = recordRecommendationObligation(USER, N, new Date().toISOString());
                g2 = written.ok ? written.generation : undefined;
            }
            return realRemove.call(this, k);
        });
        g1.resolve({ data: null, error: null });
        await settle();

        expect(g2, 'G2 was published at the clear boundary').toBeDefined();
        expect(generationsFor(N), 'G1 retired itself and nothing else: G2 is still owed').toEqual([g2]);

        vi.restoreAllMocks();
        recommendationSucceeds();
        await reconcileProgressEvaluations(USER, []);
        expect(obligationsFor(N), 'G2 recovered and retired by the next load').toEqual([]);
    });

    it('a late FAILED result for G1 clears nothing; both generations stay owed', async () => {
        const held = holdRecommendation();
        await wireProgressEvaluationOnSave(SAVE(N));
        await wireProgressEvaluationOnSave(SAVE(N)); // a later save of the same take publishes a newer generation
        expect(obligationsFor(N)).toHaveLength(2);
        held[0].resolve({ data: null, error: { message: 'lost' } });
        await settle();
        expect(obligationsFor(N)).toHaveLength(2);
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

describe('PM 6174115505 — the controller carries each take\'s remembered start into its Progress seam', () => {
    interface Ctl {
        completeProgressForRecording: (ctx: unknown, sessionId: string, attribution: string, metricsPersisted: boolean, canPublish: () => boolean) => Promise<{ kind: string }>;
    }
    const controllerWith = (starts: Map<string, string> | undefined): Ctl => {
        const c = Object.create(SpeechRuntimeController.prototype) as unknown as Ctl & Record<string, unknown>;
        c.capturedUserId = USER;
        c.takeStartedAtBySession = starts;
        return c;
    };
    it.each([
        ['Open Mic', { mode: 'open_mic' }],
        ['Focus Points', { mode: 'focus_points', brief: { projectId: 'p', briefId: 'b' }, segments: [], durationSeconds: 10 }],
    ])('%s: a take started after acceptance is bound through the seam; the same take with no remembered start is not', async (_label, ctx) => {
        finalizeObjectiveSessionOnSave.mockResolvedValue({ ok: true, registered: true, coverage: null });
        acceptAttempt(`att-seam-${String((ctx as { mode: string }).mode)}`, 'sess-source', USER, '2026-10-13T10:00:00.000Z');
        // After a reload (no remembered start): unbound — fail closed.
        expect(await controllerWith(undefined).completeProgressForRecording(ctx, N, 'verified', true, () => true)).toEqual({ kind: 'recorded' });
        await settle();
        expect(callsTo('advance_recommendation_attempt')).toHaveLength(0);
        // The same page that started it: bound to it.
        expect(await controllerWith(new Map([[N1, '2026-10-13T10:05:00.000Z']])).completeProgressForRecording(ctx, N1, 'verified', true, () => true))
            .toEqual({ kind: 'recorded' });
        await settle();
        expect(callsTo('advance_recommendation_attempt').map((c) => c[1].p_practice_session_id)).toEqual([N1]);
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

describe('Codex P2 r4275389965 — on load, an earlier page\'s owed recommendation never holds blocking evaluation debt', () => {
    it('a hung recommendation for an OLD take does not delay the load round that retires a blocking queue entry', async () => {
        const OLD = 'sess-old';
        expect(recordRecommendationObligation(USER, OLD, '2026-10-13T09:00:00.000Z').ok).toBe(true);
        expect(enqueueProgressReconcile(N, USER, new Date().toISOString(), '2026-10-13T11:00:00.000Z').ok).toBe(true);
        expect(evaluateDurableStartGate(USER)).toMatchObject({ allowed: false, reason: 'queued_debt' });
        const held = holdRecommendation(); // every recommendation call hangs until released
        const load = reconcileProgressEvaluations(USER, []);
        await settle();
        expect(callsTo('record_progress_evaluation').map((c) => c[1].p_session_id), 'the round ran while the old recommendation hangs').toContain(N);
        expect(getQueuedSessionIdsForUser(USER).sessionIds).not.toContain(N);
        expect(evaluateDurableStartGate(USER)).toEqual({ allowed: true });
        for (const d of held) d.resolve({ data: null, error: null });
        await settle();
        for (const d of held) d.resolve({ data: null, error: null });
        await load;
    });
});

describe('Codex P1 r4275718048 — a take queued first WITHOUT its start (server-obligation hydration) gains it from its save', () => {
    const startOf = (sessionId: string) => {
        const raw = Object.keys(localStorage).filter((k) => k.startsWith(PROGRESS_QUEUE_V2_PREFIX))
            .map((k) => JSON.parse(localStorage.getItem(k) ?? '{}') as { sessionId?: string; takeStartedAtIso?: string })
            .find((e) => e.sessionId === sessionId);
        return raw?.takeStartedAtIso;
    };
    it('the save merges its start into the existing entry, and a later retry round binds the accepted attempt to that take', async () => {
        acceptAttempt('att-hydrated', 'sess-source', USER, '2026-10-14T10:00:00.000Z');
        expect(enqueueProgressReconcile(N, USER, '2026-10-14T10:02:00.000Z').ok).toBe(true); // hydration: no boundary
        expect(startOf(N)).toBeUndefined();
        rpcImpl.set('record_progress_evaluation', async () => ({ data: null, error: { message: 'x' } }));
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            expect(await wireProgressEvaluationOnSave(SAVE(N, USER, '2026-10-14T10:01:00.000Z'))).toEqual({ kind: 'queued' });
        } finally { vi.useRealTimers(); }
        expect(startOf(N)).toBe('2026-10-14T10:01:00.000Z');
        expect(callsTo('advance_recommendation_attempt')).toHaveLength(0);
        rpcImpl.delete('record_progress_evaluation');
        await attemptProgressDebtRound(USER, 'retry');
        await settle();
        expect(callsTo('advance_recommendation_attempt').map((c) => c[1].p_practice_session_id)).toEqual([N]);
    });
    it('an existing earlier start is kept; a missing start never erases a known one', () => {
        expect(enqueueProgressReconcile(N1, USER, '2026-10-14T10:02:00.000Z', '2026-10-14T10:01:00.000Z').ok).toBe(true);
        expect(enqueueProgressReconcile(N1, USER, '2026-10-14T10:03:00.000Z', '2026-10-14T10:01:30.000Z').ok).toBe(true);
        expect(enqueueProgressReconcile(N1, USER, '2026-10-14T10:04:00.000Z').ok).toBe(true);
        expect(startOf(N1)).toBe('2026-10-14T10:01:00.000Z');
    });
});

describe('PM 6178959404 — a reused attempt accepted at the retry press never binds an earlier take', () => {
    it('a take that began between the failed local press and the retry stays unlinked; the next take is bound', async () => {
        // What the linked repeat stores on an unproved reuse: the retry press (11:01), not the failed press (11:00).
        acceptAttempt('att-reused', 'sess-source', USER, '2026-10-14T11:01:00.000Z');
        expect(await within(wireProgressEvaluationOnSave(SAVE(N, USER, '2026-10-14T11:00:30.000Z')))).toEqual({ kind: 'recorded' });
        await settle();
        expect(callsTo('advance_recommendation_attempt')).toHaveLength(0);
        expect(await within(wireProgressEvaluationOnSave(SAVE(N1, USER, '2026-10-14T11:02:00.000Z')))).toEqual({ kind: 'recorded' });
        await settle();
        expect(callsTo('advance_recommendation_attempt').map((c) => c[1].p_practice_session_id)).toEqual([N1]);
    });
});

describe('Codex P2 r4276808814 — a load round evaluates every blocking entry before waiting on downstream work', () => {
    it('a stalled recommendation for the FIRST entry does not keep the second entry queued or Start blocked', async () => {
        expect(enqueueProgressReconcile(N, USER, '2026-10-14T10:00:00.000Z', '2026-10-14T09:59:00.000Z').ok).toBe(true);
        expect(enqueueProgressReconcile(N1, USER, '2026-10-14T10:05:00.000Z', '2026-10-14T10:04:00.000Z').ok).toBe(true);
        expect(evaluateDurableStartGate(USER)).toMatchObject({ allowed: false, reason: 'queued_debt' });
        const held = holdRecommendation(); // every recommendation call hangs until released
        const round = attemptProgressDebtRound(USER, 'load');
        await settle();
        expect(callsTo('record_progress_evaluation').map((c) => c[1].p_session_id)).toEqual([N, N1]);
        expect(getQueuedSessionIdsForUser(USER).sessionIds).toEqual([]);
        expect(evaluateDurableStartGate(USER)).toEqual({ allowed: true });
        expect(await within(round, 50), 'the load round itself still waits for its downstream work').toBe('HELD');
        for (const d of held) d.resolve({ data: null, error: null });
        expect(await round).toMatchObject({ drained: 2 });
    });
});
