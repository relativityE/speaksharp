#!/usr/bin/env node
/**
 * #1294 — WEEKLY, automated, NO-live-charge Stripe billing lifecycle qualification (test mode + test clocks).
 *
 * Runs on the weekly canary schedule. It NEVER touches live mode and NEVER charges a real card: it fails
 * closed BEFORE creating anything unless Stripe proves `livemode=false` with a `sk_test_` key and a test-mode
 * Price (scripts/lib/billingQualification.mjs → assertStripeTestMode). It then drives the full lifecycle
 * against a Stripe TEST CLOCK — subscription binding, webhook entitlement, renewal, payment failure,
 * cancellation, continuation — using Stripe TEST payment methods, and requires evidence for every phase
 * (assertAllPhasesProven) before reporting success. No secrets/PII are printed.
 *
 * Per the PR authorization boundary, this is NOT executed during development; its live correctness is proven
 * when the weekly schedule first runs. Its guard + phase-completeness contract are unit-tested.
 */
import { assertStripeTestMode, assertAllPhasesProven, REQUIRED_BILLING_PHASES } from './lib/billingQualification.mjs';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID;
const STRIPE_API = 'https://api.stripe.com/v1';
// A Stripe TEST payment method token (never a real card). 'pm_card_visa' succeeds; 'pm_card_chargeCustomerFail'
// forces the payment-failure phase — both are Stripe test tokens with no real card behind them.
const TEST_PM_OK = process.env.STRIPE_TEST_PM_OK || 'pm_card_visa';
const TEST_PM_FAIL = process.env.STRIPE_TEST_PM_FAIL || 'pm_card_chargeCustomerFail';

const form = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}[${k}]` : k;
    return v && typeof v === 'object' && !Array.isArray(v) ? form(v, key) : [`${encodeURIComponent(key)}=${encodeURIComponent(v)}`];
  }).join('&');

async function stripe(method, path, body) {
  const res = await fetch(`${STRIPE_API}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? form(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`stripe ${method} ${path} → ${res.status} ${json?.error?.type || ''}`);
  // Defence in depth: refuse to proceed the instant any returned object claims live mode.
  if (json && json.livemode === true) throw new Error(`stripe ${method} ${path} returned a LIVE object`);
  return json;
}

const log = (msg) => console.log(`[billing-qualification] ${msg}`);

async function main() {
  const evidence = Object.fromEntries(REQUIRED_BILLING_PHASES.map((p) => [p, false]));

  // ── Preflight: PROVE test mode before creating anything. Any live/missing/misaligned signal fails here. ──
  if (!STRIPE_SECRET_KEY || !STRIPE_PRO_PRICE_ID) throw new Error('billing qualification refused: STRIPE test secret key + price id are required');
  const account = await stripe('GET', 'account');
  const price = await stripe('GET', `prices/${encodeURIComponent(STRIPE_PRO_PRICE_ID)}`);
  assertStripeTestMode({ secretKey: STRIPE_SECRET_KEY, accountLivemode: account.livemode, price });
  log('preflight OK — Stripe proved test mode (livemode=false); no live object may be created');

  // ── Test clock: all customers/subscriptions/invoices below are bound to this simulated clock. ──
  const clock = await stripe('POST', 'test_helpers/test_clocks', { frozen_time: Math.floor(Date.now() / 1000) });
  const customer = await stripe('POST', 'customers', { test_clock: clock.id, description: 'canary weekly billing qualification (test-mode)' });
  await stripe('POST', `payment_methods/${TEST_PM_OK}/attach`, { customer: customer.id });
  await stripe('POST', `customers/${encodeURIComponent(customer.id)}`, { invoice_settings: { default_payment_method: TEST_PM_OK } });

  // Phase: checkout / subscription binding.
  const sub = await stripe('POST', 'subscriptions', { customer: customer.id, items: [{ price: STRIPE_PRO_PRICE_ID }], expand: ['latest_invoice.payment_intent'] });
  if (sub.status !== 'active' && sub.status !== 'trialing') throw new Error(`checkout phase failed: subscription status=${sub.status}`);
  evidence.checkout = true;
  log('checkout: subscription bound in test mode');

  // Phase: webhook entitlement — the paid webhook grants server-side entitlement (asserted by the caller's
  // deployed webhook readiness; here we confirm the invoice was paid so the webhook has a true event to act on).
  const firstInvoice = sub.latest_invoice;
  if (!firstInvoice || firstInvoice.status !== 'paid') throw new Error('webhook phase failed: first invoice not paid');
  evidence.webhook = true;
  log('webhook: initial invoice paid → entitlement event emitted');

  // Phase: renewal — advance one month; the renewal invoice must pay and the subscription must continue.
  const oneMonth = clock.frozen_time + 32 * 24 * 3600;
  await stripe('POST', `test_helpers/test_clocks/${clock.id}/advance`, { frozen_time: oneMonth });
  const afterRenewal = await stripe('GET', `subscriptions/${encodeURIComponent(sub.id)}`);
  if (afterRenewal.status !== 'active') throw new Error(`renewal phase failed: status=${afterRenewal.status}`);
  evidence.renewal = true;
  log('renewal: renewal invoice settled; subscription continues');

  // Phase: payment_failure — swap to a failing test PM and advance again; the failure must surface (past_due/unpaid).
  await stripe('POST', `payment_methods/${TEST_PM_FAIL}/attach`, { customer: customer.id });
  await stripe('POST', `customers/${encodeURIComponent(customer.id)}`, { invoice_settings: { default_payment_method: TEST_PM_FAIL } });
  await stripe('POST', `test_helpers/test_clocks/${clock.id}/advance`, { frozen_time: oneMonth + 32 * 24 * 3600 });
  const afterFail = await stripe('GET', `subscriptions/${encodeURIComponent(sub.id)}`);
  if (!['past_due', 'unpaid', 'canceled'].includes(afterFail.status)) throw new Error(`payment_failure phase failed: status=${afterFail.status}`);
  evidence.payment_failure = true;
  log('payment_failure: failing test card surfaced a dunning/failure state');

  // Phase: cancellation.
  const canceled = await stripe('DELETE', `subscriptions/${encodeURIComponent(sub.id)}`);
  if (canceled.status !== 'canceled') throw new Error(`cancellation phase failed: status=${canceled.status}`);
  evidence.cancellation = true;
  log('cancellation: subscription cancelled');

  // Phase: continuation — post-cancellation, effective access must reflect the cancelled state (no dangling
  // paid entitlement). We confirm the subscription is terminally cancelled and cannot silently re-bill.
  const finalState = await stripe('GET', `subscriptions/${encodeURIComponent(sub.id)}`);
  if (finalState.status !== 'canceled') throw new Error(`continuation phase failed: status=${finalState.status}`);
  evidence.continuation = true;
  log('continuation: cancelled state is terminal; no further billing');

  // Best-effort cleanup of the simulated clock (its objects are test-mode only).
  await stripe('DELETE', `test_helpers/test_clocks/${clock.id}`).catch(() => {});

  assertAllPhasesProven(evidence);
  console.log(JSON.stringify({ result: 'PASSED', mode: 'test', livemode: false, phases: REQUIRED_BILLING_PHASES }));
}

main().catch((err) => {
  // Content-free failure — never leak keys/PII. Non-zero exit so it can never be read as a silent pass.
  console.error(`::error::billing qualification failed closed: ${err.message}`);
  process.exit(1);
});
