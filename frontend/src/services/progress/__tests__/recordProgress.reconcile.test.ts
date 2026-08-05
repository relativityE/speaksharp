import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #1045 — durable recovery (queue drain + bounded active-era sweep) and the "Practice this next" loop
 * closure (open attempt resolved against the next saved session).
 */

const rpc = vi.fn();
// The evaluations SELECT used by the sweep (awaited) and by recommendation derivation (.maybeSingle()).
let coveredRows: Array<{ session_id: string }> = [];
let attemptReadback: Record<string, unknown> | null = null;
let attemptReadError: unknown = null;
const maybeSingle = vi.fn(async (table?: string) => table === 'progress_recommendation_attempts'
    ? { data: attemptReadback, error: attemptReadError }
    : { data: { eligible: false }, error: null });
function makeChain(table: string) {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.maybeSingle = () => maybeSingle(table);
    // Awaiting the chain (the sweep's list query) resolves to the covered rows.
    (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: coveredRows, error: null });
    return chain;
}
const from = vi.fn((table: string) => makeChain(table));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc, from }) }));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

import { reconcileProgressEvaluations, wireProgressEvaluationOnSave } from '../recordProgress';
import { enqueueProgressReconcile, getQueuedSessionIdsForUser } from '../progressReconcileQueue';
import { clearOpenAttemptIfMatches, setOpenAttempt, getOpenAttemptForUser } from '../openAttempt';

const USER = 'user-1';
const rpcNames = () => rpc.mock.calls.map((c) => c[0]);

beforeEach(() => {
    localStorage.clear();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: 'ok-id', error: null });
    from.mockClear(); maybeSingle.mockClear();
    coveredRows = [];
    attemptReadback = null; attemptReadError = null;
});

describe('#1045 durable recovery — reconcileProgressEvaluations', () => {
    const sess = (id: string, over: Record<string, unknown> = {}) => ({
        id, status: 'completed', attribution_status: 'verified', created_at: '2026-07-31T00:00:00Z', ...over,
    });

    it('drains the owner-scoped queue, recording each queued session (idempotent RPC)', async () => {
        enqueueProgressReconcile('s-queued', USER, '2026-07-31T00:00:00Z');
        const res = await reconcileProgressEvaluations(USER, []);
        expect(res.queueDrained).toBe(1);
        expect(rpc).toHaveBeenCalledWith('record_progress_evaluation', { p_session_id: 's-queued' });
        expect(getQueuedSessionIdsForUser(USER)).toEqual([]); // cleared on success
    });

    it('sweeps only ACTIVE-ERA sessions missing an evaluation; never pre-activation history', async () => {
        // s-old already has an evaluation (covered); it defines the era start.
        coveredRows = [{ session_id: 's-old' }];
        const sessions = [
            sess('s-pre', { created_at: '2026-07-01T00:00:00Z' }), // BEFORE era start — must be skipped
            sess('s-old', { created_at: '2026-07-20T00:00:00Z' }), // covered
            sess('s-gap', { created_at: '2026-07-25T00:00:00Z' }), // in-era, missing -> recorded
        ];
        const res = await reconcileProgressEvaluations(USER, sessions);
        expect(res.swept).toBe(1);
        const recorded = rpc.mock.calls.filter((c) => c[0] === 'record_progress_evaluation').map((c) => c[1].p_session_id);
        expect(recorded).toContain('s-gap');
        expect(recorded).not.toContain('s-pre'); // future-only respected
        expect(recorded).not.toContain('s-old'); // already covered
    });

    it('skips the sweep entirely when NO evaluations exist yet (queue handles first-session)', async () => {
        coveredRows = [];
        const res = await reconcileProgressEvaluations(USER, [sess('s-first')]);
        expect(res.swept).toBe(0);
        expect(rpcNames()).not.toContain('record_progress_evaluation');
    });

    it('skips non-completed sessions, but the RPC (authority) — not the advisory column — decides attribution (finding 5)', async () => {
        coveredRows = [{ session_id: 's-old' }];
        const sessions = [
            sess('s-old', { created_at: '2026-07-20T00:00:00Z' }),
            sess('s-active', { created_at: '2026-07-25T00:00:00Z', status: 'active' }),
            // #1161: attest no longer promotes sessions.attribution_status, so a completed+attested session can
            // read 'pending' here. It must NOT be pre-filtered out — record_progress_evaluation (authority-gated)
            // decides. Here the RPC returns an id (authorized) ⇒ it is swept.
            sess('s-pending', { created_at: '2026-07-26T00:00:00Z', attribution_status: 'pending' }),
        ];
        const res = await reconcileProgressEvaluations(USER, sessions);
        expect(res.swept).toBe(1);   // s-active skipped (non-completed); s-pending evaluated by the authority RPC
    });
});

