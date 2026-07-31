import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc }) }));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

import { wireProgressEvaluationOnSave, recordProgressEvaluation } from '../recordProgress';

describe('#1045 recordProgress consumer — the wiring guard', () => {
    beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: 'eval-id', error: null }); });

    const ctx = (over = {}) => ({
        sessionId: 's1', status: 'completed', attributionStatus: 'verified', metricsPersisted: true, ...over,
    });

    it('records an evaluation only when completed, metrics-persisted, and attribution verified', async () => {
        await wireProgressEvaluationOnSave(ctx());
        expect(rpc).toHaveBeenCalledWith('record_progress_evaluation', { p_session_id: 's1' });
    });

    it('does NOT record before metrics are persisted (would write an immutable ineligible row)', async () => {
        await wireProgressEvaluationOnSave(ctx({ metricsPersisted: false }));
        expect(rpc).not.toHaveBeenCalled();
    });

    it('does NOT record while attribution is unverified', async () => {
        for (const a of ['pending', 'unverified', 'legacy_unknown', null]) {
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

    it('passes ONLY the session id — never a user id or eligibility claim', async () => {
        await recordProgressEvaluation('s9');
        expect(rpc).toHaveBeenCalledWith('record_progress_evaluation', { p_session_id: 's9' });
        const [, payload] = rpc.mock.calls[0];
        expect(Object.keys(payload)).toEqual(['p_session_id']); // no user_id, no eligible, no clarity
    });

    it('a failed RPC is non-fatal — never throws into the save journey', async () => {
        rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
        await expect(recordProgressEvaluation('s1')).resolves.toBeNull();
    });
});
