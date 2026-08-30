/**
 * #1302 — the COMMERCIAL lifecycle assertions #1301's runner does not cover.
 *
 * #1301 proves paid-subscription MECHANICS in Stripe test mode: checkout, webhook binding, renewal,
 * payment failure, cancellation, continuation. It does not prove SpeakSharp's actual commercial shape,
 * whose first act is the part with NO Stripe in it at all:
 *
 *   1. signup grants a DB-backed 30-day trial with ZERO Stripe objects — no customer, no subscription,
 *      no card;
 *   2. that trial EXPIRES and entitlement drops;
 *   3. only then may Checkout run, and it must create an IMMEDIATELY billable $10/month subscription
 *      with NO Stripe trial (`trialing` here would silently give a second free month);
 *   4. every test object created is cleaned up, unambiguously.
 *
 * ADDITIVE BY CONSTRUCTION. This module deliberately does NOT extend the runner's `REQUIRED_PHASES`:
 * doing so would make `assertAllPhasesProven` demand phases the existing runner never proves, and the
 * weekly billing-qualification lane would begin failing on work that has not been authorized to run yet.
 *
 * NOTHING HERE EXECUTES A STRIPE CALL. These are pure assertions over objects a caller supplies, so the
 * contract can be reviewed and tested before any authorized test-mode run exists.
 */

export const COMMERCIAL_PHASES = Object.freeze([
    'db_trial_granted', 'db_trial_has_no_stripe_objects', 'db_trial_expired',
    'checkout_without_stripe_trial', 'first_paid_invoice', 'test_objects_cleaned',
] as const);
export type CommercialPhase = (typeof COMMERCIAL_PHASES)[number];

const PRO_UNIT_AMOUNT = 1000;
const TRIAL_DAYS = 30;
const refuse = (why: string): never => { throw new Error(`#1302 commercial lifecycle refused: ${why}`); };

/**
 * The trial is a DATABASE fact, not a Stripe object.
 *
 * A Stripe-side trial would put the user in `trialing` and hand them a second free period after the DB
 * trial already expired. The product's promise is 30 free days TOTAL.
 */
export function assertDbTrialWithoutStripe(input: {
    trialStartedAt: string | null;
    trialEndsAt: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    entitlement: string;
}): void {
    if (!input.trialStartedAt || !input.trialEndsAt) refuse('the account has no DB-backed trial window');
    const days = (Date.parse(input.trialEndsAt!) - Date.parse(input.trialStartedAt!)) / 86_400_000;
    if (!Number.isFinite(days)) refuse('the trial window is not a readable date range');
    // Tolerance covers DST and clock skew, not a different product promise.
    if (Math.abs(days - TRIAL_DAYS) > 1) refuse(`the DB trial is ${days.toFixed(1)} days, not ${TRIAL_DAYS}`);
    if (input.stripeCustomerId) refuse('a Stripe CUSTOMER exists during the card-free DB trial');
    if (input.stripeSubscriptionId) refuse('a Stripe SUBSCRIPTION exists during the card-free DB trial');
    if (input.entitlement !== 'trial') refuse(`entitlement during the DB trial is '${input.entitlement}', not 'trial'`);
}

/** After expiry the entitlement must actually DROP. A trial that never ends is not a trial. */
export function assertTrialExpired(input: { trialEndsAt: string; now: string; entitlement: string }): void {
    if (Date.parse(input.now) <= Date.parse(input.trialEndsAt)) {
        refuse('expiry was asserted before the trial window had elapsed');
    }
    if (input.entitlement === 'pro') refuse('entitlement is still pro after the trial expired');
    if (input.entitlement === 'trial') refuse('entitlement is still trial after the trial expired');
}

/**
 * Checkout must produce an IMMEDIATELY billable subscription.
 *
 * `trialing`, a `trial_end`, or a zero first invoice all mean the user got another free month after the
 * 30 DB days. Each is checked separately so the failure names its own cause.
 */
