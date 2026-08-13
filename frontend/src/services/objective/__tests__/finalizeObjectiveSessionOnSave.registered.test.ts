import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #1265 — the explicit `registered` flag is the ONLY signal the controller uses to decide whether a Focus
 * Points session's Progress is evaluated (cohorted 'objective'). It must survive a later-stage failure or
 * throw, and must be false when registration itself fails/throws. The controller gate is a one-liner over
 * this flag (`if (objResult.registered) runProgressEval()`), so proving the flag proves the gate.
 */

const registerObjectiveSource = vi.fn();
const startObjectiveSession = vi.fn();
const finalizeObjectiveEvidence = vi.fn();
vi.mock('../objectiveSessionService', () => ({
    registerObjectiveSource: (...a: unknown[]) => registerObjectiveSource(...a),
    startObjectiveSession: (...a: unknown[]) => startObjectiveSession(...a),
    finalizeObjectiveEvidence: (...a: unknown[]) => finalizeObjectiveEvidence(...a),
}));
vi.mock('../objectiveCoverage', () => ({ computeObjectiveCoverage: () => ({ coverage: [], signals: [] }) }));
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => ({
        from: () => ({
            select: () => ({
                eq: () => ({ order: () => Promise.resolve({ data: [{ id: 'p1', label: 'L', cue: null, sort_order: 0 }], error: null }) }),
            }),
        }),
    }),
}));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

import { finalizeObjectiveSessionOnSave } from '../finalizeObjectiveSessionOnSave';

const input = { projectId: 'p', briefId: 'b', sourceSessionId: 's', idempotencyKey: 's', segments: [], durationSeconds: 60 };

beforeEach(() => {
    registerObjectiveSource.mockReset();
    startObjectiveSession.mockReset();
    finalizeObjectiveEvidence.mockReset();
});

describe('#1265 finalizeObjectiveSessionOnSave — explicit registered flag', () => {
    it('registration success + all stages ok → registered=true (Progress evaluated as objective)', async () => {
        registerObjectiveSource.mockResolvedValue({ ok: true });
        startObjectiveSession.mockResolvedValue({ ok: true, sessionId: 'obj-1' });
        finalizeObjectiveEvidence.mockResolvedValue(1);
        const r = await finalizeObjectiveSessionOnSave(input);
        expect(r.registered).toBe(true);
        expect(r.ok).toBe(true);
    });

    it('registration success + a LATER stage fails → registered=true (still evaluated)', async () => {
        registerObjectiveSource.mockResolvedValue({ ok: true });
        startObjectiveSession.mockResolvedValue({ ok: false, reason: 'x' });
        const r = await finalizeObjectiveSessionOnSave(input);
        expect(r.registered).toBe(true);
        expect(r.ok).toBe(false);
        expect(r.stage).toBe('start');
    });

    it('registration fails → registered=false (NO evaluation)', async () => {
        registerObjectiveSource.mockResolvedValue({ ok: false, reason: 'ineligible' });
        const r = await finalizeObjectiveSessionOnSave(input);
        expect(r.registered).toBe(false);
        expect(r.ok).toBe(false);
        expect(r.stage).toBe('register');
    });

    it('a throw AFTER registration is preserved as registered=true (still evaluated)', async () => {
        registerObjectiveSource.mockResolvedValue({ ok: true });
        startObjectiveSession.mockRejectedValue(new Error('boom'));
        const r = await finalizeObjectiveSessionOnSave(input);
        expect(r.registered).toBe(true); // survives the throw — the recording IS a confirmed FP source
        expect(r.ok).toBe(false);
    });

    it('a throw BEFORE registration completes → registered=false (ambiguous → NO evaluation)', async () => {
        registerObjectiveSource.mockRejectedValue(new Error('boom'));
        const r = await finalizeObjectiveSessionOnSave(input);
        expect(r.registered).toBe(false);
        expect(r.ok).toBe(false);
    });
});
