/**
 * Outcome 8 (PAID-01): the paid value loop on ONE genuinely paid test-mode identity.
 *
 * After hosted test Checkout converts the account, the same signed-in account must:
 *   1. save an eligible Private Open Mic take,
 *   2. see grounded coaching for it (the saved pair, rendered),
 *   3. get a server-recorded practice recommendation bound to that take,
 *   4. press the review's linked "Practice again" and save a repeat take bound to that recommendation,
 *   5. see the repeat comparison name the measured metric and the stored outcome,
 *   6. sign in again in a fresh browser and read all of it back on a still-active paid account.
 *
 * Pure checks only: no network, no secrets, no provider bodies. Every verdict is a closed code. The browser journey that
 * feeds these checks is `paid-value-loop.billing.spec.ts`; the offline controls are `paidValueLoop.test.ts`.
 *
 * This is test-mode, sandbox-qualified evidence only. It is not Production paid acceptance, does not cover Focus Points
 * or the paid Open Mic limits, and does not replace the human coaching review (COACH-01) or value observations (VALUE-01).
 */
import { requireFact } from './contract';
import { readSavedReview, type SavedReview } from '../../../frontend/src/components/practice/lastSessionFix';
import {
  PROGRESS_FORMULA, validRecommendation, repeatMetricPrerequisites, repeatMetricWordingVerdict,
  type ExpectedLines, type PanelObservation, type ServerEvidence,
} from '../../live/helpers/repeatMetricWording';

export const PAID_VALUE_LOOP = 'paid_value_loop' as const;

export const PAID_VALUE_LOOP_STEPS = [
  'trial_expired', 'hosted_checkout', 'first_invoice', 'stripe_delivery', 'paid_entitlement',
  'first_take_saved', 'first_take_eligible', 'coaching_saved', 'coaching_rendered', 'recommendation_recorded',
  'linked_repeat_started', 'repeat_take_saved', 'repeat_resolved', 'comparison_shown',
  'sign_in_again', 'readback', 'cleanup',
] as const;
export type PaidValueLoopStep = typeof PAID_VALUE_LOOP_STEPS[number];

/** Same closed, content-free shape as the billing receipts, under its own schema. */
export function paidValueLoopReceipt(steps: ReadonlySet<string>) {
  requireFact([...steps].every(step => (PAID_VALUE_LOOP_STEPS as readonly string[]).includes(step)), 'unknown_step');
  const missing = PAID_VALUE_LOOP_STEPS.filter(step => !steps.has(step));
  return {
    schema: 'paid-value-loop/v1', journey: PAID_VALUE_LOOP, stripeMode: 'test', evidenceClass: 'sandbox-qualified',
    result: missing.length ? 'INCOMPLETE' : 'PASSED',
    steps: PAID_VALUE_LOOP_STEPS.map(step => ({ step, result: steps.has(step) ? 'PASSED' : 'NOT_PROVEN' })),
  };
}

/** The saved session row as the journey reads it with admin authority. */
export interface SavedTakeRow { id?: unknown; user_id?: unknown; status?: unknown; engine?: unknown; product?: unknown }

export function assertSavedTake(row: SavedTakeRow | null, sessionId: string, uid: string, code: string): void {
  requireFact(row && row.id === sessionId && row.user_id === uid && row.status === 'completed'
    && row.engine === 'private' && row.product === 'open_mic', code);
}

/** The progress evaluation must be eligible under the same formula the comparison is bound to. */
export interface EvaluationRow {
  session_id?: unknown; user_id?: unknown; formula_version?: unknown; eligible?: unknown;
  exclusion_reasons?: unknown; attribution_status?: unknown;
}

export function assertEligibleEvaluation(row: EvaluationRow | null, sessionId: string, uid: string): void {
  requireFact(row && row.session_id === sessionId && row.user_id === uid && row.formula_version === PROGRESS_FORMULA,
    'evaluation_identity');
  requireFact(row.eligible === true && Array.isArray(row.exclusion_reasons) && row.exclusion_reasons.length === 0
    && row.attribution_status === 'verified', 'take_not_eligible');
}

/** The stored coaching must be a contract-valid pair; it is returned in memory only, never serialized. */
export function savedCoaching(raw: unknown): SavedReview {
  const review = readSavedReview(raw);
  requireFact(review, 'coaching_not_saved');
  return review;
}

const normalize = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim();

/** The rendered pair must be exactly the saved pair, not merely present. */
export function coachingShownAsSaved(saved: SavedReview, shown: { well: string | null; next: string | null }): boolean {
  return normalize(shown.well) === normalize(saved.whatWorked) && normalize(shown.next) === normalize(saved.whatToTryNext)
    && normalize(shown.next).length > 0;
}

export interface RecommendationRecord {
  id?: unknown; user_id?: unknown; source_session_id?: unknown; formula_version?: unknown;
  target_metric?: unknown; target_direction?: unknown; target_value?: unknown; target_units?: unknown;
}

/** One recommendation, bound to the first take, this account and the comparison formula, with a valid target. */
export function assertRecommendation(rows: readonly RecommendationRecord[] | null, sourceSessionId: string, uid: string): string {
  requireFact(Array.isArray(rows) && rows.length === 1, 'recommendation_not_unique');
  const [row] = rows;
  requireFact(typeof row.id === 'string' && row.user_id === uid && row.source_session_id === sourceSessionId
    && row.formula_version === PROGRESS_FORMULA, 'recommendation_identity');
  requireFact(validRecommendation({ targetMetric: row.target_metric, targetDirection: row.target_direction,
    targetValue: row.target_value, targetUnits: row.target_units }), 'recommendation_target_invalid');
  return row.id;
}

/**
 * The repeat is linked only when the saved review offered the LINKED action and the server bound exactly one resolved
 * attempt to this journey's repeat take. The UI link state stands in for press telemetry, which this journey does not
 * collect; a bound server row is what proves the link (see repeatMetricWording.ts).
 */
export function comparisonExpectation(server: ServerEvidence, offeredLinked: boolean): ExpectedLines {
  requireFact(offeredLinked, 'repeat_not_offered_linked');
  const prerequisite = repeatMetricPrerequisites(server, { kind: 'linked', linkedAttempt: 'unobserved' });
  if (!prerequisite.observe) throw new Error(`BILLING_JOURNEY:repeat_${prerequisite.reason}`);
  return prerequisite.expected;
}

/** PASS only when the settled, eligible panel shows the exact target, outcome and scope lines. */
export function assertComparisonShown(expected: ExpectedLines, page: PanelObservation): void {
  const { verdict } = repeatMetricWordingVerdict(expected, page);
  requireFact(verdict === 'PASS', verdict === 'HOLD' ? 'comparison_not_observed' : 'comparison_wording_wrong');
}
