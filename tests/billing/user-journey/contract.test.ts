import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'vitest';
import { RUNNER_JOURNEYS, POLICY_PENDING_STEPS, REQUIRED_STEPS, receipt, assertTestPrice, assertInvoice,
  isCorrelatedDelivery, assertSandboxConfiguration, safeFailureReason, testClockCreateFields, localStackStatus,
  hostedFieldUnavailable, hostedEmailDecision, assertCheckoutIdentity, type HostedField, hostedFormNotConfirmable, fixtureCustomerFields, firstVisibleControl, hostedEmailFieldAction,
  HOSTED_ACTION_MS, HOSTED_READ_MS, HOSTED_LINK_OPT_IN_NOT_CLEARED, progressLine, HOSTED_SELECTORS, checkoutNotReturned, hostedFieldNotEditable, hostedSubmitUnavailable, invalidFieldToken ,
  APP_MIN_SESSION_DURATION_SECONDS, RECORDING_HOLD_MS, recordingHoldRemainingMs, holdThenStop, observeCaptureLive, APP_TOO_SHORT_STATUS, WATCH_INSTALL_SCRIPT, takeStatusScript, stopGateScript, takeOutcome, optInThroughPrompt,
  privacyOptInFact, PRIVACY_PROMPT, privacyBuildState, PRIVACY_MIGRATION, privacyAnswerRecorded, historySeedFailure,
  retentionActive, retentionActivationFailure, retentionRowsFailure, retentionViewFailure, RETENTION_POLICY_VERSION, type RetentionRowFacts,
  type RetentionDetailFacts } from './contract';
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
  accountRemoval: 'AUTH_DELETE_NOT_RUN_REQUIRES_STACK_DESTRUCTION', billingRowResidue: 'NOT_READ_REQUIRES_STACK_DESTRUCTION_PROOF', testedRelease: RELEASE, stackRun: STACK_RUN };
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
  // The local-stack-only field (the finalizer only ever reads local-stack receipts); hosted/shared receipts omit it.
  const localOnly = [...attached.matchAll(/^ {8}\.\.\.\(useLocalStack \? \{ ([a-zA-Z]+):/gm)].map(m => m[1]);
  assert.deepEqual(localOnly, ['accountRemoval']);
  // receipt() supplies schema, journey, stripeMode, result and steps; the attach adds the rest.
  const written = new Set([...Object.keys(receipt('conversion', new Set())), ...added, ...localOnly]);
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
// J9.b's restore_access pays through the same hosted Checkout as conversion, so it is the one other journey with the email.
test('only conversion\'s and restore_access\'s Customer carry the fixture email; every other journey\'s Customer request is unchanged', () => {
  const f = { clock: 'clock_1', email: 'rwt-journey-billing-x@example.com', marker: 'rwt-journey-billing-x' };
  const before = { test_clock: 'clock_1', 'metadata[speaksharp_test]': 'rwt-journey-billing-x' }; // the request every journey sent before #1892
  assert.deepEqual(fixtureCustomerFields('conversion', f), { ...before, email: f.email });
  assert.deepEqual(fixtureCustomerFields('restore_access', f), { ...before, email: f.email });
  const others = RUNNER_JOURNEYS.filter((j) => j !== 'conversion' && j !== 'restore_access');
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
    'const live = await observeCaptureLive({ clock, timeoutMs: 60_000,', 'pageScript(WATCH_INSTALL_SCRIPT)',
    "await expectBenchmarkTranscriptOutput(this.page, 'billing-journey', 60_000, 3);",
    'const held = await holdThenStop({ startedObservedAt: live.observedAt, takeKey: live.takeKey, clock,',
    'pageScript(takeStatusScript(live.takeKey))', 'pageScript(stopGateScript(live.takeKey))',
    "await expect(this.page.getByTestId('recorder-bar')).toHaveCount(0", 'const outcome = await this.poll(async () => takeOutcome(',
    "requireFact(outcome === 'saved', outcome);", 'this.savedSession = held.session as string;'];
  let at = -1;
  for (const step of order) { const i = rec.indexOf(step); assert.ok(i > at, step); at = i; }
  // The only Stop is the page's own gated click; no generic Stop helper that could wait and resolve again after the check.
  assert.doesNotMatch(rec, /stopBenchmarkRecording\(|getByTestId\('recorder-stop'\)/);
  assert.equal((rec.match(/holdThenStop\(/g) ?? []).length, 1);
  assert.doesNotMatch(rec, /waitForBenchmarkSaveCandidate\(/, 'the outcome read replaces the candidate-first wait');
  const consent = spec.slice(spec.indexOf('  async ensureTranscriptSaving('), spec.indexOf('  async record(): Promise<void> {'));
  assert.match(consent, /await optInThroughPrompt\(\{/);
  assert.doesNotMatch(consent, /\.click\((?!\{ timeout: HOSTED_ACTION_MS \}\))/, 'the only click is the sequence\'s own control click');
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

test('the recording step delegates consent to the tested sequence, wired to the real prompt and the same owner\'s row', () => {
  assert.deepEqual({ ...PRIVACY_PROMPT }, { prompt: 'practice-privacy-prompt', saveYes: 'privacy-save-yes', aiNo: 'privacy-ai-no', continue: 'privacy-continue' });
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  const record = spec.slice(spec.indexOf('async record(): Promise<void> {'), spec.indexOf('async advance('));
  const ensure = record.indexOf('await this.ensureTranscriptSaving();');
  assert.ok(ensure > 0 && ensure < record.indexOf("getByTestId('practice-card-freeform')"), 'opt-in comes before the recording starts');
  const step = spec.slice(spec.indexOf('async ensureTranscriptSaving('), spec.indexOf('async record(): Promise<void> {'));
  // Wiring only: the behaviour is executed against both build states in the optInThroughPrompt tests below.
  assert.match(step, /\.from\('practice_privacy_choices'\)\.select\('user_id,transcript_save,ai_coaching,consent_version'\)\.eq\('user_id', this\.uid\)/);
  assert.match(step, /const build = privacyBuildState\(\(\(\) => \{ try \{ return readdirSync\(resolve\(process\.cwd\(\), 'backend\/supabase\/migrations'\)\); \} catch \{ return null; \} \}\)\(\)\)/);
  assert.match(step, /await optInThroughPrompt\(\{\s+build, ownerId: this\.uid,/);
  assert.match(step, /click: \(control\) => prompt\.getByTestId\(PRIVACY_PROMPT\[control\]\)\.click\(\{ timeout: HOSTED_ACTION_MS \}\)/);
  assert.doesNotMatch(step, /aiYes|privacy-ai-yes/, 'the recording step never turns on AI coaching');
  // The sequence itself never offers a coaching-yes control.
  assert.doesNotMatch(readFileSync('tests/billing/user-journey/contract.ts', 'utf8').slice(
    readFileSync('tests/billing/user-journey/contract.ts', 'utf8').indexOf('export async function optInThroughPrompt(')), /'aiYes'/);
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

// ---- Executable controls: the ACTUAL page scripts run against a fake DOM, and the actual consent sequence against fakes. ----

/**
 * A fake page: shell state, runtime take/session, a Stop button, real-shaped MutationObservers (records with oldValue, delivery
 * in batches, takeRecords for undelivered ones) and an interval backstop that only fires on tick().
 */
function fakePage(o: { state?: string; lifecycle?: number; session?: string | null } = {}) {
  const page = { state: o.state ?? 'during', lifecycle: o.lifecycle ?? 7, session: o.session === undefined ? 'sess-1' : o.session, clicks: 0, disabled: false };
  type Obs = { cb: (r: Array<{ oldValue: string | null }>) => void; target: unknown; attrs: boolean; queue: Array<{ oldValue: string | null }> };
  const observers: Obs[] = []; const intervals: Array<() => void> = [];
  const makeShell = () => ({ getAttribute: (n: string) => (n === 'data-session-state' ? page.state : null) });
  let shell = makeShell();
  const stop = { click: () => { page.clicks += 1; }, get disabled() { return page.disabled; } };
  const document = { documentElement: {}, querySelector: (sel: string) => (sel.includes('session-shell') ? shell : sel.includes('recorder-stop') ? stop : null) };
  class FakeObserver { o: Obs; constructor(cb: Obs['cb']) { this.o = { cb, target: null, attrs: false, queue: [] }; observers.push(this.o); }
    observe(target: unknown, opts: { attributes?: boolean; attributeOldValue?: boolean }) { this.o.target = target; this.o.attrs = !!opts.attributeOldValue; }
    takeRecords() { const q = this.o.queue; this.o.queue = []; return q; } disconnect() {} }
  const window: Record<string, unknown> = {
    __SPEECH_RUNTIME_DEBUG__: () => ({ lifecycleVersion: page.lifecycle, sessionId: page.session }),
    setInterval: (fn: () => void) => { intervals.push(fn); return intervals.length; }, clearInterval: () => {}, MutationObserver: FakeObserver,
  };
  const run = <T,>(body: string): T => new Function('window', 'document', body)(window, document) as T;
  /** Set the shell state, queueing a record (with the old value) for observers of that shell; delivery is separate. */
  const setState = (next: string) => { for (const ob of observers) if (ob.attrs && ob.target === shell) ob.queue.push({ oldValue: page.state }); page.state = next; };
  const deliver = () => { for (const ob of observers) { const q = ob.queue; ob.queue = []; ob.cb(q); } };
  return { page, run, setState, deliver, tick: () => intervals.forEach(fn => fn()),
    /** Each change delivered on its own (the common case). */
    mutate: (next: string) => { setState(next); deliver(); },
    /** The shell element is replaced by a new node (the tree observer fires). */
    replaceShell: () => { shell = makeShell(); deliver(); },
    /** Replaced with no observer callback delivered yet (only the Stop task's own check can see it). */
    replaceShellSilently: () => { shell = makeShell(); } };
}

test('page take watch: installs only when capture is live; the gate clicks Stop once for the same intact take', () => {
  const f = fakePage({ state: 'before' });
  assert.equal(f.run<string | null>(WATCH_INSTALL_SCRIPT), null, 'not live yet: nothing installed');
  f.page.state = 'during';
  const key = f.run<string | null>(WATCH_INSTALL_SCRIPT);
  assert.ok(key && key.endsWith('|7'));
  assert.equal(f.run<string | null>(takeStatusScript(key!)), key);
  assert.deepEqual(f.run(stopGateScript(key!)), { clicked: true, reason: null, session: 'sess-1' });
  assert.equal(f.page.clicks, 1);
});

test('CONTROL: capture dropping and resuming during the hold breaks the take for good; Stop is not clicked', () => {
  const f = fakePage(); const key = f.run<string>(WATCH_INSTALL_SCRIPT);
  f.mutate('before');
  f.mutate('during'); // resumed: must not repair the watch
  assert.equal(f.run<string | null>(takeStatusScript(key)), null);
  assert.deepEqual(f.run(stopGateScript(key)), { clicked: false, reason: 'capture_dropped', session: null });
  assert.equal(f.page.clicks, 0);
});

test('CONTROL: a drop and re-entry delivered in ONE batch, or still undelivered at Stop, is caught from the records', () => {
  // during -> before -> during inside a single callback: sampling the DOM would see only "during".
  const batched = fakePage(); const kb = batched.run<string>(WATCH_INSTALL_SCRIPT);
  batched.setState('before'); batched.setState('during'); batched.deliver();
  assert.equal(batched.run<string | null>(takeStatusScript(kb)), null);
  assert.deepEqual(batched.run(stopGateScript(kb)), { clicked: false, reason: 'capture_dropped', session: null });
  // The same pair never delivered (no callback, no interval tick): the Stop task drains the pending records first.
  const pending = fakePage(); const kp = pending.run<string>(WATCH_INSTALL_SCRIPT);
  pending.setState('before'); pending.setState('during');
  assert.deepEqual(pending.run(stopGateScript(kp)), { clicked: false, reason: 'capture_dropped', session: null });
  // A same-value write (during -> during) is not a drop.
  const same = fakePage(); const ks = same.run<string>(WATCH_INSTALL_SCRIPT);
  same.setState('during'); same.deliver();
  assert.equal(same.run<{ clicked: boolean }>(stopGateScript(ks)).clicked, true);
  // The watched shell replaced by a new element (even one that also says "during"): the take changed.
  const replaced = fakePage(); const kr = replaced.run<string>(WATCH_INSTALL_SCRIPT);
  replaced.replaceShell();
  assert.deepEqual(replaced.run(stopGateScript(kr)), { clicked: false, reason: 'take_changed', session: null });
  const silent = fakePage(); const kq = silent.run<string>(WATCH_INSTALL_SCRIPT);
  silent.replaceShellSilently();
  assert.deepEqual(silent.run(stopGateScript(kq)), { clicked: false, reason: 'take_changed', session: null });
  for (const x of [batched, pending, replaced, silent]) assert.equal(x.page.clicks, 0);
});

test('CONTROL: a take replaced between the last check and the click, a session change, or a reload: Stop is not clicked', () => {
  // Replacement with no observer or interval firing in between: the gate's own same-task check refuses.
  const a = fakePage(); const ka = a.run<string>(WATCH_INSTALL_SCRIPT);
  assert.equal(a.run<string | null>(takeStatusScript(ka)), ka);
  a.page.lifecycle = 8;
  assert.deepEqual(a.run(stopGateScript(ka)), { clicked: false, reason: 'take_changed', session: null });
  // The runtime's session changes under the same lifecycle number.
  const b = fakePage(); const kb = b.run<string>(WATCH_INSTALL_SCRIPT);
  b.page.session = 'sess-2'; b.tick();
  assert.equal(b.run<{ clicked: boolean }>(stopGateScript(kb)).clicked, false);
  // A session bound after install is then fixed: a later different id breaks the take.
  const c = fakePage({ session: null }); const kc = c.run<string>(WATCH_INSTALL_SCRIPT);
  c.page.session = 'sess-9'; c.tick(); c.page.session = 'sess-10';
  assert.equal(c.run<{ clicked: boolean }>(stopGateScript(kc)).clicked, false);
  // A reload is a new document with no watch, even if the lifecycle number repeats.
  const reloaded = fakePage();
  assert.deepEqual(reloaded.run(stopGateScript(ka)), { clicked: false, reason: 'take_watch_missing', session: null });
  // ...and after the reload a NEW watch on the same lifecycle number is a different document: the old take's key never matches.
  const relive = fakePage({ lifecycle: 7 }); const kOld = relive.run<string>(WATCH_INSTALL_SCRIPT);
  const fresh = fakePage({ lifecycle: 7 }); const kNew = fresh.run<string>(WATCH_INSTALL_SCRIPT);
  assert.notEqual(kOld, kNew);
  assert.ok(kOld.endsWith('|7') && kNew.endsWith('|7'), 'same lifecycle number in both documents');
  assert.equal(fresh.run<string | null>(takeStatusScript(kOld)), null);
  assert.deepEqual(fresh.run(stopGateScript(kOld)), { clicked: false, reason: 'take_watch_missing', session: null });
  assert.equal(fresh.page.clicks, 0);
  // A disabled Stop control is never clicked.
  const d = fakePage(); const kd = d.run<string>(WATCH_INSTALL_SCRIPT); d.page.disabled = true;
  assert.deepEqual(d.run(stopGateScript(kd)), { clicked: false, reason: 'stop_unavailable', session: null });
  for (const x of [a, b, c, reloaded, d]) assert.equal(x.page.clicks, 0);
});

// The app's rule at Stop is mirrored from useSessionLifecycle (pinned above): too short when floor((stopAt - startTime)/1000)
// < MIN_SESSION_DURATION_SECONDS, startTime = the capture-live moment.
const appKeepsTake = (appStartTime: number, stopAt: number) => Math.floor((stopAt - appStartTime) / 1000) >= APP_MIN_SESSION_DURATION_SECONDS;
function scriptedClock(liveAt: number, wakeFraction = 1) {
  let t = 0;
  return { clock: { now: () => t, sleep: async (ms: number) => { t += Math.max(1, Math.ceil(ms * wakeFraction)); } }, at: () => t,
    probe: async () => (t >= liveAt ? 'doc-1|7' : null), advance: (ms: number) => { t += ms; } };
}

test('hold-then-Stop: timed from observed capture live; the gate is asked once, after the hold; the app keeps the take', async () => {
  for (const wakeFraction of [1, 0.5]) {
    const c = scriptedClock(0, wakeFraction);
    const live = await observeCaptureLive({ probe: c.probe, clock: c.clock, timeoutMs: 60_000 });
    c.advance(940); // run 9: first words ~0.94 s after capture live
    let gateAt: number | null = null; let gates = 0;
    const r = await holdThenStop({ startedObservedAt: live.observedAt, takeKey: live.takeKey, probe: c.probe, clock: c.clock,
      stop: async () => { gates += 1; gateAt = c.at(); return { clicked: true, reason: null, session: 'sess-1' }; } });
    assert.equal(gates, 1);
    assert.ok(gateAt !== null && gateAt - live.observedAt >= RECORDING_HOLD_MS);
    assert.equal(appKeepsTake(0, gateAt!), true);
    assert.equal(r.session, 'sess-1');
  }
});

test('CONTROL: delayed capture with instant words is timed from capture; the run-9 Stop at the words is what the app discards', async () => {
  const c = scriptedClock(3_000);
  const live = await observeCaptureLive({ probe: c.probe, clock: c.clock, timeoutMs: 60_000 });
  assert.ok(live.observedAt >= 3_000);
  let gateAt = 0;
  await holdThenStop({ startedObservedAt: live.observedAt, takeKey: live.takeKey, probe: c.probe, clock: c.clock,
    stop: async () => { gateAt = c.at(); return { clicked: true, reason: null, session: 's' }; } });
  assert.equal(appKeepsTake(3_000, gateAt), true);
  assert.equal(appKeepsTake(0, 940), false);
});

test('CONTROL: a take broken during the hold, a gate that refuses, a never-live capture or a frozen clock never stops', async () => {
  // Broken mid-hold: the probe stops returning the key, so no gate call.
  let t = 0, gates = 0;
  const clock = { now: () => t, sleep: async (ms: number) => { t += ms; } };
  await assert.rejects(holdThenStop({ startedObservedAt: 0, takeKey: 'k', clock, probe: async () => (t < 3_000 ? 'k' : null),
    stop: async () => { gates += 1; return { clicked: true, reason: null, session: 's' }; } }).then(() => { t = 0; }), /take_not_live_at_stop/);
  // A gate that refuses names its reason.
  t = 0;
  await assert.rejects(holdThenStop({ startedObservedAt: 0, takeKey: 'k', clock: { now: () => t, sleep: async (ms: number) => { t += ms; } }, probe: async () => 'k',
    stop: async () => ({ clicked: false, reason: 'capture_dropped', session: null }) }), /take_not_live_at_stop_capture_dropped/);
  await assert.rejects(observeCaptureLive({ probe: async () => null, clock: scriptedClock(1e9).clock, timeoutMs: 2_000 }), /capture_live_unconfirmed/);
  await assert.rejects(holdThenStop({ startedObservedAt: 1_000, takeKey: 'k', probe: async () => 'k', clock: { now: () => 1_000, sleep: async () => {} },
    stop: async () => { gates += 1; return { clicked: true, reason: null, session: 's' }; } }), /recording_hold_not_met/);
  assert.equal(gates, 0);
});

test('outcome after Stop: too short ends at once even with no candidate; only the take\'s own saved row counts', () => {
  assert.equal(takeOutcome({ tooShort: true, candidateSession: null, persistedId: null }, 'sess-1'), 'recording_discarded_too_short');
  assert.equal(takeOutcome({ tooShort: false, candidateSession: null, persistedId: null }, 'sess-1'), 'pending');
  assert.equal(takeOutcome({ tooShort: false, candidateSession: 'sess-1', persistedId: null }, 'sess-1'), 'pending');
  assert.equal(takeOutcome({ tooShort: false, candidateSession: 'sess-1', persistedId: 'sess-1' }, 'sess-1'), 'saved');
  assert.equal(takeOutcome({ tooShort: false, candidateSession: 'sess-2', persistedId: null }, 'sess-1'), 'save_candidate_not_this_take');
  assert.equal(takeOutcome({ tooShort: false, candidateSession: null, persistedId: 'sess-2' }, 'sess-1'), 'saved_row_not_this_take');
  assert.equal(takeOutcome({ tooShort: false, candidateSession: null, persistedId: 'sess-1' }, null), 'saved_row_not_this_take');
});

/** The consent sequence's collaborators, recording every read and click. */
function consentFakes(o: { build: 'includes' | 'predates' | 'unknown'; rows: Array<import('./contract').PrivacyTableRead>; shown?: boolean }) {
  const log: string[] = []; const checkpoints: string[] = []; let reads = 0;
  return { log, checkpoints, deps: {
    build: o.build, ownerId: 'uid-owner',
    readChoice: async () => { log.push('read'); return o.rows[Math.min(reads++, o.rows.length - 1)]; },
    prompt: { waitVisible: async () => { log.push('wait'); return o.shown ?? true; },
      click: async (c: 'saveYes' | 'aiNo' | 'continue') => { log.push(`click:${c}`); }, waitHidden: async () => { log.push('hidden'); } },
    checkpoint: (n: string) => { checkpoints.push(n); },
  } };
}
const row = (r: object) => ({ state: 'read' as const, row: { user_id: 'uid-owner', consent_version: 1, ...r } });

test('consent, pre-#1835 build: skipped only when proven; the table answering on such a build stops; no prompt either way', async () => {
  const pre = consentFakes({ build: 'predates', rows: [{ state: 'absent' }] });
  assert.equal(await optInThroughPrompt(pre.deps), 'not_applicable');
  assert.deepEqual(pre.log, ['read']);
  const odd = consentFakes({ build: 'predates', rows: [row({ transcript_save: true, ai_coaching: false })] });
  await assert.rejects(optInThroughPrompt(odd.deps), /privacy_schema_unexpected/);
  assert.ok(!odd.log.some(l => l.startsWith('click') || l === 'wait'));
});

test('consent, unknown build: stops before any read, prompt or click', async () => {
  for (const rows of [[{ state: 'absent' as const }], [{ state: 'read' as const, row: null }]]) {
    const u = consentFakes({ build: 'unknown', rows });
    await assert.rejects(optInThroughPrompt(u.deps), /privacy_schema_unknown/);
    assert.deepEqual(u.log, []);
  }
});

test('consent, #1835 build: the real prompt is answered save yes, coaching no, then proven by the same owner\'s row', async () => {
  const f = consentFakes({ build: 'includes', rows: [{ state: 'read', row: null }, row({ transcript_save: true, ai_coaching: false })] });
  assert.equal(await optInThroughPrompt(f.deps), 'answered');
  assert.deepEqual(f.log, ['read', 'wait', 'click:saveYes', 'click:aiNo', 'click:continue', 'hidden', 'read']);
  assert.deepEqual(f.checkpoints, ['privacy_opted_in']);
  // The answer not recorded (still no row, coaching on, another owner) stops without the checkpoint.
  for (const after of [{ state: 'read' as const, row: null }, row({ transcript_save: true, ai_coaching: true }),
    { state: 'read' as const, row: { user_id: 'uid-other', consent_version: 1, transcript_save: true, ai_coaching: false } }]) {
    const g = consentFakes({ build: 'includes', rows: [{ state: 'read', row: null }, after] });
    await assert.rejects(optInThroughPrompt(g.deps), /privacy_choice_not_recorded/);
    assert.deepEqual(g.checkpoints, []);
  }
  // A prompt that never appears stops before any click.
  const hidden = consentFakes({ build: 'includes', rows: [{ state: 'read', row: null }], shown: false });
  await assert.rejects(optInThroughPrompt(hidden.deps), /privacy_choice_missing/);
  assert.ok(!hidden.log.some(l => l.startsWith('click')));
});

test('consent, #1835 build: a recorded choice is never rewritten — zero clicks, and anything but save=yes/coaching=no stops', async () => {
  const ok = consentFakes({ build: 'includes', rows: [row({ transcript_save: true, ai_coaching: false })] });
  assert.equal(await optInThroughPrompt(ok.deps), 'existing_choice');
  assert.deepEqual(ok.log, ['read']);
  for (const [r, code] of [[row({ transcript_save: true, ai_coaching: true }), /privacy_choice_coaching_not_off/],
    [row({ transcript_save: false, ai_coaching: false }), /privacy_choice_declined/],
    [{ state: 'read', row: { user_id: 'uid-other', consent_version: 1, transcript_save: true, ai_coaching: false } }, /privacy_choice_wrong_owner/],
    [{ state: 'absent' }, /privacy_schema_missing/], [{ state: 'unreadable' }, /privacy_choice_unreadable/]] as const) {
    const f = consentFakes({ build: 'includes', rows: [r as import('./contract').PrivacyTableRead] });
    await assert.rejects(optInThroughPrompt(f.deps), code);
    assert.ok(!f.log.some(l => l.startsWith('click') || l === 'wait'), JSON.stringify(r));
  }
});

test('(PO + Sam, 18 Nov) the local test account is removed only by this run\'s verified stack destruction; no Auth delete is claimed', () => {
  const passed = finaliseLocalStackReceipt([pendingReceipt], allChecks, finaliserExpected);
  assert.equal(passed.result, 'PASSED', JSON.stringify(passed.defects));
  assert.equal(passed.testAccount, 'REMOVED_BY_VERIFIED_STACK_DESTRUCTION');
  assert.equal(passed.authDelete, 'NOT_RUN');
  // The account is never "removed" without the destruction proof for this exact stack and identity list.
  for (const [checks, expected] of [[{ ...allChecks, stackDestroyed: 'failure' }, finaliserExpected],
    [allChecks, { ...finaliserExpected, destruction: undefined }],
    [allChecks, { ...finaliserExpected, destruction: destroyedFor('billing-local-stack-1-1') }],
    [allChecks, { ...finaliserExpected, identity: identityFor('billing-local-stack-1-1') }]] as const) {
    const combined = finaliseLocalStackReceipt([pendingReceipt], checks, expected);
    assert.equal(combined.testAccount, 'NOT_PROVEN');
    assert.equal(combined.result, 'NOT_PROVEN');
  }
  // A receipt that claims an Auth delete, omits the field or forges another value is refused, even with a valid destruction.
  for (const accountRemoval of ['AUTH_DELETED', 'NOT_PROVEN', 'REMOVED_BY_VERIFIED_STACK_DESTRUCTION', undefined]) {
    const forged = { ...pendingReceipt, accountRemoval } as Record<string, unknown>;
    if (accountRemoval === undefined) delete forged.accountRemoval;
    const combined = finaliseLocalStackReceipt([forged], allChecks, finaliserExpected);
    assert.equal(combined.result, 'NOT_PROVEN', String(accountRemoval));
    assert.equal(combined.testAccount, 'NOT_PROVEN', String(accountRemoval));
  }
});

test('(PO + Sam, 18 Nov) on the local stack neither journey spec calls the Auth delete; any other target still does', () => {
  for (const file of ['tests/billing/user-journey/journey.billing.spec.ts', 'tests/billing/user-journey/paid-value-loop.billing.spec.ts']) {
    const text = readFileSync(file, 'utf8');
    const calls = text.split('await cleanupRunOwnedAccount(').length - 1;
    assert.equal(calls, 1, `${file}: one delete path`);
    assert.match(text, /if \(this\.signupAttempted && !useLocalStack\) await cleanupRunOwnedAccount\(/, file);
    // Only the disposable raw receipt carries it; the hosted/shared raw receipt keeps its exact v1 shape (Sam on 62b022a4).
    assert.match(text, /\.\.\.\(useLocalStack \? \{ accountRemoval: 'AUTH_DELETE_NOT_RUN_REQUIRES_STACK_DESTRUCTION' \} : \{\}\),/, file);
  }
  // The in-test Stripe fixture cleanup is unchanged and still gates the cleanup step.
  const conversion = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  assert.match(conversion, /stripeClean = await proveStripeFixtureDeleted\(/);
  assert.match(conversion, /requireFact\(!stripeFailed && !accountFailed && stripeClean && !this\.uncertainStripeCreate, failure \?\? 'cleanup_unproven'\);/);
});

test('decline scan trusts only the hosted Checkout page and Stripe frames; an unrelated frame can never satisfy it', async () => {
  const { trustedCheckoutFrame } = await import('./contract');
  const checkout = 'https://checkout.stripe.com/c/pay/cs_test_a1#fragment';
  assert.equal(trustedCheckoutFrame(checkout, checkout), true);
  assert.equal(trustedCheckoutFrame(checkout, 'https://js.stripe.com/v3/elements-inner-payment.html'), true);
  for (const foreign of ['https://evil.example/declined', 'https://checkout.stripe.com.evil.example/', 'http://js.stripe.com/x',
    'https://m.stripe.network/inner.html', 'about:blank', 'not a url', '']) {
    assert.equal(trustedCheckoutFrame(checkout, foreign), false, foreign);
  }
  // Not on the hosted Checkout page (the app, a redirect, a look-alike host): no frame counts, Stripe's included.
  for (const page of ['http://127.0.0.1:5173/practice', 'https://checkout.stripe.com.evil.example/c/pay', 'about:blank']) {
    assert.equal(trustedCheckoutFrame(page, 'https://js.stripe.com/v3/x.html'), false, page);
  }
});

test('J9.a history seed: written by the member, and a refusal names its error class only', () => {
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  const seed = spec.slice(spec.indexOf('async seedHistory()'), spec.indexOf("this.steps.add('history_seeded');"));
  assert.ok(seed.length > 0 && seed.length < 2600, 'seedHistory found');
  // Run 45370792241: service_role holds only SELECT on practice_privacy_choices, so the #1835 consent trigger's FOR SHARE
  // read refuses a service-role transcript write (42501). The member's own insert policy is the supported path.
  assert.match(seed, /this\.member\.from\('sessions'\)\.insert\(/);
  assert.doesNotMatch(seed, /this\.admin\.from\('sessions'\)\.insert\(/);
  assert.match(seed, /requireFact\([^;]*historySeedFailure\(error\)\)/);
  assert.doesNotMatch(seed, /'history_seed_failed'/, 'a bare code says nothing about why');
  // The class, never the message; and every outcome is a valid receipt failure code.
  const cases: [unknown, string][] = [
    [{ code: '42501', message: 'permission denied for table practice_privacy_choices' }, 'history_seed_failed_42501'],
    [{ code: '42501', message: 'transcript_consent_required' }, 'history_seed_failed_42501'],
    [{ code: 'P0001', message: 'x' }, 'history_seed_failed_p0001'],
    [{ code: 'PGRST116', message: 'no rows' }, 'history_seed_failed_pgrst116'],
    [{ code: '42501; DROP', message: 'x' }, 'history_seed_failed_other'],
    [{ code: 'secret-row-text', message: 'x' }, 'history_seed_failed_other'],
    [{ message: 'no code' }, 'history_seed_failed_other'],
    [null, 'history_seed_failed_no_row'],
  ];
  for (const [error, expected] of cases) {
    assert.equal(historySeedFailure(error), expected);
    assert.equal(safeFailureReason(new Error(`BILLING_JOURNEY:${expected}`)), expected, `${expected} survives the receipt`);
  }
});

test('J9.a retention precondition: only the reviewed policy version, read back as active, counts', () => {
  assert.equal(RETENTION_POLICY_VERSION, 'newest_one_v1');
  assert.equal(retentionActive({ version: 'newest_one_v1', active: true }), true);
  // Negative control (Sam): an inactive policy, another version, or an unread value never passes.
  for (const read of [{ version: 'newest_one_v1', active: false }, { version: 'newest_one_v1', active: null }, { version: 'newest_one_v1', active: 'true' },
    { version: 'newest_two_v1', active: true }, { version: null, active: true }, { version: 'NEWEST_ONE_V1', active: true }]) {
    assert.equal(retentionActive(read), false, JSON.stringify(read));
  }
  for (const [error, expected] of [[{ code: '55000', message: '1 ambiguous legacy session(s)' }, 'retention_activation_failed_55000'],
    [{ code: '42501', message: 'x' }, 'retention_activation_failed_42501'], [{ message: 'x' }, 'retention_activation_failed_other']] as const) {
    assert.equal(retentionActivationFailure(error), expected);
    assert.equal(safeFailureReason(new Error(`BILLING_JOURNEY:${expected}`)), expected);
  }
});

test('J9.a retention rows: a real save expires the older text, keeps both rows and the older metrics, and stores no coaching', () => {
  const older = { id: 'old-1', phrase: 'earlier practice one about planning', duration: 60, total_words: 12, wpm: 12 };
  const oldRow: RetentionRowFacts = { id: 'old-1', transcript: null, transcript_state: 'expired', duration: 60, total_words: 12, wpm: 12, ai_suggestions: null };
  const newRow: RetentionRowFacts = { id: 'new-2', transcript: 'the newest take', transcript_state: 'available', duration: 9, total_words: 3, wpm: 20, ai_suggestions: null };
  assert.equal(retentionRowsFailure([oldRow, newRow], older, 'new-2'), null);
  assert.equal(retentionRowsFailure([newRow, { ...oldRow, wpm: '12' }], older, 'new-2'), null, 'order and numeric-string metrics');
  const cases: [RetentionRowFacts[] | null, string][] = [
    [null, 'retention_rows_unread'],
    // Negative control: the older session is missing (never seeded, or lost by the save).
    [[newRow], 'retention_older_not_listed'],
    [[oldRow, oldRow, newRow], 'retention_older_not_listed'],
    [[oldRow], 'retention_newest_missing_or_textless'],
    [[oldRow, { ...newRow, transcript: '  ' }], 'retention_newest_missing_or_textless'],
    [[oldRow, { ...newRow, transcript_state: 'expired' }], 'retention_newest_missing_or_textless'],
    [[oldRow, newRow, { ...newRow, id: 'x-3' }], 'retention_unexpected_rows'],
    // Negative controls: an inactive policy leaves the old text; a resurrected transcript brings it back.
    [[{ ...oldRow, transcript: older.phrase, transcript_state: 'available' }, newRow], 'retention_old_transcript_retained'],
    [[{ ...oldRow, transcript: older.phrase }, newRow], 'retention_old_transcript_retained'],
    [[{ ...oldRow, transcript_state: 'available' }, newRow], 'retention_old_transcript_retained'],
    [[oldRow, { ...newRow, transcript: `then ${older.phrase}` }], 'retention_old_phrase_readable'],
    [[{ ...oldRow, total_words: 0 }, newRow], 'retention_older_metrics_lost'],
    [[{ ...oldRow, duration: null }, newRow], 'retention_older_metrics_lost'],
    [[{ ...oldRow, wpm: '' }, newRow], 'retention_older_metrics_lost'],
    [[{ ...oldRow, ai_suggestions: { tips: [] } }, newRow], 'retention_coaching_stored_for_old_session'],
  ];
  for (const [rows, expected] of cases) {
    assert.equal(retentionRowsFailure(rows, older, 'new-2'), expected, expected);
    assert.equal(safeFailureReason(new Error(`BILLING_JOURNEY:${expected}`)), expected, `${expected} survives the receipt`);
  }
  assert.equal(retentionRowsFailure([oldRow, newRow], older, 'old-1'), 'retention_ids_invalid', 'the newest take cannot be the older seed');
  assert.equal(retentionRowsFailure([oldRow, newRow], { ...older, phrase: ' ' }, 'new-2'), 'retention_ids_invalid');
});

test('J9.a retention views: the older session opens as expired with its phrase nowhere, the newest with its own text', () => {
  const ids = { older: 'old-1', newest: 'new-2' };
  const older: RetentionDetailFacts = { id: 'old-1', expiredNotices: 1, transcripts: 0, transcriptHasText: false, oldPhraseElements: 0 };
  const newest: RetentionDetailFacts = { id: 'new-2', expiredNotices: 0, transcripts: 1, transcriptHasText: true, oldPhraseElements: 0 };
  assert.equal(retentionViewFailure({ older, newest }, ids), null);
  const cases: [Partial<RetentionDetailFacts>, Partial<RetentionDetailFacts>, string][] = [
    [{ expiredNotices: null }, {}, 'retention_view_unread'],
    [{}, { oldPhraseElements: null }, 'retention_view_unread'],
    [{ id: 'new-2' }, {}, 'retention_older_view_wrong_session'],
    // Negative control: a resurrected (or never expired) transcript renders as the available block.
    [{ transcripts: 1, expiredNotices: 0, transcriptHasText: true }, {}, 'retention_old_transcript_shown'],
    [{ expiredNotices: 0 }, {}, 'retention_older_not_shown_expired'],
    [{}, { id: 'old-1' }, 'retention_newest_view_wrong_session'],
    [{}, { transcripts: 0, expiredNotices: 1, transcriptHasText: false }, 'retention_newest_transcript_missing'],
    [{}, { transcriptHasText: false }, 'retention_newest_transcript_missing'],
    [{ oldPhraseElements: 1 }, {}, 'retention_old_phrase_shown'],
    [{}, { oldPhraseElements: 2 }, 'retention_old_phrase_shown'],
  ];
  for (const [o, n, expected] of cases) {
    assert.equal(retentionViewFailure({ older: { ...older, ...o }, newest: { ...newest, ...n } }, ids), expected, expected);
    assert.equal(safeFailureReason(new Error(`BILLING_JOURNEY:${expected}`)), expected);
  }
  assert.equal(retentionViewFailure({ older, newest }, { older: 'old-1', newest: 'old-1' }), 'retention_ids_invalid');
});

test('J9.a wiring: active before seeding, one member-written older session, a real save, then both verdicts on the return', () => {
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  const seed = spec.slice(spec.indexOf('  async seedHistory(): Promise<void> {'), spec.indexOf("this.steps.add('history_seeded');"));
  const order = ["if (useLocalStack && !(await this.retentionIsActive())) {", "this.admin.rpc('activate_transcript_retention_newest_one')",
    "requireFact(await this.retentionIsActive(), 'retention_not_active');", "p_ai_coaching: false", "this.member.from('sessions').insert(",
    'await this.login();', 'await this.record();', 'this.newest = this.savedSession;', 'this.retentionHolds(await this.retentionRows());',
    'p_ai_coaching: true, p_expected_revision: revision'];
  let from = 0;
  for (const step of order) { const at = seed.indexOf(step, from); assert.ok(at >= 0, step); from = at + step.length; }
  // Activation only on the disposable stack; the hosted sandbox is read, never changed.
  assert.equal(spec.match(/activate_transcript_retention_newest_one/g)?.length, 1);
  assert.equal(seed.match(/this\.member\.from\('sessions'\)\.insert\(/g)?.length, 1, 'exactly one seeded older session');
  assert.doesNotMatch(seed, /pre_expiry_/);
  const rows = spec.slice(spec.indexOf('  async retentionRows()'), spec.indexOf('  retentionHolds('));
  assert.match(rows, /this\.member\.from\('sessions'\)\.select\(RETENTION_ROW_COLUMNS\)/);
  const facts = spec.slice(spec.indexOf('  async detailFacts('), spec.indexOf('  /**\n   * J9.a: a fresh sign-in'));
  assert.doesNotMatch(facts, /innerText|querySelectorAll|locator\('body'\)/, 'element counts, never the page text');
  const kept = spec.slice(spec.indexOf("this.stage = 'history_opens';"), spec.indexOf("this.stage = 'portal_plan_shown';"));
  for (const step of ['retentionViewFailure({ older: await this.detailFacts(other, this.older), newest: await this.detailFacts(other, this.newest) },',
    "this.steps.add('history_opens');", '[this.older, this.newest]', "requireFact(coachingRequests.length === 0, 'coaching_requested_for_old_sessions');",
    "this.steps.add('no_new_coaching');"]) assert.ok(kept.includes(step), step);
  assert.equal(kept.match(/this\.retentionHolds\(await this\.retentionRows\(\)\);/g)?.length, 2, 'rows re-read on the return');
});

// Elon on f3eadc1f: J9.a's seed now saves a real take (login, record) before the trial ends, so the post-expiry login must skip it
// exactly as it skips restore_access; a second login on a signed-in page times out on /auth/signin. Every journey that signs in
// before expiry (by a pre-expiry step that logs in) is excluded from the post-expiry login, and no other journey is.
test('a journey that signed in before the trial ended never logs in again on the same page', () => {
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  const setup = spec.slice(spec.indexOf('  async setup('), spec.indexOf('  async fillCard('));
  const expiry = setup.indexOf('// Controlled expiry of ONLY this disposable sandbox fixture.');
  assert.ok(setup.length > 0 && expiry > 0);
  const method = (name: string) => spec.slice(spec.indexOf(`  async ${name}(`), spec.indexOf('\n  }\n', spec.indexOf(`  async ${name}(`)));
  const signedInEarly = new Set<string>();
  for (const [, journey, step] of setup.slice(0, expiry).matchAll(/if \(this\.journey === '([a-z_]+)'\) await this\.([A-Za-z]+)\(\);/g))
    if (/await this\.login\(\);/.test(method(step))) signedInEarly.add(journey);
  assert.deepEqual([...signedInEarly].sort(), ['paid_account_kept', 'restore_access']);
  const late = [...setup.slice(expiry).matchAll(/^\s*if \(([^)]*)\) await this\.login\(\);$/gm)];
  assert.equal(late.length, 1, 'one post-expiry login');
  const excluded = [...late[0][1].matchAll(/this\.journey !== '([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(excluded, [...signedInEarly].sort());
  assert.doesNotMatch(setup.slice(expiry), /^\s*await this\.login\(\);$/m, 'no unconditional post-expiry login');
});
