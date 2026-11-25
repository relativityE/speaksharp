// @vitest-environment node
/**
 * Offline controls for J9.b's `restore_access` checks (restoreAccess.ts) and their wiring in the billing spec. No browser,
 * account, Stripe call or network: each check must refuse the failure it exists to catch. Not journey acceptance.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { assertTakeReadable, assertMemberIsRunAccount, assertHistoryWalled, assertHistoryRestored, assertSingleCharge, firstInvoiceCharge,
  portalShowsPlan, portalPlanMiss, portalPlanSplit, portalPlanSplitCheckpoint, visiblePlanChains, PLAN_LINE_MAX, PLAN_BLOCK_MAX,
  visiblePlanSample, planSampleChains, portalPlanObserver, portalPlanVerdict, assertPortalSubscription, PLAN_PROBE_HEADINGS, PLAN_PROBE_ARGS,
  type PlanSample, type PlanCardRead } from './restoreAccess';
import { REQUIRED_STEPS, FULL_MODE_JOURNEYS, fixtureCustomerFields, progressLine, receipt, safeFailureReason, selectRunnerJourneys } from './contract';
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

describe('the empty read counts as the wall only while the member is still this run\'s account', () => {
  const f = { uid: '11111111-1111-4111-8111-111111111111', email: 'rwt-journey-billing-x@example.com' };
  const who = (user: unknown, error: unknown = null) => ({ data: { user: user as never }, error });
  it('passes only on this run\'s user id and email', () => {
    expect(reason(() => assertMemberIsRunAccount(who({ id: f.uid, email: f.email }), f))).toBe('no_failure');
    expect(reason(() => assertMemberIsRunAccount(who({ id: f.uid, email: f.email.toUpperCase() }), f))).toBe('no_failure');
  });
  it('refuses a lost sign-in, another account, a failed read or an unbound run', () => {
    for (const [name, input] of [['signed out', who(null)], ['no data', { data: null, error: null }], ['nothing', null],
      ['auth error', who({ id: f.uid, email: f.email }, { message: 'JWT expired' })], ['another user', who({ id: 'other', email: f.email })],
      ['another email', who({ id: f.uid, email: 'someone@example.com' })], ['no email', who({ id: f.uid })]] as const) {
      expect({ name, code: reason(() => assertMemberIsRunAccount(input as never, f)) }).toEqual({ name, code: 'walled_member_not_run_account' });
    }
    expect(reason(() => assertMemberIsRunAccount(who({ id: '', email: f.email }), { ...f, uid: '' }))).toBe('walled_member_unbound');
    expect(reason(() => assertMemberIsRunAccount(who({ id: f.uid, email: '' }), { ...f, email: '' }))).toBe('walled_member_unbound');
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

describe('the one charge belongs to the first invoice already verified', () => {
  const invoice = { id: 'in_first', object: 'invoice', livemode: false, status: 'paid', amount_paid: 1000, currency: 'usd',
    billing_reason: 'subscription_create', customer: 'cus_1', subscription: 'sub_1', charge: 'ch_1' };
  const f = { firstInvoice: 'in_first', customer: 'cus_1', subscription: 'sub_1' };
  it('returns that invoice\'s own charge, as a string or an expanded object', () => {
    expect(firstInvoiceCharge(invoice, f)).toBe('ch_1');
    expect(firstInvoiceCharge({ ...invoice, charge: { id: 'ch_1' } }, f)).toBe('ch_1');
  });
  it('refuses a later or different invoice, even a paid $10 one for this subscription', () => {
    expect(reason(() => firstInvoiceCharge({ ...invoice, id: 'in_later' }, f))).toBe('invoice_not_first_invoice');
    expect(reason(() => firstInvoiceCharge({ ...invoice, billing_reason: 'subscription_cycle' }, f))).toBe('invoice_not_first_invoice');
    expect(reason(() => firstInvoiceCharge({ ...invoice, subscription: 'sub_2' }, f))).toBe('invoice_not_first_invoice');
    expect(reason(() => firstInvoiceCharge({ ...invoice, customer: 'cus_2' }, f))).toBe('invoice_not_first_invoice');
    expect(reason(() => firstInvoiceCharge({ ...invoice, object: 'subscription' }, f))).toBe('invoice_not_first_invoice');
    expect(reason(() => firstInvoiceCharge(null, f))).toBe('invoice_not_first_invoice');
    expect(reason(() => firstInvoiceCharge(invoice, { ...f, firstInvoice: '' }))).toBe('first_invoice_unbound');
  });
  it('refuses a live, unpaid or wrong-amount first invoice, or one without a charge', () => {
    for (const bad of [{ livemode: true }, { status: 'open' }, { amount_paid: 0 }, { amount_paid: 2000 }, { currency: 'eur' }]) {
      expect({ bad, code: reason(() => firstInvoiceCharge({ ...invoice, ...bad }, f)) }).toEqual({ bad, code: 'first_invoice_not_paid_test' });
    }
    for (const charge of [null, '', 'pi_1', { id: 'py_1' }]) {
      expect({ charge, code: reason(() => firstInvoiceCharge({ ...invoice, charge }, f)) }).toEqual({ charge, code: 'invoice_charge_missing' });
    }
  });
});

describe('Manage billing shows the plan', () => {
  // For each element showing $10.00: its own text, then each ancestor's, innermost first (as the spec reads them).
  const page = 'Account\nSpeakSharp\nCurrent plan\nSpeakSharp Pro\nUS$10.00 per month\nYour plan renews on December 21, 2026.\nCancel plan';
  const plan = 'Current plan\nSpeakSharp Pro\nUS$10.00 per month\nYour plan renews on December 21, 2026.\nCancel plan';
  it('passes when one element holds the price with its cadence, inside the current-plan block', () => {
    expect(portalShowsPlan([['US$10.00 per month', plan, page]])).toBe(true);
    expect(portalShowsPlan([['US$10.00', 'US$10.00 per month', plan, page]])).toBe(true);
    expect(portalShowsPlan([['$10.00 / month', 'Current plan\nPro\n$10.00 / month']])).toBe(true);
    // Another $10.00 elsewhere that fails does not hide the one that passes.
    expect(portalShowsPlan([['$10.00', 'Invoice history\n$10.00 Paid\n$10.00 Paid', page], ['US$10.00 per month', plan, page]])).toBe(true);
  });
  it('refuses a price and a cadence that only the page as a whole joins', () => {
    // The price sits in one card and "per month" in an unrelated one: the first element holding both is the long page.
    const split = `Current plan\nSpeakSharp Pro\n${'Your plan details. '.repeat(12)}\nPayment method\nVisa 4242\nBilling\nInvoices are sent per month`;
    expect(portalShowsPlan([['US$10.00', 'SpeakSharp Pro\nUS$10.00', `Current plan\nSpeakSharp Pro\nUS$10.00\n${split}`]])).toBe(false);
    // Short page, but the element adding the cadence also names another amount.
    expect(portalShowsPlan([['$10.00', 'Current plan $10.00 · Add-on $5.00 per month']])).toBe(false);
    // The cadence element is fine but the block naming the current plan also lists another price.
    expect(portalShowsPlan([['$10.00 per month', 'Current plan\n$10.00 per month\nUpgrade to Team $25.00 per month']])).toBe(false);
  });
  it('keeps the heading exact: "Current plan" only; any other heading fails and reads as no_plan_block', () => {
    // Not widened on a guess (Sam, 2026-11-24): run 45361320828 never showed which heading Stripe used. If it was this one,
    // the next run says so as portal_plan_not_shown_no_plan_block instead of a bare timeout.
    for (const label of ['Current subscription', 'Subscription', 'Your plan', 'Current', 'Plan', 'Current plans page']) {
      const block = `${label}\nSpeakSharp Pro\n$10.00 per month`;
      expect({ label, shown: portalShowsPlan([['$10.00 per month', block]]), miss: portalPlanMiss([['$10.00 per month', block]]) })
        .toEqual({ label, shown: false, miss: 'no_plan_block' });
    }
    expect(portalPlanMiss([['$10.00 per month', 'Current plan\nSpeakSharp Pro\n$10.00 per month']])).toBeNull();
  });
  it('names the furthest condition any visible $10.00 reached, as one fixed word, and null only when one passes', () => {
    expect(portalPlanMiss([['US$10.00 per month', plan, page]])).toBeNull();
    expect(portalPlanMiss(null)).toBe('unreadable');
    expect(portalPlanMiss([[7]])).toBe('unreadable');
    expect(portalPlanMiss([])).toBe('no_visible_price');
    expect(portalPlanMiss([['Pro', 'Pro $10.00 per month']])).toBe('no_visible_price');
    expect(portalPlanMiss([['$10.00', 'Invoice history\n$10.00 Paid']])).toBe('no_cadence');
    expect(portalPlanMiss([[`$10.00 per month ${'x'.repeat(PLAN_LINE_MAX)}`, plan]])).toBe('line_too_long');
    expect(portalPlanMiss([['$10.00 per month', 'SpeakSharp Pro\n$10.00 per month']])).toBe('no_plan_block');
    expect(portalPlanMiss([['$10.00 per month', `Current plan\n$10.00 per month\n${'x'.repeat(PLAN_BLOCK_MAX)}`]])).toBe('no_plan_block');
    expect(portalPlanMiss([['$10.00 per month', 'Current plan\n$10.00 per month\nUpgrade to Team $25.00 per month']])).toBe('other_amount');
    // The furthest reached across chains decides, whatever their order; a passing chain anywhere wins.
    const cadenceOnly = ['$10.00', 'Invoice history\n$10.00 Paid'];
    const noBlock = ['$10.00 per month', 'SpeakSharp Pro\n$10.00 per month'];
    expect(portalPlanMiss([noBlock, cadenceOnly])).toBe('no_plan_block');
    expect(portalPlanMiss([cadenceOnly, noBlock])).toBe('no_plan_block');
    expect(portalPlanMiss([noBlock, ['US$10.00 per month', plan, page]])).toBeNull();
    // Every word fits the receipt's closed failure-code alphabet.
    for (const word of ['unreadable', 'no_visible_price', 'no_cadence', 'line_too_long', 'no_plan_block', 'other_amount']) {
      expect(`portal_plan_not_shown_${word}`).toMatch(/^[a-z0-9_]{1,160}$/);
    }
  });
  it('refuses a line or block over its length limit', () => {
    expect(portalShowsPlan([[`$10.00 per month ${'x'.repeat(PLAN_LINE_MAX)}`, plan]])).toBe(false);
    expect(portalShowsPlan([['$10.00 per month', `Current plan\n$10.00 per month\n${'x'.repeat(PLAN_BLOCK_MAX)}`]])).toBe(false);
  });
  it('refuses no current-plan label, another price or interval, and anything but text chains', () => {
    expect(portalShowsPlan([['US$10.00 per month', 'SpeakSharp Pro\nUS$10.00 per month']])).toBe(false);
    expect(portalShowsPlan([['$10.00 per year', 'Current plan\n$10.00 per year']])).toBe(false);
    expect(portalShowsPlan([['$100.00 per month', 'Current plan\n$100.00 per month']])).toBe(false);
    expect(portalShowsPlan([['$1.00 per month', 'Current plan\n$1.00 per month']])).toBe(false);
    expect(portalShowsPlan([['Current plan', 'Current plan per month']])).toBe(false);
    // The element the page matched must itself show the price; an ancestor's price is not that element's.
    expect(portalShowsPlan([['Pro', 'Pro $10.00 per month', 'Current plan\nPro $10.00 per month']])).toBe(false);
    // A chain with any non-text entry is refused, even when its text entries alone would pass.
    expect(portalShowsPlan([['$10.00 per month', null, 'Current plan\n$10.00 per month']])).toBe(false);
    for (const bad of [null, 'Current plan $10.00 per month', [], [[]], [['$10.00 per month', 7]], [[null]]]) {
      expect({ bad, shown: portalShowsPlan(bad) }).toEqual({ bad, shown: false });
    }
  });
});

describe('Manage billing reads only what the portal shows (local DOM, no Stripe)', () => {
  // The spec's read: every element whose text shows $10.00 (Playwright's getByText also matches hidden ones), passed through
  // visiblePlanSample, whose chains go to portalShowsPlan. Elements that directly hold a $10.00 text node stand in for getByText's
  // matches. Every fixture here also proves the verdict's input is unchanged: the sample's chains equal visiblePlanChains'.
  const read = (html: string, css = ''): boolean => {
    const window = new Window();
    const doc = window.document as unknown as Document;
    doc.body.innerHTML = `<style>${css}</style>${html}`;
    const matched = Array.from(doc.querySelectorAll('body *')).filter((el) => Array.from(el.childNodes)
      .some((n) => n.nodeType === 3 && /\$\s?10\.00/.test(n.nodeValue ?? '')));
    const chains = planSampleChains(visiblePlanSample(matched, PLAN_PROBE_ARGS));
    expect(chains).toEqual(visiblePlanChains(matched));
    const shown = portalShowsPlan(chains);
    void window.happyDOM.close();
    return shown;
  };
  const plan = (price: string, attrs = '', cadence = 'per month', label = 'Current plan') =>
    `<section ${attrs}><h2>${label}</h2><div>SpeakSharp Pro</div><div><span>${price}</span> <span>${cadence}</span></div></section>`;
  const wrong = plan('US$25.00');
  it('passes a visible correct plan', () => {
    expect(read(plan('US$10.00'))).toBe(true);
    expect(read(`<main>${plan('US$10.00')}<footer>Cancel plan</footer></main>`)).toBe(true);
  });
  it('fails a hidden $10 plan next to a visible wrong plan, however the $10 plan is hidden', () => {
    for (const [attrs, css] of [['hidden', ''], ['style="display:none"', ''], ['class="off"', '.off { display: none; }'],
      ['style="visibility:hidden"', ''], ['style="opacity:0"', '']]) {
      expect({ attrs, shown: read(wrong + plan('US$10.00', attrs), css) }).toEqual({ attrs, shown: false });
    }
    // Hidden by an ancestor, or only the price element hidden.
    expect(read(`<div hidden>${plan('US$10.00')}</div>${wrong}`)).toBe(false);
    expect(read(`${wrong}<section><h2>Current plan</h2><div><span hidden>US$10.00</span> <span>per month</span></div></section>`)).toBe(false);
  });
  it('fails when the cadence or the current-plan label is there only in hidden text', () => {
    expect(read(plan('US$10.00', '', '<span hidden>per month</span>'))).toBe(false);
    expect(read(plan('US$10.00', '', '<span style="display:none">per month</span>'))).toBe(false);
    expect(read(plan('US$10.00', '', 'per month', '<span style="visibility:hidden">Current plan</span>'))).toBe(false);
  });
  it('lets a hidden extra amount neither fail nor pass the visible plan', () => {
    // A hidden $25.00 inside the visible block is not shown, so the shown block names only $10.00.
    expect(read(plan('US$10.00', '', 'per month <span hidden>Upgrade to Team US$25.00 per month</span>'))).toBe(true);
    // The same $25.00 shown is another price in the block, so it fails as before.
    expect(read(plan('US$10.00', '', 'per month <span>Upgrade to Team US$25.00 per month</span>'))).toBe(false);
  });
  it('ignores script and style text and reads at most ten visible matches', () => {
    expect(read(`<section><h2>Current plan</h2><script>var p = "$10.00 per month";</script><div>US$10.00</div></section>`)).toBe(false);
    // Ten visible $10.00 receipts come first, so the plan is the eleventh match and is not read.
    const receipts = (attrs: string) => Array.from({ length: 10 }, () => `<p ${attrs}>US$10.00 paid with Visa, receipt sent by email</p>`).join('');
    expect(read(receipts('') + plan('US$10.00'))).toBe(false);
    // Hidden receipts are dropped before the cap, so the visible plan is read.
    expect(read(receipts('hidden') + plan('US$10.00'))).toBe(true);
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
    // The charge is bound to the first invoice by its verified id, never re-read from the subscription.
    expect(branch).toMatch(/const invoice = await this\.stripe\(`invoices\/\$\{encodeURIComponent\(this\.firstInvoice\)\}`\);/);
    expect(branch).toMatch(/invoiceCharge: firstInvoiceCharge\(invoice, \{ firstInvoice: this\.firstInvoice/);
    expect(branch).not.toMatch(/latest_invoice/);
    expect(spec).toMatch(/this\.firstInvoice = id\(sub\.latest_invoice\);\n\s+assertInvoice\(await this\.stripe\(`invoices\/\$\{this\.firstInvoice\}`\), this\.customer, this\.subscription, 'subscription_create'\);\n\s+this\.steps\.add\('first_invoice'\);/);
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
    const order = ['await runAccount();', 'const member = await this.history(this.member);', 'await runAccount();', 'assertHistoryWalled(member,',
      'goto(`${this.targets.app}/progress`)', "getByTestId('trial-payment-wall')).toBeVisible(",
      "'BILLING_JOURNEY:progress_not_walled'", "getByTestId(`open-session-detail-${this.trialTake}`).count() === 0, 'progress_listed_walled_take'",
      "this.steps.add('history_walled');"];
    // Each step is looked for after the one before, so the repeated account check must appear both before and after the read.
    let from = 0;
    const at = order.map((s) => { const i = helper.indexOf(s, from); from = i < 0 ? from : i + s.length; return i; });
    expect(at.filter((i) => i < 0)).toEqual([]);
    expect(helper.match(/await runAccount\(\);/g)).toHaveLength(2);
  });
  it('restores the take on Progress too, takes the one next take only after the restore, and opens the real portal', () => {
    const restored = branch.indexOf('assertHistoryRestored(');
    const listed = branch.indexOf("requireFact(await this.progressLists(this.trialTake), 'progress_did_not_list_restored_take');");
    expect(listed).toBeGreaterThan(restored);
    expect(branch.indexOf("this.steps.add('history_restored')")).toBeGreaterThan(listed);
    expect(branch.match(/this\.record\(\)/g)).toHaveLength(1);
    expect(branch.indexOf('this.record()')).toBeGreaterThan(branch.indexOf("this.steps.add('portal_plan')"));
    const portal = spec.slice(spec.indexOf('  async portalPlan(): Promise<void> {'), spec.indexOf('  async planSample(page: Page): Promise<PlanSample> {'));
    expect(portal.length).toBeGreaterThan(0);
    expect(portal).toMatch(/waitForURL\(url => url\.origin === 'https:\/\/billing\.stripe\.com'/);
    // The portal check reads per-element ancestries, never the whole page's text, and a timeout names its fixed reason.
    expect(portal).toMatch(/await this\.awaitPortalPlan\(this\.page\);/);
    expect(spec).toMatch(/\(miss = portalPlanVerdict\(sample = await this\.planSample\(page\)\.catch\(\(\) => null\)\)\)/);
    expect(spec).toMatch(/throw new Error\(`BILLING_JOURNEY:portal_plan_not_shown_\$\{miss \?\? 'unreadable'\}`\)/);
    // J9.a's paid_account_kept reads the same way in its fresh context: never its own innerText scan.
    const kept = spec.slice(spec.indexOf("this.stage = 'portal_plan_shown';"), spec.indexOf("this.steps.add('portal_plan_shown');"));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept).toMatch(/await this\.awaitPortalPlan\(other\);/);
    expect(kept).not.toMatch(/innerText|textContent|querySelectorAll/);
    // Only visible $10.00 elements, read as visible text (visiblePlanSample's chains), never innerText (which includes hidden content).
    expect(spec).toMatch(/return page\.getByText\(\/\\\$\\s\?10\\\.00\/\)\.evaluateAll\(visiblePlanSample, PLAN_PROBE_ARGS\);/);
    expect(spec.match(/evaluateAll\(/g)).toHaveLength(1);
    const ancestries = spec.slice(spec.indexOf('  async planSample(page: Page): Promise<PlanSample> {'));
    expect(ancestries.slice(0, ancestries.indexOf('\n  }\n'))).not.toMatch(/innerText|textContent/);
    expect(spec).not.toMatch(/portalShowsPlan\(await this\.page\.locator\('body'\)/);
  });
  it('reads history as the member for the wall and the restore, and never posts to the webhook or writes a charge', () => {
    expect(spec).toMatch(/const runAccount = async \(\) => assertMemberIsRunAccount\(await this\.member\.auth\.getUser\(\), \{ uid: this\.uid, email: this\.email \}\);/);
    expect(spec).toMatch(/assertHistoryWalled\(member, await this\.history\(this\.admin\), this\.trialTake\)/);
    expect(spec).toMatch(/this\.trialHistory = await this\.history\(this\.member\);/);
    expect(spec).not.toMatch(/functions\/v1\/stripe-webhook|invoke\('stripe-webhook'/);
    expect(spec).not.toMatch(/stripe\('charges'?,\s*'POST'/);
  });
});

describe('a no_plan_block miss splits into its two causes, content-free, without changing the verdict', () => {
  const line = 'US$10.00 per month';
  const plan = `Current plan\nSpeakSharp Pro\n${line}`;
  // Cause 1: the label is not visible text anywhere in the ancestry (another heading), up to the page root.
  const labelAbsent = [line, `Your subscription\nSpeakSharp Pro\n${line}`, `Account\nYour subscription\nSpeakSharp Pro\n${line}\nPayment method`];
  // Cause 2: the label is there, but only in an ancestor whose visible text is over PLAN_BLOCK_MAX (a separate section).
  const bigBlock = (n: number) => `Current plan\n${'Payment method Visa ending 4242. '.repeat(n)}\n${line}`;
  const labelTooFar = [line, `SpeakSharp Pro\n${line}`, bigBlock(25)];

  it('negative control, cause 1: label absent reads label_absent_block_none, and the miss stays no_plan_block', () => {
    expect(portalPlanMiss([labelAbsent])).toBe('no_plan_block');
    expect(portalPlanSplit([labelAbsent])).toEqual({ label: 'absent', block: 'none' });
    expect(portalPlanSplitCheckpoint(portalPlanSplit([labelAbsent]))).toBe('portal_plan_split_label_absent_block_none');
  });
  it('negative control, cause 2: label only in an oversized ancestor reads label_present with its size bucket, miss unchanged', () => {
    expect(bigBlock(25).length).toBeGreaterThan(PLAN_BLOCK_MAX);
    expect(bigBlock(25).length).toBeLessThanOrEqual(2 * PLAN_BLOCK_MAX);
    expect(portalPlanMiss([labelTooFar])).toBe('no_plan_block');
    expect(portalPlanSplit([labelTooFar])).toEqual({ label: 'present', block: 'up_to_2x' });
    expect(portalPlanSplit([[line, bigBlock(50)]])).toEqual({ label: 'present', block: 'up_to_4x' });
    expect(portalPlanSplit([[line, bigBlock(100)]])).toEqual({ label: 'present', block: 'over_4x' });
  });
  it('takes the smallest labelled block across chains, in either order, and a passing chain reads within_limit', () => {
    expect(portalPlanSplit([labelAbsent, labelTooFar])).toEqual({ label: 'present', block: 'up_to_2x' });
    expect(portalPlanSplit([labelTooFar, labelAbsent])).toEqual({ label: 'present', block: 'up_to_2x' });
    expect(portalPlanSplit([[line, bigBlock(100)], labelTooFar])).toEqual({ label: 'present', block: 'up_to_2x' });
    expect(portalPlanSplit([[line, plan]])).toEqual({ label: 'present', block: 'within_limit' });
  });
  it('counts only chains that passed price, cadence and line, and never changes portalPlanMiss or portalShowsPlan', () => {
    expect(portalPlanSplit(null)).toBeNull();
    expect(portalPlanSplit([])).toBeNull();
    expect(portalPlanSplit([['$10.00', 'Current plan\n$10.00 Paid']])).toBeNull();
    expect(portalPlanSplit([[`$10.00 per month ${'x'.repeat(PLAN_LINE_MAX)}`, plan]])).toBeNull();
    expect(portalPlanSplitCheckpoint(null)).toBe('portal_plan_split_not_reached');
    // The same verdicts as before for every input the split reads.
    const inputs: unknown[] = [null, [], [labelAbsent], [labelTooFar], [[line, plan]], [labelAbsent, [line, plan]],
      [['$10.00 per month', 'Current plan\n$10.00 per month\nUpgrade to Team $25.00 per month']]];
    for (const input of inputs) {
      const before = [portalPlanMiss(input), portalShowsPlan(input)];
      portalPlanSplit(input);
      expect([portalPlanMiss(input), portalShowsPlan(input)]).toEqual(before);
    }
  });
  it('leaves only fixed words that fit the progress line alphabet', () => {
    for (const label of ['present', 'absent'] as const) {
      for (const block of ['none', 'within_limit', 'up_to_2x', 'up_to_4x', 'over_4x'] as const) {
        expect(progressLine('checkpoint', portalPlanSplitCheckpoint({ label, block }), 0)).not.toContain('=invalid');
      }
    }
    expect(progressLine('checkpoint', portalPlanSplitCheckpoint(null), 0)).not.toContain('=invalid');
  });
  it('the spec emits the split only after a no_plan_block miss, and still throws the same failure code', () => {
    const spec = readFileSync(new URL('./journey.billing.spec.ts', import.meta.url), 'utf8');
    const body = spec.slice(spec.indexOf('async awaitPortalPlan('), spec.indexOf('async planSample('));
    expect(body).toContain("if (miss === 'no_plan_block') this.checkpoint(portalPlanSplitCheckpoint(portalPlanSplit(planSampleChains(sample))));");
    expect(body).toContain('throw new Error(`BILLING_JOURNEY:portal_plan_not_shown_${miss ?? \'unreadable\'}`);');
  });
});

describe('the J9 observer reads the heading of the price card from the same sample, and changes nothing about the verdict', () => {
  const line = 'US$10.00 per month';
  // Elements that directly hold a $10.00 text node stand in for getByText's matches; open shadow roots are searched too, as
  // getByText does, and frame contents are not, as getByText (a main-frame locator) does not.
  const matches = (doc: Document): Element[] => {
    const out: Element[] = [];
    const walk = (root: Document | ShadowRoot): void => {
      for (const el of Array.from(root.querySelectorAll('*'))) {
        if (Array.from(el.childNodes).some((n) => n.nodeType === 3 && /\$\s?10\.00/.test(n.nodeValue ?? ''))) out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(doc);
    return out;
  };
  // Reads a page the way the spec does and checks, every time, that the verdict's input is exactly visiblePlanChains', that the
  // observer leaves the sample as it was, and that nothing but the chains carries page text. `chrome` installs Chrome's documented
  // checkVisibility rule for a box-less element (display: contents has no box, so it reads as not visible); happy-dom has none.
  const page = (html: string, opts: { build?: (doc: Document) => void; chrome?: boolean; args?: typeof PLAN_PROBE_ARGS } = {}) => {
    const window = new Window();
    const doc = window.document as unknown as Document;
    if (opts.chrome) {
      (window.Element.prototype as unknown as { checkVisibility: () => boolean }).checkVisibility = function (this: Element) {
        return window.getComputedStyle(this as never).display !== 'contents';
      };
    }
    doc.body.innerHTML = html;
    opts.build?.(doc);
    const matched = matches(doc);
    const sample = visiblePlanSample(matched, 'args' in opts ? opts.args : PLAN_PROBE_ARGS);
    expect(planSampleChains(sample)).toEqual(visiblePlanChains(matched));
    const extras = JSON.stringify({ roots: sample.roots, shown: sample.shown, cards: sample.cards });
    expect(extras).not.toMatch(/\$|SpeakSharp|Current plan|subscription |Visa/i);
    const before = JSON.stringify(sample);
    const words = portalPlanObserver(sample);
    expect(JSON.stringify(sample)).toBe(before);
    const verdict = { miss: portalPlanMiss(sample.chains), split: portalPlanSplit(sample.chains), pass: portalPlanVerdict(sample) === null };
    void window.happyDOM.close();
    return { sample, words, verdict, card: words.slice(0, 2), label: words.slice(2, 4) };
  };
  const cardHtml = (heading: string, wrap = (h: string) => h) =>
    `<section>${wrap(heading)}<div>SpeakSharp Pro</div><div><span>US$10.00</span> <span>per month</span></div></section>`;
  const h2 = (text: string) => `<h2>${text}</h2>`;
  const said = (heading: string, same: string) => [`portal_plan_probe_card_heading_${heading}`, `portal_plan_probe_same_card_${same}`];
  const labelled = (label: string, same: string) => [`portal_plan_probe_card_label_${label}`, `portal_plan_probe_label_same_card_${same}`];

  it('names the one semantic heading in the price card with a closed label, and says it is in the same card', () => {
    expect(page(cardHtml(h2('Current plan'))).card).toEqual(said('current_plan', 'yes'));
    expect(page(cardHtml(h2('Current subscription'))).card).toEqual(said('current_subscription', 'yes'));
    expect(page(cardHtml(h2('YOUR SUBSCRIPTION'))).card).toEqual(said('your_subscription', 'yes'));
    expect(page(cardHtml('<h3>Your plan</h3>')).card).toEqual(said('your_plan', 'yes'));
    expect(page(cardHtml(h2('Pro plan'))).card).toEqual(said('plan_or_subscription_word', 'yes'));
    expect(page(cardHtml(h2('SpeakSharp Pro'))).card).toEqual(said('other_text', 'yes'));
    expect(page(cardHtml('<div role="heading" aria-level="2">Your subscription</div>')).card).toEqual(said('your_subscription', 'yes'));
    // The current-plan card passes the verdict as it always did; the others still miss.
    expect(page(cardHtml(h2('Current plan'))).verdict.miss).toBeNull();
    expect(page(cardHtml(h2('Your subscription'))).verdict).toEqual({ miss: 'no_plan_block', split: { label: 'absent', block: 'none' }, pass: false });
  });

  it('says no, unknown or ambiguous rather than guessing', () => {
    // A plain page with no heading at all, read to its root within the card limit: no heading, not in the card.
    expect(page(cardHtml('')).card).toEqual(said('none', 'no'));
    expect(page('<div><span>US$10.00</span> <span>per month</span></div>').card).toEqual(said('none', 'no'));
    // Only semantic headings count as a heading: the same words as plain text are read as a label instead.
    expect(page(cardHtml('<div>Current plan</div>')).card).toEqual(said('none', 'no'));
    expect(page(cardHtml('<div>Current plan</div>')).label).toEqual(labelled('current_plan', 'yes'));
    // A heading elsewhere on the page, past the compact card limit, is never claimed: overflow is unknown.
    const pad = `<p>${'Payment method Visa ending 4242. '.repeat(25)}</p>`;
    const far = page(`<main>${h2('Current plan')}${pad}${cardHtml('')}</main>`);
    expect(far.card).toEqual(said('unknown', 'unknown'));
    // Two headings in the first card that holds one: ambiguous, labelled by the most specific listed phrase.
    expect(page(cardHtml(`${h2('Your subscription')}<h3>SpeakSharp Pro</h3>`)).card).toEqual(said('your_subscription', 'unknown'));
    // Two candidates that disagree.
    expect(page(cardHtml(h2('Your plan')) + cardHtml(h2('Current plan'))).card).toEqual(said('mixed', 'unknown'));
    // Two candidates that agree.
    expect(page(cardHtml(h2('Your plan')) + cardHtml(h2('Your plan'))).card).toEqual(said('your_plan', 'yes'));
  });

  it('says yes only from a card element of its own, never from a short wrapper that joins two separate cards', () => {
    const priceLine = '<div><span>US$10.00</span> <span>per month</span></div>';
    // Sam's control: the heading in one card, the $10.00 monthly line in a sibling card, under a short common wrapper.
    for (const wrapper of ['div', 'main']) {
      const siblings = page(`<${wrapper}><section>${h2('Current plan')}</section><section>${priceLine}</section></${wrapper}>`);
      expect(siblings.card).toEqual(said('current_plan', 'unknown'));
      // The verdict is untouched: its existing rule reads the short wrapper as the current-plan block and passes, as on main.
      expect(siblings.verdict.miss).toBeNull();
    }
    // The same with plain div cards: no card element at all, so the heading is named but never claimed for the card.
    expect(page(`<main><div>${h2('Current plan')}</div><div>${priceLine}</div></main>`).card).toEqual(said('current_plan', 'unknown'));
    expect(page(`<div>${h2('Current plan')}${priceLine}</div>`).card).toEqual(said('current_plan', 'unknown'));
    // A list item is its own card: the heading above the list is outside it.
    expect(page(`<div>${h2('Your plan')}<ul><li>${priceLine}</li></ul></div>`).card).toEqual(said('your_plan', 'unknown'));
    // Card elements that do hold their one heading say yes.
    expect(page(`<div role="region" aria-labelledby="t"><h2 id="t">Current plan</h2>${priceLine}</div>`).card).toEqual(said('current_plan', 'yes'));
    expect(page(`<article>${h2('Your subscription')}${priceLine}</article>`).card).toEqual(said('your_subscription', 'yes'));
    expect(page(`<ul><li><h3>Current plan</h3>${priceLine}</li></ul>`).card).toEqual(said('current_plan', 'yes'));
    // The nearest card element decides: an outer section with one heading cannot vouch for an inner card without one.
    expect(page(`<section>${h2('Current plan')}<article>${priceLine}</article></section>`).card).toEqual(said('current_plan', 'unknown'));
    // Sam's nested control: the heading in a nested card and the price in a plain block of the outer card are not one card.
    expect(page(`<section><article>${h2('Current plan')}</article>${priceLine}</section>`).card).toEqual(said('current_plan', 'unknown'));
    expect(page(`<section><div role="group">${h2('Your plan')}<p>Seat add-on</p></div><div>${priceLine}</div></section>`).card)
      .toEqual(said('your_plan', 'unknown'));
    // The outer card's own heading still counts when a nested card sits beside the price without one.
    expect(page(`<section>${h2('Current plan')}<article><p>Seat add-on</p></article>${priceLine}</section>`).card)
      .toEqual(said('current_plan', 'yes'));
  });

  it('reads a styled section label such as the portal preview caption, closed words only, under the same card rule', () => {
    // Shaped like Stripe's preview: an uppercase caption, the product, then the monthly price, in one section.
    const caption = (text: string) => `<section><div style="text-transform: uppercase">${text}</div><div>SpeakSharp Pro</div>`
      + '<div><span>US$10.00</span> <span>per month</span></div><div>Your next billing date is Dec 25</div>'
      + '<button>Cancel subscription</button></section>';
    const preview = page(caption('CURRENT SUBSCRIPTION'));
    expect(preview.label).toEqual(labelled('current_subscription', 'yes'));
    expect(preview.card).toEqual(said('none', 'no'));
    // The text rule is untouched (no "Current plan" anywhere: label_absent, as on main); the verdict passes it through its card.
    expect(preview.verdict).toEqual({ miss: 'no_plan_block', split: { label: 'absent', block: 'none' }, pass: true });
    expect(page(caption('Current plan')).label).toEqual(labelled('current_plan', 'yes'));
    expect(page(caption('Your plan')).label).toEqual(labelled('your_plan', 'yes'));
    // A product name as a heading and a caption as a label are read side by side, neither replacing the other.
    const both = page(`<section><div>CURRENT SUBSCRIPTION</div>${h2('Premium')}<div><span>US$10.00</span> <span>per month</span></div></section>`);
    expect(both.card).toEqual(said('other_text', 'yes'));
    expect(both.label).toEqual(labelled('current_subscription', 'yes'));
    // No caption: none. A button, link or long sentence is never a label, even when it names a listed phrase.
    expect(page(cardHtml('')).label).toEqual(labelled('none', 'no'));
    expect(page(caption('')).label).toEqual(labelled('none', 'no'));
    expect(page(cardHtml('<a href="#">Your plan</a>')).label).toEqual(labelled('none', 'no'));
    expect(page(cardHtml('<p>Your subscription renews every month unless you cancel it first.</p>')).label).toEqual(labelled('none', 'no'));
    // Two captions in one card: ambiguous, named by the most specific listed phrase.
    expect(page(caption('CURRENT SUBSCRIPTION</div><div>Your plan')).label).toEqual(labelled('current_subscription', 'unknown'));
    // Sam's control holds for labels too: a caption in a sibling card under a short wrapper is named, never claimed.
    const priceLine = '<div><span>US$10.00</span> <span>per month</span></div>';
    for (const wrapper of ['div', 'main']) {
      const siblings = page(`<${wrapper}><section><div>CURRENT SUBSCRIPTION</div></section><section>${priceLine}</section></${wrapper}>`);
      expect(siblings.label).toEqual(labelled('current_subscription', 'unknown'));
    }
    expect(page(`<main><div><div>Current plan</div></div><div>${priceLine}</div></main>`).label).toEqual(labelled('current_plan', 'unknown'));
    // Sam's nested control for captions: a caption inside a nested card is that card's, not the outer card's.
    expect(page(`<section><article><div>CURRENT SUBSCRIPTION</div></article><div>${priceLine}</div></section>`).label)
      .toEqual(labelled('current_subscription', 'unknown'));
    expect(page(`<section><div>CURRENT SUBSCRIPTION</div><article><div>Your plan</div></article><div>${priceLine}</div></section>`).label)
      .toEqual(labelled('current_subscription', 'yes'));
    // Sam's boundary: the caption element is itself a nested card, so it is that card's caption, not the outer card's.
    expect(page('<section><article>Current subscription</article><div><span>US$10.00</span> per month</div></section>').label)
      .toEqual(labelled('current_subscription', 'unknown'));
    expect(page('<section><div>Current subscription</div><div><span>US$10.00</span> per month</div></section>').label)
      .toEqual(labelled('current_subscription', 'yes'));
    // The same for a heading that is itself a card element.
    expect(page('<section><h2 role="region">Current plan</h2><div><span>US$10.00</span> per month</div></section>').card)
      .toEqual(said('current_plan', 'unknown'));
  });

  it('passes "Current subscription" only from one identified compact card with no other amount, and loosens nothing else', () => {
    const priceLine = '<div><span>US$10.00</span> <span>per month</span></div>';
    const passes = (html: string, opts?: Parameters<typeof page>[1]) => page(html, opts).verdict.pass;
    // The portal-shaped card: caption, product, price, in one section, as a caption or as a heading, any case.
    expect(passes(`<section><div>CURRENT SUBSCRIPTION</div><div>SpeakSharp Pro</div>${priceLine}</section>`)).toBe(true);
    expect(passes(`<section>${h2('Current subscription')}<div>SpeakSharp Pro</div>${priceLine}</section>`)).toBe(true);
    expect(passes(`<article><div>current subscription</div>${priceLine}<button>Cancel subscription</button></article>`)).toBe(true);
    // "Current plan" passes as it always did, through the unchanged text rule.
    expect(passes(cardHtml(h2('Current plan')))).toBe(true);
    // A sibling card under a short wrapper, a nested card, or plain divs with no identified card: never.
    for (const wrapper of ['div', 'main']) {
      expect(passes(`<${wrapper}><section><div>CURRENT SUBSCRIPTION</div></section><section>${priceLine}</section></${wrapper}>`)).toBe(false);
    }
    expect(passes(`<section><article><div>CURRENT SUBSCRIPTION</div></article>${priceLine}</section>`)).toBe(false);
    expect(passes(`<section><article>Current subscription</article>${priceLine}</section>`)).toBe(false);
    expect(passes(`<div><div>CURRENT SUBSCRIPTION</div><div>SpeakSharp Pro</div>${priceLine}</div>`)).toBe(false);
    // Other wording, two captions, another amount in the card, or no cadence: never.
    expect(passes(cardHtml(h2('Your subscription')))).toBe(false);
    expect(passes(`<section><div>CURRENT SUBSCRIPTION</div><div>Your subscription</div>${priceLine}</section>`)).toBe(false);
    expect(passes(`<section><div>CURRENT SUBSCRIPTION</div>${priceLine}<div>Add-on US$5.00</div></section>`)).toBe(false);
    expect(passes(`<section><div>CURRENT SUBSCRIPTION</div><div><span>US$10.00</span> paid</div></section>`)).toBe(false);
    // A card past the compact limit is no card; a failed card read passes nothing.
    const long = `<p>${'Payment method Visa ending 4242. '.repeat(25)}</p>`;
    expect(passes(`<section><div>CURRENT SUBSCRIPTION</div>${long}${priceLine}</section>`)).toBe(false);
    expect(passes(`<section><div>CURRENT SUBSCRIPTION</div>${priceLine}</section>`, { args: undefined })).toBe(false);
    // Every miss word other than no_plan_block is returned exactly as the text rule gives it.
    for (const bad of [null, 'x', {}, { chains: [] }]) expect(portalPlanVerdict(bad)).toBe(portalPlanMiss(planSampleChains(bad)));
    const lineTooLong: PlanSample = { chains: [[`$10.00 per month ${'x'.repeat(PLAN_LINE_MAX)}`]], roots: ['document'], shown: 1,
      cards: [{ heading: 'current_subscription', same: 'yes', label: 'current_subscription', labelSame: 'yes', amounts: 'only_ten' }] };
    expect(portalPlanVerdict(lineTooLong)).toBe('line_too_long');
  });

  it('10 versus 11: labels come only from the ten elements the verdict reads, and a cap hit is said, not read past', () => {
    const receipts = (n: number, attrs = '') => Array.from({ length: n }, () => `<p ${attrs}>US$10.00 paid with Visa</p>`).join('');
    const eleven = page(receipts(10) + cardHtml(h2('Your subscription')));
    expect([eleven.sample.shown, eleven.sample.chains.length]).toEqual([11, 10]);
    // The page-level ancestor joins all eleven, so the verdict stops at line_too_long, never at the card's no_plan_block.
    expect(eleven.verdict.miss).toBe('line_too_long');
    expect(eleven.sample.cards).toEqual(Array(10).fill(null));
    expect(eleven.words).toEqual([...said('not_reached', 'not_reached'), ...labelled('not_reached', 'not_reached'), 'portal_plan_probe_roots_document', 'portal_plan_probe_kept_10_cap_hit']);
    const ten = page(receipts(9) + cardHtml(h2('Your subscription')));
    expect([ten.sample.shown, ten.sample.chains.length]).toEqual([10, 10]);
    expect(ten.verdict).toEqual({ miss: 'no_plan_block', split: { label: 'absent', block: 'none' }, pass: false });
    expect(ten.words).toEqual([...said('your_subscription', 'yes'), ...labelled('none', 'no'), 'portal_plan_probe_roots_document', 'portal_plan_probe_kept_10_cap_clear']);
    expect(page(receipts(10, 'hidden') + cardHtml(h2('Your subscription'))).words.slice(4))
      .toEqual(['portal_plan_probe_roots_document', 'portal_plan_probe_kept_1_cap_clear']);
  });

  it('an unrelated frame changes neither the sample nor a single label', () => {
    const plain = page(cardHtml(h2('Your subscription')));
    for (const frame of ['<iframe></iframe>', '<iframe srcdoc="<h2>Current plan</h2><p>US$10.00 per month</p>"></iframe>',
      '<frameset><frame></frameset>']) {
      const framed = page(`${frame}${cardHtml(h2('Your subscription'))}<iframe title="Current plan US$10.00 per month"></iframe>`);
      expect(framed.sample).toEqual(plain.sample);
      expect(framed.words).toEqual(plain.words);
      expect(framed.verdict).toEqual(plain.verdict);
    }
  });

  it('a visible heading under a box-less wrapper is read as the card heading, while the verdict reads it exactly as before', () => {
    const contents = (style: string) => (h: string) => `<div style="${style}">${h}</div>`;
    const wrapped = page(cardHtml(h2('Current plan'), contents('display:contents')), { chrome: true });
    // In Chrome the wrapper reads as not visible (no box), so the verdict's text skips the heading: label_absent, unchanged.
    expect(wrapped.verdict).toEqual({ miss: 'no_plan_block', split: { label: 'absent', block: 'none' }, pass: false });
    expect(wrapped.card).toEqual(said('current_plan', 'yes'));
    // Hidden wrappers and hidden headings stay hidden for the observer too.
    for (const style of ['display:contents;visibility:hidden', 'display:contents;opacity:0', 'display:none']) {
      expect(page(cardHtml(h2('Current plan'), contents(style)), { chrome: true }).card).toEqual(said('none', 'no'));
    }
    expect(page(cardHtml('<h2 hidden>Current plan</h2>'), { chrome: true }).card).toEqual(said('none', 'no'));
    expect(page(cardHtml('<div hidden style="display:contents"><h2>Current plan</h2></div>'), { chrome: true }).card).toEqual(said('none', 'no'));
    // The same wrapper with a box: both read the heading, and the verdict passes as it always did.
    const boxed = page(cardHtml(h2('Current plan'), (h) => `<div>${h}</div>`), { chrome: true });
    expect(boxed.verdict.miss).toBeNull();
    expect(boxed.card).toEqual(said('current_plan', 'yes'));
  });

  it('says where the elements live, and treats a shadow boundary as unknown rather than absent', () => {
    const outside = page(`<section>${h2('Current plan')}<plan-card></plan-card></section>`, { build: (doc) => {
      doc.querySelector('plan-card')!.attachShadow({ mode: 'open' }).innerHTML = `<div>SpeakSharp Pro</div><div>${line}</div>`;
    } });
    expect(outside.verdict).toEqual({ miss: 'no_plan_block', split: { label: 'absent', block: 'none' }, pass: false });
    expect(outside.words).toEqual([...said('none', 'unknown'), ...labelled('none', 'unknown'), 'portal_plan_probe_roots_shadow', 'portal_plan_probe_kept_1_cap_clear']);
    const inside = page('<plan-card></plan-card>', { build: (doc) => {
      doc.querySelector('plan-card')!.attachShadow({ mode: 'open' }).innerHTML = cardHtml(h2('Your plan'));
    } });
    expect(inside.card).toEqual(said('your_plan', 'yes'));
    const mixed = page(`<div>${line}</div><x-card></x-card>`, { build: (doc) => {
      doc.querySelector('x-card')!.attachShadow({ mode: 'open' }).innerHTML = `<div>${line}</div>`;
    } });
    expect(mixed.words[4]).toBe('portal_plan_probe_roots_mixed');
    expect(page('<p>Nothing priced here</p>').words).toEqual([...said('not_reached', 'not_reached'), ...labelled('not_reached', 'not_reached'), 'portal_plan_probe_roots_none',
      'portal_plan_probe_kept_0_cap_clear']);
  });

  it('a missing or broken observer input leaves the chains whole and reads not_reached or unreadable', () => {
    const html = cardHtml(h2('Current plan'));
    expect(page(html, { args: undefined }).sample.cards).toEqual([null]);
    expect(page(html, { args: undefined }).card).toEqual(said('not_reached', 'not_reached'));
    // A pattern the page cannot build fails only that card read.
    const broken = page(html, { args: { ...PLAN_PROBE_ARGS, cadence: ['(', ''] } });
    expect(broken.sample.cards).toEqual([null]);
    expect(broken.verdict.miss).toBeNull();
  });

  it('leaves pass/fail, the miss word and the split exactly as they were, and reads anything malformed as unreadable', () => {
    expect(planSampleChains(null)).toBeNull();
    for (const bad of [null, 'x', {}, 3]) expect(portalPlanMiss(planSampleChains(bad))).toBe('unreadable');
    const yes: PlanCardRead = { heading: 'your_plan', same: 'yes', label: 'none', labelSame: 'no', amounts: 'only_ten' };
    const good: PlanSample = { chains: [[line, 'Your plan']], roots: ['document'], shown: 1, cards: [yes] };
    expect(portalPlanObserver(good)).toHaveLength(6);
    for (const bad of [null, undefined, 'x', {}, { ...good, cards: [] }, { ...good, roots: ['frame'] }, { ...good, roots: [] },
      { ...good, shown: 0 }, { ...good, shown: 1.5 }, { ...good, cards: [{ ...yes, heading: 'Current plan' }] },
      { ...good, cards: [{ ...yes, same: 'maybe' }] }, { ...good, cards: [{ ...yes, label: 'CURRENT SUBSCRIPTION' }] },
      { ...good, cards: [{ ...yes, labelSame: 'maybe' }] }, { ...good, cards: [{ heading: 'your_plan', same: 'yes' }] },
      { ...good, cards: [{ ...yes, amounts: 'some' }] }, { ...good, chains: Array(11).fill([line]),
        roots: Array(11).fill('document'), cards: Array(11).fill(null), shown: 11 }]) {
      expect(portalPlanObserver(bad)).toEqual(['portal_plan_probe_unreadable']);
    }
    expect(portalShowsPlan([[line, 'Your subscription\nSpeakSharp Pro']])).toBe(false);
  });

  it('leaves only fixed words that fit the progress line alphabet', () => {
    const headings = [...PLAN_PROBE_HEADINGS.map(([name]) => name), 'other_text', 'none', 'unknown', 'mixed', 'not_reached'];
    const names = [...headings.map((h) => `portal_plan_probe_card_heading_${h}`),
      ...['yes', 'no', 'unknown', 'not_reached'].map((v) => `portal_plan_probe_same_card_${v}`),
      ...headings.map((h) => `portal_plan_probe_card_label_${h}`),
      ...['yes', 'no', 'unknown', 'not_reached'].map((v) => `portal_plan_probe_label_same_card_${v}`),
      ...['document', 'shadow', 'other', 'mixed', 'none'].map((r) => `portal_plan_probe_roots_${r}`),
      ...Array.from({ length: 11 }, (_, n) => [`portal_plan_probe_kept_${n}_cap_clear`, `portal_plan_probe_kept_${n}_cap_hit`]).flat(),
      'portal_plan_probe_unreadable'];
    for (const name of names) expect(progressLine('checkpoint', name, 0)).not.toContain('=invalid');
    expect(new Set(names).size).toBe(names.length);
    const s: PlanSample = { chains: [[line], [line]], roots: ['other', 'shadow'], shown: 12,
      cards: [{ heading: 'other_text', same: 'unknown', label: 'current_subscription', labelSame: 'yes', amounts: 'only_ten' },
        { heading: 'none', same: 'no', label: 'none', labelSame: 'no', amounts: 'no_region' }] };
    for (const w of portalPlanObserver(s)) expect(names).toContain(w);
  });

  it('the spec reads once, gives the verdict only the chains, and runs the observer on that same sample after the miss', () => {
    const spec = readFileSync(new URL('./journey.billing.spec.ts', import.meta.url), 'utf8');
    const body = spec.slice(spec.indexOf('async awaitPortalPlan('), spec.indexOf('async planSample('));
    expect(body).toContain('(miss = portalPlanVerdict(sample = await this.planSample(page).catch(() => null)))');
    expect(body).toMatch(/\(m\) => m === null, 'portal_plan_not_shown'\)\.catch\(\(\) => \{/);
    expect(body).toContain("if (miss === 'no_plan_block') this.checkpoint(portalPlanSplitCheckpoint(portalPlanSplit(planSampleChains(sample))));");
    expect(body).toContain("if (miss === 'no_plan_block') this.portalPlanProbe(sample);");
    expect(body.indexOf('this.portalPlanProbe(sample)')).toBeLessThan(body.indexOf('throw new Error(`BILLING_JOURNEY:portal_plan_not_shown_'));
    expect(body).toContain('throw new Error(`BILLING_JOURNEY:portal_plan_not_shown_${miss ?? \'unreadable\'}`);');
    expect(body.match(/throw new Error/g)).toHaveLength(1);
    expect(body).not.toMatch(/await this\.portalPlanProbe|evaluateAll/);
    expect(spec.match(/evaluateAll\(/g)).toHaveLength(1);
    const probe = spec.slice(spec.indexOf('  portalPlanProbe('), spec.indexOf('\n  }\n', spec.indexOf('  portalPlanProbe(')));
    expect(probe).toMatch(/^\s+portalPlanProbe\(sample: unknown\): void \{\n\s+try \{\n\s+for \(const name of portalPlanObserver\(sample\)\) this\.checkpoint\(name\);/);
    expect(probe).toContain("} catch {\n      this.checkpoint('portal_plan_probe_unreadable');");
    expect(probe).not.toMatch(/await|page|innerText|textContent|throw |steps\.add|requireFact/);
  });
});

describe('option 1: at the portal step, Stripe\'s own test-mode record must still show this run\'s plan current', () => {
  const price = { id: 'price_test_10', livemode: false, active: true, unit_amount: 1000, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } };
  const sub = { id: 'sub_run', livemode: false, customer: 'cus_run', status: 'active', cancel_at_period_end: false, items: { data: [{ price }] } };
  const facts = { subscription: 'sub_run', customer: 'cus_run', price: 'price_test_10' };
  const code = (input: unknown, f: typeof facts | { subscription: string; customer: string; price: string | undefined } = facts) => {
    try { assertPortalSubscription(input, f); return 'ok'; } catch (e) { return (e as Error).message.replace(/^BILLING_JOURNEY:/, ''); }
  };

  it('passes only the run\'s active, test-mode, not-cancelling subscription on its one $10.00 monthly test price', () => {
    expect(code(sub)).toBe('ok');
    for (const bad of [null, {}, 'x', { ...sub, id: 'sub_other' }, { ...sub, livemode: true }, { ...sub, customer: 'cus_other' },
      { ...sub, status: 'past_due' }, { ...sub, status: 'canceled' }, { ...sub, status: 'trialing' }, { ...sub, cancel_at_period_end: true },
      { ...sub, cancel_at_period_end: undefined }, { ...sub, items: { data: [] } }, { ...sub, items: { data: [{ price }, { price }] } },
      { ...sub, items: { data: [{ price: { ...price, id: 'price_other' } }] } }, { ...sub, items: undefined }]) {
      expect(code(bad)).toBe('portal_subscription_not_current');
    }
    expect(code(sub, { ...facts, price: undefined })).toBe('portal_subscription_not_current');
    expect(code(sub, { ...facts, subscription: '' })).toBe('portal_subscription_not_current');
    // The price itself is bound exactly as at checkout.
    expect(code({ ...sub, items: { data: [{ price: { ...price, unit_amount: 2000 } }] } })).toBe('wrong_price');
    expect(code({ ...sub, items: { data: [{ price: { ...price, livemode: true } }] } })).toBe('price_not_active_test');
  });

  it('the spec reads the subscription once the portal shows the plan, in J9.a and J9.b alike, and loosens nothing', () => {
    const spec = readFileSync(new URL('./journey.billing.spec.ts', import.meta.url), 'utf8');
    const body = spec.slice(spec.indexOf('async awaitPortalPlan('), spec.indexOf('async planSample('));
    const check = body.indexOf('assertPortalSubscription(await this.stripe(`subscriptions/${this.subscription}`),');
    expect(check).toBeGreaterThan(body.indexOf("'portal_plan_not_shown').catch("));
    expect(body.slice(check)).toContain('{ subscription: this.subscription, customer: this.customer, price: env.BILLING_SANDBOX_PRICE_ID });');
    expect(body.match(/assertPortalSubscription\(/g)).toHaveLength(1);
    expect(spec.match(/await this\.awaitPortalPlan\(/g)).toHaveLength(2);
    // The checkout-time subscription assertions are untouched.
    expect(spec).toContain("requireFact(sub.items?.data?.length === 1 && sub.items.data[0].price.id === env.BILLING_SANDBOX_PRICE_ID, 'subscription_price_identity');");
  });
});
