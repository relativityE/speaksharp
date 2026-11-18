import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'vitest';
import { RUNNER_JOURNEYS, POLICY_PENDING_STEPS, REQUIRED_STEPS, receipt, assertTestPrice, assertInvoice,
  isCorrelatedDelivery, assertSandboxConfiguration, safeFailureReason, testClockCreateFields, localStackStatus,
  hostedFieldUnavailable, hostedEmailDecision, assertCheckoutIdentity, type HostedField, hostedFormNotConfirmable, fixtureCustomerFields, firstVisibleControl, hostedEmailFieldAction,
  HOSTED_ACTION_MS, HOSTED_READ_MS, HOSTED_LINK_OPT_IN_NOT_CLEARED, progressLine, HOSTED_SELECTORS, checkoutNotReturned, hostedFieldNotEditable, hostedSubmitUnavailable, invalidFieldToken ,
  APP_MIN_SESSION_DURATION_SECONDS, RECORDING_HOLD_MS, recordingHoldRemainingMs, holdThenStop, APP_TOO_SHORT_STATUS,
  privacyOptInFact, PRIVACY_PROMPT, privacyBuildState, PRIVACY_MIGRATION, privacyAnswerRecorded } from './contract';
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
  // The account's own event version (run 44203911253's events: 2025-07-30.basil) and the pinned one both correlate.
  for (const api_version of ['2025-07-30.basil', '2024-06-20']) assert.equal(isCorrelatedDelivery({ ...event, api_version }, expected, ledger), true, api_version);
  for (const api_version of ['unknown', '', 'latest', '2025-13-01', '2025-07-30.', '2025-07-30.Basil', ' 2024-06-20', null, undefined, 20240620])
    assert.equal(isCorrelatedDelivery({ ...event, api_version }, expected, ledger), false, String(api_version));
  for (const wrong of [{ ...event, livemode: true }, { ...event, id: 'evt_synthetic_local' },
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
  for (const boundCustomerEmailIsFixture of [true, false, null])
    assert.equal(hostedEmailDecision({ emailFieldVisible: true, shownSession: bound, boundSession: bound, boundCustomerEmailIsFixture }), 'fill');
  assert.equal(hostedEmailDecision({ emailFieldVisible: true, shownSession: null, boundSession: null, boundCustomerEmailIsFixture: null }), 'fill');
  // Email already supplied: the bound session's customer carries EXACTLY the fixture email, so no field is needed.
  assert.equal(hostedEmailDecision({ emailFieldVisible: false, shownSession: bound, boundSession: bound, boundCustomerEmailIsFixture: true }), 'absent_after_binding');
  // CONTROLS: no email (run 44157731067), a DIFFERENT non-empty email (Sam's hold on #1895, 18f006c6), or unread: a missing field
  // is never "absent". `false` is what openCheckout records for both no email and another email (see the static check below).
  for (const boundCustomerEmailIsFixture of [false, null])
    assert.equal(hostedEmailDecision({ emailFieldVisible: false, shownSession: bound, boundSession: bound, boundCustomerEmailIsFixture }), 'missing', String(boundCustomerEmailIsFixture));
  // Unbound, a different session on screen, an unreadable page, or a malformed binding never skips email, even with the fixture email.
  for (const [shownSession, boundSession] of [[bound, null], ['cs_test_Other456', bound], [null, bound], ['', ''],
    ['cs_live_Bound123', 'cs_live_Bound123'], [bound, `${bound}x!`]] as const) {
    assert.equal(hostedEmailDecision({ emailFieldVisible: false, shownSession, boundSession, boundCustomerEmailIsFixture: true }), 'missing', `${shownSession} / ${boundSession}`);
  }
  // The flag openCheckout computes, evaluated on Stripe Customer shapes: only the exact fixture email is true; another non-empty
  // email, no email and an unreadable value are not.
  const fixtureEmail = 'rwt-journey-billing-1-1@example.com';
  const flag = (email: unknown) => typeof email === 'string' ? email === fixtureEmail : email === null ? false : null;
  assert.equal(flag(fixtureEmail), true);
  for (const other of ['someone-else@example.com', `${fixtureEmail} `, fixtureEmail.toUpperCase(), '', null]) {
    assert.equal(flag(other), false, String(other));
    assert.equal(hostedEmailDecision({ emailFieldVisible: false, shownSession: bound, boundSession: bound, boundCustomerEmailIsFixture: flag(other) }), 'missing', String(other));
  }
  assert.equal(flag(undefined), null);
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
    country: '#payment-countryInput', postalCode: '#payment-postalCodeInput', cardName: '#payment-nameInput', email: '#linkAuthentication-emailInput' });
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
test('existing-customer sandbox conversion: the fixture Customer carries the fixture email; only booleans are kept from it, never the value', () => {
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  const create = spec.slice(spec.indexOf("const customer = await this.stripe('customers', 'POST'"), spec.indexOf("requireFact(customer.livemode === false"));
  assert.ok(create.length > 0);
  // The request is built by fixtureCustomerFields for THIS journey; the email is the fixture's own run-owned address, never a user's.
  assert.match(create, /fixtureCustomerFields\(this\.journey, \{ clock: this\.clock, email: this\.email, marker: this\.marker \}\)/);
  assert.match(spec, /readonly email = `\$\{this\.marker\}@example\.com`;/);
  assert.match(spec, /if \(this\.journey === 'conversion'\) this\.checkpoint\('existing_customer_fixture'\);/);
  assert.doesNotMatch(spec, /^\s*this\.checkpoint\('existing_customer_fixture'\);/m, 'never unconditional');
  const open = spec.slice(spec.indexOf('async openCheckout('), spec.indexOf('async checkout(): Promise<void> {'));
  const identity = open.indexOf('assertCheckoutIdentity('), presence = open.indexOf('this.boundCustomerEmailIsFixture = typeof bound.email'), bind = open.indexOf('this.boundCheckout = session;');
  assert.ok(identity > 0 && presence > identity && bind > presence, 'presence is read after the identity proof and before the session is bound');
  // One boolean only (Sam on run 44203911253 and the #1895 hold): whether the bound email IS this run's fixture email. Compared, never
  // kept or reported; no presence-only flag remains, so a different non-empty email can never satisfy either email path.
  assert.equal((open.match(/bound\.email/g) ?? []).length, 3);
  assert.doesNotMatch(spec, /boundCustomerHasEmail/);
  assert.match(open, /this\.boundCustomerEmailIsFixture = typeof bound\.email === 'string' \? bound\.email === this\.email : bound\.email === null \? false : null;/);
  // The absent-field decision is fed the exact-fixture flag, only on the bound after-binding path.
  assert.match(spec, /boundCustomerEmailIsFixture: email === 'after-binding' \? this\.boundCustomerEmailIsFixture : null \}\);/);
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

