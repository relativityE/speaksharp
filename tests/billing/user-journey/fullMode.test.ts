// Offline controls for the runner's full mode. Nothing here reaches a network, reads a key or starts a run:
// fetch is replaced by a trap for the whole file, and every check reads committed source or pure functions.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, test } from 'vitest';
import { parse } from 'yaml';
import { selectRunnerJourneys, receipt, isRefundCancellation, assertFullRefund, assertCheckoutGrantedNothing,
  BILLING_JOURNEYS, FULL_MODE_JOURNEYS, RUNNER_JOURNEYS, REQUIRED_STEPS, POLICY_PENDING_STEPS, PENDING_POLICY } from './contract';
import { finaliseLocalStackReceipt } from './localStackReceipt.mjs';
import { MODES, PHASES, PREREQUISITES, STRIPE_WRITE_ALLOWLIST, planRun, finaliseModeReceipt } from './runnerPlan.mjs';

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
  assert.match(branch, /await this\.recovered\(await this\.poll\(\(\) => this\.stripe\(`invoices\/\$\{failedInvoice\}`\)/);
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
  assert.match(SPEC, /all\.data\.length === 1\s*\n?\s*&& all\.data\[0\]\.id === this\.subscription, 'more_than_one_subscription'/);
});

test('refund: the whole charge, never an amount; the cancellation must be the webhook\'s own follow-up', () => {
  const branch = between('// refund_period_end (Akin', '  /**\n   * The period ends');
  const refundCall = branch.match(/this\.stripe\('refunds', 'POST', \{([^}]*)\}\)/);
  assert.ok(refundCall, 'one refund request');
  assert.doesNotMatch(refundCall![1], /amount/);
  assert.match(branch, /assertFullRefund\(refund, charge\)/);
  assert.match(branch, /isRefundCancellation\(e, \{ subscription: this\.subscription, customer: this\.customer, refundEventId \}\)/);
  assert.match(branch, /'second_charge_after_refund'/);
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
const destruction = { schema: 'billing-local-stack-destroyed/v1', project: STACK_RUN, databaseSystemIdentifier: '7300000000000000001',
  containers: 9, volumes: 3, networks: 1, destroyed: true };
const expectedFor = (journey: string) => ({ journey, release: RELEASE, stackRun: STACK_RUN, receiptSha256: 'b'.repeat(64), destruction });
const combine = (journey: keyof typeof REQUIRED_STEPS, override: Record<string, unknown> = {}) =>
  finaliseLocalStackReceipt([{ ...pendingFor(journey), ...override }], checks, expectedFor(journey));

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
    assert.notEqual(plan.result, 'READY', `${mode} on this branch is blocked`);
  }
  const best = planRun('full', fullPlanReader);
  assert.ok(best.phases.every(phase => phase.status === 'READY'), JSON.stringify(best.phases.map(p => [p.id, p.blockedBy])));
  assert.equal(best.result, 'READY_WITH_PENDING_POLICY');
  assert.equal(best.authorizesExecution, false);
  assert.ok(best.openQuestions.some(question => question.startsWith('access after a membership ends')));
  assert.equal(planRun('smoke', fullPlanReader).result, 'READY');
  assert.throws(() => planRun('bogus'), /mode_unknown/);
  // On this branch: the refund handler and the payment gate live on other local branches, so those phases block.
  const here = planRun('full');
  const blocked = (id: string) => here.phases.find(phase => phase.id === id)!.blockedBy.map(entry => entry.prerequisite);
  assert.ok(blocked('refund_period_end').includes('refund_handler'));
  assert.ok(blocked('portal_recovery').includes('payment_gate'));
  assert.ok(blocked('paid_value_loop').includes('paid_loop_spec'));
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

test('mode result: PASSED only when every phase passed; held phases make it PENDING_POLICY, never PASSED', () => {
  const combinedFor = (journey: keyof typeof REQUIRED_STEPS) => combine(journey);
  const fullIds = PHASES.filter(phase => phase.modes.includes('full')).map(phase => phase.id);
  const external = { schema: 'billing-user-journey/v1', journey: 'paid_value_loop', result: 'PASSED' };
  const all = [...RUNNER_JOURNEYS.map(combinedFor), external];
  assert.deepEqual(all.map(item => item.journey).sort(), [...fullIds].sort());
  const full = finaliseModeReceipt('full', all);
  assert.equal(full.result, PENDING_POLICY, JSON.stringify(full));
  assert.deepEqual(full.phases.filter(phase => phase.result === PENDING_POLICY).map(phase => phase.phase).sort(), ['portal_expiry', 'refund_period_end']);
  assert.equal(finaliseModeReceipt('smoke', [combinedFor('conversion')]).result, 'PASSED');

  const cases: [string, unknown[]][] = [
    ['missing phase', all.filter(item => item.journey !== 'failed_checkout')],
    ['duplicate phase', [...all, combinedFor('failed_checkout')]],
    ['unknown phase', [...all, { journey: 'invented', result: 'PASSED' }]],
    ['other defect beside policy_pending', all.map(item => item.journey === 'portal_expiry' ? { ...item, defects: ['policy_pending', 'release_mismatch'] } : item)],
    ['held phase claims PASSED', all.map(item => item.journey === 'refund_period_end' ? { ...item, result: 'PASSED', defects: [] } : item)],
    ['teardown not proven', all.map(item => item.journey === 'portal_expiry' ? { ...item, stackDestroyed: 'NOT_PROVEN' } : item)],
    ['phase not proven', all.map(item => item.journey === 'portal_recovery' ? { ...item, result: 'NOT_PROVEN' } : item)],
    ['not a list', 'receipts' as unknown as unknown[]],
  ];
  for (const [name, receipts] of cases) assert.equal(finaliseModeReceipt('full', receipts).result, 'NOT_PROVEN', name);
  assert.equal(finaliseModeReceipt('smoke', [{ ...combinedFor('conversion'), journey: 'renewal_recovery' }]).result, 'NOT_PROVEN');
  assert.throws(() => finaliseModeReceipt('all', all), /mode_unknown/);
});

test('the workflow can dispatch the three new branches in full mode, and not the paid loop it does not own', () => {
  const doc = parse(readFileSync(WORKFLOW, 'utf8'));
  assert.deepEqual(doc.on.workflow_dispatch.inputs.journey.options, [...RUNNER_JOURNEYS]);
  const step = doc.jobs.journey.steps.find((entry: { name?: string }) => entry.name === 'Run the billing journey against the local stack');
  assert.equal(step.env.BILLING_RUNNER_MODE, 'full');
  assert.match(step.run, /-g "billing \$\{JOURNEY\}:"/);
  assert.ok(!doc.on.workflow_dispatch.inputs.journey.options.includes('paid_value_loop'), 'the paid loop is #1822\'s to wire');
});
