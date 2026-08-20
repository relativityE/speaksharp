import { describe, it, expect, vi, beforeEach } from 'vitest';

const registerObjectiveSource = vi.fn();
const startObjectiveSession = vi.fn();
const finalizeObjectiveEvidence = vi.fn();
vi.mock('../objectiveSessionService', () => ({
    registerObjectiveSource: (...a: unknown[]) => registerObjectiveSource(...a),
    startObjectiveSession: (...a: unknown[]) => startObjectiveSession(...a),
    finalizeObjectiveEvidence: (...a: unknown[]) => finalizeObjectiveEvidence(...a),
}));

// Supabase reader for loadObjectiveBriefPoints: from().select().eq().order() → { data, error }.
let pointsRows: { id: string; label: string; cue: string | null; sort_order: number }[] | null = [];
let pointsError: unknown = null;
const order = vi.fn(() => Promise.resolve({ data: pointsRows, error: pointsError }));
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ order }) }) }) }),
}));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

import { finalizeObjectiveSessionOnSave } from '../finalizeObjectiveSessionOnSave';

const INPUT = {
    projectId: 'proj', briefId: 'brief', sourceSessionId: 'src', idempotencyKey: 'idem',
    segments: [{ text: 'we cover pricing and cost clearly', startSec: 8 }],
    durationSeconds: 60,
};

describe('#1046 finalizeObjectiveSessionOnSave', () => {
    beforeEach(() => {
        registerObjectiveSource.mockReset(); startObjectiveSession.mockReset(); finalizeObjectiveEvidence.mockReset();
        order.mockClear(); pointsRows = [{ id: 'p1', label: 'pricing cost', cue: null, sort_order: 0 }]; pointsError = null;
    });

    it('runs register → start → load → finalize and returns coverage + count', async () => {
        registerObjectiveSource.mockResolvedValue({ ok: true });
        startObjectiveSession.mockResolvedValue({ ok: true, sessionId: 'objsess-1' });
        finalizeObjectiveEvidence.mockResolvedValue(1);

        const res = await finalizeObjectiveSessionOnSave(INPUT);

        expect(res.ok).toBe(true);
        expect(res.objectiveSessionId).toBe('objsess-1');
        expect(res.evidenceCount).toBe(1);
        expect(res.coverage?.[0]).toMatchObject({ briefPointId: 'p1', status: 'covered' });
        // Finalize received the signal derived from the matched offset (rounded).
        expect(finalizeObjectiveEvidence).toHaveBeenCalledWith('objsess-1', [{ brief_point_id: 'p1', detected_at_seconds: 8 }]);
    });

    it('stops at register on an ineligible recording (no start/finalize)', async () => {
        registerObjectiveSource.mockResolvedValue({ ok: false, reason: 'ineligible' });
        const res = await finalizeObjectiveSessionOnSave(INPUT);
        expect(res).toEqual({ ok: false, stage: 'register', reason: 'ineligible', registered: false });
        expect(startObjectiveSession).not.toHaveBeenCalled();
        expect(finalizeObjectiveEvidence).not.toHaveBeenCalled();
    });

    it('fails closed at start (no finalize)', async () => {
        registerObjectiveSource.mockResolvedValue({ ok: true });
        startObjectiveSession.mockResolvedValue({ ok: false, reason: 'capability' });
        const res = await finalizeObjectiveSessionOnSave(INPUT);
        expect(res).toEqual({ ok: false, stage: 'start', reason: 'capability', registered: true });
        expect(finalizeObjectiveEvidence).not.toHaveBeenCalled();
    });

    it('fails closed when the brief has no readable points', async () => {
        registerObjectiveSource.mockResolvedValue({ ok: true });
        startObjectiveSession.mockResolvedValue({ ok: true, sessionId: 'objsess-1' });
        pointsRows = [];
        const res = await finalizeObjectiveSessionOnSave(INPUT);
        expect(res).toMatchObject({ ok: false, stage: 'load-points' });
        expect(finalizeObjectiveEvidence).not.toHaveBeenCalled();
    });

    it('fails closed when finalize rejects (e.g. bad offset)', async () => {
        registerObjectiveSource.mockResolvedValue({ ok: true });
        startObjectiveSession.mockResolvedValue({ ok: true, sessionId: 'objsess-1' });
        finalizeObjectiveEvidence.mockResolvedValue(null);
        const res = await finalizeObjectiveSessionOnSave(INPUT);
        expect(res).toMatchObject({ ok: false, stage: 'finalize' });
    });
});