test('the hosted email is found by the observed control first: Link\'s text input, which `input[type="email"]` alone never matched', () => {
  assert.equal(HOSTED_SELECTORS.email, '#linkAuthentication-emailInput');
  assert.equal(invalidFieldToken({ id: 'linkAuthentication-emailInput', name: 'email' }), 'email');
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  // Two selectors in priority order, never one combined selector (whose .first() follows document order, not priority).
  assert.match(spec, /await fill\(\[HOSTED_SELECTORS\.email, 'input\[type="email"\]'\], this\.email, 'email', decision === 'absent_after_binding'\);/);
  assert.doesNotMatch(spec, /`\$\{HOSTED_SELECTORS\.email\},input\[type="email"\]`/);
  const fillBody = spec.slice(spec.indexOf('const fill = async ('), spec.indexOf('// Email only: absent is accepted'));
  assert.match(fillBody, /const pick = firstVisibleControl\(visible\);/);
  assert.doesNotMatch(fillBody, /\.first\(\)/, 'no first-in-document-order pick in the fill');
});

// Sam on #1892 (a3fb4404): the fixture email was unconditional in shared setup, and a combined selector's .first() did not give the
// observed control priority.
test('only conversion\'s Customer carries the fixture email; every other journey\'s Customer request is unchanged', () => {
  const f = { clock: 'clock_1', email: 'rwt-journey-billing-x@example.com', marker: 'rwt-journey-billing-x' };
  const before = { test_clock: 'clock_1', 'metadata[speaksharp_test]': 'rwt-journey-billing-x' }; // the request every journey sent before #1892
  assert.deepEqual(fixtureCustomerFields('conversion', f), { ...before, email: f.email });
  const others = RUNNER_JOURNEYS.filter((j) => j !== 'conversion');
  assert.ok(others.length >= 2, String(others));
  for (const journey of others) assert.deepEqual(fixtureCustomerFields(journey, f), before, journey);
});

