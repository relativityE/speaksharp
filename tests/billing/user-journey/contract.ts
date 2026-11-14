/** Billing acceptance is separate from the fixed 15 practice journeys. No network or secrets here. */
import { BILLING_JOURNEYS, FULL_MODE_JOURNEYS, RUNNER_JOURNEYS, RUNNER_MODES, REQUIRED_STEPS, PENDING_POLICY,
  POLICY_PENDING_STEPS, LOCAL_STACK_JOURNEYS, type BillingJourney, type RunnerJourney, type RunnerMode,
  type LocalStackJourney } from './journeySteps.mjs';
export { BILLING_JOURNEYS, FULL_MODE_JOURNEYS, RUNNER_JOURNEYS, RUNNER_MODES, REQUIRED_STEPS, PENDING_POLICY,
  POLICY_PENDING_STEPS, LOCAL_STACK_JOURNEYS, type BillingJourney, type RunnerJourney, type RunnerMode,
  type LocalStackJourney };

/**
 * Which branches a run collects. No mode keeps today's three lifecycle branches unchanged. Anything other
 * than an exact mode name is refused at load, so a typo can never quietly run fewer branches.
 */
export function selectRunnerJourneys(raw: string | undefined): { mode: RunnerMode | null; journeys: readonly RunnerJourney[] } {
  if (raw === undefined || raw === '') return { mode: null, journeys: BILLING_JOURNEYS };
  requireFact((RUNNER_MODES as readonly string[]).includes(raw), 'runner_mode_unknown');
  const mode = raw as RunnerMode;
  return { mode, journeys: mode === 'smoke' ? ['conversion'] : RUNNER_JOURNEYS };
}

export function requireFact(value: unknown, code: string): asserts value {
  if (!value) throw new Error(`BILLING_JOURNEY:${code}`);
}

export function safeFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^BILLING_JOURNEY:([a-z_]{1,80})$/.exec(message)?.[1] ?? 'unclassified_step_failure';
}

/** All output is a closed, content-free list. Never serialize provider responses or credentials. */
export function receipt(journey: LocalStackJourney, steps: ReadonlySet<string>) {
  const required = REQUIRED_STEPS[journey];
  const pending: readonly string[] = POLICY_PENDING_STEPS[journey] ?? [];
  requireFact([...steps].every(step => required.includes(step)), 'unknown_step');
  // Access after a membership ends is on hold: such a step can never be recorded as proven.
  requireFact([...steps].every(step => !pending.includes(step)), 'policy_pending_step_asserted');
  const missing = required.filter(step => !pending.includes(step) && !steps.has(step));
  return {
    schema: 'billing-user-journey/v1', journey, stripeMode: 'test',
    result: missing.length ? 'INCOMPLETE' : pending.length ? PENDING_POLICY : 'PASSED',
    steps: required.map(step => ({ step,
      result: pending.includes(step) ? PENDING_POLICY : steps.has(step) ? 'PASSED' : 'NOT_PROVEN' })),
  };
}

/** The run marker every fixture carries. A fixed shape, so a foreign or empty marker is refused. */
export const RUN_MARKER = /^rwt-journey-billing-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Fields for the one test-clock create. The run marker goes in `name` IN THE CREATE REQUEST, before the
 * uncertain-create boundary: if the response is lost, the clock can still be attributed to this run by name
 * instead of being an unowned leftover. Refuses to build the request without a valid marker.
 */
export function testClockCreateFields(marker: string, nowSeconds: number): Record<string, string> {
  requireFact(RUN_MARKER.test(marker), 'run_marker_invalid');
  requireFact(Number.isSafeInteger(nowSeconds) && nowSeconds > 0, 'clock_time_invalid');
  return { frozen_time: String(nowSeconds), name: marker };
}

/**
 * The journey's own receipt status. On the local stack it can never say PASSED or VERIFIED by itself: the
 * billing rows were not read, so it waits for the workflow's checked teardown and destruction proof.
 */
export function localStackStatus(result: string, cleanup: string, localStack: boolean): { result: string; cleanup: string } {
  if (!localStack) return { result, cleanup };
  return {
    result: result === 'PASSED' ? 'PENDING_STACK_DESTRUCTION' : result,
    cleanup: cleanup === 'VERIFIED' ? 'PENDING_STACK_DESTRUCTION' : cleanup,
  };
}

export function assertTestPrice(input: unknown): void {
  const price = (input ?? {}) as { livemode?: unknown; active?: unknown; unit_amount?: unknown;
    currency?: unknown; recurring?: { interval?: unknown; interval_count?: unknown } };
  requireFact(price.livemode === false && price.active === true, 'price_not_active_test');
  requireFact(price.unit_amount === 1000 && price.currency === 'usd'
    && price.recurring?.interval === 'month' && price.recurring?.interval_count === 1, 'wrong_price');
}

