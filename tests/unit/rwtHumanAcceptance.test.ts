// @vitest-environment node
/**
 * PO 2026-09-25 — the automated RWT receipt and the human-check worksheet are read TOGETHER, and an automated PASS can
 * never be mistaken for a completed human check.
 */
import { describe, it, expect } from 'vitest';
import { humanWorksheet, receiptAcceptance, type ReceiptRow } from '../live/helpers/rwtJourney';

const automated: ReceiptRow[] = [
    { step: 'session saved', verdict: 'PASS', detail: 'the take saved' },
    { step: 'coaching rendered', verdict: 'PASS', detail: 'two phrases' },
];
const human = (verdict: ReceiptRow['verdict']): ReceiptRow => ({
    step: 'human: coaching is about this speech', verdict, detail: 'named human RWT observation',
    evidence: { observationId: 'open_mic_coaching_relevant', runbookRow: 'Product 1 row 5', passCriterion: 'each phrase relates to this take', recorded: verdict === 'HUMAN' ? 'pending' : verdict },
});

describe('RWT acceptance: automated rows + named human observations', () => {
    it('all automated rows PASS but a human check is pending → INCOMPLETE, never PASS', () => {
        const a = receiptAcceptance([...automated, human('HUMAN')]);
        expect(a.acceptance).toBe('INCOMPLETE');
        expect(a.automatedRowsAllPass).toBe(true);
        expect(a.humanObservations).toEqual([{ id: 'open_mic_coaching_relevant', runbookRow: 'Product 1 row 5', result: 'pending' }]);
    });
    it('a recorded human PASS completes it; a recorded FAIL fails it; any HOLD keeps it INCOMPLETE', () => {
        expect(receiptAcceptance([...automated, human('PASS')]).acceptance).toBe('PASS');
        expect(receiptAcceptance([...automated, human('FAIL')]).acceptance).toBe('FAIL');
        expect(receiptAcceptance([...automated, human('PASS'), { step: 'x', verdict: 'HOLD', detail: '' }]).acceptance).toBe('INCOMPLETE');
    });
    it('the worksheet carries the run identity and one blank decision row per human observation', () => {
        const md = humanWorksheet('rwt-open-mic', 'a'.repeat(40), ['journey-1'], [...automated, human('HUMAN')]);
        expect(md).toContain(`Deployed SHA: \`${'a'.repeat(40)}\``);
        expect(md).toContain('`journey-1`');
        expect(md).toContain('An automated PASS is not a human check');
        const row = md.split('\n').find((l) => l.includes('open_mic_coaching_relevant'))!;
        expect(row).toContain('Product 1 row 5');
        expect(row).toContain('each phrase relates to this take');
        expect(row.split('|').map((c) => c.trim()).slice(5, 7)).toEqual(['', '']); // result + observer left blank
        expect(md).not.toContain('session saved'); // automated rows are not re-listed as human checks
    });
});