test('the observed control wins over a generic match, and a hidden match before a visible one never hides it', () => {
  assert.deepEqual(firstVisibleControl([[true], [true]]), { selector: 0, match: 0 }, 'observed control first');
  assert.deepEqual(firstVisibleControl([[false, true], [true]]), { selector: 0, match: 1 }, 'hidden observed match before a visible one');
  assert.deepEqual(firstVisibleControl([[false], [false, true]]), { selector: 1, match: 1 }, 'observed hidden: the visible generic match, not its hidden first');
  assert.deepEqual(firstVisibleControl([[], [true]]), { selector: 1, match: 0 });
  assert.equal(firstVisibleControl([[false], [false]]), null);
  assert.equal(firstVisibleControl([]), null);
});

// Run 44203911253 (after #1892): the existing Customer's email was shown PREFILLED and not editable; filling it failed with
// hosted_field_not_editable_email. Sam: skip only for the exact owner-bound fixture email; test each case; keep values out of logs.
test('hosted email: read-only exact owner-bound match is supplied; mismatch or unreadable stops; editable is filled and read back', () => {
  const expected = 'rwt-journey-billing-x@example.com';
  assert.equal(hostedEmailFieldAction({ editable: false, current: expected, expected, ownerBound: true }), 'supplied');
  assert.equal(hostedEmailFieldAction({ editable: false, current: 'someone@example.com', expected, ownerBound: true }), 'hosted_email_prefilled_mismatch');
  assert.equal(hostedEmailFieldAction({ editable: false, current: expected, expected, ownerBound: false }), 'hosted_email_prefilled_mismatch', 'not proven owner-bound');
  assert.equal(hostedEmailFieldAction({ editable: false, current: '', expected, ownerBound: true }), 'hosted_email_prefilled_mismatch');
  assert.equal(hostedEmailFieldAction({ editable: false, current: null, expected, ownerBound: true }), 'hosted_email_unreadable');
  assert.equal(hostedEmailFieldAction({ editable: null, current: expected, expected, ownerBound: true }), 'hosted_email_unreadable');
  for (const current of [null, '', expected]) assert.equal(hostedEmailFieldAction({ editable: true, current, expected, ownerBound: false }), 'fill');
  for (const code of ['hosted_email_prefilled_mismatch', 'hosted_email_unreadable']) assert.equal(safeFailureReason(new Error(`BILLING_JOURNEY:${code}`)), code);
  // The journey's email step is the shared helper (exercised in a real browser by tests/e2e/billing-hosted-email-fixture.e2e.spec.ts).
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  const fill = spec.slice(spec.indexOf('const fill = async ('), spec.indexOf('// Email only: absent is accepted'));
  assert.match(fill, /if \(field === 'email'\) \{\s+await fillHostedEmail\(input, \{ value, ownerBound: this\.boundCustomerEmailIsFixture === true, checkpoint: \(name\) => this\.checkpoint\(name\) \}\);\s+return;\s+\}/);
  assert.match(spec, /this\.boundCustomerEmailIsFixture = typeof bound\.email === 'string' \? bound\.email === this\.email : bound\.email === null \? false : null;/);
  const helper = readFileSync('tests/billing/user-journey/hostedEmail.ts', 'utf8');
  const decide = helper.indexOf('const action = hostedEmailFieldAction('), typed = helper.indexOf('await input.fill(opts.value, { timeout: HOSTED_ACTION_MS })');
  const readback = helper.indexOf("requireFact(await input.inputValue({ timeout: HOSTED_READ_MS }).catch(() => null) === opts.value, hostedFieldNotEditable('email'));");
  assert.ok(decide > 0 && typed > decide && readback > typed, 'decide, then fill, then read back');
  // Email values never reach a log, a return value or an error: fixed codes and a fixed checkpoint name only.
  assert.doesNotMatch(helper, /console\.|logger\./);
  assert.match(helper, /opts\.checkpoint\('hosted_email_prefilled'\)/);
});

