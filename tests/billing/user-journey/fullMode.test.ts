// Offline controls for the runner's full mode. Nothing here reaches a network, reads a key or starts a run:
// fetch is replaced by a trap for the whole file, and every check reads committed source or pure functions.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, test } from 'vitest';
import { parse } from 'yaml';
import { selectRunnerJourneys, receipt, isRefundCancellation, assertFullRefund, assertCheckoutGrantedNothing,
  checkoutSessionFromUrl, assertCheckoutIdentity, newlyAddedCard, assertNoSecondCharge,
  BILLING_JOURNEYS, FULL_MODE_JOURNEYS, RUNNER_JOURNEYS, REQUIRED_STEPS, POLICY_PENDING_STEPS, PENDING_POLICY } from './contract';
import { finaliseLocalStackReceipt, journeyReceiptDefects } from './localStackReceipt.mjs';
import { stackIdentitySha256 } from './localStackResources.mjs';
import { MODES, PHASES, PREREQUISITES, STRIPE_WRITE_ALLOWLIST, planRun, finaliseModeReceipt, readRepoFile, EXTERNAL_REQUIRED_STEPS } from './runnerPlan.mjs';

const SPEC = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
const WORKFLOW = '.github/workflows/billing-local-stack-journey.yml';
let fetchCalls = 0;
const realFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = (async () => { fetchCalls += 1; throw new Error('network is not allowed here'); }) as typeof fetch; });
afterAll(() => { globalThis.fetch = realFetch; assert.equal(fetchCalls, 0, 'an offline test reached for the network'); });

/** The body of one run() branch or helper, from its opening line to the next sibling. */
const between = (from: string, to: string) => {
  const start = SPEC.indexOf(from);
  assert.ok(start > -1, from);
  const end = SPEC.indexOf(to, start + from.length);
  assert.ok(end > start, to);
  return SPEC.slice(start, end);
};

test('mode selection: no mode keeps the three branches, smoke is conversion only, full is all six, typos refused', () => {
  assert.deepEqual(selectRunnerJourneys(undefined).journeys, BILLING_JOURNEYS);
  assert.deepEqual(selectRunnerJourneys('').journeys, BILLING_JOURNEYS);
  assert.deepEqual(selectRunnerJourneys('smoke').journeys, ['conversion']);
  assert.deepEqual(selectRunnerJourneys('full').journeys, [...BILLING_JOURNEYS, ...FULL_MODE_JOURNEYS]);
  for (const typo of ['Full', 'all', ' full', 'full ', 'smoke,full', 'FULL']) {
    assert.throws(() => selectRunnerJourneys(typo), /runner_mode_unknown/, typo);
  }
  assert.match(SPEC, /const \{ journeys: RUN_JOURNEYS \} = selectRunnerJourneys\(env\.BILLING_RUNNER_MODE\);/);
  // Sam's source contract needs the lifecycle loop exactly as it was; full mode adds a second, filtered loop.
  assert.match(SPEC, /\nfor \(const journey of BILLING_JOURNEYS\) if \(RUN_JOURNEYS\.includes\(journey\)\) journeyTest\(journey\);\n/);
  assert.match(SPEC, /\nfor \(const journey of FULL_MODE_JOURNEYS\) if \(RUN_JOURNEYS\.includes\(journey\)\) journeyTest\(journey\);\n/);
  assert.equal(SPEC.match(/journeyTest\(journey\);/g)?.length, 2);
});

test('every runner journey has its own branch, and only portal_expiry and refund_period_end hold steps', () => {
  assert.deepEqual(Object.keys(POLICY_PENDING_STEPS).sort(), ['portal_expiry', 'refund_period_end']);
  for (const journey of RUNNER_JOURNEYS) {
    if (journey !== 'conversion') assert.match(SPEC, new RegExp(`this\\.journey === '${journey}'|// ${journey} `), journey);
    for (const step of REQUIRED_STEPS[journey]) {
      const held = (POLICY_PENDING_STEPS[journey] ?? []).includes(step);
      // A held step is never recorded anywhere; every other step is recorded by some branch.
      if (held) assert.doesNotMatch(SPEC, new RegExp(`steps\\.add\\('${step}'\\)`), `${journey}:${step}`);
      else assert.match(SPEC, new RegExp(`steps\\.add\\('${step}'\\)`), `${journey}:${step}`);
    }
  }
});

