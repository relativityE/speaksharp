// The billing journeys and the steps each must prove. One source for the spec (via contract.ts), the workflow's
// combined-receipt finalizer (localStackReceipt.mjs) and the runner plan (runnerPlan.mjs), so they can't drift.
import { PAID_LOOP_STEPS } from './paidLoopSteps.mjs';

/** The three lifecycle journeys a run without a mode collects (unchanged). */
export const BILLING_JOURNEYS = Object.freeze(['conversion', 'renewal_recovery', 'portal_expiry']);
/** Branches only the Stripe test-mode runner's full mode adds. Each has its own fixture, test and receipt. */
export const FULL_MODE_JOURNEYS = Object.freeze(['failed_checkout', 'portal_recovery', 'refund_period_end']);
export const RUNNER_JOURNEYS = Object.freeze([...BILLING_JOURNEYS, ...FULL_MODE_JOURNEYS]);
/**
 * The outcome 8 paid value loop (#1822). It has its own spec, Playwright config and runner mode (`paid_loop`), so the
 * lifecycle spec never collects it and billing's verdict never depends on it, but it runs on the same disposable
 * local stack and goes through the same receipt path.
 */
export const PAID_LOOP_JOURNEYS = Object.freeze(['paid_value_loop']);
/** Every journey the local-stack workflow may dispatch, and so every journey its combined receipt accepts. */
export const LOCAL_STACK_JOURNEYS = Object.freeze([...RUNNER_JOURNEYS, ...PAID_LOOP_JOURNEYS]);
export const RUNNER_MODES = Object.freeze(['smoke', 'full']);

const PAID = ['hosted_checkout', 'first_invoice', 'stripe_delivery', 'paid_entitlement'];
export const REQUIRED_STEPS = Object.freeze({
  conversion: Object.freeze(['trial_granted', 'trial_expired', 'repeated_click_one_session', 'checkout_cancelled',
    'checkout_retried', ...PAID, 'returned_to_app', 'paid_ui', 'reload', 'sign_in_again', 'next_recording', 'cleanup']),
  renewal_recovery: Object.freeze([...PAID,
    'renewal_paid', 'renewal_delivery', 'failure_observed', 'failure_delivery', 'access_revoked',
    'recovery_paid', 'recovery_delivery', 'access_restored', 'cleanup']),
  portal_expiry: Object.freeze([...PAID,
    'portal_opened', 'portal_cancelled', 'cancellation_delivery', 'paid_until_period_end',
    'expiry_delivery', 'account_retained', 'access_expired', 'history_retained', 'cleanup']),
  // A declined card and an abandoned session grant nothing; a retry then converts to exactly one subscription.
  failed_checkout: Object.freeze(['trial_expired', 'declined_checkout', 'no_access_after_decline', 'abandoned_checkout',
    'no_access_after_abandon', ...PAID, 'single_subscription', 'cleanup']),
  // Recovery is the customer's own act in Manage billing (the Stripe portal), not an API payment.
  portal_recovery: Object.freeze([...PAID,
    'failure_observed', 'failure_delivery', 'access_revoked', 'portal_opened', 'portal_payment_method_updated',
    'recovery_paid', 'recovery_delivery', 'access_restored', 'cleanup']),
  // Akin, 2026-11-12: refunds are full only, and "the customer uses the balance days/time of the monthly
  // subscription": Pro until the period ends, then no second charge.
  refund_period_end: Object.freeze([...PAID,
    'refund_issued', 'refund_cancellation_scheduled', 'cancellation_delivery', 'paid_until_period_end',
    'expiry_delivery', 'no_second_charge', 'account_retained', 'access_expired', 'history_retained', 'cleanup']),
  // Outcome 8 (#1822) owns this list in paidLoopSteps.mjs; this file only lists it.
  paid_value_loop: PAID_LOOP_STEPS,
});

/**
 * What a member can do once a paid membership has ended is ON HOLD (Sam, 2026-11-12) until Akin confirms the
 * end-of-access policy with Sam. These steps are never asserted and never PASSED: each receipt shows them as
 * PENDING_POLICY, and a journey holding one cannot pass. Data retention (account_retained) is not access and
 * is still proven, from the database only.
 */
export const PENDING_POLICY = 'PENDING_POLICY';
export const POLICY_PENDING_STEPS = Object.freeze({
  portal_expiry: Object.freeze(['access_expired', 'history_retained']),
  refund_period_end: Object.freeze(['access_expired', 'history_retained']),
});
