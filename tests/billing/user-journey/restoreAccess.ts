/**
 * J9.b, `restore_access`: an expired trial is walled, and one Stripe TEST-MODE payment restores access on the same account.
 *
 * Akin, 2026-11-21: "There will be no "real charge". Test charge is the success criteria. Period." Any user gets the whole
 * product free for 30 days; an unpaid account then loses the app and its saved work; paying restores both (#1863).
 *
 * The browser journey (`journey.billing.spec.ts`, journey `restore_access`) feeds these checks:
 *   1. a take saved during the trial, read back by the member and listed on Progress,
 *   2. after the trial ends: the member's own read of that take is empty while the row is kept (walled, not deleted),
 *   3. after one $10 test-mode Checkout: exactly one succeeded charge, and it is the already-verified first invoice's,
 *   4. the member's own read returns the same take with the same content-free facts (restored, unchanged),
 *   5. Manage billing shows the $10 monthly plan: price, cadence and current-plan label visible in the same plan block.
 *
 * Pure checks only: no network, no secrets, no transcript text kept (rows arrive as digests, `sessionFactsFromRows`). Every
 * failure is a closed code. The offline controls are `restoreAccess.test.ts`. This journey never replays a webhook event. A
 * duplicate delivery through the real webhook handler into the migrated ledger is proven offline, with no Stripe call, in
 * scripts/billing-qualification/runner.test.ts ("the same event delivered twice").
 */
import { requireFact } from './contract';
import { compareSessionRows, type SessionRowFacts } from '../../live/helpers/rwtNavigationRows';

/** Our test price: $10.00 a month (assertTestPrice binds the price itself; this binds the one charge to it). */
const AMOUNT = 1000;
const CURRENCY = 'usd';

/** The take saved during the trial, as the member's own read returns it: completed, with a transcript, listed once. */
export function assertTakeReadable(facts: readonly SessionRowFacts[] | null, takeId: string, code: string): void {
  requireFact(facts && typeof takeId === 'string' && takeId.length > 0, code);
  const own = facts.filter((r) => r.id === takeId);
  requireFact(own.length === 1 && own[0].status === 'completed' && own[0].transcriptDigest !== null, code);
}

/**
 * The member client is still signed in as this run's own account. A signed-out read of walled history is also an empty list,
 * so an empty read counts as the wall only between two of these checks (Sam on #1937).
 */
export function assertMemberIsRunAccount(who: { data?: { user?: { id?: unknown; email?: unknown } | null } | null; error?: unknown } | null,
  f: { uid: string; email: string }): void {
  const user = who && !who.error ? who.data?.user : null;
  requireFact(typeof f.uid === 'string' && f.uid.length > 0 && typeof f.email === 'string' && f.email.length > 0, 'walled_member_unbound');
  requireFact(user && user.id === f.uid && typeof user.email === 'string' && user.email.toLowerCase() === f.email.toLowerCase(),
    'walled_member_not_run_account');
}

/**
 * Walled, not deleted: the signed-in member's own read is a readable empty list, while the service read still holds the
 * same take. An unreadable member read is never "walled", and a missing row is deletion, not a wall. The caller proves the
 * member is still this run's account around the read (assertMemberIsRunAccount).
 */
export function assertHistoryWalled(member: readonly SessionRowFacts[] | null, kept: readonly SessionRowFacts[] | null,
  takeId: string): void {
  requireFact(member !== null, 'walled_history_unreadable');
  requireFact(member.length === 0, 'history_readable_after_trial');
  requireFact(kept !== null && kept.some((r) => r.id === takeId), 'history_deleted_at_trial_end');
}

/**
 * Restored, unchanged: after payment the member's own read is exactly the history read during the trial (same ids, same
 * content-free facts), and that history held the trial take. Read before the next take, so nothing may be added.
 */
export function assertHistoryRestored(before: readonly SessionRowFacts[] | null, after: readonly SessionRowFacts[] | null,
  takeId: string): void {
  assertTakeReadable(before, takeId, 'pre_expiry_history_missing');
  requireFact(after !== null, 'restored_history_unreadable');
  const d = compareSessionRows(before!, after);
  requireFact(d.removed === 0 && d.changed === 0 && d.added === 0, 'history_not_restored_unchanged');
}

/** A Stripe charge as the journey reads it (test-mode objects only; provider fields are untrusted until checked). */
export interface ChargeRow {
  id?: unknown; object?: unknown; livemode?: unknown; status?: unknown; paid?: unknown; amount?: unknown; currency?: unknown;
  customer?: unknown; refunded?: unknown; amount_refunded?: unknown;
}