test('access after the end is never read: no sign-in, page or access check after the subscription ends', () => {
  const periodEnd = between('  async periodEnd(ending: Obj): Promise<void> {', '\n  }\n');
  for (const forbidden of [/entitlement\(/, /\.account\(/, /goto\(/, /sign-?in/i, /usage\(\)/, /profile\(\)/, /access_expired|history_retained/]) {
    assert.doesNotMatch(periodEnd, forbidden, String(forbidden));
  }
  // Data kept is read from the database only.
  assert.match(periodEnd, /getUserById\(this\.uid\)/);
  assert.match(periodEnd, /steps\.add\('account_retained'\)/);
  // periodEnd is the last thing paidUntilPeriodEnd does, and only it calls periodEnd.
  const until = between('  async paidUntilPeriodEnd(ending: Obj): Promise<void> {', '\n  }\n');
  assert.match(until, /await this\.periodEnd\(ending\);$/);
  assert.equal(SPEC.match(/this\.periodEnd\(/g)?.length, 1);
  // Both ending branches stop at paidUntilPeriodEnd; refund only reads its invoices afterwards.
  const portal = between("} else if (this.journey === 'portal_expiry') {", '    } else {\n      // refund_period_end');
  assert.match(portal, /await this\.paidUntilPeriodEnd\(ending\);\n$/);
  const refund = between('// refund_period_end (Akin', '  /** A renewal on a card that declines');
  const afterRefund = refund.slice(refund.indexOf('await this.paidUntilPeriodEnd(ending);'));
  assert.ok(refund.includes('await this.paidUntilPeriodEnd(ending);'));
  assert.doesNotMatch(afterRefund, /entitlement\(|\.account\(|goto\(|usage\(|profile\(/);
  assert.doesNotMatch(SPEC, /Free · Free/);
  // A pending run fails visibly with its own code; it can never be read as a pass.
  assert.match(SPEC, /result\.result !== PENDING_POLICY, 'access_after_end_policy_pending'/);
});

test('portal recovery repairs billing in Manage billing only, never with an API payment', () => {
  const branch = between("} else if (this.journey === 'portal_recovery') {", "} else if (this.journey === 'portal_expiry') {");
  assert.match(branch, /await this\.failRenewal\(\);/);
  assert.match(branch, /const paid = await this\.poll\(\(\) => this\.stripe\(`invoices\/\$\{failedInvoice\}`\)/);
  assert.match(branch, /await this\.recovered\(paid, failedInvoice\);/);
  // Sam's fa7e7180 return: the card is the one the member just added, never the 4242 card from Checkout, and
  // the recovery charge used it.
  const snapshot = branch.indexOf('const listedBefore = await cards();');
  assert.ok(snapshot > -1 && snapshot < branch.indexOf('await add.click();'), 'cards are listed before Add');
  assert.match(branch, /const newCard = newlyAddedCard\(/);
  assert.match(branch, /recoveryCharge\.payment_method === newCard, 'portal_recovery_not_new_card'/);
  assert.doesNotMatch(branch, /pm\.card\?\.last4 === '4242'/);
  assert.match(branch, /name: 'Manage billing', exact: true/);
  assert.match(branch, /billing\.stripe\.com/);
  assert.doesNotMatch(branch, /\/pay`|invoices\/[^`]*\/pay|'POST', \{ *\}\)/);
  const updated = branch.indexOf("steps.add('portal_payment_method_updated')");
  assert.ok(updated > -1 && updated < branch.indexOf('await this.recovered('), 'the card is added before recovery');
  // The shared recovery helper takes the invoice it is given and never pays one itself.
  assert.doesNotMatch(between('  async recovered(invoice: Obj, failedInvoice: string): Promise<void> {', '\n  }\n'), /this\.stripe\(/);
  assert.match(branch, /portal_recovery_pay_unavailable/);
});

test('failed checkout: a declining test card, an expired session, then one paid subscription', () => {
  const branch = between("} else if (this.journey === 'failed_checkout') {\n      // A declined card", '    } else {\n      checkoutUrl = await invoke();');
  assert.match(branch, /payOnHostedPage\('4000000000000002'\)/);
  assert.match(branch, /checkout\/sessions\/\$\{declined\}\/expire`, 'POST'/);
  assert.match(branch, /sessionOf\(checkoutUrl\) !== declined, 'retry_checkout_refused'/);
  const order = ['declined_checkout', 'no_access_after_decline', 'abandoned_checkout', 'no_access_after_abandon']
    .map(step => branch.indexOf(`steps.add('${step}')`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(order.every(index => index > -1));
  // The declined Checkout is checked before the browser goes to it (Sam's fa7e7180 return).
  assert.match(branch, /const declined = await this\.openCheckout\(await invoke\(\)\);/);
  assert.match(SPEC, /all\.data\.length === 1\s*\n?\s*&& all\.data\[0\]\.id === this\.subscription, 'more_than_one_subscription'/);
});

test('refund: the whole charge, never an amount; the cancellation must be the webhook\'s own follow-up', () => {
  const branch = between('// refund_period_end (Akin', '  /**\n   * The period ends');
  const refundCall = branch.match(/this\.stripe\('refunds', 'POST', \{([^}]*)\}\)/);
  assert.ok(refundCall, 'one refund request');
  assert.doesNotMatch(refundCall![1], /amount/);
  assert.match(branch, /assertFullRefund\(refund, charge\)/);
  assert.match(branch, /isRefundCancellation\(e, \{ subscription: this\.subscription, customer: this\.customer, refundEventId \}\)/);
  assert.match(branch, /assertNoSecondCharge\(/);
});

test('contract helpers: a refund cancellation counts only from this refund event\'s webhook request', () => {
  const ok = { type: 'customer.subscription.updated', livemode: false,
    request: { id: 'req_1', idempotency_key: 'refund-cancel-at-period-end-evt_Refund1' },
    data: { object: { id: 'sub_1', customer: 'cus_1', cancel_at_period_end: true, status: 'active' } } };
  const want = { subscription: 'sub_1', customer: 'cus_1', refundEventId: 'evt_Refund1' };
  assert.equal(isRefundCancellation(ok, want), true);
  const object = ok.data.object;
  for (const wrong of [
    { ...ok, livemode: true }, { ...ok, type: 'customer.subscription.deleted' },
    { ...ok, request: { id: 'req_1', idempotency_key: null } }, { ...ok, request: null },
    { ...ok, request: { id: 'req_1', idempotency_key: 'refund-cancel-at-period-end-evt_Other' } },
    { ...ok, data: { object: { ...object, cancel_at_period_end: false } } },
    { ...ok, data: { object: { ...object, status: 'canceled' } } },
    { ...ok, data: { object: { ...object, id: 'sub_other' } } },
    { ...ok, data: { object: { ...object, customer: 'cus_other' } } }, null, 'evt']) {
    assert.equal(isRefundCancellation(wrong, want), false, JSON.stringify(wrong));
  }
  assert.equal(isRefundCancellation(ok, { ...want, refundEventId: '' }), false);
});

test('contract helpers: only a whole, succeeded, test refund of this charge; only an unpaid, subscription-free failed checkout', () => {
  const full = { object: 'refund', status: 'succeeded', amount: 1000, currency: 'usd', charge: 'ch_1' };
  assertFullRefund(full, 'ch_1');
  for (const wrong of [{ ...full, amount: 500 }, { ...full, amount: 999 }, { ...full, status: 'pending' }, { ...full, status: 'failed' },
    { ...full, charge: 'ch_other' }, { ...full, currency: 'eur' }, { ...full, object: 'charge' }, null]) {
    assert.throws(() => assertFullRefund(wrong, 'ch_1'), /refund_not_full_contract/, JSON.stringify(wrong));
  }
  const open = { livemode: false, status: 'open', payment_status: 'unpaid', subscription: null };
  assertCheckoutGrantedNothing(open, 'open');
  assertCheckoutGrantedNothing({ ...open, status: 'expired' }, 'expired');
  for (const [wrong, status] of [[{ ...open, status: 'complete' }, 'open'], [{ ...open, payment_status: 'paid' }, 'open'],
    [{ ...open, subscription: 'sub_1' }, 'open'], [{ ...open, livemode: true }, 'open'], [open, 'expired'], [null, 'open']] as const) {
    assert.throws(() => assertCheckoutGrantedNothing(wrong, status), /failed_checkout_granted_something/, JSON.stringify(wrong));
  }
});

// A pending receipt exactly as the spec writes it on the local stack.
const RELEASE = 'a'.repeat(40);
const STACK_RUN = 'billing-local-stack-123456-1';
const pendingFor = (journey: keyof typeof REQUIRED_STEPS) => {
  const held: readonly string[] = POLICY_PENDING_STEPS[journey] ?? [];
  const built = receipt(journey, new Set(REQUIRED_STEPS[journey].filter(step => !held.includes(step))));
  return { ...built, failureStage: null, reason: null, cleanup: 'PENDING_STACK_DESTRUCTION',
    result: built.result === 'PASSED' ? 'PENDING_STACK_DESTRUCTION' : built.result,
    billingRowResidue: 'NOT_READ_REQUIRES_STACK_DESTRUCTION_PROOF', testedRelease: RELEASE, stackRun: STACK_RUN };
};
const checks = { stackStopped: 'success', stackDestroyed: 'success', stripeClean: 'success' };
const identityFor = (stackRun: string) => ({ schema: 'billing-local-stack-identity/v1', project: stackRun,
  database: { container: 'c_db', volume: `supabase_db_${stackRun}`, systemIdentifier: '7300000000000000001' },
  containers: ['c_auth', 'c_db'], volumes: [`supabase_config_${stackRun}`, `supabase_db_${stackRun}`], networks: ['n_net'] });
const destroyedFor = (stackRun: string) => ({ schema: 'billing-local-stack-destroyed/v2', project: stackRun,
  databaseSystemIdentifier: '7300000000000000001', identitySha256: stackIdentitySha256(identityFor(stackRun), stackRun),
  containers: 2, volumes: 2, networks: 1, destroyed: true });
const destruction = destroyedFor(STACK_RUN);
const expectedFor = (journey: string) => ({ journey, release: RELEASE, stackRun: STACK_RUN, receiptSha256: 'b'.repeat(64), destruction,
  identity: identityFor(STACK_RUN) });
const combine = (journey: keyof typeof REQUIRED_STEPS, override: Record<string, unknown> = {}) =>
  finaliseLocalStackReceipt([{ ...pendingFor(journey), ...override }], checks, expectedFor(journey));

test('Checkout is validated before navigation: every page.goto of a Checkout URL goes through openCheckout', () => {
  const open = between('  async openCheckout(raw: string | null): Promise<string> {', '\n  }\n');
  const order = ['checkoutSessionFromUrl(raw)', 'assertCheckoutIdentity(await this.stripe(`checkout/sessions/${session}`)', 'await this.page.goto(raw as string);']
    .map(part => open.indexOf(part));
  assert.ok(order.every(index => index > -1) && order[0] < order[1] && order[1] < order[2], 'URL, then provider identity, then navigation');
  // Nowhere else does the browser go to a Checkout URL, and the three Checkout entries all use the helper.
  const gotos = [...SPEC.matchAll(/this\.page\.goto\(([^)]*)\)/g)].map(match => match[1]);
  assert.deepEqual(gotos.filter(arg => !arg.includes('this.targets.app')), ['raw as string']);
  assert.equal(SPEC.match(/await this\.openCheckout\(/g)?.length, 3);
  assert.match(SPEC, /requireFact\(await this\.openCheckout\(answers\[0\]\) === only, 'repeated_click_two_sessions'\);/);
  assert.match(SPEC, /this\.session = await this\.openCheckout\(checkoutUrl\);/);
});

test('contract helpers: a Checkout URL and session are refused before navigation unless they are this member\'s', () => {
  const good = 'https://checkout.stripe.com/c/pay/cs_test_a1B2c3#fragment';
  assert.equal(checkoutSessionFromUrl(good), 'cs_test_a1B2c3');
  for (const [name, raw, code] of [
    ['missing', null, 'checkout_unavailable'],
    ['not a URL', 'checkout', 'checkout_origin'],
    ['http', 'http://checkout.stripe.com/c/pay/cs_test_a1', 'checkout_origin'],
    ['look-alike host', 'https://checkout.stripe.com.evil.example/c/pay/cs_test_a1', 'checkout_origin'],
    ['credentials', 'https://user:pw@checkout.stripe.com/c/pay/cs_test_a1', 'checkout_origin'],
    ['port', 'https://checkout.stripe.com:8443/c/pay/cs_test_a1', 'checkout_origin'],
    ['app origin', 'https://app.example/c/pay/cs_test_a1', 'checkout_origin'],
    ['live session', 'https://checkout.stripe.com/c/pay/cs_live_a1', 'test_checkout_required'],
    ['no session', 'https://checkout.stripe.com/c/pay/', 'test_checkout_required'],
    ['two sessions', 'https://checkout.stripe.com/c/pay/cs_test_a1/cs_test_b2', 'test_checkout_required'],
    ['live beside test', 'https://checkout.stripe.com/c/pay/cs_live_a1/cs_test_b2', 'test_checkout_required'],
  ] as [string, string | null, string][]) {
    assert.throws(() => checkoutSessionFromUrl(raw), new RegExp(`BILLING_JOURNEY:${code}$`), name);
  }
  const app = 'http://127.0.0.1:4173';
  const expected = { session: 'cs_test_a1', customer: 'cus_1', uid: 'u1', app };
  const session = { id: 'cs_test_a1', livemode: false, mode: 'subscription', status: 'open', payment_status: 'unpaid',
    customer: 'cus_1', client_reference_id: 'u1', metadata: { userId: 'u1' },
    success_url: `${app}/account?checkout=success`, cancel_url: `${app}/pricing?checkout=cancelled` };
  assertCheckoutIdentity(session, expected);
  for (const [name, change, code] of [
    ['mismatched session', { id: 'cs_test_other' }, 'checkout_identity'],
    ['live', { livemode: true }, 'checkout_identity'],
    ['payment mode', { mode: 'payment' }, 'checkout_identity'],
    ['other customer', { customer: 'cus_2' }, 'checkout_identity'],
    ['other member', { client_reference_id: 'u2' }, 'checkout_identity'],
    ['metadata for another member', { metadata: { userId: 'u2' } }, 'checkout_identity'],
    ['already complete', { status: 'complete', payment_status: 'paid' }, 'checkout_not_open'],
    ['success elsewhere', { success_url: 'https://evil.example/account' }, 'checkout_return_origin'],
    ['cancel elsewhere', { cancel_url: 'https://evil.example/pricing' }, 'checkout_return_origin'],
    ['no return URL', { success_url: null }, 'checkout_return_origin'],
  ] as [string, Record<string, unknown>, string][]) {
    assert.throws(() => assertCheckoutIdentity({ ...session, ...change }, expected), new RegExp(`BILLING_JOURNEY:${code}$`), name);
  }
  assert.throws(() => assertCheckoutIdentity(null, expected), /checkout_identity/);
});

test('contract helpers: the portal card is the newly added one; no second charge needs a complete, bound read', () => {
  const before = ['pm_checkout4242', 'pm_bad'];
  const page = (data: unknown[], hasMore = false) => ({ data, has_more: hasMore });
  const original = { id: 'pm_checkout4242', card: { last4: '4242' } };
  const bad = { id: 'pm_bad', card: { last4: '0341' } };
  assert.equal(newlyAddedCard(page([original, bad, { id: 'pm_new', card: { last4: '4242' } }]), before, 'pm_bad'), 'pm_new');
  for (const [name, listed] of [
    ['no-op Add: only the original 4242 card', page([original, bad])],
    ['new card is not 4242', page([original, bad, { id: 'pm_new', card: { last4: '1881' } }])],
    ['two new cards', page([original, bad, { id: 'pm_new', card: { last4: '4242' } }, { id: 'pm_other', card: { last4: '4242' } }])],
    ['incomplete page', page([original, bad, { id: 'pm_new', card: { last4: '4242' } }], true)],
    ['unreadable', null],
  ] as [string, unknown][]) {
    assert.throws(() => newlyAddedCard(listed, before, 'pm_bad'), /portal_card_not_added|payment_method_page_incomplete/, name);
  }

  const expected = { customer: 'cus_1', subscription: 'sub_1', firstInvoice: 'in_first' };
  const invoice = (id: string, amount: number, change: Record<string, unknown> = {}) =>
    ({ id, livemode: false, customer: 'cus_1', subscription: 'sub_1', amount_paid: amount, ...change });
  assertNoSecondCharge(page([invoice('in_first', 1000), invoice('in_zero', 0)]), expected);
  for (const [name, listed, code] of [
    ['empty list', page([]), 'original_invoice_missing'],
    ['original missing', page([invoice('in_zero', 0)]), 'original_invoice_missing'],
    ['original not the full payment', page([invoice('in_first', 1)]), 'original_invoice_missing'],
    ['incomplete page', page([invoice('in_first', 1000)], true), 'invoice_page_incomplete'],
    ['unreadable', null, 'invoice_page_incomplete'],
    ['foreign customer', page([invoice('in_first', 1000), invoice('in_x', 0, { customer: 'cus_2' })]), 'invoice_identity'],
    ['foreign subscription', page([invoice('in_first', 1000), invoice('in_x', 0, { subscription: 'sub_2' })]), 'invoice_identity'],
    ['live invoice', page([invoice('in_first', 1000, { livemode: true })]), 'invoice_identity'],
    ['second charge', page([invoice('in_first', 1000), invoice('in_renewal', 1000)]), 'second_charge_after_refund'],
  ] as [string, unknown, string][]) {
    assert.throws(() => assertNoSecondCharge(listed, expected), new RegExp(`BILLING_JOURNEY:${code}$`), name);
  }
});

test('refund branch: a paid recording first, so the period end always checks saved data', () => {
  const branch = between("      // refund_period_end (Akin, 2026-11-12)", "\n  /** A renewal on a card that declines");
  const recorded = branch.indexOf('await this.record();');
  assert.ok(recorded > -1 && recorded < branch.indexOf("this.stripe('refunds', 'POST'"), 'recording before the refund');
  assert.match(branch, /assertNoSecondCharge\(await this\.stripe\(`invoices\?/);
  const end = between('  async periodEnd(ending: Obj): Promise<void> {', '\n  }\n');
  assert.match(end, /requireFact\(this\.savedSession, 'saved_data_not_seeded'\);/);
  assert.doesNotMatch(end, /if \(this\.savedSession\)/);
});

test('combined receipt: a held run is never PASSED, and its only defect is policy_pending', () => {
  for (const journey of RUNNER_JOURNEYS) {
    const combined = combine(journey);
    if (POLICY_PENDING_STEPS[journey]) {
      assert.equal(combined.result, 'NOT_PROVEN', journey);
      assert.deepEqual(combined.defects, ['policy_pending'], journey);
    } else {
      assert.equal(combined.result, 'PASSED', `${journey} ${JSON.stringify(combined.defects)}`);
    }
  }
});

test('combined receipt negative controls: PENDING_POLICY steps only where held, and only in a held receipt', () => {
  const portal = pendingFor('portal_expiry');
  // A held step marked PASSED (someone asserted it) is refused.
  const asserted = portal.steps.map(row => row.result === PENDING_POLICY ? { ...row, result: 'PASSED' } : row);
  assert.ok(combine('portal_expiry', { steps: asserted }).defects.includes('steps_not_all_passed'));
  // A step that is not held marked PENDING_POLICY is refused.
  const dodged = portal.steps.map(row => row.step === 'portal_cancelled' ? { ...row, result: PENDING_POLICY } : row);
  assert.ok(combine('portal_expiry', { steps: dodged }).defects.includes('steps_not_all_passed'));
  // A held step in a receipt that does not say PENDING_POLICY is refused.
  assert.ok(combine('portal_expiry', { result: 'PENDING_STACK_DESTRUCTION' }).defects.includes('steps_not_all_passed'));
  // A journey with no held steps cannot claim one.
  const conversion = pendingFor('conversion');
  const claimed = combine('conversion', { result: PENDING_POLICY,
    steps: conversion.steps.map(row => row.step === 'next_recording' ? { ...row, result: PENDING_POLICY } : row) });
  assert.ok(claimed.defects.includes('steps_not_all_passed') && claimed.result === 'NOT_PROVEN');
});

const fullPlanReader = (path: string) => {
  // Every prerequisite present and the workflow able to dispatch every phase: the best case a dry run can see.
  if (path === WORKFLOW) {
    const doc = parse(readFileSync(WORKFLOW, 'utf8'));
    doc.on.workflow_dispatch.inputs.journey.options = PHASES.map(phase => phase.id);
    doc.jobs.journey.steps.push({ run: 'if [ "$JOURNEY" = \'paid_value_loop\' ]; then playwright test -c playwright.paid-value-loop.config.ts; fi' });
    return JSON.stringify(doc); // JSON is YAML
  }
  if (path.endsWith('appRuntimeConfig.ts')) return 'export const isLocalPaymentsSandbox = true;';
  if (path.endsWith('refund.ts')) return 'refund-cancel-at-period-end-';
  if (path.endsWith('stripe-webhook/index.ts')) return 'case "charge.refunded"';
  return '';
};

test('dry run: plans only, makes no call, never authorizes, and cannot say READY while access after end is held', () => {
  for (const mode of MODES) {
    const plan = planRun(mode);
    assert.equal(plan.dryRun, true);
    assert.equal(plan.stripeCalls, 0);
    assert.equal(plan.authorizesExecution, false);
    // READY only when every phase is READY and none holds a step; full mode holds two, so it is never READY.
    const allReady = plan.phases.every(phase => phase.status === 'READY');
    assert.equal(plan.result === 'READY', allReady && plan.phases.every(phase => phase.pendingPolicySteps.length === 0), mode);
    if (!allReady) assert.equal(plan.result, 'BLOCKED_PREREQUISITE', mode);
  }
  assert.notEqual(planRun('full').result, 'READY');
  const best = planRun('full', fullPlanReader);
  assert.ok(best.phases.every(phase => phase.status === 'READY'), JSON.stringify(best.phases.map(p => [p.id, p.blockedBy])));
  assert.equal(best.result, 'READY_WITH_PENDING_POLICY');
  assert.equal(best.authorizesExecution, false);
  assert.ok(best.openQuestions.some(question => question.startsWith('access after a membership ends')));
  assert.equal(planRun('smoke', fullPlanReader).result, 'READY');
  assert.throws(() => planRun('bogus'), /mode_unknown/);
  // Whatever branch this runs on (alone or stacked with the gate and refund handler), each phase is blocked by
  // exactly the prerequisites that the committed files here do not satisfy, and by nothing else.
  const here = planRun('full');
  for (const phase of here.phases) {
    const spec = PHASES.find(entry => entry.id === phase.id)!;
    const missing = spec.requires.filter(name => !PREREQUISITES[name].check(readRepoFile));
    assert.deepEqual(phase.blockedBy.map(entry => entry.prerequisite).filter(name => name !== 'workflow_dispatch'), missing, phase.id);
  }
  // #1822 owns the paid loop, so it stays blocked until its spec and dispatch exist.
  assert.ok(here.phases.find(phase => phase.id === 'paid_value_loop')!.blockedBy.length > 0);
  assert.deepEqual(Object.keys(PREREQUISITES).sort(), ['local_checkout_exception', 'paid_loop_spec', 'payment_gate', 'refund_handler']);
});

test('every Stripe write in the runner is on the allowlist, and every phase\'s writes are too', () => {
  const writes = new Set<string>();
  for (const [, , path, method] of SPEC.matchAll(/this\.stripe\((['`])(.+?)\1, '(POST|DELETE)'/g)) {
    const normal = path.split('?')[0].replace(/\$\{[^}]+\}/g, ':id').split('/')
      .map(part => /^(pm|cus|sub|in|cs|ch|clock)_/.test(part) ? ':id' : part).join('/');
    writes.add(`${method} ${normal}`);
  }
  assert.ok(writes.size >= 8, [...writes].join(', '));
  for (const write of writes) assert.ok(STRIPE_WRITE_ALLOWLIST.includes(write), write);
  for (const phase of PHASES) for (const write of phase.stripeWrites) assert.ok(STRIPE_WRITE_ALLOWLIST.includes(write), `${phase.id} ${write}`);
  // Never a raw charge, payout, transfer, immediate cancel or deletion of a subscription.
  assert.doesNotMatch(SPEC, /this\.stripe\([`'](charges|payouts|transfers)\b[^)]*'POST'/);
  assert.doesNotMatch(SPEC, /this\.stripe\(`subscriptions\/[^`]*`, 'DELETE'/);
});

/** What a real run hands the mode finaliser for one local phase: combined receipt, raw receipt, destruction proof, identity. */
const evidenceFor = (journey: keyof typeof REQUIRED_STEPS, stack = 1, rawOverride: Record<string, unknown> = {}) => {
  const stackRun = `billing-local-stack-123456-${stack}`;
  // As the workflow writes it: jq's array of the spec's receipt attachments, holding exactly one.
  const rawReceipt = `${JSON.stringify([{ ...pendingFor(journey), stackRun, ...rawOverride }], null, 2)}\n`;
  const proof = destroyedFor(stackRun);
  const identity = identityFor(stackRun);
  const combined = finaliseLocalStackReceipt(JSON.parse(rawReceipt), checks, { journey, release: RELEASE, stackRun,
    receiptSha256: createHash('sha256').update(rawReceipt).digest('hex'), destruction: proof, identity });
  return { phase: journey, combined, rawReceipt, destruction: proof, identity };
};

test('mode result: each phase is re-validated from its evidence; held phases are PENDING_POLICY, never PASSED', () => {
  const fullIds = PHASES.filter(phase => phase.modes.includes('full')).map(phase => phase.id);
  const local = RUNNER_JOURNEYS.map((journey, i) => evidenceFor(journey, i + 1));
  const external = { phase: 'paid_value_loop', rawReceipt: JSON.stringify({ schema: 'billing-user-journey/v1', journey: 'paid_value_loop', result: 'PASSED' }) };
  const all = [...local, external];
  assert.deepEqual(all.map(item => item.phase).sort(), [...fullIds].sort());
  const full = finaliseModeReceipt('full', all, { release: RELEASE });
  const byPhase = Object.fromEntries(full.phases.map(phase => [phase.phase, phase]));
  for (const journey of RUNNER_JOURNEYS) {
    assert.equal(byPhase[journey].result, POLICY_PENDING_STEPS[journey] ? PENDING_POLICY : 'PASSED', `${journey} ${byPhase[journey].why}`);
  }
  // The paid loop's step contract belongs to #1822. Until it is committed here, nothing can prove that phase,
  // so full mode is NOT_PROVEN however its receipt reads.
  assert.deepEqual(EXTERNAL_REQUIRED_STEPS, {});
  assert.deepEqual(byPhase.paid_value_loop.why, ['external_contract_undefined']);
  assert.equal(full.result, 'NOT_PROVEN');
  assert.equal(finaliseModeReceipt('smoke', [evidenceFor('conversion')], { release: RELEASE }).result, 'PASSED');
});

test('mode result reads the raw receipt as the workflow writes it: one receipt inside a JSON array, hashed as bytes', () => {
  const smoke = (entry: unknown) => finaliseModeReceipt('smoke', [entry], { release: RELEASE });
  const good = evidenceFor('conversion');
  assert.ok(good.rawReceipt.startsWith('[\n'), 'the fixture is the workflow array');
  assert.equal(smoke(good).result, 'PASSED');
  assert.equal(smoke({ ...good, rawReceipt: Buffer.from(good.rawReceipt) }).result, 'PASSED', 'the file bytes as read');
  // Each shape is hashed into its own combined receipt, so only the shape can fail it.
  const withRaw = (text: string) => ({ ...good, rawReceipt: text,
    combined: { ...good.combined, rawReceiptSha256: createHash('sha256').update(text).digest('hex') } });
  const element = JSON.parse(good.rawReceipt)[0];
  const shapes: [string, string, string][] = [
    ['the bare receipt object, not the workflow array', JSON.stringify(element), 'raw_receipt_not_workflow_array'],
    ['an empty array (no receipt attached)', '[]', 'raw_receipt_count'],
    ['two receipts (a retried test attaches twice)', JSON.stringify([element, element]), 'raw_receipt_count'],
    ['the workflow placeholder when no receipt was written', 'null', 'raw_receipt_not_workflow_array'],
  ];
  for (const [name, text, defect] of shapes) {
    const result = smoke(withRaw(text));
    assert.equal(result.result, 'NOT_PROVEN', name);
    assert.deepEqual(result.phases[0].why, [defect], name);
  }
});

test('workflow artifacts to mode result: the files a run uploads re-validate to PASSED, end to end, offline', () => {
  // Sam's ac08d973 review reproduced a valid combined receipt becoming NOT_PROVEN (receipt_not_an_object) once the
  // mode finaliser read the real artifact. This runs the workflow's own jq extraction and the combined
  // finaliser's CLI on a Playwright report shaped like a real run, then hands the files to the mode finaliser.
  // No Docker, no Stripe, no network: jq and node only, in a temporary directory.
  const workflow = readFileSync(WORKFLOW, 'utf8');
  const extract = workflow.match(/jq '([^']+)' \\\n\s+"\$report" > billing-local-stack-receipt\.json/);
  assert.ok(extract, 'the workflow extracts the receipt with jq into billing-local-stack-receipt.json');
  assert.match(workflow, /--receipt billing-local-stack-receipt\.json --destruction billing-local-stack-destroyed\.json \\\n\s+--identity billing-local-stack-identity\.json/);
  const dir = mkdtempSync(join(tmpdir(), 'billing-mode-artifacts-'));
  const run = (attachments: number) => {
    const receiptBody = Buffer.from(JSON.stringify(pendingFor('conversion'))).toString('base64');
    const attachment = { name: 'billing-user-journey.json', contentType: 'application/json', body: receiptBody };
    const report = { suites: [{ title: 'journey.billing.spec.ts', specs: [{ title: 'billing conversion: x', tests: [{ results: [
      { attachments: [...Array.from({ length: attachments }, () => attachment), { name: 'trace', contentType: 'application/zip', path: 'trace.zip' }] },
    ] }] }] }] };
    const file = (name: string) => join(dir, name);
    writeFileSync(file('playwright-report.json'), JSON.stringify(report));
    const jq = spawnSync('jq', [extract![1], file('playwright-report.json')], { encoding: 'utf8' });
    assert.equal(jq.status, 0, jq.stderr);
    writeFileSync(file('billing-local-stack-receipt.json'), jq.stdout);
    writeFileSync(file('billing-local-stack-identity.json'), JSON.stringify(identityFor(STACK_RUN)));
    writeFileSync(file('billing-local-stack-destroyed.json'), JSON.stringify(destroyedFor(STACK_RUN)));
    const cli = spawnSync(process.execPath, ['tests/billing/user-journey/localStackReceipt.mjs',
      '--receipt', file('billing-local-stack-receipt.json'), '--destruction', file('billing-local-stack-destroyed.json'),
      '--identity', file('billing-local-stack-identity.json'), '--journey', 'conversion', '--release', RELEASE, '--run', STACK_RUN,
      '--stack-stopped', 'success', '--stack-destroyed', 'success', '--stripe-clean', 'success'], { encoding: 'utf8', env: {} });
    const combined = JSON.parse(cli.stdout);
    const bytes = readFileSync(file('billing-local-stack-receipt.json'));
    const entry = { phase: 'conversion', combined, rawReceipt: bytes,
      destruction: JSON.parse(readFileSync(file('billing-local-stack-destroyed.json'), 'utf8')),
      identity: JSON.parse(readFileSync(file('billing-local-stack-identity.json'), 'utf8')) };
    return { cli, combined, bytes, entry };
  };
  try {
    const one = run(1);
    assert.equal(one.cli.status, 0, one.cli.stdout);
    assert.equal(one.combined.result, 'PASSED');
    assert.equal(one.combined.rawReceiptSha256, createHash('sha256').update(one.bytes).digest('hex'), 'the combined receipt binds the array bytes');
    // The defect Sam reproduced: the artifact is an array, so reading it as one receipt object fails.
    assert.deepEqual(journeyReceiptDefects(JSON.parse(one.bytes.toString('utf8')), { journey: 'conversion', release: RELEASE, stackRun: STACK_RUN }), ['receipt_not_an_object']);
    assert.equal(finaliseModeReceipt('smoke', [one.entry], { release: RELEASE }).result, 'PASSED');
    assert.equal(finaliseModeReceipt('smoke', [{ ...one.entry, rawReceipt: one.bytes.toString('utf8') }], { release: RELEASE }).result, 'PASSED');
    const edited = Buffer.concat([one.bytes, Buffer.from(' ')]);
    assert.deepEqual(finaliseModeReceipt('smoke', [{ ...one.entry, rawReceipt: edited }], { release: RELEASE }).phases[0].why, ['raw_receipt_hash']);
    // A receipt attached twice is refused by both finalisers.
    const two = run(2);
    assert.equal(two.combined.result, 'NOT_PROVEN');
    assert.ok(two.combined.defects.includes('receipt_count'), two.combined.defects.join(','));
    const twice = finaliseModeReceipt('smoke', [two.entry], { release: RELEASE });
    assert.equal(twice.result, 'NOT_PROVEN');
    assert.ok(twice.phases[0].why.includes('raw_receipt_count'), twice.phases[0].why.join(','));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mode result negative controls: a bare or summary-only PASSED, or evidence from another run, never passes', () => {
  const smoke = (entries: unknown, release = RELEASE) => finaliseModeReceipt('smoke', entries, { release });
  const good = evidenceFor('conversion');
  // Sam's fa7e7180 return: the bare receipt and the bare combined summary.
  assert.equal(smoke([{ journey: 'conversion', result: 'PASSED' }]).result, 'NOT_PROVEN');
  assert.equal(smoke([{ phase: 'conversion', result: 'PASSED' }]).result, 'NOT_PROVEN');
  assert.equal(smoke([good.combined]).result, 'NOT_PROVEN');
  assert.equal(smoke([{ phase: 'conversion', combined: good.combined }]).result, 'NOT_PROVEN');
  const why = (entry: unknown) => smoke([entry]).phases[0].why;
  const cases: [string, unknown, string][] = [
    ['raw receipt edited after combining', { ...good, rawReceipt: good.rawReceipt.replace('"conversion"', '"conversion" ') }, 'raw_receipt_hash'],
    ['steps missing from the raw receipt', evidenceFor('conversion', 1, { steps: [] }), 'steps_not_all_passed'],
    ['raw receipt for another stack', evidenceFor('conversion', 1, { stackRun: 'billing-local-stack-999-9' }), 'stack_run_mismatch'],
    ['raw receipt for another release', evidenceFor('conversion', 1, { testedRelease: 'c'.repeat(40) }), 'release_mismatch'],
    ['cleanup not pending destruction', evidenceFor('conversion', 1, { cleanup: 'FAILED' }), 'cleanup_not_pending'],
    ['failure recorded', evidenceFor('conversion', 1, { failureStage: 'checkout', reason: 'x' }), 'failure_recorded'],
    ['combined summary with an extra field', { ...good, combined: { ...good.combined, note: 'ok' } }, 'combined_shape'],
    ['combined summary for another journey', { ...good, combined: { ...good.combined, journey: 'renewal_recovery' } }, 'combined_journey'],
    ['combined summary for another release', { ...good, combined: { ...good.combined, release: 'c'.repeat(40) } }, 'combined_release'],
    ['teardown not proven', { ...good, combined: { ...good.combined, stackDestroyed: 'NOT_PROVEN' } }, 'combined_stackDestroyed'],
    ['destruction proof missing', { ...good, destruction: undefined }, 'destruction_proof_missing'],
    ['destruction proof for another stack', { ...good, destruction: { ...destruction, project: 'billing-local-stack-1-1' } }, 'destruction_not_this_run'],
    ['identity list not handed over', { ...good, identity: undefined }, 'stack_identity_invalid'],
    ['identity list edited after the run', { ...good, identity: { ...good.identity, containers: ['c_db'] } }, 'destruction_identity_mismatch'],
    ['combined summary naming another list', { ...good, combined: { ...good.combined, stackIdentitySha256: 'c'.repeat(64) } }, 'combined_identity'],
    ['raw receipt unreadable', { ...good, rawReceipt: 'not json' }, 'raw_receipt_unreadable'],
    ['raw receipt bytes not UTF-8', { ...good, rawReceipt: Uint8Array.from([0x5b, 0xff, 0x5d]) }, 'raw_receipt_unreadable'],
  ];
  for (const [name, entry, expected] of cases) {
    const result = smoke([entry]);
    assert.equal(result.result, 'NOT_PROVEN', name);
    assert.ok(why(entry).includes(expected), `${name}: ${why(entry)}`);
  }
  assert.equal(smoke([good], 'c'.repeat(40)).result, 'NOT_PROVEN', 'evidence from another release');
  assert.equal(smoke([good], 'not-a-sha').result, 'NOT_PROVEN', 'no release to bind to');

  const local = RUNNER_JOURNEYS.map((journey, i) => evidenceFor(journey, i + 1));
  const full = (entries: unknown) => finaliseModeReceipt('full', entries, { release: RELEASE });
  const held = local.find(item => item.phase === 'portal_expiry')!;
  const asserted = JSON.parse(held.rawReceipt)[0];
  asserted.result = 'PENDING_STACK_DESTRUCTION';
  asserted.steps = asserted.steps.map((row: { step: string; result: string }) => ({ ...row, result: 'PASSED' }));
  const fullCases: [string, unknown][] = [
    ['missing phase', local.filter(item => item.phase !== 'failed_checkout')],
    ['duplicate phase', [...local, evidenceFor('failed_checkout', 20)]],
    ['unknown phase', [...local, { ...evidenceFor('conversion', 21), phase: 'invented' }]],
    ['two phases on one stack', local.map(item => item.phase === 'portal_recovery' ? evidenceFor('portal_recovery', 1) : item)],
    ['held phase asserts its held steps', local.map(item => item.phase === 'portal_expiry'
      ? evidenceFor('portal_expiry', 3, { result: asserted.result, steps: asserted.steps }) : item)],
    ['held combined receipt with another defect', local.map(item => item.phase === 'portal_expiry'
      ? { ...item, combined: { ...item.combined, defects: ['policy_pending', 'release_mismatch'] } } : item)],
    ['not a list', 'receipts'],
  ];
  for (const [name, entries] of fullCases) {
    const result = full(entries);
    assert.equal(result.result, 'NOT_PROVEN', name);
    if (name !== 'missing phase' && name !== 'not a list') {
      // Every full run is NOT_PROVEN anyway while the paid loop has no contract; prove each case fails on its own.
      assert.ok(result.problems.length > 0 || result.phases.some(phase => phase.phase !== 'paid_value_loop' && phase.result === 'NOT_PROVEN'), name);
    }
  }
  assert.equal(smoke([{ ...evidenceFor('conversion'), phase: 'renewal_recovery' }]).result, 'NOT_PROVEN');
  assert.throws(() => finaliseModeReceipt('all', local, { release: RELEASE }), /mode_unknown/);
});

test('the workflow can dispatch the three new branches in full mode, and not the paid loop it does not own', () => {
  const doc = parse(readFileSync(WORKFLOW, 'utf8'));
  assert.deepEqual(doc.on.workflow_dispatch.inputs.journey.options, [...RUNNER_JOURNEYS]);
  const step = doc.jobs.journey.steps.find((entry: { name?: string }) => entry.name === 'Run the billing journey against the local stack');
  assert.equal(step.env.BILLING_RUNNER_MODE, 'full');
  assert.match(step.run, /-g "billing \$\{JOURNEY\}:"/);
  assert.ok(!doc.on.workflow_dispatch.inputs.journey.options.includes('paid_value_loop'), 'the paid loop is #1822\'s to wire');
});
