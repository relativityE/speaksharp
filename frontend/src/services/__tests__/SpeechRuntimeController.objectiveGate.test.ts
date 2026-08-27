// @vitest-environment jsdom
//
// #1265 — DIRECT controller proof of the Focus Points Progress-cohort gate. A Focus Points recording's
// Progress must be evaluated ONLY after its objective registration DURABLY lands, so the server cohorts it
// 'objective', never 'freeform'. This exercises the extracted controller seam
// (finalizeObjectiveAndGateProgress) with a stubbed finalize, asserting the gate calls the Progress
// evaluator in exactly the right cases:
//   • register failure (registered=false) -> NO evaluation;
//   • later objective-stage failure but registered=true -> evaluation STILL runs;
//   • ambiguous throw (finalize rejects) -> NO evaluation, swallowed (non-fatal).
// The fourth required case — Open Mic immediate (no brief -> evaluate at once) — is proven by
// '#1045: the completed-save journey wires the Progress evaluation seam' in SpeechRuntimeController.test.ts
// (a private session with no objective brief invokes wireProgressEvaluationOnSave directly).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';

// The controller dynamically imports the objective finalize seam; vi.mock intercepts the dynamic import too.
const finalizeObjectiveSessionOnSave = vi.fn();
vi.mock('@/services/objective/finalizeObjectiveSessionOnSave', () => ({
    finalizeObjectiveSessionOnSave: (...a: unknown[]) => finalizeObjectiveSessionOnSave(...a),
}));
vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}));

type Gate = (
    brief: { projectId: string; briefId: string },
    sessionId: string,
    segments: { text: string; startSec: number }[],
    durationSeconds: number,
    runProgressEval: () => void,
    // #1354: the seam RETURNS an outcome — it was `void` before the gate existed, and a stale `void`
    // here silently hides the value every case-5 assertion depends on.
) => Promise<{ kind: string; reason?: string }>;

const BRIEF = { projectId: 'proj', briefId: 'brief' };

describe('#1265 SpeechRuntimeController — Focus Points Progress gating (direct)', () => {
    let gate: Gate;
    let runProgressEval: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        finalizeObjectiveSessionOnSave.mockReset();
        runProgressEval = vi.fn();
        useSessionStore.getState().setObjectiveCoverageResult(null);
        const controller = SpeechRuntimeController.getInstance();
        gate = (controller as unknown as { finalizeObjectiveAndGateProgress: Gate })
            .finalizeObjectiveAndGateProgress.bind(controller);
    });

    it('register failure (registered=false) records NO objective Progress evaluation', async () => {
        finalizeObjectiveSessionOnSave.mockResolvedValue({ ok: false, stage: 'register', reason: 'ineligible', registered: false });
        await gate(BRIEF, 'sess-reg-fail', [], 60, runProgressEval);
        expect(runProgressEval).not.toHaveBeenCalled();
        expect(useSessionStore.getState().objectiveCoverageResult).toBeNull(); // no rail on a failed register
    });

    it('later objective-stage failure but registered=true STILL evaluates (cohorted objective, not freeform)', async () => {
        finalizeObjectiveSessionOnSave.mockResolvedValue({ ok: false, stage: 'finalize', reason: 'error', registered: true });
        await gate(BRIEF, 'sess-late-fail', [], 60, runProgressEval);
        expect(runProgressEval).toHaveBeenCalledTimes(1);           // the recording IS a confirmed objective source
        expect(useSessionStore.getState().objectiveCoverageResult).toBeNull(); // but no rail on a failed finalize
    });

    it('ambiguous throw (finalize rejects) records NO evaluation and is swallowed (non-fatal)', async () => {
        finalizeObjectiveSessionOnSave.mockRejectedValue(new Error('network blip mid-finalize'));
        // #1354: the gate now RETURNS an outcome instead of `void`. An ambiguous throw leaves the
        // registration state unknown, so it must resolve to `unresolved` — which blocks the next
        // recording — rather than to a value that would let the recorder reopen.
        await expect(gate(BRIEF, 'sess-throw', [], 60, runProgressEval))
            .resolves.toEqual({ kind: 'unresolved', reason: 'queue_unavailable' });
        expect(runProgressEval).not.toHaveBeenCalled();             // unknown registration state -> fail closed
    });

    it('#1354 CASE 5: a DEFINITIVE registration refusal is terminal and unlocks', async () => {
        // The server answered: nothing was written, nothing is owed, and no evaluation will ever
        // arrive. That is an ACCEPTED terminal reason — it unlocks — but reporting `recorded` would be
        // a lie about durability and would mask a genuine evaluation failure behind the same value.
        finalizeObjectiveSessionOnSave.mockResolvedValue({ ok: false, stage: 'register', reason: 'denied', registered: false });
        await expect(gate(BRIEF, 'sess-unreg', [], 60, runProgressEval))
            .resolves.toEqual({ kind: 'not_applicable', reason: 'not_completed' });
        expect(runProgressEval).not.toHaveBeenCalled();
    });

    it('#1354 CASE 5: an UNCONFIRMED registration must NOT be relabelled not_completed', async () => {
        // UPDATED CONTRACT. This previously asserted that ANY `registered: false` unlocks. It does not:
        // a throw before registration also reports `registered: false` (and, per this result type's own
        // contract, LOSES the stage), so the write may have reached the server. Treating that as an
        // accepted terminal exclusion unlocks the recorder on an assumption nobody proved. Pending,
        // missing and unknown stay blocked — while still never claiming an evaluation was recorded.
        finalizeObjectiveSessionOnSave.mockResolvedValue({ ok: false, reason: 'error', registered: false });
        const outcome = await gate(BRIEF, 'sess-unconfirmed', [], 60, runProgressEval);
        expect(outcome.kind).toBe('unresolved');
        expect(outcome.kind).not.toBe('recorded');
        expect(runProgressEval).not.toHaveBeenCalled();
    });

    it('#1354: a REGISTERED take returns the evaluation outcome unchanged', async () => {
        finalizeObjectiveSessionOnSave.mockResolvedValue({ ok: true, registered: true });
        runProgressEval.mockResolvedValue({ kind: 'queued' });
        await expect(gate(BRIEF, 'sess-reg', [], 60, runProgressEval)).resolves.toEqual({ kind: 'queued' });
    });

    it('full success (registered + coverage) evaluates AND publishes the per-point rail', async () => {
        finalizeObjectiveSessionOnSave.mockResolvedValue({
            ok: true, registered: true, objectiveSessionId: 'o1', evidenceCount: 1,
            coverage: [{ briefPointId: 'p1', point: 'pricing', status: 'covered' }],
        });
        await gate(BRIEF, 'sess-ok', [], 60, runProgressEval);
        expect(runProgressEval).toHaveBeenCalledTimes(1);
        expect(useSessionStore.getState().objectiveCoverageResult).toEqual([{ id: 'p1', label: 'pricing', status: 'covered' }]);
    });
});