export function assertInvoice(input: unknown, customer: string, subscription: string, reason: string): void {
  const invoice = (input ?? {}) as { livemode?: unknown; status?: unknown; amount_paid?: unknown;
    currency?: unknown; billing_reason?: unknown; customer?: unknown; subscription?: unknown };
  requireFact(invoice.livemode === false && invoice.status === 'paid' && invoice.amount_paid === 1000
    && invoice.currency === 'usd' && invoice.billing_reason === reason, 'invoice_not_paid_contract');
  requireFact(invoice.customer === customer && invoice.subscription === subscription, 'invoice_identity');
}

/** A real provider event plus the deployed processing ledger, never an unchanged tier alone. */
export type BillingEvent = { id: string; livemode: boolean; type: string; api_version: string;
  request?: { id?: string | null; idempotency_key?: string | null } | null;
  data: { object: { id: string; customer: string; cancel_at_period_end?: boolean; status?: string } } };

/** The webhook's per-refund-event idempotency key (stripe-webhook/refund.ts). */
export const REFUND_CANCEL_KEY_PREFIX = 'refund-cancel-at-period-end-';

/**
 * The refund branch's cancellation must be the webhook's own follow-up to THIS refund event: the
 * subscription.updated event carries the request's idempotency key, which names the refund event. A
 * cancellation made any other way (portal, dashboard, test code) does not count.
 */
export function isRefundCancellation(input: unknown, expected: { subscription: string; customer: string; refundEventId: string }): boolean {
  const event = (input ?? {}) as Partial<BillingEvent>;
  return /^evt_[A-Za-z0-9]+$/.test(expected.refundEventId) && event.type === 'customer.subscription.updated'
    && event.livemode === false && event.data?.object?.id === expected.subscription
    && event.data?.object?.customer === expected.customer && event.data?.object?.cancel_at_period_end === true
    && event.data?.object?.status === 'active'
    && event.request?.idempotency_key === `${REFUND_CANCEL_KEY_PREFIX}${expected.refundEventId}`;
}

/** The operator refund is the whole first payment, in test mode, on this run's own charge. */
export function assertFullRefund(input: unknown, charge: string): void {
  const refund = (input ?? {}) as { object?: unknown; status?: unknown; amount?: unknown; currency?: unknown; charge?: unknown };
  requireFact(refund.object === 'refund' && refund.status === 'succeeded' && refund.amount === 1000
    && refund.currency === 'usd' && refund.charge === charge, 'refund_not_full_contract');
}

/**
 * The Checkout URL the app returned, checked BEFORE the browser goes anywhere (Sam's v5 and fa7e7180 returns):
 * Stripe's own hosted origin over https, no credentials or port, and exactly one test-mode session id.
 */
export function checkoutSessionFromUrl(raw: unknown): string {
  requireFact(typeof raw === 'string' && raw.length > 0, 'checkout_unavailable');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('BILLING_JOURNEY:checkout_origin'); }
  requireFact(url.protocol === 'https:' && url.origin === 'https://checkout.stripe.com'
    && url.username === '' && url.password === '' && url.port === '', 'checkout_origin');
  const sessions = url.pathname.match(/cs_(?:test|live)_[A-Za-z0-9]+/g) ?? [];
  requireFact(sessions.length === 1 && sessions[0].startsWith('cs_test_'), 'test_checkout_required');
  return sessions[0];
}

/**
 * The provider's own record of that session, also read before navigation: this member's test-mode subscription
 * Checkout, still open and unpaid, returning only to this app.
 */
export function assertCheckoutIdentity(input: unknown, expected: { session: string; customer: string; uid: string; app: string }): void {
  const session = (input ?? {}) as { id?: unknown; livemode?: unknown; mode?: unknown; status?: unknown; payment_status?: unknown;
    customer?: unknown; client_reference_id?: unknown; metadata?: { userId?: unknown } | null; success_url?: unknown; cancel_url?: unknown };
  const originOf = (raw: unknown) => { try { return typeof raw === 'string' ? new URL(raw).origin : ''; } catch { return ''; } };
  requireFact(session.id === expected.session && session.livemode === false && session.mode === 'subscription', 'checkout_identity');
  requireFact(session.customer === expected.customer && session.client_reference_id === expected.uid
    && session.metadata?.userId === expected.uid, 'checkout_identity');
  requireFact(session.status === 'open' && session.payment_status === 'unpaid', 'checkout_not_open');
  requireFact(originOf(session.success_url) === expected.app && originOf(session.cancel_url) === expected.app, 'checkout_return_origin');
}

/**
 * The payment method the member just added in the portal: exactly one card that was not on the customer before
 * the Add (so the 4242 card from Checkout, or a no-op Add, can never satisfy it), and not the failing card.
 */
export function newlyAddedCard(listed: unknown, before: readonly string[], excluded: string): string {
  const page = (listed ?? {}) as { data?: unknown; has_more?: unknown };
  requireFact(Array.isArray(page.data) && page.has_more === false, 'payment_method_page_incomplete');
  const fresh = (page.data as { id?: unknown; card?: { last4?: unknown } | null }[])
    .filter(pm => typeof pm?.id === 'string' && !before.includes(pm.id) && pm.id !== excluded);
  requireFact(fresh.length === 1 && fresh[0].card?.last4 === '4242', 'portal_card_not_added');
  return fresh[0].id as string;
}

