// AHT-02 / AHT-03 grounded-coaching (front-run review fix 5): the Focus journey writes `Focus coaching differs between takes` from
// the shared `capturedTakesDifferVerdict` over the first take and the Practice-again take. Fail closed: anything short of two
// distinct, witnessed takes with settled, non-external coaching is HOLD.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CapturedCoachingTake } from '../live/helpers/rwtCoachingCollector';
import type { ReceiptRow } from '../live/helpers/rwtAcceptance';
import { FOCUS_TAKES_DIFFER_ROW, focusTakesDifferRow, type FocusTakesDifferInput } from '../live/helpers/rwtFocusTakesDiffer';

const here = path.dirname(fileURLToPath(import.meta.url));
const RELEASE = 'a'.repeat(40);
const parent = (verdict: ReceiptRow['verdict']): ReceiptRow => ({ step: 'Focus coaching rendered', verdict, detail: '' });
/** A stand-in witness: the real one carries a full RwtCoachingTakeEvidence that only the shared judge reads. */
const take = (totalWords: number | null) => ({ take: {} as never, totalWords }) as CapturedCoachingTake;
const capture = (byId: Record<string, CapturedCoachingTake>) => ({ get: (id: string | null) => (id && byId[id]) || { hold: 'saved_take_not_witnessed' } });
const input = (over: Partial<FocusTakesDifferInput> = {}): FocusTakesDifferInput => ({
    rows: [parent('PASS')], firstSessionId: 'a', repeatSessionId: 'b',
    captured: capture({ a: take(120), b: take(18) }), releaseSha: RELEASE, ...over,
});
const judge = (status: 'PASS' | 'FAIL' | 'HOLD') => vi.fn(() => ({ status, detail: `judge ${status}` }));

describe('focusTakesDifferRow', () => {
    it('two witnessed takes with settled coaching: the shared verdict decides, PASS passes through with its evidence', () => {
        const j = judge('PASS');
        const r = focusTakesDifferRow(input(), j);
        expect(r).toMatchObject({ verdict: 'PASS', detail: 'judge PASS' });
        expect(r.evidence).toMatchObject({ parentVerdict: 'PASS', firstWitness: 'take', repeatWitness: 'take', bothPairsSaved: true, evidenceDiffers: true });
        expect(j).toHaveBeenCalledWith(expect.objectContaining({ totalWords: 120 }), expect.objectContaining({ totalWords: 18 }), RELEASE);
    });
    it('identical coaching for different takes FAILs; an unproven comparison HOLDs (verdict passed through unchanged)', () => {
        expect(focusTakesDifferRow(input(), judge('FAIL')).verdict).toBe('FAIL');
        expect(focusTakesDifferRow(input(), judge('HOLD')).verdict).toBe('HOLD');
    });
    it('the real shared verdict: a changed witness FAILs, an unwitnessed one HOLDs, never PASS', () => {
        expect(focusTakesDifferRow(input({ captured: capture({ a: { fail: 'saved_evidence_changed' }, b: take(18) }) })).verdict).toBe('FAIL');
        const held = focusTakesDifferRow(input({ captured: capture({ a: take(120) }) }));
        expect(held.verdict).toBe('HOLD');
        expect(held.evidence.repeatWitness).toBe('hold:saved_take_not_witnessed');
    });
    it.each<[string, Partial<FocusTakesDifferInput>]>([
        ['the coaching step never settled (no parent row)', { rows: [] }],
        ['a proved provider outage (EXTERNAL is outside the Focus scope for this row)', { rows: [parent('EXTERNAL')] }],
        ['no first saved take', { firstSessionId: null }],
        ['no Practice-again saved take', { repeatSessionId: null }],
        ['the repeat is the same take', { repeatSessionId: 'a' }],
        ['no capture was started', { captured: null }],
    ])('%s → HOLD, and the shared judge is never asked', (_, over) => {
        const j = judge('PASS');
        expect(focusTakesDifferRow(input(over), j).verdict).toBe('HOLD');
        expect(j).not.toHaveBeenCalled();
    });
    it('a FAIL parent does not excuse the comparison: the shared verdict still decides', () => {
        expect(focusTakesDifferRow(input({ rows: [parent('FAIL')] }), judge('PASS')).verdict).toBe('PASS');
    });
    it('evidence is content-free scalars', () => {
        for (const v of Object.values(focusTakesDifferRow(input(), judge('PASS')).evidence)) {
            expect(['string', 'number', 'boolean'].includes(typeof v) || v === null).toBe(true);
        }
    });
});

describe('wiring in rwtFocusPointsJourney.ts', () => {
    const src = readFileSync(path.resolve(here, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
    it('the row is written once, after the capture stopped and sampled the repeat take, in the prompt-binding step', () => {
        const step = src.indexOf("await test.step('coaching prompt binding — restricted synthetic artifact'");
        const stop = src.indexOf('await coachingCapture?.stop();', step);
        const sample = src.indexOf('if (repeatSessionId) await coachingCapture?.sample(repeatSessionId);', step);
        const judgeAt = src.indexOf('const differ = focusTakesDifferRow({ rows: receipt.rows, firstSessionId: persistedId, repeatSessionId,', step);
        const row = src.indexOf('receipt.row(FOCUS_TAKES_DIFFER_ROW, differ.verdict, differ.detail, differ.evidence);', step);
        const nextStep = src.indexOf('await test.step(', step + 1);
        for (const at of [step, stop, sample, judgeAt, row]) expect(at).toBeGreaterThan(0);
        expect(stop).toBeLessThan(sample);
        expect(sample).toBeLessThan(judgeAt);
        expect(judgeAt).toBeLessThan(row);
        expect(row).toBeLessThan(nextStep);
        expect(src.match(/receipt\.row\(FOCUS_TAKES_DIFFER_ROW/g)).toHaveLength(1);
        expect(FOCUS_TAKES_DIFFER_ROW).toBe('Focus coaching differs between takes');
    });
});
