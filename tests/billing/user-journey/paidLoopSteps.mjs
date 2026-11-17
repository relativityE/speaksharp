// The outcome 8 paid value loop's step list (#1822). Outcome 8 owns this list; journeySteps.mjs only lists it, so
// the spec, the workflow's combined receipt and the runner plan all read the same 17 steps.

/** The four steps every paid journey proves first (the same four as the billing journeys, in the same order). */
export const PAID_LOOP_PAID_STEPS = Object.freeze(['hosted_checkout', 'first_invoice', 'stripe_delivery', 'paid_entitlement']);

/** One paid account gets coaching, a linked repeat, a comparison and a returning sign-in. */
export const PAID_LOOP_STEPS = Object.freeze(['trial_expired', ...PAID_LOOP_PAID_STEPS,
  'first_take_saved', 'first_take_eligible', 'coaching_saved', 'coaching_rendered', 'recommendation_recorded',
  'linked_repeat_started', 'repeat_take_saved', 'repeat_resolved', 'comparison_shown',
  'sign_in_again', 'readback', 'cleanup']);
