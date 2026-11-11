// @vitest-environment node
/**
 * Offline controls for the outcome 8 paid value loop checks (paidValueLoop.ts). No browser, account, Stripe call or
 * network: these prove each check refuses the failure it exists to catch. They are not journey acceptance.
 */
import { describe, expect, it } from 'vitest';
import {
  PAID_VALUE_LOOP_STEPS, paidValueLoopReceipt, assertSavedTake, assertEligibleEvaluation, savedCoaching,
  coachingShownAsSaved, assertRecommendation, comparisonExpectation, assertComparisonShown,
} from './paidValueLoop';
import { safeFailureReason } from './contract';
import { SCOPE_LINE, type PanelObservation, type ServerEvidence } from '../../live/helpers/repeatMetricWording';

const UID = '11111111-1111-4111-8111-111111111111';
const FIRST = '22222222-2222-4222-8222-222222222222';
const REPEAT = '33333333-3333-4333-8333-333333333333';
const reason = (run: () => unknown) => { try { run(); return 'no_failure'; } catch (error) { return safeFailureReason(error); } };

describe('paid value loop receipt', () => {
  it('passes only with every step, in the fixed order, and names its evidence class', () => {
    const all = paidValueLoopReceipt(new Set(PAID_VALUE_LOOP_STEPS));
    expect(all).toMatchObject({ schema: 'paid-value-loop/v1', journey: 'paid_value_loop', stripeMode: 'test',
      evidenceClass: 'sandbox-qualified', result: 'PASSED' });
    expect(all.steps.map(s => s.step)).toEqual([...PAID_VALUE_LOOP_STEPS]);
    const partial = paidValueLoopReceipt(new Set(PAID_VALUE_LOOP_STEPS.filter(s => s !== 'comparison_shown')));
    expect(partial.result).toBe('INCOMPLETE');
    expect(partial.steps.find(s => s.step === 'comparison_shown')?.result).toBe('NOT_PROVEN');
  });

  it('refuses an unknown step rather than dropping it', () => {
    expect(reason(() => paidValueLoopReceipt(new Set(['next_recording'])))).toBe('unknown_step');
  });

  it('holds no content, ids or provider fields', () => {
    const text = JSON.stringify(paidValueLoopReceipt(new Set(PAID_VALUE_LOOP_STEPS)));
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|cus_|sub_|evt_|cs_test_|@/);
  });
});

describe('saved take and eligibility', () => {
  const row = { id: FIRST, user_id: UID, status: 'completed', engine: 'private', product: 'open_mic' };
  it('accepts this account\'s completed Private Open Mic take', () => {
    expect(reason(() => assertSavedTake(row, FIRST, UID, 'x'))).toBe('no_failure');
  });
  it.each([
    ['another account', { user_id: '99999999-9999-4999-8999-999999999999' }],
    ['another session', { id: REPEAT }],
    ['not completed', { status: 'processing' }],
    ['another engine', { engine: 'cloud' }],
    ['Focus Points', { product: 'focus_points' }],
  ])('refuses %s', (_, change) => {
    expect(reason(() => assertSavedTake({ ...row, ...change }, FIRST, UID, 'first_take_not_saved'))).toBe('first_take_not_saved');
  });

  const evaluation = { session_id: FIRST, user_id: UID, formula_version: 'clarity_v1', eligible: true,
    exclusion_reasons: [], attribution_status: 'verified' };
  it('accepts an eligible clarity_v1 evaluation with verified attribution', () => {
    expect(reason(() => assertEligibleEvaluation(evaluation, FIRST, UID))).toBe('no_failure');
  });
  it.each([
    [{ eligible: false, exclusion_reasons: ['too_short'] }, 'take_not_eligible'],
    [{ exclusion_reasons: ['too_few_words'] }, 'take_not_eligible'],
    [{ attribution_status: 'pending' }, 'take_not_eligible'],
    [{ formula_version: 'clarity_v0' }, 'evaluation_identity'],
    [{ user_id: '99999999-9999-4999-8999-999999999999' }, 'evaluation_identity'],
  ])('refuses %o', (change, code) => {
    expect(reason(() => assertEligibleEvaluation({ ...evaluation, ...change }, FIRST, UID))).toBe(code);
  });
  it('refuses a missing evaluation', () => {
    expect(reason(() => assertEligibleEvaluation(null, FIRST, UID))).toBe('evaluation_identity');
  });
});

