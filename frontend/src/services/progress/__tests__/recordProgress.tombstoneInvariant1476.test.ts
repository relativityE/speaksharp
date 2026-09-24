/* @vitest-environment jsdom */
/**
 * #1476 PM pre-push RETURN (F3) — THE CODE-LEVEL INVARIANT BEHIND "A TOMBSTONE HIDES ONLY SETTLED DEBT".
 *
 * A Progress tombstone for (owner, session) can hide that session's queue entry, including one another tab wrote
 * concurrently. It is harmless only if a tombstone is written ONLY after the server durably recorded that session's
 * evaluation — once recorded, the session is never owed again (obligations are sessions with NO evaluation row, and an
 * evaluation is never removed except with its session). The only writer of a tombstone is
 * `clearProgressReconcileEntry`, and its only callers are the two paths below (recordProgress.ts: the save-time
 * evaluation and the retry/load drain). These drive both REAL paths against the PRE-APPLY schema — the server has no
 * `get_progress_obligations` (PGRST202) — and assert: no evaluation id, no tombstone; and a tombstone never exists
 * before the evaluation RPC has resolved with an id.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const rpc = vi.fn();
const maybeSingle = vi.fn(async () => ({ data: { eligible: false }, error: null }));
function makeChain() {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.in = () => chain;
    chain.maybeSingle = () => maybeSingle();
    (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
    return chain;
}
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc, from: vi.fn(() => makeChain()) }) }));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

import { reconcileProgressEvaluations, wireProgressEvaluationOnSave } from '../recordProgress';
import { enqueueProgressReconcile, getQueueEntriesForUser } from '../progressReconcileQueue';

const USER = 'owner-1476-invariant';
const SESSION = 'sess-1476-invariant';
const TOMB_PREFIX = 'ss_progress_reconcile_queue_v2|t|';
const hasTomb = () => Object.keys(localStorage).some((k) => k.startsWith(TOMB_PREFIX));
const entryVisible = () => {
    const r = getQueueEntriesForUser(USER);
    return r.ok && r.entries.some((e) => e.sessionId === SESSION);
};

/** Pre-apply server: the evaluation RPC exists (it predates #1476); the obligations RPC does not. */
function preApplyServer(evaluation: () => Promise<{ data: unknown; error: unknown }>) {
    rpc.mockImplementation(async (fn: string) => {
        if (fn === 'get_progress_obligations') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
        if (fn === 'record_progress_evaluation') return evaluation();
        return { data: null, error: null };
    });
}
/** Record the moment every tombstone write happens, relative to the evaluation RPC resolving. */
function watchTombstoneWrites(events: string[]) {
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
        if (key.startsWith(TOMB_PREFIX)) events.push('tombstone-written');
        return original.call(this, key, value);
    });
}

beforeEach(() => { localStorage.clear(); rpc.mockReset(); maybeSingle.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('#1476 F3 invariant — a tombstone exists only after the server recorded the evaluation (pre-apply schema)', () => {
    it('RETRY/LOAD DRAIN: an evaluation RPC that FAILS writes no tombstone; the debt stays visible', async () => {
        enqueueProgressReconcile(SESSION, USER, '2026-09-23T12:00:00.000Z');
        preApplyServer(async () => ({ data: null, error: { message: 'evaluation failed' } }));
        await reconcileProgressEvaluations(USER, []);
        expect(hasTomb()).toBe(false);
        expect(entryVisible()).toBe(true);
    });

    it('RETRY/LOAD DRAIN: an answer with NO evaluation id writes no tombstone', async () => {
        enqueueProgressReconcile(SESSION, USER, '2026-09-23T12:00:00.000Z');
        preApplyServer(async () => ({ data: null, error: null }));
        await reconcileProgressEvaluations(USER, []);
        expect(hasTomb()).toBe(false);
        expect(entryVisible()).toBe(true);
    });

    it('RETRY/LOAD DRAIN: the tombstone is written only AFTER the evaluation RPC resolved with an id', async () => {
        enqueueProgressReconcile(SESSION, USER, '2026-09-23T12:00:00.000Z');
        const events: string[] = [];
        watchTombstoneWrites(events);
        preApplyServer(async () => { events.push('evaluation-recorded'); return { data: 'eval-1', error: null }; });
        await reconcileProgressEvaluations(USER, []);
        expect(events).toEqual(['evaluation-recorded', 'tombstone-written']);
        expect(entryVisible()).toBe(false);
    });

    it('SAVE PATH: a failed evaluation leaves the write-ahead debt and no tombstone; a recorded one is followed by it', async () => {
        preApplyServer(async () => ({ data: null, error: { message: 'evaluation failed' } }));
        await wireProgressEvaluationOnSave({ sessionId: SESSION, status: 'completed', attributionStatus: 'verified', metricsPersisted: true, userId: USER });
        expect(hasTomb()).toBe(false);
        expect(entryVisible(), 'the write-ahead obligation survives').toBe(true);

        localStorage.clear();
        const events: string[] = [];
        watchTombstoneWrites(events);
        preApplyServer(async () => { events.push('evaluation-recorded'); return { data: 'eval-2', error: null }; });
        await wireProgressEvaluationOnSave({ sessionId: SESSION, status: 'completed', attributionStatus: 'verified', metricsPersisted: true, userId: USER });
        expect(events).toEqual(['evaluation-recorded', 'tombstone-written']);
    });
});
