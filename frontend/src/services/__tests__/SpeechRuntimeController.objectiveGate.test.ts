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
) => Promise<void>;

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
        await expect(gate(BRIEF, 'sess-throw', [], 60, runProgressEval)).resolves.toBeUndefined();
        expect(runProgressEval).not.toHaveBeenCalled();             // unknown registration state -> fail closed
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