// Run 44284831241: a take under the app's minimum is discarded as too short, so the journey must hold past it before Stop.
test('recording hold: past the app\'s own minimum duration, timed from the observed start, then Stop; a too-short status is named', () => {
  const env = readFileSync('frontend/src/config/env.ts', 'utf8');
  const appMin = Number(/export const MIN_SESSION_DURATION_SECONDS = (\d+);/.exec(env)?.[1]);
  assert.ok(Number.isInteger(appMin) && appMin > 0, 'the app minimum is readable');
  assert.equal(APP_MIN_SESSION_DURATION_SECONDS, appMin, 'the journey uses the app\'s own minimum');
  assert.ok(RECORDING_HOLD_MS >= (appMin + 2) * 1000, 'a margin over the minimum');
  assert.equal(recordingHoldRemainingMs(1_000, 1_000), RECORDING_HOLD_MS);
  assert.equal(recordingHoldRemainingMs(1_000, 1_900), RECORDING_HOLD_MS - 900); // run 9: text at ~0.9 s
  assert.equal(recordingHoldRemainingMs(1_000, 1_000 + RECORDING_HOLD_MS), 0);
  assert.equal(recordingHoldRemainingMs(1_000, 1_000 + RECORDING_HOLD_MS + 5_000), 0);
  assert.equal(recordingHoldRemainingMs(5_000, 1_000), RECORDING_HOLD_MS); // a clock going backwards never shortens it
  assert.equal(recordingHoldRemainingMs(Number.NaN, 1_000), RECORDING_HOLD_MS);
  // The app's own too-short text is the one the journey names.
  const lifecycle = readFileSync('frontend/src/hooks/useSessionLifecycle.ts', 'utf8');
  assert.ok(lifecycle.includes(`${APP_TOO_SHORT_STATUS} (\${elapsedAtStop}s)`), 'the app status the journey detects');
  // Order in record(): capture live confirmed, started observed, transcript, then the hold-then-Stop, then the save.
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  const rec = spec.slice(spec.indexOf('  async record(): Promise<void> {'), spec.indexOf('  async advance('));
  const order = ["await expectBenchmarkRecordingStarted(this.page, 'billing-journey');",
    "getByTestId('session-shell').getAttribute('data-session-state'", "requireFact(liveState === 'during', 'capture_live_unconfirmed');",
    'const startedObservedAt = Date.now();', "await expectBenchmarkTranscriptOutput(this.page, 'billing-journey', 60_000, 3);",
    'await holdThenStop({ startedObservedAt,', "await stopBenchmarkRecording(this.page, 'billing-journey');",
    "requireFact(!settled.tooShort, 'recording_discarded_too_short');", 'this.savedSession = settled.id;'];
  let at = -1;
  for (const step of order) { const i = rec.indexOf(step); assert.ok(i > at, step); at = i; }
  assert.equal((rec.match(/stopBenchmarkRecording\(/g) ?? []).length, 1);
  assert.equal((rec.match(/holdThenStop\(/g) ?? []).length, 1);
});

// #1835 makes transcript saving opt-in; the billing recording step needs a saved transcript (paid_recording_not_proven).
test('privacy opt-in fact: only THIS owner\'s row with saving on proceeds; no choice is a named stop, not a later generic failure', () => {
  const uid = 'uid-owner';
  const own = (save: unknown, version: unknown = 1, user = uid) => ({ state: 'read' as const, row: { user_id: user, transcript_save: save, consent_version: version } });
  for (const build of ['includes', 'unknown'] as const) {
    assert.equal(privacyOptInFact(own(true), uid, build), 'opted_in', build);
    // CONTROL: no recorded choice (the prompt was never answered) stops before any recording.
    assert.equal(privacyOptInFact({ state: 'read', row: null }, uid, build), 'privacy_choice_missing', build);
    assert.equal(privacyOptInFact(own(false), uid, build), 'privacy_choice_declined', build);
    assert.equal(privacyOptInFact(own(true, 1, 'uid-other'), uid, build), 'privacy_choice_wrong_owner', build);
    for (const row of [own('yes'), own(true, 2)]) assert.equal(privacyOptInFact(row, uid, build), 'privacy_choice_unreadable', build);
  }
  for (const code of ['privacy_choice_missing', 'privacy_choice_declined', 'privacy_choice_wrong_owner', 'privacy_choice_unreadable',
    'privacy_schema_missing', 'privacy_schema_unknown', 'privacy_schema_unexpected'])
    assert.equal(safeFailureReason(new Error(`BILLING_JOURNEY:${code}`)), code);
});

// Sam, 17 Nov: a missing consent table is not_applicable ONLY for a build independently known to predate #1835.
test('a missing or unreadable consent table: not_applicable only for a build known to predate #1835; otherwise a stop', () => {
  const uid = 'uid-owner';
  assert.equal(privacyOptInFact({ state: 'absent' }, uid, 'predates'), 'not_applicable', 'pre-#1835 build: existing scope unchanged');
  assert.equal(privacyOptInFact({ state: 'absent' }, uid, 'includes'), 'privacy_schema_missing', 'a #1835 build without its table');
  assert.equal(privacyOptInFact({ state: 'absent' }, uid, 'unknown'), 'privacy_schema_unknown');
  assert.equal(privacyOptInFact({ state: 'unreadable' }, uid, 'unknown'), 'privacy_schema_unknown');
  assert.equal(privacyOptInFact({ state: 'unreadable' }, uid, 'includes'), 'privacy_choice_unreadable');
  assert.equal(privacyOptInFact({ state: 'unreadable' }, uid, 'predates'), 'privacy_choice_unreadable');
  // A pre-#1835 build whose database answers for the table is not the tested schema.
  assert.equal(privacyOptInFact({ state: 'read', row: null }, uid, 'predates'), 'privacy_schema_unexpected');
  // Schema identity comes from the tested commit's own migrations; an unreadable or empty listing is unknown, never "predates".
  assert.equal(PRIVACY_MIGRATION, '20261117105700_practice_privacy_choices_1835.sql');
  assert.equal(privacyBuildState(['20260101000000_a.sql', PRIVACY_MIGRATION]), 'includes');
  assert.equal(privacyBuildState(['20260101000000_a.sql']), 'predates');
  assert.equal(privacyBuildState([]), 'unknown');
  assert.equal(privacyBuildState(null), 'unknown');
  // This checkout's real migrations: this base predates #1835, so the reading is `predates` (it flips to `includes` with #1835).
  assert.equal(privacyBuildState(readdirSync('backend/supabase/migrations')), existsSync(`backend/supabase/migrations/${PRIVACY_MIGRATION}`) ? 'includes' : 'predates');
});

test('the recording step opts in through the actual prompt (save yes, coaching no) for the exact owner, before any recording', () => {
  assert.deepEqual({ ...PRIVACY_PROMPT }, { prompt: 'practice-privacy-prompt', saveYes: 'privacy-save-yes', aiNo: 'privacy-ai-no', continue: 'privacy-continue' });
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  const record = spec.slice(spec.indexOf('async record(): Promise<void> {'), spec.indexOf('async advance('));
  const ensure = record.indexOf('await this.ensureTranscriptSaving();');
  assert.ok(ensure > 0 && ensure < record.indexOf("getByTestId('practice-card-freeform')"), 'opt-in comes before the recording starts');
  const step = spec.slice(spec.indexOf('async ensureTranscriptSaving('), spec.indexOf('async record(): Promise<void> {'));
  assert.match(step, /\.from\('practice_privacy_choices'\)\.select\('user_id,transcript_save,ai_coaching,consent_version'\)\.eq\('user_id', this\.uid\)/);
  assert.match(step, /getByTestId\(PRIVACY_PROMPT\.saveYes\)/);
  assert.match(step, /getByTestId\(PRIVACY_PROMPT\.aiNo\)/);
  assert.doesNotMatch(step, /aiYes|privacy-ai-yes/, 'the recording step never turns on AI coaching');
  assert.match(step, /requireFact\(privacyOptInFact\(recorded, this\.uid, build\) === 'opted_in', 'privacy_choice_not_recorded'\);/);
  // The build's schema identity is read from the tested checkout's migrations, and both reads use it.
  assert.match(step, /const build = privacyBuildState\(\(\(\) => \{ try \{ return readdirSync\(resolve\(process\.cwd\(\), 'backend\/supabase\/migrations'\)\); \} catch \{ return null; \} \}\)\(\)\)/);
  assert.match(step, /const first = await readChoice\(\);\s+const before = privacyOptInFact\(first, this\.uid, build\);/);
  assert.equal((step.match(/privacyOptInFact\(recorded, this\.uid, build\)/g) ?? []).length, 1);
  // Anything other than an observed absence of a choice stops before the prompt is touched.
  assert.match(step, /if \(before !== 'privacy_choice_missing'\) requireFact\(false, before\);/);
  // Only an observed absence of a choice may answer the prompt; an existing choice (opted in, declined, foreign) is never rewritten.
  const firstClick = step.indexOf('.click(');
  assert.ok(step.indexOf("if (before === 'not_applicable') return;") < firstClick);
  // Sam (17 Nov): the existing-choice path needs the same server proof; saving on with coaching on or unreadable stops unrewritten.
  const existing = step.indexOf("if (before === 'opted_in') { requireFact(privacyAnswerRecorded(first, this.uid), 'privacy_choice_coaching_not_off'); return; }");
  assert.ok(existing > 0 && existing < firstClick);
  assert.ok(step.indexOf("if (before !== 'privacy_choice_missing') requireFact(false, before);") < firstClick);
  // Sam on 9dcf0259: a real bounded visibility wait, not the isVisible() snapshot (hydration must not falsely stop the run).
  assert.doesNotMatch(step, /isVisible\(/);
  assert.match(step, /prompt\.waitFor\(\{ state: 'visible', timeout: HOSTED_ACTION_MS \}\)/);
  // privacy_opted_in is emitted only after the same owner's server row proves saving on and coaching off.
  const proof = step.indexOf("requireFact(privacyAnswerRecorded(recorded, this.uid), 'privacy_choice_not_recorded');");
  const mark = step.indexOf("this.checkpoint('privacy_opted_in');");
  assert.ok(step.lastIndexOf('.click(') < proof && proof < mark, 'clicks, then server proof, then the checkpoint');
  for (const call of step.match(/\.click\([^;]*/g) ?? []) assert.match(call, /timeout: HOSTED_ACTION_MS/);
});

test('the answer is recorded only when the same owner\'s row shows saving on AND coaching off', () => {
  const uid = 'uid-owner';
  const row = (o: Record<string, unknown>) => ({ state: 'read' as const, row: { user_id: uid, transcript_save: true, ai_coaching: false, consent_version: 1, ...o } });
  assert.equal(privacyAnswerRecorded(row({}), uid), true);
  for (const [label, read] of [['coaching on', row({ ai_coaching: true })], ['saving off', row({ transcript_save: false })],
    ['another owner', row({ user_id: 'uid-other' })], ['coaching unread', row({ ai_coaching: null })], ['another version', row({ consent_version: 2 })],
    ['no row', { state: 'read' as const, row: null }], ['absent', { state: 'absent' as const }], ['unreadable', { state: 'unreadable' as const }]] as const)
    assert.equal(privacyAnswerRecorded(read, uid), false, label);
  for (const code of ['privacy_choice_not_recorded', 'privacy_choice_coaching_not_off']) assert.equal(safeFailureReason(new Error(`BILLING_JOURNEY:${code}`)), code);
  // The existing-choice cases: saving on with coaching on, or coaching unread, are opted in by privacyOptInFact but not proven.
  for (const o of [{ ai_coaching: true }, { ai_coaching: null }]) {
    assert.equal(privacyOptInFact(row(o), uid, 'includes'), 'opted_in');
    assert.equal(privacyAnswerRecorded(row(o), uid), false, JSON.stringify(o));
  }
});

// The app's own facts the hold relies on, pinned: `during` (which shows the recorder bar) exists only once capture is live, and
// the app's clock is re-based to that moment in the same store update.
test('capture live: the app renders the recording state only once capture is live, and starts its clock at that moment', () => {
  const store = readFileSync('frontend/src/stores/useSessionStore.ts', 'utf8');
  assert.match(store, /setCaptureLive: \(captureLive\) => set\(\(state\) => \(captureLive && !state\.captureLive && state\.isListening\s*\? \{ captureLive, startTime: Date\.now\(\), elapsedTime: 0 \}/);
  const view = readFileSync('frontend/src/components/session/SessionOverhaulView.tsx', 'utf8');
  assert.match(view, /firstAudioFrameReceived: isListening && captureLiveForState,/);
  const machine = readFileSync('frontend/src/utils/sessionStateMachine.ts', 'utf8');
  assert.match(machine, /if \(firstAudioFrameReceived\) return 'during';/);
  assert.match(readFileSync('frontend/src/components/session/SessionShell.tsx', 'utf8'), /data-session-state=\{sessionState\}/);
  const lifecycle = readFileSync('frontend/src/hooks/useSessionLifecycle.ts', 'utf8');
  assert.match(lifecycle, /const liveStart = useSessionStore\.getState\(\)\.startTime;\s+const elapsedAtStop = liveStart \? Math\.floor\(\(Date\.now\(\) - liveStart\) \/ 1000\) : elapsedTime;/);
});

// Behaviour with a controlled clock. The app's rule at Stop is mirrored from useSessionLifecycle (pinned above):
// too short when floor((stopAt - startTime) / 1000) < MIN_SESSION_DURATION_SECONDS.
const appKeepsTake = (appStartTime: number, stopAt: number) => Math.floor((stopAt - appStartTime) / 1000) >= APP_MIN_SESSION_DURATION_SECONDS;
function fakeClock(start: number, wakeFraction = 1) {
  let t = start; const slept: number[] = [];
  return { clock: { now: () => t, sleep: async (ms: number) => { slept.push(ms); t += Math.max(1, Math.ceil(ms * wakeFraction)); } },
    advance: (ms: number) => { t += ms; }, slept, at: () => t };
}

test('hold-then-Stop: Stop never comes before the hold, so the app keeps the take (run 9\'s timings)', async () => {
  // Run 9: capture live (app startTime) at 0; the journey saw it at +50 ms; the first words at +940 ms.
  for (const wakeFraction of [1, 0.5]) { // a sleep that wakes early (halfway) is re-checked
    const f = fakeClock(50, wakeFraction);
    f.advance(890);
    let stoppedAt: number | null = null;
    const held = await holdThenStop({ startedObservedAt: 50, clock: f.clock, stop: async () => { stoppedAt = f.at(); } });
    assert.ok(stoppedAt !== null && stoppedAt - 50 >= RECORDING_HOLD_MS, `stopped at ${stoppedAt}`);
    assert.ok(held >= RECORDING_HOLD_MS);
    assert.equal(appKeepsTake(0, stoppedAt!), true);
  }
  // Stop is pressed exactly once.
  const f = fakeClock(0); let stops = 0;
  await holdThenStop({ startedObservedAt: 0, clock: f.clock, stop: async () => { stops += 1; } });
  assert.equal(stops, 1);
});

test('CONTROL: the run-9 premature Stop (as soon as three words appear) is the case the app discards', async () => {
  // Without the hold, Stop lands at the first words (~0.94 s after capture live): the app's own rule discards it.
  assert.equal(appKeepsTake(0, 940), false);
  // A clock that never advances cannot satisfy the hold: Stop is refused, never pressed early.
  const frozen = { now: () => 1_000, sleep: async () => {} };
  let stopped = false;
  await assert.rejects(holdThenStop({ startedObservedAt: 1_000, clock: frozen, stop: async () => { stopped = true; } }), /recording_hold_not_met/);
  assert.equal(stopped, false);
});
