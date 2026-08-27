/* @vitest-environment jsdom */
// #1354 subtask A — the seam reports a TRUTHFUL outcome, and `queued` requires a durable debt.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const recordProgressEvaluation = vi.fn();
// The `recorded` path also derives a recommendation, which reads through `.from(...)`. A chainable stub
// keeps this test focused on the OUTCOME contract rather than on recommendation behaviour.
const table = () => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'insert', 'upsert']) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.single = async () => ({ data: null, error: null });
    chain.then = undefined;
    return chain;
};
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => ({ rpc: recordProgressEvaluation, from: () => table() }),
}));

const { wireProgressEvaluationOnSave, progressOutcomeAllowsNextRecording } =
    await import('../recordProgress');

const BASE = {
    sessionId: 'sess-1',
    status: 'completed',
    attributionStatus: 'verified',
    metricsPersisted: true,
    userId: 'user-1',
};

beforeEach(() => { localStorage.clear(); recordProgressEvaluation.mockReset(); vi.restoreAllMocks(); });

describe('outcomes that BLOCK the next recording', () => {
    it('a missing session is unresolved, never a silent success', async () => {
        const o = await wireProgressEvaluationOnSave({ ...BASE, sessionId: null });
        expect(o).toEqual({ kind: 'unresolved', reason: 'missing_session' });
        expect(progressOutcomeAllowsNextRecording(o)).toBe(false);
    });

    it('metrics not persisted is unresolved — nothing to evaluate AND nothing to queue', async () => {
        const o = await wireProgressEvaluationOnSave({ ...BASE, metricsPersisted: false });
        expect(o).toEqual({ kind: 'unresolved', reason: 'metrics_not_persisted' });
        expect(progressOutcomeAllowsNextRecording(o)).toBe(false);
    });

    it('PENDING attribution is unresolved, not a pass — deferring is correct but not terminal', async () => {
        // Previously an early `return` indistinguishable from success. This is the state that let a
        // later recording start against evidence that was still resolving.
        const o = await wireProgressEvaluationOnSave({ ...BASE, attributionStatus: 'pending' });
        expect(o).toEqual({ kind: 'unresolved', reason: 'attribution_not_terminal' });
        expect(progressOutcomeAllowsNextRecording(o)).toBe(false);
    });

    it('a failed evaluation with NO owner cannot be queued, so it is unresolved', async () => {
        recordProgressEvaluation.mockResolvedValue({ data: null, error: null });
        const o = await wireProgressEvaluationOnSave({ ...BASE, userId: null });
        expect(o).toEqual({ kind: 'unresolved', reason: 'queue_unavailable' });
        expect(progressOutcomeAllowsNextRecording(o)).toBe(false);
    });

    it('a failed evaluation whose ENQUEUE cannot be verified is unresolved, not queued', async () => {
        // The blocker this closes: a swallowed storage failure would have reported `queued` and promised
        // a retry that never runs.
        recordProgressEvaluation.mockResolvedValue({ data: null, error: null });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
        const o = await wireProgressEvaluationOnSave(BASE);
        expect(o).toEqual({ kind: 'unresolved', reason: 'queue_unavailable' });
        expect(progressOutcomeAllowsNextRecording(o)).toBe(false);
    });

    it('QUEUED blocks the next recording even though it is durable', async () => {
        recordProgressEvaluation.mockResolvedValue({ data: null, error: null });
        const o = await wireProgressEvaluationOnSave(BASE);
        expect(o).toEqual({ kind: 'queued' });
        expect(progressOutcomeAllowsNextRecording(o)).toBe(false);
    });
});

describe('outcomes that ALLOW the next recording', () => {
    it('a recorded evaluation unlocks', async () => {
        recordProgressEvaluation.mockResolvedValue({ data: 'eval-1', error: null });
        const o = await wireProgressEvaluationOnSave(BASE);
        expect(o.kind).toBe('recorded');
        expect(progressOutcomeAllowsNextRecording(o)).toBe(true);
    });

    it('a non-completed session owes nothing and unlocks', async () => {
        const o = await wireProgressEvaluationOnSave({ ...BASE, status: 'aborted' });
        expect(o).toEqual({ kind: 'not_applicable', reason: 'not_completed' });
        expect(progressOutcomeAllowsNextRecording(o)).toBe(true);
    });

    it('NOT-APPLICABLE and UNRESOLVED are distinct — collapsing them re-opens the defect', () => {
        // Both mean "no evaluation was written", but only one may unlock.
        expect(progressOutcomeAllowsNextRecording({ kind: 'not_applicable', reason: 'not_completed' })).toBe(true);
        expect(progressOutcomeAllowsNextRecording({ kind: 'unresolved', reason: 'queue_unavailable' })).toBe(false);
    });
});

describe('the outcome carries no customer content', () => {
    it('only discriminants and accepted reason tokens cross the boundary', async () => {
        recordProgressEvaluation.mockResolvedValue({ data: null, error: null });
        const o = await wireProgressEvaluationOnSave(BASE);
        const serialized = JSON.stringify(o);
        expect(serialized).not.toContain('sess-1');
        expect(serialized).not.toContain('user-1');
        expect(Object.keys(o).every((k) => k === 'kind' || k === 'reason')).toBe(true);
    });
});