/**
 * After a full refund and the period end, no second charge: a complete, identity-bound invoice read that holds
 * the original paid invoice, and nothing else that took money. An empty or partial list proves nothing.
 */
export function assertNoSecondCharge(listed: unknown, expected: { customer: string; subscription: string; firstInvoice: string }): void {
  const page = (listed ?? {}) as { data?: unknown; has_more?: unknown };
  requireFact(Array.isArray(page.data) && page.has_more === false, 'invoice_page_incomplete');
  const invoices = page.data as { id?: unknown; livemode?: unknown; customer?: unknown; subscription?: unknown; amount_paid?: unknown }[];
  requireFact(invoices.every(i => i?.livemode === false && i.customer === expected.customer && i.subscription === expected.subscription),
    'invoice_identity');
  const first = invoices.filter(i => i.id === expected.firstInvoice);
  requireFact(first.length === 1 && first[0].amount_paid === 1000, 'original_invoice_missing');
  requireFact(invoices.every(i => i.id === expected.firstInvoice || i.amount_paid === 0), 'second_charge_after_refund');
}

/** A declined or abandoned Checkout grants nothing: no subscription, no payment, the session not complete. */
export function assertCheckoutGrantedNothing(input: unknown, expectedStatus: 'open' | 'expired'): void {
  const session = (input ?? {}) as { livemode?: unknown; status?: unknown; payment_status?: unknown; subscription?: unknown };
  requireFact(session.livemode === false && session.status === expectedStatus && session.payment_status === 'unpaid'
    && (session.subscription === null || session.subscription === undefined), 'failed_checkout_granted_something');
}

export function isCorrelatedDelivery(input: unknown, expected: {
  type: string; objectId: string; customer: string;
}, ledger: { event_id?: unknown; event_type?: unknown; processed_at?: unknown } | null): boolean {
  const event = (input ?? {}) as Partial<BillingEvent>;
  return /^evt_[A-Za-z0-9]+$/.test(event.id ?? '') && event.livemode === false && event.api_version === '2024-06-20'
    && event.type === expected.type && event.data?.object?.id === expected.objectId
    && event.data?.object?.customer === expected.customer
    && ledger?.event_id === event.id && ledger?.event_type === 'subscription.snapshot'
    && typeof ledger?.processed_at === 'string' && Number.isFinite(Date.parse(ledger.processed_at));
}

/** The disposable stack started inside the approval-gated workflow: loopback only, never a hosted project. */
export const LOCAL_STACK_STATUS = 'LOCAL_DISPOSABLE_STACK';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

export function assertSandboxConfiguration(env: Record<string, string | undefined>, target: {
  status: string; appOrigin: string | null; apiOrigin: string | null; productionApiOrigin: string | null;
}) {
  // A caller cannot admit an arbitrary app/database by naming two different URLs in its environment.
  // Changing this committed target requires code/security review before any fixture may be created.
  const local = target.status === LOCAL_STACK_STATUS;
  requireFact((target.status === 'REVIEWED_ISOLATED_SANDBOX' || local) && target.appOrigin && target.apiOrigin
    && target.productionApiOrigin, 'sandbox_target_not_reviewed');
  const names = ['BILLING_SANDBOX_APP_URL', 'BILLING_SANDBOX_SUPABASE_URL', 'BILLING_SANDBOX_ANON_KEY',
    'BILLING_SANDBOX_SERVICE_ROLE_KEY', 'BILLING_SANDBOX_STRIPE_KEY', 'BILLING_SANDBOX_PRICE_ID',
    'BILLING_SANDBOX_RELEASE_SHA', 'BILLING_PRODUCTION_SUPABASE_URL'];
  requireFact(names.every(name => Boolean(env[name]?.trim())), 'missing_sandbox_configuration');
  requireFact(env.BILLING_JOURNEY_APPROVAL === 'ISOLATED-TEST-MODE-ONLY', 'missing_sandbox_acknowledgment');
  requireFact(env.BILLING_SANDBOX_STRIPE_KEY?.startsWith('sk_test_'), 'test_key_required');
  requireFact(/^[0-9a-f]{40}$/i.test(env.BILLING_SANDBOX_RELEASE_SHA!), 'release_sha_required');
  const origin = (raw: string, loopback = false) => {
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error('BILLING_JOURNEY:invalid_origin'); }
    requireFact(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'https_origin_required');
    // Plain http is admitted ONLY for the local stack's loopback app/API; everything else stays https.
    if (loopback) requireFact(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname), 'loopback_origin_required');
    else requireFact(url.protocol === 'https:', 'https_origin_required');
    return url.origin;
  };
  const app = origin(env.BILLING_SANDBOX_APP_URL!, local);
  const api = origin(env.BILLING_SANDBOX_SUPABASE_URL!, local);
  const productionApi = origin(env.BILLING_PRODUCTION_SUPABASE_URL!);
  requireFact(app === target.appOrigin && api === target.apiOrigin && productionApi === target.productionApiOrigin,
    'sandbox_target_binding_mismatch');
  requireFact(app !== 'https://speaksharp-public.vercel.app' && api !== productionApi, 'production_target_refused');
  return { app, api };
}