/**
 * Exactly one successful test-mode charge: the customer's complete charge list holds one charge, it succeeded for exactly
 * $10.00 USD, nothing was refunded, and it is the first invoice's own charge. A partial or unreadable list proves nothing.
 */
export function assertSingleCharge(listed: { data?: unknown; has_more?: unknown } | null, f: { customer: string; invoiceCharge: string }): void {
  requireFact(listed && Array.isArray(listed.data) && listed.has_more === false, 'charge_list_unreadable');
  requireFact(typeof f.invoiceCharge === 'string' && f.invoiceCharge.startsWith('ch_'), 'invoice_charge_missing');
  const charges = listed.data as ChargeRow[];
  requireFact(charges.length === 1, 'charge_count_not_one');
  const c = charges[0];
  requireFact(c && c.id === f.invoiceCharge && c.customer === f.customer, 'charge_not_invoice_charge');
  requireFact(c.object === 'charge' && c.livemode === false, 'charge_not_test_mode');
  requireFact(c.status === 'succeeded' && c.paid === true && c.amount === AMOUNT && c.currency === CURRENCY
    && c.refunded === false && c.amount_refunded === 0, 'charge_not_ten_usd_succeeded');
}

/** An invoice as the journey reads it (test-mode objects only; provider fields are untrusted until checked). */
export interface InvoiceRow {
  id?: unknown; object?: unknown; livemode?: unknown; status?: unknown; amount_paid?: unknown; currency?: unknown;
  billing_reason?: unknown; customer?: unknown; subscription?: unknown; charge?: unknown;
}

/**
 * The charge of the first invoice that hosted Checkout created and the journey already verified (`first_invoice`), read by
 * that invoice's own id. Never the subscription's latest invoice, which a later invoice replaces (Sam on #1937).
 */
export function firstInvoiceCharge(invoice: InvoiceRow | null, f: { firstInvoice: string; customer: string; subscription: string }): string {
  requireFact(typeof f.firstInvoice === 'string' && f.firstInvoice.startsWith('in_'), 'first_invoice_unbound');
  requireFact(invoice && invoice.id === f.firstInvoice && invoice.object === 'invoice', 'invoice_not_first_invoice');
  requireFact(invoice.billing_reason === 'subscription_create' && invoice.customer === f.customer
    && invoice.subscription === f.subscription, 'invoice_not_first_invoice');
  requireFact(invoice.livemode === false && invoice.status === 'paid' && invoice.amount_paid === AMOUNT && invoice.currency === CURRENCY,
    'first_invoice_not_paid_test');
  const charge = typeof invoice.charge === 'string' ? invoice.charge
    : invoice.charge && typeof invoice.charge === 'object' ? (invoice.charge as { id?: unknown }).id : null;
  requireFact(typeof charge === 'string' && charge.startsWith('ch_'), 'invoice_charge_missing');
  return charge;
}

const PLAN_PRICE = /\$\s?10\.00(?!\d)/;
const PLAN_CADENCE = /(\bper month|\/\s?month|\bmonthly|\bevery month)\b/i;
/**
 * The heading of the block that names the plan, unchanged: "Current plan". Run 45361320828 opened the portal and never passed
 * in 120 s, and which condition failed is unread (no page text leaves). A timeout now names it (`portalPlanMiss`); a
 * different heading reads as `no_plan_block`. The check is widened only after a run shows why (Sam, 2026-11-24).
 */
const PLAN_LABEL = /\bcurrent plan\b/i;
const MONEY = /\$\s?\d[\d,]*(?:\.\d+)?/g;
/** Longest text of the element that carries the price and its cadence, and of the current-plan block around it. */
export const PLAN_LINE_MAX = 200;
export const PLAN_BLOCK_MAX = 600;
const onlyTenDollars = (t: string): boolean => {
  const amounts = t.match(MONEY) ?? [];
  return amounts.length > 0 && amounts.every((a) => /^\$\s?10\.00$/.test(a));
};

/**
 * Why no chain passes, as one fixed content-free word (null: one passes). The furthest any visible $10.00 got decides it,
 * so a failed run names the condition that stopped it (no page text ever leaves): `unreadable` (the read failed or was not
 * text chains), `no_visible_price`, `no_cadence` (no ancestor adds a monthly cadence), `line_too_long`, `no_plan_block` (no
 * short enough ancestor names the current plan), `other_amount` (that block names an amount other than $10.00).
 */
