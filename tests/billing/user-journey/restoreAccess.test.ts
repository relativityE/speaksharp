// @vitest-environment node
/**
 * Offline controls for J9.b's `restore_access` checks (restoreAccess.ts) and their wiring in the billing spec. No browser,
 * account, Stripe call or network: each check must refuse the failure it exists to catch. Not journey acceptance.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { assertTakeReadable, assertMemberIsRunAccount, assertHistoryWalled, assertHistoryRestored, assertSingleCharge, firstInvoiceCharge,
  portalShowsPlan, portalPlanMiss, visiblePlanChains, PLAN_LINE_MAX, PLAN_BLOCK_MAX } from './restoreAccess';
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
  // visiblePlanChains, then portalShowsPlan. Elements that directly hold a $10.00 text node stand in for getByText's matches.
  const read = (html: string, css = ''): boolean => {
    const window = new Window();
    const doc = window.document as unknown as Document;
    doc.body.innerHTML = `<style>${css}</style>${html}`;
    const matched = Array.from(doc.querySelectorAll('body *')).filter((el) => Array.from(el.childNodes)
      .some((n) => n.nodeType === 3 && /\$\s?10\.00/.test(n.nodeValue ?? '')));
    const shown = portalShowsPlan(visiblePlanChains(matched));
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
    const portal = spec.slice(spec.indexOf('  async portalPlan(): Promise<void> {'), spec.indexOf('  async planAncestries(page: Page): Promise<string[][]> {'));
    expect(portal.length).toBeGreaterThan(0);
    expect(portal).toMatch(/waitForURL\(url => url\.origin === 'https:\/\/billing\.stripe\.com'/);
    // The portal check reads per-element ancestries, never the whole page's text, and a timeout names its fixed reason.
    expect(portal).toMatch(/await this\.awaitPortalPlan\(this\.page\);/);
    expect(spec).toMatch(/portalPlanMiss\(await this\.planAncestries\(page\)\.catch\(\(\) => null\)\)/);
    expect(spec).toMatch(/throw new Error\(`BILLING_JOURNEY:portal_plan_not_shown_\$\{miss \?\? 'unreadable'\}`\)/);
    // J9.a's paid_account_kept reads the same way in its fresh context: never its own innerText scan.
    const kept = spec.slice(spec.indexOf("this.stage = 'portal_plan_shown';"), spec.indexOf("this.steps.add('portal_plan_shown');"));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept).toMatch(/await this\.awaitPortalPlan\(other\);/);
    expect(kept).not.toMatch(/innerText|textContent|querySelectorAll/);
    // Only visible $10.00 elements, read as visible text (visiblePlanChains), never innerText (which includes hidden content).
    expect(spec).toMatch(/return page\.getByText\(\/\\\$\\s\?10\\\.00\/\)\.evaluateAll\(visiblePlanChains\);/);
    const ancestries = spec.slice(spec.indexOf('  async planAncestries(page: Page): Promise<string[][]> {'));
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
