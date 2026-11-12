// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { finalizeReceipt, humanWorksheet, parseHumanWorksheet, requiredAutomatedRows, type ReceiptRow } from '../live/helpers/rwtAcceptance';

const ROW = 'interrupted take coaching saved and shown in its saved review';
const SUITE = 'open-mic-first-session';
const SHA = 'b'.repeat(40);
const J = 'journey-rec';
const STAGES = ['session_during', 'session_after_open_mic', 'share_feedback', 'analytics_inventory', 'session_pdf_export'];
const pass = (step: string): ReceiptRow => ({ step, verdict: 'PASS', detail: 'ok' });
const humanRow = (id: string): ReceiptRow => ({ step: `human: ${id}`, verdict: 'HUMAN', detail: 'named human RWT observation', evidence: { observationId: id, runbookRow: 'row', passCriterion: 'c', recorded: 'pending' } });
const canonical = (): ReceiptRow[] => [
  ...['telemetry decodable', 'signup-stage telemetry (user class)', 'journey telemetry (canary class)', 'receipt content-free'].map(pass),
  { step: 'signup-stage telemetry received', verdict: 'HOLD', detail: 'non-gating' },
  { step: 'journey telemetry received', verdict: 'HOLD', detail: 'readback follows' },
  ...[...new Set([...requiredAutomatedRows(SUITE)!.product, ROW])].map(step => step === 'base_q4 primary' ? { step, verdict: 'HOLD' as const, detail: 'non-gating' } : pass(step)),
  humanRow('open_mic_coaching_relevant'), humanRow('open_mic_uh_detected'),
];
const finalize = (rows: ReceiptRow[]) => {
  const receipt = { suite: SUITE, release: SHA, meta: { fixtureKind: 'synthetic' }, rows, readback: { journeys: [{ journeyId: J, stages: STAGES }], reportedJourneyIds: ['other'], missingBindings: [] } };
  const worksheet = parseHumanWorksheet(humanWorksheet(SUITE, SHA, [J, 'other'], rows).split('\n').map(l => l.startsWith('| `open_mic_') ? l.replace(/\| {2}\| {2}\|$/, '| PASS | PO · 2026-09-28 |') : l).join('\n'));
  return finalizeReceipt(receipt, worksheet, { suite: SUITE, release: SHA, journeys: [{ journeyId: J, stages: STAGES, verdict: 'QUALIFIED' }], missingBindings: [] });
};

describe('Open Mic ordinary saved-review persistence registration', () => {
  it('requires the named ordinary persistence row exactly once', () => {
    expect(requiredAutomatedRows(SUITE)!.product.filter(step => step === ROW)).toEqual([ROW]);
  });
  it('complete matched receipt remains PASS', () => {
    expect(finalize(canonical())).toMatchObject({ status: 'final', finalAcceptance: 'PASS', errors: [] });
  });
  it('missing ordinary persistence row cannot finalize PASS', () => {
    const result = finalize(canonical().filter(row => row.step !== ROW));
    expect(result.finalAcceptance).toBe('INCOMPLETE');
    expect(result.errors.some(error => error.includes(`missing the required product row "${ROW}"`))).toBe(true);
  });
  it('ordinary persistence HOLD stays INCOMPLETE', () => {
    expect(finalize(canonical().map(row => row.step === ROW ? { ...row, verdict: 'HOLD' } : row)).finalAcceptance).toBe('INCOMPLETE');
  });
  it('ordinary persistence FAIL stays FAIL', () => {
    expect(finalize(canonical().map(row => row.step === ROW ? { ...row, verdict: 'FAIL' } : row)).finalAcceptance).toBe('FAIL');
  });
  it('does not add the Open Mic row to Focus or returning-user inventory', () => {
    for (const suite of ['focus-points-session', 'focus-points-partial', 'returning-user-navigation']) expect(requiredAutomatedRows(suite)!.product).not.toContain(ROW);
  });
});
