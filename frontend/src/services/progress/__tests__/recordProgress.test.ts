import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
// The evaluation row returned by the SELECT the recommendation-derivation performs. Tests override it.
let evalRow: Record<string, unknown> | null = null;
let evalError: unknown = null;
const maybeSingle = vi.fn(async () => ({ data: evalRow, error: evalError }));
const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.maybeSingle = maybeSingle;
    return chain;
});
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc, from }) }));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

import { wireProgressEvaluationOnSave, recordProgressEvaluation } from '../recordProgress';

const ELIGIBLE_ROW = {
    eligible: true, word_count: 200, filler_count: 4, wpm: 140, clarity_raw: 96.5,
    cohort_key: 'private|v2|base|clarity_v1', engine: 'private', engine_version: 'v2',
    model_name: 'base', attribution_status: 'verified',
};

describe('#1045 recordProgress consumer — the wiring guard', () => {
    beforeEach(() => {
        rpc.mockReset();
        rpc.mockResolvedValue({ data: 'eval-id', error: null });
        from.mockClear(); maybeSingle.mockClear();
        evalRow = null; evalError = null;
    });

    const ctx = (over = {}) => ({
        sessionId: 's1', status: 'completed', attributionStatus: 'verified', metricsPersisted: true, ...over,
    });

    const rpcNames = () => rpc.mock.calls.map((c) => c[0]);

    it('records an eligible evaluation AND derives the recommendation from the persisted evaluation', async () => {
        evalRow = { ...ELIGIBLE_ROW };
        await wireProgressEvaluationOnSave(ctx());
        expect(rpc).toHaveBeenCalledWith('record_progress_evaluation', { p_session_id: 's1' });
        // The recommendation is recorded WITHOUT a caller-supplied source metric value (RPC derives it).
        const recCall = rpc.mock.calls.find((c) => c[0] === 'record_progress_recommendation');
        expect(recCall).toBeTruthy();
        expect(recCall![1]).not.toHaveProperty('p_source_metric_value');
        expect(recCall![1]).toMatchObject({ p_source_session_id: 's1', p_target_metric: expect.any(String) });
    });

    it('records an AUDITABLE EXCLUSION for a completed, terminal-but-unverified session (no recommendation)', async () => {
        // unverified is terminal; the RPC will store an ineligible row, so the SELECT reports not-eligible.
        evalRow = { ...ELIGIBLE_ROW, eligible: false };
        await wireProgressEvaluationOnSave(ctx({ attributionStatus: 'unverified' }));
        expect(rpcNames()).toContain('record_progress_evaluation');
        expect(rpcNames()).not.toContain('record_progress_recommendation'); // ineligible → no action recorded
    });

    it('does NOT record before metrics are persisted (would write an immutable ineligible row)', async () => {
        await wireProgressEvaluationOnSave(ctx({ metricsPersisted: false }));
        expect(rpc).not.toHaveBeenCalled();
    });

    it('DEFERS while attribution is still non-terminal (pending / legacy_unknown / null)', async () => {
        for (const a of ['pending', 'legacy_unknown', null, undefined]) {
            rpc.mockClear();
            await wireProgressEvaluationOnSave(ctx({ attributionStatus: a }));
            expect(rpc, `attribution=${a}`).not.toHaveBeenCalled();
        }
    });

    it('does NOT record a non-completed session, or one with no id', async () => {
        await wireProgressEvaluationOnSave(ctx({ status: 'failed' }));
        await wireProgressEvaluationOnSave(ctx({ sessionId: null }));
        expect(rpc).not.toHaveBeenCalled();
    });

    it('passes ONLY the session id to the evaluation RPC — never a user id or eligibility claim', async () => {
        await recordProgressEvaluation('s9');
        expect(rpc).toHaveBeenCalledWith('record_progress_evaluation', { p_session_id: 's9' });
        const [, payload] = rpc.mock.calls[0];
        expect(Object.keys(payload)).toEqual(['p_session_id']); // no user_id, no eligible, no clarity
    });

    it('a failed evaluation RPC is non-fatal — never throws into the save journey', async () => {
        rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
        await expect(recordProgressEvaluation('s1')).resolves.toBeNull();
    });

    it('retries a transient evaluation failure, then records once it succeeds', async () => {
        vi.useFakeTimers();
        evalRow = { ...ELIGIBLE_ROW };
        rpc.mockReset();
        // First eval attempt errors; second succeeds. Recommendation call then succeeds.
        rpc.mockResolvedValueOnce({ data: null, error: { message: 'transient' } })
           .mockResolvedValue({ data: 'eval-id', error: null });
        const p = wireProgressEvaluationOnSave(ctx());
        await vi.runAllTimersAsync();
        await p;
        expect(rpcNames().filter((n) => n === 'record_progress_evaluation').length).toBeGreaterThanOrEqual(2);
        vi.useRealTimers();
    });
});
