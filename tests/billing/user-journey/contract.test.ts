import { strict as assert } from 'node:assert';
import { test } from 'vitest';
import { BILLING_JOURNEYS, REQUIRED_STEPS, receipt, assertTestPrice, assertInvoice,
  isCorrelatedDelivery, assertSandboxConfiguration, safeFailureReason } from './contract';

const price = { livemode: false, active: true, unit_amount: 1000, currency: 'usd',
  recurring: { interval: 'month', interval_count: 1 } };
const invoice = { livemode: false, status: 'paid', amount_paid: 1000, currency: 'usd',
  billing_reason: 'subscription_create', customer: 'cus_control', subscription: 'sub_control' };
const expected = { type: 'checkout.session.completed', objectId: 'cs_test_control', customer: 'cus_control' };
const event = { id: 'evt_control', livemode: false, type: expected.type, api_version: '2024-06-20',
  data: { object: { id: expected.objectId, customer: expected.customer } } };
const ledger = { event_id: event.id, event_type: 'subscription.snapshot', processed_at: '2026-01-01T00:00:00Z' };
const env = { BILLING_SANDBOX_APP_URL: 'https://billing-sandbox.example.com',
  BILLING_SANDBOX_SUPABASE_URL: 'https://sandbox.example.com', BILLING_PRODUCTION_SUPABASE_URL: 'https://production.example.com',
  BILLING_SANDBOX_ANON_KEY: 'synthetic-control', BILLING_SANDBOX_SERVICE_ROLE_KEY: 'synthetic-control',
  BILLING_SANDBOX_STRIPE_KEY: 'sk_test_synthetic_control', BILLING_SANDBOX_PRICE_ID: 'price_control',
  BILLING_SANDBOX_RELEASE_SHA: 'a'.repeat(40), BILLING_JOURNEY_APPROVAL: 'ISOLATED-TEST-MODE-ONLY' };
const target = { status: 'REVIEWED_ISOLATED_SANDBOX', appOrigin: env.BILLING_SANDBOX_APP_URL,
  apiOrigin: env.BILLING_SANDBOX_SUPABASE_URL, productionApiOrigin: env.BILLING_PRODUCTION_SUPABASE_URL };

for (const journey of BILLING_JOURNEYS) {
  test(`${journey}: every individual missing step blocks PASS`, () => {
    assert.equal(receipt(journey, new Set(REQUIRED_STEPS[journey])).result, 'PASSED');
    for (const omitted of REQUIRED_STEPS[journey]) {
      const result = receipt(journey, new Set(REQUIRED_STEPS[journey].filter(step => step !== omitted)));
      assert.equal(result.result, 'INCOMPLETE', omitted);
      assert.equal(result.steps.find(row => row.step === omitted)?.result, 'NOT_PROVEN');
    }
    assert.equal(receipt(journey, new Set()).result, 'INCOMPLETE');
    assert.throws(() => receipt(journey, new Set(['invented-step'])));
  });
}
test('real-event correlation rejects wrong object/customer/type/ledger and missing delivery', () => {
  assert.equal(isCorrelatedDelivery(event, expected, ledger), true);
  for (const wrong of [{ ...event, livemode: true }, { ...event, api_version: 'unknown' }, { ...event, id: 'evt_synthetic_local' },
    { ...event, type: 'invoice.paid' }, { ...event, data: { object: { ...event.data.object, customer: 'cus_other' } } },
    { ...event, data: { object: { ...event.data.object, id: 'cs_test_other' } } }]) {
    assert.equal(isCorrelatedDelivery(wrong, expected, ledger), false);
  }
  for (const wrong of [null, { ...ledger, event_id: 'evt_other' }, { ...ledger, event_type: 'ignored' },
    { ...ledger, processed_at: 'invalid' }]) assert.equal(isCorrelatedDelivery(event, expected, wrong), false);
});
test('paid invoice is exact first charge and identity, not a renewal, zero charge or live object', () => {
  assertInvoice(invoice, 'cus_control', 'sub_control', 'subscription_create');
  for (const delta of [{ livemode: true }, { status: 'open' }, { amount_paid: 0 }, { currency: 'eur' },
    { billing_reason: 'subscription_cycle' }, { customer: 'cus_other' }, { subscription: 'sub_other' }]) {
    assert.throws(() => assertInvoice({ ...invoice, ...delta }, 'cus_control', 'sub_control', 'subscription_create'));
  }
});
test('price is exact active monthly test price', () => {
  assertTestPrice(price);
  for (const delta of [{ livemode: true }, { active: false }, { unit_amount: 999 }, { currency: 'eur' },
    { recurring: { interval: 'month', interval_count: 2 } }]) assert.throws(() => assertTestPrice({ ...price, ...delta }));
});
test('sandbox preflight rejects production, live keys, missing inputs and credential-bearing URLs', () => {
  assertSandboxConfiguration(env, target);
  for (const key of Object.keys(env)) assert.throws(() => assertSandboxConfiguration({ ...env, [key]: '' }, target));
  for (const delta of [{ BILLING_SANDBOX_STRIPE_KEY: 'sk_live_synthetic_control' },
    { BILLING_SANDBOX_APP_URL: 'https://speaksharp-public.vercel.app' },
    { BILLING_SANDBOX_SUPABASE_URL: env.BILLING_PRODUCTION_SUPABASE_URL },
    { BILLING_SANDBOX_APP_URL: 'https://user:password@example.com' },
    { BILLING_SANDBOX_APP_URL: 'https://example.com/?token=synthetic-control' },
    { BILLING_SANDBOX_RELEASE_SHA: 'main' }]) assert.throws(() => assertSandboxConfiguration({ ...env, ...delta }, target));
});
test('unreviewed targets and caller-declared alternative backends are refused before fixture creation', () => {
  assert.throws(() => assertSandboxConfiguration(env, { ...target, status: 'UNCONFIGURED' }));
  assert.throws(() => assertSandboxConfiguration(env, { ...target, apiOrigin: null }));
  assert.throws(() => assertSandboxConfiguration({ ...env, BILLING_SANDBOX_SUPABASE_URL: 'https://other.example.com' }, target));
});
test('failure receipts preserve safe codes, not raw provider/credential-bearing errors', () => {
  assert.equal(safeFailureReason(new Error('BILLING_JOURNEY:checkout_unavailable')), 'checkout_unavailable');
  for (const value of [new Error('provider replied with a private URL'), new Error('BILLING_JOURNEY:https://private.example.com'), null]) {
    assert.equal(safeFailureReason(value), 'unclassified_step_failure');
  }
});