describe('coaching', () => {
  const stored = { version: 'gemini_coaching_v1', what_worked: 'You kept an even pace.', what_to_try_next: 'Pause before key points.' };
  it('reads a contract-valid stored pair and matches it to what rendered', () => {
    const saved = savedCoaching(stored);
    expect(coachingShownAsSaved(saved, { well: ' You kept an even pace. ', next: 'Pause before key points.' })).toBe(true);
  });
  it('refuses a rendered pair that differs from the stored one, or is missing', () => {
    const saved = savedCoaching(stored);
    expect(coachingShownAsSaved(saved, { well: 'You kept an even pace.', next: 'Slow down.' })).toBe(false);
    expect(coachingShownAsSaved(saved, { well: null, next: null })).toBe(false);
  });
  it.each([
    ['nothing stored', null],
    ['half a pair', { ...stored, what_worked: ' ' }],
    ['an unknown version', { ...stored, version: 'v0' }],
    ['an extra key', { ...stored, extra: 'x' }],
  ])('refuses %s', (_, raw) => {
    expect(reason(() => savedCoaching(raw))).toBe('coaching_not_saved');
  });
});

describe('recommendation', () => {
  const rec = { id: 'rec-1', user_id: UID, source_session_id: FIRST, formula_version: 'clarity_v1',
    target_metric: 'pace', target_direction: 'increase', target_value: 140, target_units: 'words per minute' };
  it('accepts exactly one valid recommendation bound to the first take', () => {
    expect(assertRecommendation([rec], FIRST, UID)).toBe('rec-1');
  });
  it.each([
    [[], 'recommendation_not_unique'],
    [[rec, { ...rec, id: 'rec-2' }], 'recommendation_not_unique'],
    [[{ ...rec, source_session_id: REPEAT }], 'recommendation_identity'],
    [[{ ...rec, user_id: '99999999-9999-4999-8999-999999999999' }], 'recommendation_identity'],
    [[{ ...rec, target_metric: 'volume' }], 'recommendation_target_invalid'],
  ])('refuses %o', (rows, code) => {
    expect(reason(() => assertRecommendation(rows, FIRST, UID))).toBe(code);
  });
});

describe('linked repeat and comparison', () => {
  const recommendation = { targetMetric: 'pace', targetDirection: 'increase', targetValue: 140, targetUnits: 'words per minute' };
  const bound = { lifecycle: 'completed', outcome: 'moved', acceptedAt: '2026-11-11T10:00:00Z', isThisRepeat: true, id: 'att-1' };
  const server: ServerEvidence = { kind: 'read', recommendation, newest: [bound], boundCount: 1, boundId: 'att-1' };
  const expected = comparisonExpectation(server, true);
  const shown: PanelObservation = { state: 'eligible', target: expected.target, outcome: expected.outcome, scope: SCOPE_LINE,
    legacyPhrase: false, readsStable: true };

  it('expects the stored outcome for a linked, bound and resolved repeat', () => {
    expect(expected.outcome).toBe('Pace was higher on the repeat than in the original session.');
    expect(reason(() => assertComparisonShown(expected, shown))).toBe('no_failure');
  });
  it('refuses a repeat the review did not offer as linked', () => {
    expect(reason(() => comparisonExpectation(server, false))).toBe('repeat_not_offered_linked');
  });
  it.each([
    [{ ...server, boundCount: 0, newest: [] }, 'repeat_repeat_unbound'],
    [{ ...server, newest: [{ ...bound, lifecycle: 'pending', outcome: null }] }, 'repeat_repeat_unresolved'],
    [{ ...server, boundCount: 2 }, 'repeat_multiple_bound_attempts'],
    [{ kind: 'read_failed' } as ServerEvidence, 'repeat_server_read_failed'],
  ])('refuses server evidence %#', (evidence, code) => {
    expect(reason(() => comparisonExpectation(evidence as ServerEvidence, true))).toBe(code);
  });
  it.each([
    [{ outcome: 'Pace was not higher on the repeat than in the original session.' }, 'comparison_wording_wrong'],
    [{ scope: null }, 'comparison_wording_wrong'],
    [{ legacyPhrase: true }, 'comparison_wording_wrong'],
    [{ state: 'insufficient' }, 'comparison_not_observed'],
    [{ readsStable: false }, 'comparison_not_observed'],
  ] as [Partial<PanelObservation>, string][])('refuses panel %o', (change, code) => {
    expect(reason(() => assertComparisonShown(expected, { ...shown, ...change }))).toBe(code);
  });
});
