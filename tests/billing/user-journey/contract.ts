/** Billing acceptance is separate from the fixed 15 practice journeys. No network or secrets here. */
export const BILLING_JOURNEYS = ['conversion', 'renewal_recovery', 'portal_expiry'] as const;
export type BillingJourney = typeof BILLING_JOURNEYS[number];
export const REQUIRED_STEPS: Record<BillingJourney, readonly string[]> = {
  conversion: ['trial_granted', 'trial_expired', 'hosted_checkout', 'first_invoice', 'stripe_delivery',
    'paid_entitlement', 'returned_to_app', 'paid_ui', 'reload', 'sign_in_again', 'next_recording', 'cleanup'],
  renewal_recovery: ['hosted_checkout', 'first_invoice', 'stripe_delivery', 'paid_entitlement',
    'renewal_paid', 'renewal_delivery', 'failure_observed', 'failure_delivery', 'access_revoked',
    'recovery_paid', 'recovery_delivery', 'access_restored', 'cleanup'],
  portal_expiry: ['hosted_checkout', 'first_invoice', 'stripe_delivery', 'paid_entitlement',
    'portal_opened', 'portal_cancelled', 'cancellation_delivery', 'paid_until_period_end',
    'expiry_delivery', 'access_expired', 'account_retained', 'history_retained', 'cleanup'],
};

export function requireFact(value: unknown, code: string): asserts value {
  if (!value) throw new Error(`BILLING_JOURNEY:${code}`);
}

export function safeFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^BILLING_JOURNEY:([a-z_]{1,80})$/.exec(message)?.[1] ?? 'unclassified_step_failure';
}

/** All output is a closed, content-free list. Never serialize provider responses or credentials. */
export function receipt(journey: BillingJourney, steps: ReadonlySet<string>) {
  const required = REQUIRED_STEPS[journey];
  requireFact([...steps].every(step => required.includes(step)), 'unknown_step');
  const missing = required.filter(step => !steps.has(step));
  return {
    schema: 'billing-user-journey/v1', journey, stripeMode: 'test',
    result: missing.length ? 'INCOMPLETE' : 'PASSED',
    steps: required.map(step => ({ step, result: steps.has(step) ? 'PASSED' : 'NOT_PROVEN' })),
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
  data: { object: { id: string; customer: string; cancel_at_period_end?: boolean } } };

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

export function assertSandboxConfiguration(env: Record<string, string | undefined>, target: {
  status: string; appOrigin: string | null; apiOrigin: string | null; productionApiOrigin: string | null;
}) {
  // A caller cannot admit an arbitrary app/database by naming two different URLs in its environment.
  // Changing this committed target requires code/security review before any fixture may be created.
  requireFact(target.status === 'REVIEWED_ISOLATED_SANDBOX' && target.appOrigin && target.apiOrigin
    && target.productionApiOrigin, 'sandbox_target_not_reviewed');
  const names = ['BILLING_SANDBOX_APP_URL', 'BILLING_SANDBOX_SUPABASE_URL', 'BILLING_SANDBOX_ANON_KEY',
    'BILLING_SANDBOX_SERVICE_ROLE_KEY', 'BILLING_SANDBOX_STRIPE_KEY', 'BILLING_SANDBOX_PRICE_ID',
    'BILLING_SANDBOX_RELEASE_SHA', 'BILLING_PRODUCTION_SUPABASE_URL'];
  requireFact(names.every(name => Boolean(env[name]?.trim())), 'missing_sandbox_configuration');
  requireFact(env.BILLING_JOURNEY_APPROVAL === 'ISOLATED-TEST-MODE-ONLY', 'missing_sandbox_acknowledgment');
  requireFact(env.BILLING_SANDBOX_STRIPE_KEY?.startsWith('sk_test_'), 'test_key_required');
  requireFact(/^[0-9a-f]{40}$/i.test(env.BILLING_SANDBOX_RELEASE_SHA!), 'release_sha_required');
  const origin = (raw: string) => {
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error('BILLING_JOURNEY:invalid_origin'); }
    requireFact(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && url.pathname === '/', 'https_origin_required');
    return url.origin;
  };
  const app = origin(env.BILLING_SANDBOX_APP_URL!);
  const api = origin(env.BILLING_SANDBOX_SUPABASE_URL!);
  const productionApi = origin(env.BILLING_PRODUCTION_SUPABASE_URL!);
  requireFact(app === target.appOrigin && api === target.apiOrigin && productionApi === target.productionApiOrigin,
    'sandbox_target_binding_mismatch');
  requireFact(app !== 'https://speaksharp-public.vercel.app' && api !== productionApi, 'production_target_refused');
  return { app, api };
}
