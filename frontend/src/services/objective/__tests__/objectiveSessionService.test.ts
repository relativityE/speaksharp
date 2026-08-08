import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const invoke = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc, functions: { invoke } }) }));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

import {
    registerObjectiveSource,
    startObjectiveSession,
    finalizeObjectiveEvidence,
    OBJECTIVE_DETECTOR_VERSION,
    OBJECTIVE_FORMULA_VERSION,
} from '../objectiveSessionService';

describe('#1046 objectiveSessionService', () => {
    beforeEach(() => { rpc.mockReset(); invoke.mockReset(); });

    describe('registerObjectiveSource', () => {
        it('calls the objective-register-source Edge Function and returns ok on registered:true', async () => {
            invoke.mockResolvedValue({ data: { registered: true }, error: null });
            const res = await registerObjectiveSource('sess-1');
            expect(res).toEqual({ ok: true });
            expect(invoke).toHaveBeenCalledWith('objective-register-source', { body: { sessionId: 'sess-1' } });
        });

        it('returns ineligible when the function rejects (422 / not registered)', async () => {
            invoke.mockResolvedValue({ data: { registered: false }, error: { message: 'not eligible' } });
            expect(await registerObjectiveSource('sess-1')).toEqual({ ok: false, reason: 'ineligible' });
        });

        it('returns error when the invoke throws', async () => {
            invoke.mockRejectedValue(new Error('network'));
            expect(await registerObjectiveSource('sess-1')).toEqual({ ok: false, reason: 'error' });
        });
    });

    describe('startObjectiveSession', () => {
        it('passes the approved detector + formula versions and returns the session id', async () => {
            rpc.mockResolvedValue({ data: 'objsess-1', error: null });
            const res = await startObjectiveSession({
                projectId: 'proj', briefId: 'brief', sourceSessionId: 'src', idempotencyKey: 'idem',
            });
            expect(res).toEqual({ ok: true, sessionId: 'objsess-1' });
            expect(rpc).toHaveBeenCalledWith('objective_start_session_v1', {
                p_project_id: 'proj',
                p_brief_id: 'brief',
                p_source_session_id: 'src',
                p_detector_version: OBJECTIVE_DETECTOR_VERSION,
                p_formula_version: OBJECTIVE_FORMULA_VERSION,
                p_idempotency_key: 'idem',
            });
        });

        it('maps a capability error (42501) to reason capability', async () => {
            rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
            const res = await startObjectiveSession({ projectId: 'p', briefId: 'b', sourceSessionId: 's', idempotencyKey: 'k' });
            expect(res).toEqual({ ok: false, reason: 'capability' });
        });
    });

    describe('finalizeObjectiveEvidence', () => {
        it('sends the signals and returns the evidence row count', async () => {
            rpc.mockResolvedValue({ data: 3, error: null });
            const signals = [{ brief_point_id: 'p1', detected_at_seconds: 5 }, { brief_point_id: 'p2', detected_at_seconds: null }];
            const count = await finalizeObjectiveEvidence('objsess-1', signals);
            expect(count).toBe(3);
            expect(rpc).toHaveBeenCalledWith('objective_finalize_evidence_v1', { p_session_id: 'objsess-1', p_signals: signals });
        });

        it('returns null on error (never throws / never fabricates a count)', async () => {
            rpc.mockResolvedValue({ data: null, error: { message: 'bad offset' } });
            expect(await finalizeObjectiveEvidence('objsess-1', [])).toBeNull();
        });
    });
});