describe('#1045 "Practice this next" loop closure', () => {
    it('clears only the matching durable handoff after terminal abandonment', () => {
        setOpenAttempt({ attemptId: 'att-new', userId: USER, sourceSessionId: 's-new' });
        expect(clearOpenAttemptIfMatches(USER, 'att-old')).toBe(false);
        expect(getOpenAttemptForUser(USER)?.attemptId).toBe('att-new');
        expect(clearOpenAttemptIfMatches(USER, 'att-new')).toBe(true);
        expect(getOpenAttemptForUser(USER)).toBeNull();
    });

    it('reports matching handoff cleanup failure when storage removal throws or is a no-op', () => {
        setOpenAttempt({ attemptId: 'att-match', userId: USER, sourceSessionId: 's-source' });
        const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => { throw new Error('denied'); });
        expect(clearOpenAttemptIfMatches(USER, 'att-match')).toBe(false);
        expect(getOpenAttemptForUser(USER)?.attemptId).toBe('att-match');
        remove.mockRestore();

        const noOp = vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => undefined);
        expect(clearOpenAttemptIfMatches(USER, 'att-match')).toBe(false);
        expect(getOpenAttemptForUser(USER)?.attemptId).toBe('att-match');
        noOp.mockRestore();
    });

    it('fails closed on malformed storage instead of claiming a matching clear', () => {
        localStorage.setItem('ss_progress_open_attempt_v1', '{malformed');
        expect(clearOpenAttemptIfMatches(USER, 'att-match')).toBe(false);
        expect(localStorage.getItem('ss_progress_open_attempt_v1')).toBe('{malformed');
    });
    it('resolves an open attempt against the next saved session and clears it', async () => {
        setOpenAttempt({ attemptId: 'att-1', userId: USER, sourceSessionId: 's-source' });
        // eval recorded, recommendation derivation no-ops (eligible:false), then the attempt is advanced.
        await wireProgressEvaluationOnSave({
            sessionId: 's-next', status: 'completed', attributionStatus: 'verified', metricsPersisted: true, userId: USER,
        });
        expect(rpcNames()).toContain('advance_recommendation_attempt');
        const advanceCall = rpc.mock.calls.find((c) => c[0] === 'advance_recommendation_attempt');
        expect(advanceCall![1]).toMatchObject({ p_attempt_id: 'att-1', p_lifecycle: 'completed', p_next_comparable_session_id: 's-next' });
        expect(getOpenAttemptForUser(USER)).toBeNull(); // cleared exactly once
    });

    it('never resolves a recommendation against its own source session', async () => {
        setOpenAttempt({ attemptId: 'att-1', userId: USER, sourceSessionId: 's-self' });
        await wireProgressEvaluationOnSave({
            sessionId: 's-self', status: 'completed', attributionStatus: 'verified', metricsPersisted: true, userId: USER,
        });
        expect(rpcNames()).not.toContain('advance_recommendation_attempt');
        expect(getOpenAttemptForUser(USER)).not.toBeNull(); // still open
    });

    it('keeps a technical resolution failure pending and retryable', async () => {
        setOpenAttempt({ attemptId: 'att-technical', userId: USER, sourceSessionId: 's-source' });
        rpc.mockImplementation(async (name: string) => name === 'advance_recommendation_attempt'
            ? { data: null, error: { code: '57014', message: 'network timeout' } }
            : { data: 'ok-id', error: null });
        await wireProgressEvaluationOnSave({
            sessionId: 's-next', status: 'completed', attributionStatus: 'verified', metricsPersisted: true, userId: USER,
        });
        expect(rpcNames().filter((name) => name === 'advance_recommendation_attempt')).toHaveLength(1);
        expect(getOpenAttemptForUser(USER)).toMatchObject({ attemptId: 'att-technical', resolutionSessionId: 's-next' });
    });

    it('reload reconciliation retries the original repeat and a later save cannot steal it', async () => {
        setOpenAttempt({ attemptId: 'att-bound', userId: USER, sourceSessionId: 's-source' });
        let resolutionAttempts = 0;
        rpc.mockImplementation(async (name: string, payload: Record<string, unknown>) => {
            if (name !== 'advance_recommendation_attempt') return { data: 'ok-id', error: null };
            resolutionAttempts++;
            if (resolutionAttempts < 3) return { data: null, error: { code: '57014', message: 'network timeout' } };
            return { data: 'moved', error: null, payload };
        });
        await wireProgressEvaluationOnSave({
            sessionId: 's-original-repeat', status: 'completed', attributionStatus: 'verified', metricsPersisted: true, userId: USER,
        });
        await wireProgressEvaluationOnSave({
            sessionId: 's-later', status: 'completed', attributionStatus: 'verified', metricsPersisted: true, userId: USER,
        });
        const firstTwo = rpc.mock.calls.filter((call) => call[0] === 'advance_recommendation_attempt');
        expect(firstTwo).toHaveLength(2);
        expect(firstTwo[1][1]).toMatchObject({
            p_attempt_id: 'att-bound',
            p_practice_session_id: 's-original-repeat',
            p_next_comparable_session_id: 's-original-repeat',
        });
        expect(getOpenAttemptForUser(USER)?.resolutionSessionId).toBe('s-original-repeat');

        await reconcileProgressEvaluations(USER, []);
        const advanceCalls = rpc.mock.calls.filter((call) => call[0] === 'advance_recommendation_attempt');
        const finalCall = advanceCalls[advanceCalls.length - 1];
        expect(finalCall?.[1]).toMatchObject({ p_practice_session_id: 's-original-repeat' });
        expect(getOpenAttemptForUser(USER)).toBeNull();
    });

    it('uses not_comparable only after the server authoritatively rejects comparability', async () => {
        setOpenAttempt({ attemptId: 'att-mismatch', userId: USER, sourceSessionId: 's-source' });
        let advanceCalls = 0;
        rpc.mockImplementation(async (name: string) => {
            if (name !== 'advance_recommendation_attempt') return { data: 'ok-id', error: null };
            advanceCalls++;
            return advanceCalls === 1
                ? { data: null, error: { code: '22023', message: 'next session is not an eligible, same-cohort evaluation; use not_comparable' } }
                : { data: 'not_comparable', error: null };
        });
        await wireProgressEvaluationOnSave({
            sessionId: 's-next', status: 'completed', attributionStatus: 'verified', metricsPersisted: true, userId: USER,
        });
        const calls = rpc.mock.calls.filter((call) => call[0] === 'advance_recommendation_attempt');
        expect(calls).toHaveLength(2);
        expect(calls[1][1]).toMatchObject({ p_lifecycle: 'not_comparable', p_practice_session_id: 's-next' });
        expect(getOpenAttemptForUser(USER)).toBeNull();
    });

    it('clears a durable binding after a lost successful response is verified terminal', async () => {
        setOpenAttempt({ attemptId: 'att-committed', userId: USER, sourceSessionId: 's-source' });
        attemptReadback = {
            id: 'att-committed', lifecycle: 'completed', outcome: 'moved',
            practice_session_id: 's-next', next_comparable_session_id: 's-next',
        };
        rpc.mockImplementation(async (name: string) => name === 'advance_recommendation_attempt'
            ? { data: null, error: { code: '22023', message: 'attempt already resolved' } }
            : { data: 'ok-id', error: null });
        await wireProgressEvaluationOnSave({
            sessionId: 's-next', status: 'completed', attributionStatus: 'verified', metricsPersisted: true, userId: USER,
        });
        expect(getOpenAttemptForUser(USER)).toBeNull();
    });

    it.each([
        ['mismatched repeat', { id: 'att-committed', lifecycle: 'completed', outcome: 'moved', practice_session_id: 's-other', next_comparable_session_id: 's-other' }, null],
        ['pending', { id: 'att-committed', lifecycle: 'pending', outcome: null, practice_session_id: null, next_comparable_session_id: null }, null],
        ['missing', null, null],
        ['read error', null, { message: 'offline' }],
    ])('keeps the binding when already-terminal readback is %s', async (_label, row, readError) => {
        setOpenAttempt({ attemptId: 'att-committed', userId: USER, sourceSessionId: 's-source' });
        attemptReadback = row; attemptReadError = readError;
        rpc.mockImplementation(async (name: string) => name === 'advance_recommendation_attempt'
            ? { data: null, error: { code: '22023', message: 'attempt already resolved' } }
            : { data: 'ok-id', error: null });
        await wireProgressEvaluationOnSave({
            sessionId: 's-next', status: 'completed', attributionStatus: 'verified', metricsPersisted: true, userId: USER,
        });
        expect(getOpenAttemptForUser(USER)).toMatchObject({ attemptId: 'att-committed', resolutionSessionId: 's-next' });
    });
});
