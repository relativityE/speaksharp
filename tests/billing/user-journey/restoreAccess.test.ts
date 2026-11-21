// @vitest-environment node
/**
 * Offline controls for J9.b's `restore_access` checks (restoreAccess.ts) and their wiring in the billing spec. No browser,
 * account, Stripe call or network: each check must refuse the failure it exists to catch. Not journey acceptance.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertTakeReadable, assertHistoryWalled, assertHistoryRestored, assertSingleCharge, portalShowsPlan } from './restoreAccess';
import { REQUIRED_STEPS, FULL_MODE_JOURNEYS, fixtureCustomerFields, receipt, safeFailureReason, selectRunnerJourneys } from './contract';
import { PHASES, STRIPE_WRITE_ALLOWLIST, workflowDispatch, readRepoFile } from './runnerPlan.mjs';
import { sessionFactsFromRows, type SessionRowFacts } from '../../live/helpers/rwtNavigationRows';

const TAKE = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const reason = (run: () => unknown) => { try { run(); return 'no_failure'; } catch (error) { return safeFailureReason(error); } };
const row = (id: string, over: Record<string, unknown> = {}) => ({ id, status: 'completed', transcript_state: 'available',
  transcript: 'hello there from the trial', idempotency_key: `k-${id}`, created_at: '2026-11-21T22:00:00Z', ...over });
const facts = (...rows: unknown[]): SessionRowFacts[] => sessionFactsFromRows(rows)!;

describe('J9.b steps', () => {
  it('restore_access is a full-mode journey with its own fixed steps, and its receipt passes only with all of them', () => {
    expect(FULL_MODE_JOURNEYS).toContain('restore_access');
    expect(selectRunnerJourneys('full').journeys).toContain('restore_access');
    expect(selectRunnerJourneys('smoke').journeys).not.toContain('restore_access');
    const steps = REQUIRED_STEPS.restore_access;
    expect(steps).toEqual(['trial_granted', 'pre_expiry_take', 'pre_expiry_progress', 'trial_expired', 'history_walled',
      'hosted_checkout', 'first_invoice', 'stripe_delivery', 'paid_entitlement', 'returned_to_app', 'single_charge', 'paid_ui',
      'history_restored', 'portal_plan', 'next_recording', 'cleanup']);
    expect(receipt('restore_access', new Set(steps))).toMatchObject({ journey: 'restore_access', stripeMode: 'test', result: 'PASSED' });
    for (const missing of steps) {
      expect({ missing, result: receipt('restore_access', new Set(steps.filter((s) => s !== missing))).result }).toEqual({ missing, result: 'INCOMPLETE' });
    }
  });

  it('pays through the same hosted Checkout as conversion, with the fixture\'s own email on the test Customer', () => {
    const f = { clock: 'clock_1', email: 'rwt-journey-billing-x@example.com', marker: 'rwt-journey-billing-x' };
    expect(fixtureCustomerFields('restore_access', f)).toEqual(fixtureCustomerFields('conversion', f));
  });

  it('is planned as a test-mode browser branch that writes nothing beyond the run\'s own fixtures', () => {
    const phase = PHASES.find((p) => p.id === 'restore_access')!;
    expect(phase).toMatchObject({ modes: ['full'], grep: 'billing restore_access:', testCards: ['4242424242424242'],
      events: ['checkout.session.completed'] });
    expect(phase.requires).toEqual(['local_checkout_exception', 'payment_gate']);
    expect(phase.stripeWrites.every((w) => STRIPE_WRITE_ALLOWLIST.includes(w))).toBe(true);
    expect(phase.stripeWrites).not.toContain('POST refunds');
    expect(workflowDispatch(readRepoFile).options).toContain('restore_access');
  });
});

describe('the take saved in the trial', () => {
  it('is readable only as one completed row with a transcript', () => {
    expect(reason(() => assertTakeReadable(facts(row(TAKE)), TAKE, 'c'))).toBe('no_failure');
    expect(reason(() => assertTakeReadable(null, TAKE, 'c'))).toBe('c');
    expect(reason(() => assertTakeReadable(facts(row(OTHER)), TAKE, 'c'))).toBe('c');
    expect(reason(() => assertTakeReadable(facts(row(TAKE, { status: 'recording' })), TAKE, 'c'))).toBe('c');
    expect(reason(() => assertTakeReadable(facts(row(TAKE, { transcript: '   ' })), TAKE, 'c'))).toBe('c');
    expect(reason(() => assertTakeReadable(facts(row(TAKE)), '', 'c'))).toBe('c');
    // The parser already refuses a repeated id; the check refuses one too, if handed facts directly.
    const once = facts(row(TAKE))[0];
    expect(reason(() => assertTakeReadable([once, once], TAKE, 'c'))).toBe('c');
  });
});

describe('walled after the trial ends', () => {
  it('needs a readable empty member read while the kept row still exists', () => {
    expect(reason(() => assertHistoryWalled([], facts(row(TAKE)), TAKE))).toBe('no_failure');
    expect(reason(() => assertHistoryWalled(null, facts(row(TAKE)), TAKE))).toBe('walled_history_unreadable');
    expect(reason(() => assertHistoryWalled(facts(row(TAKE)), facts(row(TAKE)), TAKE))).toBe('history_readable_after_trial');
    // Another readable row is still access after the trial.
    expect(reason(() => assertHistoryWalled(facts(row(OTHER)), facts(row(TAKE)), TAKE))).toBe('history_readable_after_trial');
    // An empty member read with the row gone is deletion, not a wall.
    expect(reason(() => assertHistoryWalled([], [], TAKE))).toBe('history_deleted_at_trial_end');
    expect(reason(() => assertHistoryWalled([], null, TAKE))).toBe('history_deleted_at_trial_end');
  });
});

describe('restored after one test-mode payment', () => {
  const before = facts(row(TAKE));
  it('passes only on the same rows with the same content-free facts', () => {
    expect(reason(() => assertHistoryRestored(before, facts(row(TAKE)), TAKE))).toBe('no_failure');
    expect(reason(() => assertHistoryRestored(before, null, TAKE))).toBe('restored_history_unreadable');
    expect(reason(() => assertHistoryRestored(before, [], TAKE))).toBe('history_not_restored_unchanged');
    expect(reason(() => assertHistoryRestored(before, facts(row(TAKE, { transcript: 'edited' })), TAKE))).toBe('history_not_restored_unchanged');
    expect(reason(() => assertHistoryRestored(before, facts(row(TAKE, { status: 'failed' })), TAKE))).toBe('history_not_restored_unchanged');
    expect(reason(() => assertHistoryRestored(before, facts(row(TAKE), row(OTHER)), TAKE))).toBe('history_not_restored_unchanged');
  });
  it('needs a trial read that held the take', () => {
    expect(reason(() => assertHistoryRestored(null, facts(row(TAKE)), TAKE))).toBe('pre_expiry_history_missing');
    expect(reason(() => assertHistoryRestored([], [], TAKE))).toBe('pre_expiry_history_missing');
  });
});

describe('exactly one successful test-mode charge', () => {
  const charge = { id: 'ch_1', object: 'charge', livemode: false, status: 'succeeded', paid: true, amount: 1000, currency: 'usd',
    customer: 'cus_1', refunded: false, amount_refunded: 0 };
  const f = { customer: 'cus_1', invoiceCharge: 'ch_1' };
  const list = (...data: unknown[]) => ({ object: 'list', data, has_more: false });
  it('passes on the invoice\'s own $10.00 charge alone', () => {
    expect(reason(() => assertSingleCharge(list(charge), f))).toBe('no_failure');
  });
  it('refuses an unreadable or partial list', () => {
    expect(reason(() => assertSingleCharge(null, f))).toBe('charge_list_unreadable');
    expect(reason(() => assertSingleCharge({ data: [charge], has_more: true }, f))).toBe('charge_list_unreadable');
    expect(reason(() => assertSingleCharge({ data: null, has_more: false }, f))).toBe('charge_list_unreadable');
  });
  it('refuses none, two, or a charge that is not the invoice\'s', () => {
    expect(reason(() => assertSingleCharge(list(), f))).toBe('charge_count_not_one');
    expect(reason(() => assertSingleCharge(list(charge, { ...charge, id: 'ch_2' }), f))).toBe('charge_count_not_one');
    expect(reason(() => assertSingleCharge(list({ ...charge, id: 'ch_2' }), f))).toBe('charge_not_invoice_charge');
    expect(reason(() => assertSingleCharge(list({ ...charge, customer: 'cus_2' }), f))).toBe('charge_not_invoice_charge');
    expect(reason(() => assertSingleCharge(list(charge), { ...f, invoiceCharge: '' }))).toBe('invoice_charge_missing');
  });
  it('refuses a live, failed, wrong-amount or refunded charge', () => {
    expect(reason(() => assertSingleCharge(list({ ...charge, livemode: true }), f))).toBe('charge_not_test_mode');
    expect(reason(() => assertSingleCharge(list({ ...charge, object: 'payment_intent' }), f))).toBe('charge_not_test_mode');
    for (const bad of [{ status: 'failed' }, { status: 'pending' }, { paid: false }, { amount: 999 }, { amount: 2000 },
      { currency: 'eur' }, { refunded: true }, { amount_refunded: 1000 }]) {
      expect({ bad, code: reason(() => assertSingleCharge(list({ ...charge, ...bad }), f)) }).toEqual({ bad, code: 'charge_not_ten_usd_succeeded' });
    }
  });
});

describe('Manage billing shows the plan', () => {
  it('needs the $10.00 price and a monthly interval on the page', () => {
    expect(portalShowsPlan('SpeakSharp Pro\nUS$10.00 per month\nRenews December 21')).toBe(true);
    expect(portalShowsPlan('$10.00 / month')).toBe(true);
    expect(portalShowsPlan('SpeakSharp Pro $10.00 per year')).toBe(false);
    expect(portalShowsPlan('$100.00 per month')).toBe(false);
    expect(portalShowsPlan('$1.00 per month')).toBe(false);
    expect(portalShowsPlan('Current plan')).toBe(false);
    expect(portalShowsPlan(null)).toBe(false);
  });
});

describe('the spec runs the checks in the order that proves the story', () => {
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  const setup = spec.slice(spec.indexOf('async setup(): Promise<void> {'), spec.indexOf('/** Fills Stripe\'s hosted card form'));
  const branch = spec.slice(spec.indexOf("} else if (this.journey === 'restore_access') {"), spec.indexOf("} else if (this.journey === 'failed_checkout') {\n      // A declined"));
  it('saves the take before the trial is ended, and checks the wall right after it ends', () => {
    const take = setup.indexOf("if (this.journey === 'restore_access') await this.trialTakeSaved();");
    const expire = setup.indexOf("update({ trial_expires_at:");
    const walled = setup.indexOf("if (this.journey === 'restore_access') await this.historyWalled();");
    const customer = setup.indexOf("const customer = await this.stripe('customers', 'POST'");
    expect(take).toBeGreaterThan(0);
    expect(expire).toBeGreaterThan(take);
    expect(walled).toBeGreaterThan(expire);
    expect(customer).toBeGreaterThan(walled);
  });
  it('reads the restored history before the next take, and binds the one charge to the first invoice', () => {
    const order = ["this.steps.add('returned_to_app')", 'assertSingleCharge(', "this.steps.add('single_charge')",
      "this.steps.add('paid_ui')", 'assertHistoryRestored(this.trialHistory, await this.history(this.member), this.trialTake)',
      "this.steps.add('history_restored')", "this.steps.add('portal_plan')", "await this.record(); this.steps.add('next_recording')"];
    const at = order.map((s) => branch.indexOf(s));
    expect(at.filter((i) => i <= 0)).toEqual([]);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(branch).toMatch(/invoiceCharge: id\(invoice\.charge\)/);
  });
  it('reads the trial history after the take is saved, and shows the take on Progress before the trial ends', () => {
    const helper = spec.slice(spec.indexOf('  async trialTakeSaved(): Promise<void> {'), spec.indexOf('  async historyWalled(): Promise<void> {'));
    const order = ['await this.login();', 'await this.record();', 'this.trialTake = this.savedSession;',
      'this.trialHistory = await this.history(this.member);', "assertTakeReadable(this.trialHistory, this.trialTake, 'pre_expiry_take_not_readable');",
      "this.steps.add('pre_expiry_take');", "requireFact(await this.progressLists(this.trialTake), 'progress_did_not_list_trial_take');",
      "this.steps.add('pre_expiry_progress');"];
    const at = order.map((s) => helper.indexOf(s));
    expect(at.filter((i) => i < 0)).toEqual([]);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it('after the trial, Progress shows the payment wall and not the take', () => {
    const helper = spec.slice(spec.indexOf('  async historyWalled(): Promise<void> {'), spec.indexOf('  async portalPlan(): Promise<void> {'));
    const order = ['assertHistoryWalled(', 'goto(`${this.targets.app}/progress`)', "getByTestId('trial-payment-wall')).toBeVisible(",
      "'BILLING_JOURNEY:progress_not_walled'", "getByTestId(`open-session-detail-${this.trialTake}`).count() === 0, 'progress_listed_walled_take'",
      "this.steps.add('history_walled');"];
    const at = order.map((s) => helper.indexOf(s));
    expect(at.filter((i) => i < 0)).toEqual([]);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it('restores the take on Progress too, takes the one next take only after the restore, and opens the real portal', () => {
    const restored = branch.indexOf('assertHistoryRestored(');
    const listed = branch.indexOf("requireFact(await this.progressLists(this.trialTake), 'progress_did_not_list_restored_take');");
    expect(listed).toBeGreaterThan(restored);
    expect(branch.indexOf("this.steps.add('history_restored')")).toBeGreaterThan(listed);
    expect(branch.match(/this\.record\(\)/g)).toHaveLength(1);
    expect(branch.indexOf('this.record()')).toBeGreaterThan(branch.indexOf("this.steps.add('portal_plan')"));
    const portal = spec.slice(spec.indexOf('  async portalPlan(): Promise<void> {'), spec.indexOf('  async portalPlan(): Promise<void> {') + 1200);
    expect(portal).toMatch(/waitForURL\(url => url\.origin === 'https:\/\/billing\.stripe\.com'/);
  });
  it('reads history as the member for the wall and the restore, and never posts to the webhook or writes a charge', () => {
    expect(spec).toMatch(/assertHistoryWalled\(await this\.history\(this\.member\), await this\.history\(this\.admin\), this\.trialTake\)/);
    expect(spec).toMatch(/this\.trialHistory = await this\.history\(this\.member\);/);
    expect(spec).not.toMatch(/functions\/v1\/stripe-webhook|invoke\('stripe-webhook'/);
    expect(spec).not.toMatch(/stripe\('charges'?,\s*'POST'/);
  });
});