export function assertCheckoutHasNoStripeTrial(subscription: unknown): void {
    if (!subscription || typeof subscription !== 'object') refuse('the subscription could not be read');
    const s = subscription as {
        livemode?: unknown; status?: unknown; trial_end?: unknown; trial_start?: unknown;
        items?: { data?: Array<{ price?: { unit_amount?: unknown; currency?: unknown; recurring?: { interval?: unknown } } }> };
    };
    if (s.livemode !== false) refuse('the subscription is a LIVE object');
    if (s.trial_end != null) refuse('the Stripe subscription carries a trial_end — a second free period');
    if (s.trial_start != null) refuse('the Stripe subscription carries a trial_start — a second free period');
    if (s.status !== 'active') refuse(`the subscription status is '${String(s.status)}', not immediately active`);
    const price = s.items?.data?.[0]?.price;
    if (!price) refuse('the subscription has no price item');
    if (price.unit_amount !== PRO_UNIT_AMOUNT) refuse(`the subscription price is ${String(price.unit_amount)}, not ${PRO_UNIT_AMOUNT}`);
    if (price.currency !== 'usd') refuse(`the subscription currency is '${String(price.currency)}', not usd`);
    if (price.recurring?.interval !== 'month') refuse('the subscription is not billed monthly');
}

/** The first invoice must be a real $10 charge that actually succeeded. */
export function assertFirstPaidInvoice(invoice: unknown): void {
    if (!invoice || typeof invoice !== 'object') refuse('the first invoice could not be read');
    const i = invoice as { livemode?: unknown; amount_paid?: unknown; currency?: unknown; status?: unknown; billing_reason?: unknown };
    if (i.livemode !== false) refuse('the first invoice is a LIVE object');
    if (i.status !== 'paid') refuse(`the first invoice status is '${String(i.status)}', not paid`);
    if (i.amount_paid !== PRO_UNIT_AMOUNT) refuse(`the first invoice charged ${String(i.amount_paid)}, not ${PRO_UNIT_AMOUNT}`);
    if (i.currency !== 'usd') refuse(`the first invoice currency is '${String(i.currency)}', not usd`);
    if (i.billing_reason === 'subscription_cycle') refuse('the first invoice is a RENEWAL, not the initial charge');
}

/**
 * Cleanup must be UNAMBIGUOUS.
 *
 * "No error" is not proof of deletion. Every object the run created must be named and confirmed gone;
 * anything unaccounted for aborts, because a leftover test object is indistinguishable from one this run
 * never created.
 */
export function assertTestObjectsCleaned(input: {
    created: readonly string[];
    confirmedDeleted: readonly string[];
}): void {
    if (input.created.length === 0) refuse('cleanup was asserted but the run recorded creating nothing');
    const deleted = new Set(input.confirmedDeleted);
    const leftover = input.created.filter((id) => !deleted.has(id));
    if (leftover.length) refuse(`test objects not confirmed deleted: ${leftover.join(', ')}`);
    const unexpected = input.confirmedDeleted.filter((id) => !input.created.includes(id));
    if (unexpected.length) refuse(`cleanup deleted objects this run did not create: ${unexpected.join(', ')}`);
}

export function assertAllCommercialPhasesProven(evidence: Partial<Record<CommercialPhase, boolean>>): void {
    const missing = COMMERCIAL_PHASES.filter((p) => evidence[p] !== true);
    if (missing.length) refuse(`unproven commercial phase(s): ${missing.join(', ')}`);
}

/**
 * #1302 — is this retrieval failure PROOF that the object is gone?
 *
 * Only a definite "it is not there" counts. The first version of the cleanup treated EVERY retrieval
 * exception as proof of deletion, so an expired key, a 429 or a DNS blip would have been reported as
 * clean cleanup while a Test Clock — and its customer and subscription — leaked into a shared test
 * account. Absence must be observed, not inferred from an inability to look.
 */
export function isProofOfAbsence(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { statusCode?: number; code?: string; type?: string; message?: string };
    if (e.statusCode === 404) return true;
    if (e.code === 'resource_missing') return true;
    if (e.type === 'StripeInvalidRequestError' && /no such|resource_missing/i.test(e.message ?? '')) return true;
    return false;
}
