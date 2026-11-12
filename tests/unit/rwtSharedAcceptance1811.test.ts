// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { automatedEvaluation, receiptAcceptance, requiredAutomatedRows, type ReceiptRow } from '../live/helpers/rwtAcceptance';

const focus = ['sign-in', 'Focus presentation contract', 'Practice again keeps the saved target', 'repeat result names the measured metric'];
const suites = [
    ['focus-points-session', focus],
    ['focus-points-partial', focus],
    ['feedback-association-boundaries-no-session', ['zero residue']],
] as const;

describe('#1811 shared acceptance additions', () => {
    for (const [suite, additions] of suites) {
        const inventory = requiredAutomatedRows(suite)!;
        const rows: ReceiptRow[] = [...inventory.required, ...inventory.product].map(step => ({ step, verdict: step === 'journey telemetry received' ? 'HOLD' : 'PASS', detail: 'fixture' }));
        if (suite.startsWith('focus-')) rows.push({ step: 'human: Focus coaching', verdict: 'HUMAN', detail: 'pending',
            evidence: { observationId: 'focus_coaching_covers_points', runbookRow: 'Focus coaching', passCriterion: 'covers points', recorded: 'pending' } });
        const receipt = { suite, release: 'a'.repeat(40), rows, readback: { journeys: [{ journeyId: 'j1', stages: ['share_feedback'] }], reportedJourneyIds: [] } };
        const readback = { suite, release: receipt.release, journeys: [{ journeyId: 'j1', stages: ['share_feedback'], verdict: 'QUALIFIED' }], missingBindings: [] };
        for (const step of additions) {
            it(`${suite}: ${step} is mandatory exactly once`, () => {
                expect(inventory.product.filter(x => x === step)).toHaveLength(1);
                const evaluate = (candidate: ReceiptRow[]) => automatedEvaluation({ ...receipt, rows: candidate }, readback);
                expect(evaluate(rows).errors).toEqual([]);
                expect(evaluate(rows.filter(r => r.step !== step)).errors.some(e => e.includes(step))).toBe(true);
            });
            it(`${suite}: ${step} HOLD/FAIL cannot become PASS`, () => {
                for (const verdict of ['HOLD', 'FAIL'] as const) {
                    const evaluated = automatedEvaluation({ ...receipt, rows: rows.map(r => r.step === step ? { ...r, verdict } : r) }, readback);
                    expect(evaluated.errors).toEqual([]);
                    expect(receiptAcceptance(evaluated.rows).acceptance).toBe(verdict === 'FAIL' ? 'FAIL' : 'INCOMPLETE');
                }
            });
        }
    }
    it('does not add the no-session cleanup requirement to unrelated suites', () => {
        expect(requiredAutomatedRows('open-mic-first-session')!.product).not.toContain('zero residue');
        expect(requiredAutomatedRows('pending-start-navigation')!.product).not.toContain('zero residue');
    });
});
