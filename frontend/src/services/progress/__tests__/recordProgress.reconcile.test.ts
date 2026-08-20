import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #1265 — durable recovery after the mode-ambiguous generic sweep was REMOVED. Recovery is limited to the
 * owner-scoped durable queue, which is authoritative about practice mode by construction: a Focus Points
 * session is enqueued only AFTER its objective registration succeeds (so a re-evaluation is cohorted
 * 'objective'); an Open Mic session is enqueued on a transient eval failure; a failed FP registration
 * enqueues nothing. A completed session that is NOT in the queue is never auto-recorded — so an
 * unregistered Focus Points recording can never be permanently stamped 'freeform' on reload.
 */

const rpc = vi.fn();
let attemptReadback: Record<string, unknown> | null = null;
let attemptReadError: unknown = null;
const maybeSingle = vi.fn(async (table?: string) => table === 'progress_recommendation_attempts'
    ? { data: attemptReadback, error: attemptReadError }
    : { data: { eligible: false }, error: null });
function makeChain(table: string) {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.in = () => chain;
    chain.maybeSingle = () => maybeSingle(table);
    (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
    return chain;
}
const from = vi.fn((table: string) => makeChain(table));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc, from }) }));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

import { reconcileProgressEvaluations } from '../recordProgress';
import { enqueueProgressReconcile, getQueuedSessionIdsForUser } from '../progressReconcileQueue';

const USER = 'user-1';
const recordedIds = () => rpc.mock.calls.filter((c) => c[0] === 'record_progress_evaluation').map((c) => c[1].p_session_id);

beforeEach(() => {
    localStorage.clear();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: 'ok-id', error: null });
    from.mockClear(); maybeSingle.mockClear();
    attemptReadback = null; attemptReadError = null;
});

describe('#1265 durable recovery — generic sweep removed', () => {
    const sess = (id: string, over: Record<string, unknown> = {}) => ({
        id, status: 'completed', attribution_status: 'verified', created_at: '2026-07-31T00:00:00Z', ...over,
    });

    it('drains the owner-scoped durable queue, recording each queued session (idempotent RPC)', async () => {
        enqueueProgressReconcile('s-queued', USER, '2026-07-31T00:00:00Z');
        const res = await reconcileProgressEvaluations(USER, []);
        expect(res.queueDrained).toBe(1);
        expect(recordedIds()).toEqual(['s-queued']);
        expect(getQueuedSessionIdsForUser(USER)).toEqual([]); // cleared on success
    });

    it('does NOT auto-record a completed session missing an evaluation (no mode-ambiguous sweep)', async () => {
        // The removed sweep could not identify the mode before writing the immutable evaluation, so an
        // unregistered Focus Points recording could be permanently stamped 'freeform'. With it gone, a
        // completed session that is not durably queued is left untouched — "no evaluation" over false mode.
        const res = await reconcileProgressEvaluations(USER, [sess('s-missing', { created_at: '2026-07-25T00:00:00Z' })]);
        expect(res.swept).toBe(0);
        expect(recordedIds()).not.toContain('s-missing');
    });

    it('recovers ONLY queued sessions; ignores non-queued completed sessions', async () => {
        enqueueProgressReconcile('s-queued', USER, '2026-07-31T00:00:00Z');
        const res = await reconcileProgressEvaluations(USER, [sess('s-queued'), sess('s-other', { created_at: '2026-07-26T00:00:00Z' })]);
        expect(res.queueDrained).toBe(1);
        expect(recordedIds()).toEqual(['s-queued']);
        expect(recordedIds()).not.toContain('s-other');
    });

    it('a failed queue drain leaves the entry for the next load (no duplicate, no loss)', async () => {
        rpc.mockResolvedValueOnce({ data: null, error: { message: 'transient' } }); // first record fails
        enqueueProgressReconcile('s-queued', USER, '2026-07-31T00:00:00Z');
        const res = await reconcileProgressEvaluations(USER, []);
        expect(res.queueDrained).toBe(0);
        expect(getQueuedSessionIdsForUser(USER)).toEqual(['s-queued']); // retained for next load
    });
});