export type PortalPlanMiss = 'unreadable' | 'no_visible_price' | 'no_cadence' | 'line_too_long' | 'no_plan_block' | 'other_amount';
const MISS_ORDER: readonly PortalPlanMiss[] = ['unreadable', 'no_visible_price', 'no_cadence', 'line_too_long', 'no_plan_block', 'other_amount'];

export function portalPlanMiss(ancestries: unknown): PortalPlanMiss | null {
  if (!Array.isArray(ancestries)) return 'unreadable';
  let furthest: PortalPlanMiss = ancestries.length === 0 ? 'no_visible_price' : 'unreadable';
  const reach = (m: PortalPlanMiss): void => { if (MISS_ORDER.indexOf(m) > MISS_ORDER.indexOf(furthest)) furthest = m; };
  for (const chain of ancestries) {
    if (!Array.isArray(chain) || chain.length === 0 || !chain.every((t) => typeof t === 'string')) continue;
    if (!PLAN_PRICE.test(chain[0])) { reach('no_visible_price'); continue; }
    const line = chain.findIndex((t: string) => PLAN_CADENCE.test(t));
    if (line < 0) { reach('no_cadence'); continue; }
    if (chain[line].length > PLAN_LINE_MAX) { reach('line_too_long'); continue; }
    // The block holds the line (it is the line or an ancestor), so its amount check covers the line's too.
    const block = chain.slice(line).find((t: string) => PLAN_LABEL.test(t));
    if (typeof block !== 'string' || block.length > PLAN_BLOCK_MAX) { reach('no_plan_block'); continue; }
    if (!onlyTenDollars(block)) { reach('other_amount'); continue; }
    return null;
  }
  return furthest;
}

/**
 * Manage billing (the Stripe portal) shows the plan: one element holds the $10.00 price and its monthly cadence together,
 * inside the current-plan block (Sam on #1937). The spec passes, for each VISIBLE element showing $10.00, the visible text of
 * that element and each of its ancestors, innermost first (`visiblePlanChains`). The nearest one that adds the cadence must be short, and the nearest one at or
 * above it that names the current plan must be short and name no amount but $10.00, so a price and a cadence from
 * unrelated parts of the page, which only the page as a whole joins, never pass. The text stays in memory; only this boolean (and `portalPlanMiss`'s fixed word) leaves.
 */
export function portalShowsPlan(ancestries: unknown): boolean {
  return portalPlanMiss(ancestries) === null;
}

/**
 * Runs in the portal page (the spec's `evaluateAll`) and, in `restoreAccess.test.ts`, in a local DOM, so it is self-contained:
 * it uses nothing from this module. Given the elements Playwright matched for $10.00 (hidden ones included), it keeps only the
 * ones that are visible, with every ancestor visible, and returns for each (at most 10) the VISIBLE text of the element and of
 * each ancestor, innermost first. Visible text skips any descendant that is not rendered, so a hidden $10.00 plan can neither
 * supply the price nor hide a visible wrong plan's amount (Sam on #1937). An element counts as hidden when it has the `hidden`
 * attribute, or its computed style is display none, visibility hidden or collapse, or opacity 0, or the browser's own
 * `checkVisibility` says so. Visibility is judged per element, so a visible child inside a visibility-hidden parent also counts
 * as hidden: that fails closed. The text stays in the page and in memory; only `portalShowsPlan`'s boolean leaves.
 */
export function visiblePlanChains(elements: Element[]): string[][] {
  const rendered = (el: Element): boolean => {
    const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
    if (!style || (el as HTMLElement).hidden || style.display === 'none' || style.visibility === 'hidden'
      || style.visibility === 'collapse' || style.opacity === '0') return false;
    const check = (el as Element & { checkVisibility?: (options?: object) => boolean }).checkVisibility;
    return typeof check !== 'function' || check.call(el, { opacityProperty: true, visibilityProperty: true });
  };
  const shown = (el: Element): boolean => {
    for (let e: Element | null = el; e; e = e.parentElement) if (!rendered(e)) return false;
    return true;
  };
  const visibleText = (el: Element): string => {
    const parts: string[] = [];
    const walk = (node: Node): void => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) parts.push(child.nodeValue ?? '');
        else if (child.nodeType === 1 && !['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes((child as Element).tagName)
          && rendered(child as Element)) walk(child);
      }
    };
    walk(el);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  };
  const chains: string[][] = [];
  for (const el of elements.filter(shown).slice(0, 10)) {
    const chain: string[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) chain.push(visibleText(e));
    chains.push(chain);
  }
  return chains;
}
