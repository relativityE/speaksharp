import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { RUNNER_JOURNEYS, POLICY_PENDING_STEPS, REQUIRED_STEPS, receipt, assertTestPrice, assertInvoice,
  isCorrelatedDelivery, assertSandboxConfiguration, safeFailureReason, testClockCreateFields, localStackStatus,
  hostedFieldUnavailable, hostedEmailDecision, assertCheckoutIdentity, type HostedField, hostedFormNotConfirmable,
  HOSTED_ACTION_MS, HOSTED_READ_MS, HOSTED_LINK_OPT_IN_NOT_CLEARED, progressLine, HOSTED_SELECTORS, checkoutNotReturned, hostedFieldNotEditable, hostedSubmitUnavailable, invalidFieldToken } from './contract';
import { finaliseLocalStackReceipt, RECEIPT_KEYS } from './localStackReceipt.mjs';
import { stackIdentitySha256 } from './localStackResources.mjs';

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
test('a missing hosted field is named (run 44055010939 could not say which), content-free, and survives the reason sanitizer', () => {
  const fields: HostedField[] = ['email', 'card_number', 'card_expiry', 'card_cvc'];
  for (const field of fields) {
    for (const [choice, suffix] of [[false, ''], [true, '_card_choice_shown'], [null, '_choice_unread']] as const) {
      const code = hostedFieldUnavailable(field, choice);
      assert.equal(code, `hosted_field_unavailable_${field}${suffix}`);
      // The receipt keeps exactly this code: it is a closed [a-z_] token under 80 characters.
      assert.equal(safeFailureReason(new Error(`BILLING_JOURNEY:${code}`)), code);
    }
  }
  // An unknown field name is refused, never reported as a free-form string.
  assert.throws(() => hostedFieldUnavailable('card_holder' as HostedField, false), /BILLING_JOURNEY:hosted_field_unknown/);
});
test('hosted email (run 44066185734): required by default; absent only on the exact session positively bound to this run', () => {
  const bound = 'cs_test_Bound123';
  // A visible editable email field is always filled, bound or not, whatever the customer carries.
  for (const boundCustomerHasEmail of [true, false, null])
    assert.equal(hostedEmailDecision({ emailFieldVisible: true, shownSession: bound, boundSession: bound, boundCustomerHasEmail }), 'fill');
  assert.equal(hostedEmailDecision({ emailFieldVisible: true, shownSession: null, boundSession: null, boundCustomerHasEmail: null }), 'fill');
  // Email already supplied: the bound session's customer carries an email, so no field is rendered and none is needed.
  assert.equal(hostedEmailDecision({ emailFieldVisible: false, shownSession: bound, boundSession: bound, boundCustomerHasEmail: true }), 'absent_after_binding');
  // CONTROL (run 44157731067): the bound customer has NO email (or its presence is unread), so a missing field is never "absent".
  for (const boundCustomerHasEmail of [false, null])
    assert.equal(hostedEmailDecision({ emailFieldVisible: false, shownSession: bound, boundSession: bound, boundCustomerHasEmail }), 'missing', String(boundCustomerHasEmail));
  // Unbound, a different session on screen, an unreadable page, or a malformed binding never skips email, even with a customer email.
  for (const [shownSession, boundSession] of [[bound, null], ['cs_test_Other456', bound], [null, bound], ['', ''],
    ['cs_live_Bound123', 'cs_live_Bound123'], [bound, `${bound}x!`]] as const) {
    assert.equal(hostedEmailDecision({ emailFieldVisible: false, shownSession, boundSession, boundCustomerHasEmail: true }), 'missing', `${shownSession} / ${boundSession}`);
  }
});
test('the binding that permits an absent email: a wrong customer, user, paid or live session never binds', () => {
  const expected = { session: 'cs_test_Bound123', customer: 'cus_owned', uid: 'uid-1', app: 'http://localhost:5173' };
  const session = { id: 'cs_test_Bound123', livemode: false, mode: 'subscription', status: 'open', payment_status: 'unpaid',
    customer: 'cus_owned', client_reference_id: 'uid-1', metadata: { userId: 'uid-1' },
    success_url: 'http://localhost:5173/?checkout=success', cancel_url: 'http://localhost:5173/?checkout=cancel' };
  assert.doesNotThrow(() => assertCheckoutIdentity(session, expected));
  for (const change of [{ customer: 'cus_other' }, { customer: null }, { client_reference_id: 'uid-2' }, { livemode: true },
    { payment_status: 'paid' }, { status: 'complete' }, { metadata: { userId: 'uid-2' } }]) {
    assert.throws(() => assertCheckoutIdentity({ ...session, ...change }, expected), /BILLING_JOURNEY:checkout_/, JSON.stringify(change));
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
const identityFor = (stackRun: string) => ({ schema: 'billing-local-stack-identity/v1', project: stackRun,
  database: { container: 'c_db', volume: `supabase_db_${stackRun}`, systemIdentifier: '7300000000000000001' },
  containers: ['c_auth', 'c_db'], volumes: [`supabase_config_${stackRun}`, `supabase_db_${stackRun}`], networks: ['n_net'] });
const destroyedFor = (stackRun: string) => ({ schema: 'billing-local-stack-destroyed/v2', project: stackRun,
  databaseSystemIdentifier: '7300000000000000001', identitySha256: stackIdentitySha256(identityFor(stackRun), stackRun),
  containers: 2, volumes: 2, networks: 1, destroyed: true });
const destruction = destroyedFor(STACK_RUN);
const identity = identityFor(STACK_RUN);
const finaliserExpected = { journey: 'conversion', release: RELEASE, stackRun: STACK_RUN, receiptSha256: 'b'.repeat(64), destruction, identity };

test('combined local receipt is PASSED only after checked teardown, destruction proof and Stripe cleanup', () => {
  const combined = finaliseLocalStackReceipt([pendingReceipt], allChecks, finaliserExpected);
  assert.equal(combined.result, 'PASSED', JSON.stringify(combined.defects));
  assert.equal(combined.billingRowResidue, 'NOT_READ_DATABASE_DESTROYED');
  // Bound to this dispatch: journey, release, stack and the raw receipt's hash.
  assert.deepEqual([combined.journey, combined.release, combined.stackRun, combined.rawReceiptSha256],
    ['conversion', RELEASE, STACK_RUN, 'b'.repeat(64)]);
  // And to the identity list captured after creation, which the destruction proof names by sha256.
  assert.equal(combined.stackIdentitySha256, stackIdentitySha256(identity, STACK_RUN));
  assert.equal(combined.stackIdentitySha256, destruction.identitySha256);
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

test('(c) negative control: the destruction proof must name the kept identity list, unchanged (Sam, 6cd45e76)', () => {
  const run = (change: Record<string, unknown>) => finaliseLocalStackReceipt([pendingReceipt], allChecks, { ...finaliserExpected, ...change });
  const cases: [string, Record<string, unknown>, string][] = [
    ['identity list not kept', { identity: undefined }, 'stack_identity_invalid'],
    ['identity list for another run', { identity: identityFor('billing-local-stack-999-1') }, 'stack_identity_invalid'],
    ['identity list malformed', { identity: { ...identity, networks: [] } }, 'stack_identity_invalid'],
    ['a container dropped from the list after the run', { identity: { ...identity, containers: ['c_db'] } }, 'destruction_identity_mismatch'],
    ['a container swapped in the list', { identity: { ...identity, containers: ['c_db', 'c_other'] } }, 'destruction_identity_mismatch'],
    ['another database in the list', { identity: { ...identity, database: { ...identity.database, systemIdentifier: '1' } } }, 'destruction_identity_mismatch'],
    ['proof without the digest (v1)', { destruction: { ...destruction, schema: 'billing-local-stack-destroyed/v1', identitySha256: undefined } }, 'destruction_proof_shape'],
    ['proof naming another list', { destruction: { ...destruction, identitySha256: 'c'.repeat(64) } }, 'destruction_identity_mismatch'],
    ['proof counts disagree with the list', { destruction: { ...destruction, containers: 9 } }, 'destruction_counts_mismatch'],
    ['proof for another database', { destruction: { ...destruction, databaseSystemIdentifier: '42' } }, 'destruction_database'],
  ];
  for (const [name, change, defect] of cases) {
    const combined = run(change);
    assert.equal(combined.result, 'NOT_PROVEN', name);
    assert.ok(combined.defects.includes(defect), `${name}: ${combined.defects}`);
  }
  // Formatting or list order does not change the digest; content does.
  const reordered = { networks: identity.networks, volumes: [...identity.volumes].reverse(), containers: [...identity.containers].reverse(),
    database: identity.database, project: identity.project, schema: identity.schema };
  assert.equal(stackIdentitySha256(reordered, STACK_RUN), destruction.identitySha256);
  assert.equal(run({ identity: JSON.parse(JSON.stringify(reordered, null, 4)) }).result, 'PASSED');
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

// Run 44080723593: the hosted page never confirmed a payment and an unbounded wait ran into the 10-minute test timeout, so the
// receipt named no step. Every hosted fill and the Pay click are now bounded and fail with a named, content-free code.
test('a stuck hosted field or Pay button fails fast with a named, content-free code', () => {
  assert.ok(HOSTED_ACTION_MS > 0 && HOSTED_ACTION_MS <= 30_000);
  for (const field of ['email', 'card_number', 'card_expiry', 'card_cvc'] as HostedField[])
    assert.equal(hostedFieldNotEditable(field), `hosted_field_not_editable_${field}`);
  assert.throws(() => hostedFieldNotEditable('card_holder' as HostedField), /hosted_field_unknown/);
  assert.equal(hostedSubmitUnavailable({ visible: true, enabled: false, invalidFields: 2 }), 'hosted_submit_unavailable_disabled_invalid_2');
  assert.equal(hostedSubmitUnavailable({ visible: true, enabled: true, invalidFields: 0 }), 'hosted_submit_unavailable_enabled_invalid_0');
  assert.equal(hostedSubmitUnavailable({ visible: false, enabled: null, invalidFields: null }), 'hosted_submit_unavailable_hidden_invalid_unread');
  assert.equal(hostedSubmitUnavailable({ visible: null, enabled: true, invalidFields: -1 }), 'hosted_submit_unavailable_unread_invalid_unread');
  for (const code of [hostedSubmitUnavailable({ visible: true, enabled: false, invalidFields: 3 }), hostedFieldNotEditable('card_cvc')])
    assert.match(code, /^[a-z0-9_]+$/);
});

test('no fill or click on the hosted card path can wait without a bound', () => {
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  const start = spec.indexOf('async fillCard(');
  const end = spec.indexOf('\n  }\n', spec.indexOf('async payOnHostedPage('));
  assert.ok(start > 0 && end > start);
  const body = spec.slice(start, end);
  const actions = body.match(/\.(fill|click|uncheck|selectOption)\([^;]*/g) ?? [];
  assert.ok(actions.length >= 4);
  for (const call of actions) assert.match(call, /timeout: HOSTED_ACTION_MS/, call);
  // Reads that wait for their element (Codex P2 on 011932fd: isEnabled after a failed click) carry their own small bound.
  const waitingReads = body.match(/\.(isEnabled|isChecked)\([^)]*\)/g) ?? [];
  assert.ok(waitingReads.length >= 2);
  for (const call of waitingReads) assert.match(call, /timeout: HOSTED_READ_MS/, call);
  assert.ok(HOSTED_READ_MS > 0 && HOSTED_READ_MS < HOSTED_ACTION_MS);
  // The Pay button is in Stripe's embedded frame (run 44080723593): it must be found across frames, never on the top document alone.
  assert.doesNotMatch(body, /button\[type="submit"\]/, 'never "the first submit button": Link and other buttons share the frame');
  assert.match(body, /visibleInFrames\(HOSTED_SELECTORS\.submit\)/);
  const pay = spec.slice(spec.indexOf('async payOnHostedPage('), spec.indexOf('async noPaidAccess('));
  assert.ok(pay.indexOf('await this.clearLinkOptIn();') > 0 && pay.indexOf('await this.clearLinkOptIn();') < pay.indexOf('visibleInFrames(HOSTED_SELECTORS.submit)'), 'the opt-in is cleared before Subscribe is searched');
  // The default-ticked Link opt-in is cleared through its label and proven unticked on its real input, never filled with a phone number.
  assert.match(body, /attachedInFrames\(HOSTED_SELECTORS\.linkOptInInput\)/);
  assert.match(body, /attachedInFrames\(HOSTED_SELECTORS\.linkOptInLabel\)/);
  // The fill path never targets a phone field; the post-submit facts only READ (no fill, click or check of any kind).
  const fillBody = spec.slice(spec.indexOf('async fillCard('), spec.indexOf('async attachedInFrames('));
  assert.doesNotMatch(fillBody, /type="tel"|autocomplete="tel|name="phone|getByLabel\([^)]*(phone|mobile)/i);
  const factsBody = spec.slice(spec.indexOf('async afterSubmitFacts('), spec.indexOf('async payOnHostedPage('));
  assert.ok(factsBody.length > 100);
  assert.doesNotMatch(factsBody, /\.(fill|click|check|uncheck|press|type)\(/);
  assert.equal(HOSTED_LINK_OPT_IN_NOT_CLEARED, 'hosted_link_optin_not_cleared');
});

// Sam on run 44080723593: the next attempt needs progress checkpoints. Each completed step and stage change prints one content-free line
// as it happens, so a timeout still leaves the last step reached in the log.
test('progress lines are content-free: fixed names and whole seconds only', () => {
  assert.equal(progressLine('step', 'hosted_checkout', 12_999), 'BILLING_JOURNEY_PROGRESS step=hosted_checkout t=12s');
  assert.equal(progressLine('stage', 'stripe_delivery', 0), 'BILLING_JOURNEY_PROGRESS stage=stripe_delivery t=0s');
  for (const leak of ['cus_123 user@example.com', 'https://checkout.stripe.com/x', 'a'.repeat(65), '']) assert.equal(progressLine('checkpoint', leak, 1000), 'BILLING_JOURNEY_PROGRESS checkpoint=invalid t=1s');
  assert.equal(progressLine('step', 'cleanup', Number.NaN), 'BILLING_JOURNEY_PROGRESS step=cleanup t=-1s');
});

test('the journey prints a checkpoint for every step and stage, and around every hosted action', () => {
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  assert.match(spec, /set\.add = \(name: string\) => \{ if \(!set\.has\(name\)\) this\.checkpoint\(name, 'step'\)/);
  assert.match(spec, /set stage\(name: string\) \{ this\.currentStage = name; this\.checkpoint\(name, 'stage'\); \}/);
  for (const name of ['hosted_fill_start', 'hosted_fill_done', 'hosted_submit_search', 'hosted_submit_clicked', 'checkout_success_wait'])
    assert.match(spec, new RegExp(`this\\.checkpoint\\('${name}'\\)`), name);
  assert.doesNotMatch(spec, /console\.log\((?!progressLine)/, 'no other console output in the journey');
});

// Run 44098470690 clicked Subscribe and was never returned; the PO's manual walkthrough on the same price completed once Link's opt-in was
// unticked. Stripe's own markup (read in the PO's DevTools, read-only) fixes the exact controls; a missing return now names what was shown.
test('the hosted controls are the exact ones observed on Stripe Checkout', () => {
  assert.deepEqual({ ...HOSTED_SELECTORS }, { submit: '[data-testid="payment-form-submit-button"]', linkOptInInput: '#payment-linkOptInInput', linkOptInLabel: '#Field-linkOptInCheckbox',
    country: '#payment-countryInput', postalCode: '#payment-postalCodeInput', cardName: '#payment-nameInput' });
  assert.ok(Object.isFrozen(HOSTED_SELECTORS));
});

test('a missing return after Subscribe is named content-free, and every named code survives into the receipt', () => {
  assert.equal(checkoutNotReturned({ optIn: 'checked', phoneShown: true, alerts: 1, invalid: 1, challenge: false, invalidFields: ['zip'] }),
    'checkout_success_not_reached_optin_checked_phone_shown_alerts_1_invalid_1_challenge_none_fields_zip');
  assert.equal(checkoutNotReturned({ optIn: null, phoneShown: null, alerts: null, invalid: null, challenge: null, invalidFields: null }),
    'checkout_success_not_reached_optin_unread_phone_unread_alerts_unread_invalid_unread_challenge_unread_fields_unread');
  assert.equal(checkoutNotReturned({ optIn: 'clear', phoneShown: false, alerts: -1, invalid: Number.NaN, challenge: true, invalidFields: [] }),
    'checkout_success_not_reached_optin_clear_phone_none_alerts_unread_invalid_unread_challenge_shown_fields_none');
  // Run 44141620120's shape, now naming the fields: sorted, de-duplicated, and anything outside the closed tokens is `other`.
  assert.equal(checkoutNotReturned({ optIn: 'clear', phoneShown: false, alerts: 4, invalid: 2, challenge: false, invalidFields: ['zip', 'country', 'zip', 'Card declined'] }),
    'checkout_success_not_reached_optin_clear_phone_none_alerts_4_invalid_2_challenge_none_fields_country_other_zip');
  // The longest possible code (every count unread, every field token) still fits the receipt's closed alphabet and length.
  const longest = checkoutNotReturned({ optIn: null, phoneShown: null, alerts: null, invalid: null, challenge: null,
    invalidFields: ['name', 'zip', 'country', 'number', 'expiry', 'cvc', 'email', 'other'] });
  assert.ok(longest.length <= 160, String(longest.length));
  for (const code of [longest, checkoutNotReturned({ optIn: 'absent', phoneShown: false, alerts: 0, invalid: 0, challenge: false, invalidFields: [] }),
    hostedSubmitUnavailable({ visible: true, enabled: false, invalidFields: 2 }), hostedFieldNotEditable('card_number'), HOSTED_LINK_OPT_IN_NOT_CLEARED])
    assert.equal(safeFailureReason(new Error(`BILLING_JOURNEY:${code}`)), code, code);
  for (const leak of ['BILLING_JOURNEY:https://checkout.stripe.com/x', 'BILLING_JOURNEY:Card declined', `BILLING_JOURNEY:${'a'.repeat(161)}`, 'BILLING_JOURNEY:cus_ABC'])
    assert.equal(safeFailureReason(new Error(leak)), 'unclassified_step_failure', leak);
});

test('the success wait after Subscribe names what the hosted page showed instead of a bare timeout', () => {
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  assert.match(spec, /checkout_success_wait'\);\n\s+await this\.page\.waitForURL\([^;]*\.catch\(async \(\) => \{ throw new Error\(`BILLING_JOURNEY:\$\{checkoutNotReturned\(await this\.afterSubmitFacts\(\)\)\}`\)/);
});

// Run 44141620120 (after #1889): Stripe refused the form with 2 invalid fields. The PO's DevTools on that run's own session: country
// <select id="payment-countryInput">, ZIP <input id="payment-postalCodeInput" autocomplete="billing postal-code">, name
// <input id="payment-nameInput" autocomplete="cc-name">, all aria-required="true".
test('invalid hosted controls are named by id or name attribute only, as closed tokens', () => {
  assert.equal(invalidFieldToken({ id: 'payment-postalCodeInput', name: 'postalCode' }), 'zip');
  assert.equal(invalidFieldToken({ id: 'payment-countryInput', name: null }), 'country');
  assert.equal(invalidFieldToken({ id: null, name: 'name' }), 'name');
  assert.equal(invalidFieldToken({ id: 'payment-numberInput', name: 'cardNumber' }), 'number');
  for (const leak of [{ id: 'user@example.com', name: null }, { id: null, name: null }, { id: '__proto__', name: 'constructor' }])
    assert.equal(invalidFieldToken(leak), 'other');
  for (const field of ['billing_country', 'postal_code', 'card_name'] as HostedField[])
    assert.equal(hostedFieldNotEditable(field), `hosted_field_not_editable_${field}`);
});

test('on Checkout the country, ZIP and name are REQUIRED fills by their exact ids, country first; the portal keeps them optional', () => {
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  const body = spec.slice(spec.indexOf('async fillCard('), spec.indexOf('async visibleInFrames('));
  const required = body.slice(body.indexOf("if (email !== 'none') {\n      await fill(HOSTED_SELECTORS.country"));
  assert.ok(required.length > 0);
  const country = required.indexOf("await fill(HOSTED_SELECTORS.country, 'US', 'billing_country', false, 'select');");
  const zip = required.indexOf("await fill(HOSTED_SELECTORS.postalCode, '94105', 'postal_code');");
  const name = required.indexOf("await fill(HOSTED_SELECTORS.cardName, 'SpeakSharp Test', 'card_name');");
  assert.ok(country >= 0 && zip > country && name > zip, 'country, then ZIP, then name; none absent-allowed');
  // The chosen country is read back from the select itself.
  assert.match(body, /requireFact\(await input\.inputValue\(\{ timeout: HOSTED_READ_MS \}\)\.catch\(\(\) => null\) === value, hostedFieldNotEditable\(field\)\)/);
  // The old exact `postal-code` selector alone (which never matched Stripe's "billing postal-code") is gone from the required path.
  assert.doesNotMatch(required.slice(0, required.indexOf('} else {')), /autocomplete="postal-code"/);
});

test('the form-confirmable read is a bounded, read-only checkpoint taken after the opt-in and before Subscribe', () => {
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  const read = spec.slice(spec.indexOf('async formConfirmable('), spec.indexOf('async payOnHostedPage('));
  assert.ok(read.length > 100);
  assert.doesNotMatch(read, /\.(fill|click|check|uncheck|press|type|selectOption)\(/);
  assert.match(read, /getAttribute\('data-can-confirm', \{ timeout: HOSTED_READ_MS \}\)/);
  assert.match(read, /const deadline = Date\.now\(\) \+ HOSTED_ACTION_MS;/);
  const pay = spec.slice(spec.indexOf('async payOnHostedPage('), spec.indexOf('async noPaidAccess('));
  const optIn = pay.indexOf('await this.clearLinkOptIn();'), check = pay.indexOf('await this.formConfirmable();'), submit = pay.indexOf('visibleInFrames(HOSTED_SELECTORS.submit)');
  assert.ok(optIn > 0 && check > optIn && submit > check);
  for (const name of ['hosted_form_confirmable', 'hosted_form_not_confirmable', 'hosted_form_confirm_unread'])
    assert.equal(progressLine('checkpoint', name, 1000), `BILLING_JOURNEY_PROGRESS checkpoint=${name} t=1s`);
});

// Sam on run 44157731067 (receipt `fields_email`, `hosted_form_not_confirmable`): the fixture's Stripe customer has no email, so the
// optional-email path must be closed for it, and a form that never reports it can confirm must not be submitted.
test('the fixture creates its customer without an email, and only a presence flag for it is read, never the value', () => {
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  const create = spec.slice(spec.indexOf("const customer = await this.stripe('customers', 'POST'"), spec.indexOf("requireFact(customer.livemode === false"));
  assert.ok(create.length > 0);
  assert.doesNotMatch(create, /email/, 'the fixture customer carries no email, which is why Checkout asks for one');
  const open = spec.slice(spec.indexOf('async openCheckout('), spec.indexOf('async checkout(): Promise<void> {'));
  const identity = open.indexOf('assertCheckoutIdentity('), presence = open.indexOf('this.boundCustomerHasEmail = typeof bound.email'), bind = open.indexOf('this.boundCheckout = session;');
  assert.ok(identity > 0 && presence > identity && bind > presence, 'presence is read after the identity proof and before the session is bound');
  // The email value is never stored or reported: only a boolean (or null when unread) leaves that expression.
  assert.match(open, /this\.boundCustomerHasEmail = typeof bound\.email === 'string' \? bound\.email\.length > 0 : bound\.email === null \? false : null;/);
  assert.equal((open.match(/bound\.email/g) ?? []).length, 3);
  // The decision is fed the presence flag only on the bound after-binding path.
  assert.match(spec, /boundCustomerHasEmail: email === 'after-binding' \? this\.boundCustomerHasEmail : null \}\);/);
});

test('an unconfirmable form is not submitted: the stop names the invalid controls; an unread state still proceeds', () => {
  assert.equal(hostedFormNotConfirmable(['email']), 'hosted_form_not_confirmable_fields_email');
  assert.equal(hostedFormNotConfirmable(['zip', 'email', 'zip', 'free text']), 'hosted_form_not_confirmable_fields_email_other_zip');
  assert.equal(hostedFormNotConfirmable([]), 'hosted_form_not_confirmable_fields_none');
  assert.equal(hostedFormNotConfirmable(null), 'hosted_form_not_confirmable_fields_unread');
  const longest = hostedFormNotConfirmable(['name', 'zip', 'country', 'number', 'expiry', 'cvc', 'email', 'other']);
  for (const code of [longest, hostedFormNotConfirmable(null)]) assert.equal(safeFailureReason(new Error(`BILLING_JOURNEY:${code}`)), code);
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  const pay = spec.slice(spec.indexOf('async payOnHostedPage('), spec.indexOf('async noPaidAccess('));
  const stop = pay.indexOf('if (confirmable === false) throw new Error(`BILLING_JOURNEY:${hostedFormNotConfirmable((await this.afterSubmitFacts()).invalidFields)}`);');
  const submit = pay.indexOf('visibleInFrames(HOSTED_SELECTORS.submit)'), click = pay.indexOf('submit.click(');
  assert.ok(stop > 0 && submit > stop && click > submit, 'the unconfirmable stop comes before Subscribe is searched or clicked');
  // Only `false` stops: `true` and the unread `null` reach Subscribe.
  assert.doesNotMatch(pay, /if \(confirmable !== true\)|if \(!confirmable\)/);
});
