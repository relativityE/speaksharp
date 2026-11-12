import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { RUNNER_JOURNEYS, POLICY_PENDING_STEPS, REQUIRED_STEPS, receipt, assertTestPrice, assertInvoice,
  isCorrelatedDelivery, assertSandboxConfiguration, safeFailureReason, testClockCreateFields, localStackStatus } from './contract';
import { finaliseLocalStackReceipt, RECEIPT_KEYS } from './localStackReceipt.mjs';

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

for (const journey of RUNNER_JOURNEYS) {
  test(`${journey}: every individual missing step blocks PASS`, () => {
    const pending: readonly string[] = POLICY_PENDING_STEPS[journey] ?? [];
    const provable = REQUIRED_STEPS[journey].filter(step => !pending.includes(step));
    // With access after end on hold, a complete run says PENDING_POLICY, never PASSED.
    assert.equal(receipt(journey, new Set(provable)).result, pending.length ? 'PENDING_POLICY' : 'PASSED');
    for (const omitted of provable) {
      const result = receipt(journey, new Set(provable.filter(step => step !== omitted)));
      assert.equal(result.result, 'INCOMPLETE', omitted);
      assert.equal(result.steps.find(row => row.step === omitted)?.result, 'NOT_PROVEN');
    }
    for (const held of pending) {
      assert.throws(() => receipt(journey, new Set([...provable, held])), /policy_pending_step_asserted/, held);
      assert.equal(receipt(journey, new Set(provable)).steps.find(row => row.step === held)?.result, 'PENDING_POLICY');
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
test('local disposable stack admits loopback http only, and only under its own committed target', async () => {
  const localTarget = (await import('./sandbox-target.local.json', { with: { type: 'json' } })).default;
  const local = { ...env, BILLING_SANDBOX_APP_URL: 'http://localhost:5173',
    BILLING_SANDBOX_SUPABASE_URL: 'http://127.0.0.1:54321',
    BILLING_PRODUCTION_SUPABASE_URL: 'https://yxlapjuovrsvjswkwnrk.supabase.co' };
  assert.deepEqual(assertSandboxConfiguration(local, localTarget),
    { app: 'http://localhost:5173', api: 'http://127.0.0.1:54321' });
  // The reviewed hosted-sandbox status never admits plain http, even for loopback.
  assert.throws(() => assertSandboxConfiguration(local, { ...localTarget, status: 'REVIEWED_ISOLATED_SANDBOX' }));
  for (const delta of [{ BILLING_SANDBOX_SUPABASE_URL: 'http://sandbox.example.com' },
    { BILLING_SANDBOX_APP_URL: 'http://192.168.1.5:5173' },
    { BILLING_SANDBOX_SUPABASE_URL: 'https://127.0.0.1:54321' },
    { BILLING_SANDBOX_SUPABASE_URL: 'http://127.0.0.1:54322' },
    { BILLING_SANDBOX_APP_URL: 'http://user:password@localhost:5173' },
    { BILLING_PRODUCTION_SUPABASE_URL: 'http://127.0.0.1:54321' },
    { BILLING_SANDBOX_STRIPE_KEY: 'sk_live_synthetic_control' }]) {
    assert.throws(() => assertSandboxConfiguration({ ...local, ...delta }, localTarget), JSON.stringify(delta));
  }
  // A loopback target can never point at a hosted project's API.
  assert.throws(() => assertSandboxConfiguration({ ...local, BILLING_SANDBOX_SUPABASE_URL: 'https://sandbox.supabase.co' },
    { ...localTarget, apiOrigin: 'https://sandbox.supabase.co' }));
});

const MARKER = 'rwt-journey-billing-0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';

test('D1: the test clock is created with the run marker in name, in the create request itself', () => {
  assert.deepEqual(testClockCreateFields(MARKER, 1_800_000_000), { frozen_time: '1800000000', name: MARKER });
});

test('D1 negative control: no clock request is built without this run\'s marker', () => {
  for (const marker of ['', 'rwt-journey-billing-', 'someone-else-0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e',
    `${MARKER}-extra`, MARKER.toUpperCase(), ' ' + MARKER]) {
    assert.throws(() => testClockCreateFields(marker, 1_800_000_000), /run_marker_invalid/, marker);
  }
  for (const now of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => testClockCreateFields(MARKER, now), /clock_time_invalid/, String(now));
  }
});

test('local stack: the journey receipt never says PASSED or VERIFIED by itself', () => {
  assert.deepEqual(localStackStatus('PASSED', 'VERIFIED', true), { result: 'PENDING_STACK_DESTRUCTION', cleanup: 'PENDING_STACK_DESTRUCTION' });
  assert.deepEqual(localStackStatus('INCOMPLETE', 'UNPROVEN', true), { result: 'INCOMPLETE', cleanup: 'UNPROVEN' });
  // The hosted target is unchanged.
  assert.deepEqual(localStackStatus('PASSED', 'VERIFIED', false), { result: 'PASSED', cleanup: 'VERIFIED' });
});

const RELEASE = 'a'.repeat(40);
const STACK_RUN = 'billing-local-stack-123456-1';
const pendingReceipt = { schema: 'billing-user-journey/v1', journey: 'conversion', stripeMode: 'test',
  result: 'PENDING_STACK_DESTRUCTION', steps: REQUIRED_STEPS.conversion.map(step => ({ step, result: 'PASSED' })),
  failureStage: null, reason: null, cleanup: 'PENDING_STACK_DESTRUCTION',
  billingRowResidue: 'NOT_READ_REQUIRES_STACK_DESTRUCTION_PROOF', testedRelease: RELEASE, stackRun: STACK_RUN };
const allChecks = { stackStopped: 'success', stackDestroyed: 'success', stripeClean: 'success' };
const destruction = { schema: 'billing-local-stack-destroyed/v1', project: STACK_RUN, databaseSystemIdentifier: '7300000000000000001',
  containers: 9, volumes: 3, networks: 1, destroyed: true };
const finaliserExpected = { journey: 'conversion', release: RELEASE, stackRun: STACK_RUN, receiptSha256: 'b'.repeat(64), destruction };

test('combined local receipt is PASSED only after checked teardown, destruction proof and Stripe cleanup', () => {
  const combined = finaliseLocalStackReceipt([pendingReceipt], allChecks, finaliserExpected);
  assert.equal(combined.result, 'PASSED', JSON.stringify(combined.defects));
  assert.equal(combined.billingRowResidue, 'NOT_READ_DATABASE_DESTROYED');
  // Bound to this dispatch: journey, release, stack and the raw receipt's hash.
  assert.deepEqual([combined.journey, combined.release, combined.stackRun, combined.rawReceiptSha256],
    ['conversion', RELEASE, STACK_RUN, 'b'.repeat(64)]);
});

test('the receipt the spec writes has exactly the shape the finalizer requires', () => {
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  const attached = spec.slice(spec.indexOf("info.attach('billing-user-journey.json'"), spec.indexOf("contentType: 'application/json'"));
  const added = [...attached.matchAll(/^ {8}([a-zA-Z]+)[:,]/gm)].map(m => m[1]);
  // receipt() supplies schema, journey, stripeMode, result and steps; the attach adds the rest.
  const written = new Set([...Object.keys(receipt('conversion', new Set())), ...added]);
  assert.deepEqual([...written].sort(), [...RECEIPT_KEYS]);
});

test('combined local receipt negative controls: any failed, skipped or unknown check is NOT_PROVEN', () => {
  for (const key of Object.keys(allChecks) as (keyof typeof allChecks)[]) {
    for (const value of ['failure', 'skipped', 'cancelled', '', undefined]) {
      const combined = finaliseLocalStackReceipt([pendingReceipt], { ...allChecks, [key]: value as string }, finaliserExpected);
      assert.equal(combined.result, 'NOT_PROVEN', `${key}=${String(value)}`);
    }
  }
  assert.equal(finaliseLocalStackReceipt([pendingReceipt], { ...allChecks, stackDestroyed: 'failure' }, finaliserExpected).billingRowResidue, 'NOT_READ_NOT_PROVEN');
});

test('combined local receipt negative controls: a missing, extra, failed or self-PASSED journey receipt is NOT_PROVEN', () => {
  for (const receipts of [null, [], [pendingReceipt, pendingReceipt], [{ ...pendingReceipt, result: 'INCOMPLETE' }],
    [{ ...pendingReceipt, result: 'PASSED', cleanup: 'VERIFIED' }], [{ ...pendingReceipt, cleanup: 'UNPROVEN' }],
    [{ ...pendingReceipt, billingRowResidue: 'COUNTED_ZERO_OR_FAILED' }], [null], 'not json']) {
    assert.equal(finaliseLocalStackReceipt(receipts, allChecks, finaliserExpected).result, 'NOT_PROVEN', JSON.stringify(receipts));
  }
});

test('(c) negative control: a receipt holding only the PENDING/residue fields is not a journey', () => {
  const bare = { journey: 'conversion', result: 'PENDING_STACK_DESTRUCTION', cleanup: 'PENDING_STACK_DESTRUCTION',
    billingRowResidue: 'NOT_READ_REQUIRES_STACK_DESTRUCTION_PROOF' };
  const combined = finaliseLocalStackReceipt([bare], allChecks, finaliserExpected);
  assert.equal(combined.result, 'NOT_PROVEN');
  assert.ok(combined.defects.includes('receipt_shape') && combined.defects.includes('steps_not_all_passed'));
  // Sam's exact reproduction: the old finalizer returned PASSED with journey:null for a receipt with no journey.
  const noJourney = Object.fromEntries(Object.entries(bare).filter(([key]) => key !== 'journey'));
  const result = finaliseLocalStackReceipt([noJourney], allChecks, finaliserExpected);
  assert.equal(result.result, 'NOT_PROVEN');
});

test('(c) negative control: the wrong journey, release, stack, steps or a recorded failure is NOT_PROVEN', () => {
  const steps = pendingReceipt.steps;
  const cases: [string, unknown][] = [
    ['journey_not_dispatched', { ...pendingReceipt, journey: 'portal_expiry' }],
    ['release_mismatch', { ...pendingReceipt, testedRelease: 'c'.repeat(40) }],
    ['release_mismatch', { ...pendingReceipt, testedRelease: null }],
    ['stack_run_mismatch', { ...pendingReceipt, stackRun: 'billing-local-stack-999-1' }],
    ['stack_run_mismatch', { ...pendingReceipt, stackRun: null }],
    ['steps_not_all_passed', { ...pendingReceipt, steps: steps.slice(1) }],
    ['steps_not_all_passed', { ...pendingReceipt, steps: steps.map((s, i) => i === 3 ? { ...s, result: 'NOT_PROVEN' } : s) }],
    ['steps_not_all_passed', { ...pendingReceipt, steps: [...steps].reverse() }],
    ['steps_not_all_passed', { ...pendingReceipt, steps: REQUIRED_STEPS.portal_expiry.map(step => ({ step, result: 'PASSED' })) }],
    ['failure_recorded', { ...pendingReceipt, reason: 'x' }],
    ['failure_recorded', { ...pendingReceipt, failureStage: 'checkout' }],
    ['stripe_mode', { ...pendingReceipt, stripeMode: 'live' }],
    ['receipt_schema', { ...pendingReceipt, schema: 'billing-user-journey/v0' }],
    ['receipt_shape', { ...pendingReceipt, extra: true }],
  ];
  for (const [defect, bad] of cases) {
    const combined = finaliseLocalStackReceipt([bad], allChecks, finaliserExpected);
    assert.equal(combined.result, 'NOT_PROVEN', defect);
    assert.ok(combined.defects.includes(defect), `${defect}: ${JSON.stringify(combined.defects)}`);
  }
  // The dispatch itself must be well formed; the receipt cannot supply what was finaliserExpected.
  for (const bad of [{ ...finaliserExpected, journey: undefined }, { ...finaliserExpected, journey: 'refund' }, { ...finaliserExpected, release: 'HEAD' },
    { ...finaliserExpected, stackRun: undefined }, { ...finaliserExpected, receiptSha256: undefined }]) {
    assert.equal(finaliseLocalStackReceipt([pendingReceipt], allChecks, bad).result, 'NOT_PROVEN', JSON.stringify(bad));
  }
});

test('(c) negative control: a destruction proof missing, failed or for another run is NOT_PROVEN', () => {
  for (const bad of [undefined, null, { ...destruction, project: 'billing-local-stack-999-1' }, { ...destruction, destroyed: false },
    { ...destruction, containers: 0 }, { ...destruction, databaseSystemIdentifier: '' }, { ...destruction, schema: 'x' }]) {
    const combined = finaliseLocalStackReceipt([pendingReceipt], allChecks, { ...finaliserExpected, destruction: bad });
    assert.equal(combined.result, 'NOT_PROVEN', JSON.stringify(bad));
    assert.equal(combined.stackDestroyed, 'NOT_PROVEN');
  }
});

test('smoke (Sam): conversion proves repeated click, cancel and retry before it pays, in that order', () => {
  const steps = REQUIRED_STEPS.conversion;
  const at = (step: string) => steps.indexOf(step);
  assert.ok(at('trial_expired') < at('repeated_click_one_session') && at('repeated_click_one_session') < at('checkout_cancelled')
    && at('checkout_cancelled') < at('checkout_retried') && at('checkout_retried') < at('hosted_checkout'));
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  const checkout = spec.slice(spec.indexOf('async checkout(): Promise<void> {'), spec.indexOf('async record(): Promise<void> {'));
  // Two requests at the same moment, and Stripe's own list must hold exactly one session for the customer.
  assert.match(checkout, /await Promise\.all\(\[invoke\(\), invoke\(\)\]\)/);
  assert.match(checkout, /requireFact\(\(await customerSessions\(\)\)\.join\(','\) === only, 'repeated_click_two_sessions'\)/);
  // Cancel is a click on Stripe's back link, not a navigation to the cancel URL.
  assert.match(checkout, /a\[href\^="\$\{this\.targets\.app\}\/pricing\?checkout=cancelled"\]/);
  assert.doesNotMatch(checkout, /page\.goto\([^)]*checkout=cancelled/);
  for (const code of ['cancelled_checkout_subscribed', 'cancelled_checkout_granted_access', 'retry_did_not_reuse_session',
    'retry_created_second_session']) assert.ok(checkout.includes(`'${code}'`), code);
  // Payment happens only after all three were recorded.
  assert.ok(checkout.indexOf("this.steps.add('checkout_retried')") < checkout.indexOf('this.session = await this.openCheckout(checkoutUrl);'));
});
