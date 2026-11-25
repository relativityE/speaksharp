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
import { requireFact, assertTestPrice } from './contract';
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
 * The heading of the block that names the plan, unchanged here: "Current plan". Run 45361320828 opened the portal and never passed
 * in 120 s, and which condition failed is unread (no page text leaves). A timeout now names it (`portalPlanMiss`); a
 * different heading reads as `no_plan_block`. The portal's "Current subscription" wording passes only through
 * `portalPlanVerdict`, and only through the section rule read from the real portal (`currentSubscriptionSection`), never through
 * this text rule.
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
 * Option 1 (Akin, 2026-11-25: "Yes, add option 1", "Yes, bundle the fix"): when the portal is checked, Stripe's own test-mode
 * record of this run's subscription must still show the plan current: this run's subscription and customer, test mode, active,
 * not set to cancel at period end, exactly one item on the run's test price, and that price $10.00 monthly (`assertTestPrice`).
 * It only adds requirements to the portal step; any miss is `portal_subscription_not_current` (or assertTestPrice's own code).
 */
export function assertPortalSubscription(input: unknown, f: { subscription: string; customer: string; price: string | undefined }): void {
  const sub = (input ?? {}) as { id?: unknown; livemode?: unknown; customer?: unknown; status?: unknown; cancel_at_period_end?: unknown;
    items?: { data?: unknown } };
  const items = Array.isArray(sub.items?.data) ? sub.items.data as Array<{ price?: { id?: unknown } } | null> : [];
  requireFact(typeof f.subscription === 'string' && f.subscription.startsWith('sub_') && typeof f.price === 'string' && f.price.length > 0
    && sub.id === f.subscription && sub.livemode === false && sub.customer === f.customer && sub.status === 'active'
    && sub.cancel_at_period_end === false && items.length === 1 && items[0]?.price?.id === f.price, 'portal_subscription_not_current');
  assertTestPrice(items[0]?.price);
}

/** Length bucket of the smallest current-plan block, in multiples of PLAN_BLOCK_MAX; `none` when no ancestor names it. */
export type PlanBlockBucket = 'none' | 'within_limit' | 'up_to_2x' | 'up_to_4x' | 'over_4x';
const BUCKET_ORDER: readonly PlanBlockBucket[] = ['within_limit', 'up_to_2x', 'up_to_4x', 'over_4x', 'none'];
const blockBucket = (length: number): PlanBlockBucket => length <= PLAN_BLOCK_MAX ? 'within_limit'
  : length <= 2 * PLAN_BLOCK_MAX ? 'up_to_2x' : length <= 4 * PLAN_BLOCK_MAX ? 'up_to_4x' : 'over_4x';

/**
 * Splits a `no_plan_block` miss into its two possible causes, content-free (Sam, 2026-11-24, after run 45496024399). Only chains
 * that already passed the price, cadence and line checks count. `label` says whether any element at or above such a line names the
 * current plan (each chain runs to the page root, so `absent` means the label is not visible text anywhere on the page). `block`
 * is the length bucket of the smallest such element across those chains. Diagnostic only: it never changes `portalPlanMiss` or
 * `portalShowsPlan`, and only these fixed words leave; null when no chain reached the block check.
 */
export function portalPlanSplit(ancestries: unknown): { label: 'present' | 'absent'; block: PlanBlockBucket } | null {
  if (!Array.isArray(ancestries)) return null;
  let reached = false;
  let best: PlanBlockBucket = 'none';
  for (const chain of ancestries) {
    if (!Array.isArray(chain) || chain.length === 0 || !chain.every((t) => typeof t === 'string')) continue;
    if (!PLAN_PRICE.test(chain[0])) continue;
    const line = chain.findIndex((t: string) => PLAN_CADENCE.test(t));
    if (line < 0 || chain[line].length > PLAN_LINE_MAX) continue;
    reached = true;
    const block = chain.slice(line).find((t: string) => PLAN_LABEL.test(t));
    if (typeof block !== 'string') continue;
    const bucket = blockBucket(block.length);
    if (BUCKET_ORDER.indexOf(bucket) < BUCKET_ORDER.indexOf(best)) best = bucket;
  }
  return reached ? { label: best === 'none' ? 'absent' : 'present', block: best } : null;
}

/** The split as one progress checkpoint name (`progressLine`'s alphabet), e.g. `portal_plan_split_label_present_block_up_to_2x`. */
export function portalPlanSplitCheckpoint(split: ReturnType<typeof portalPlanSplit>): string {
  return split === null ? 'portal_plan_split_not_reached' : `portal_plan_split_label_${split.label}_block_${split.block}`;
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

/**
 * Closed heading labels the J9 observer can report, most specific first. Diagnostic only: the verdict still needs "Current plan".
 */
export const PLAN_PROBE_HEADINGS = [
  ['current_plan', /\bcurrent plan\b/i],
  ['current_subscription', /\bcurrent subscriptions?\b/i],
  ['your_subscription', /\byour subscriptions?\b/i],
  ['your_plan', /\byour plan\b/i],
  ['plan_or_subscription_word', /\b(?:plan|subscription)s?\b/i],
] as const;
export type PlanCardHeading = typeof PLAN_PROBE_HEADINGS[number][0] | 'other_text' | 'none' | 'unknown';
export type PlanSameCard = 'yes' | 'no' | 'unknown';
/**
 * One candidate's card read: the closed label of the visible semantic heading near it and whether that heading is in the same
 * card, and the same two for a short visible section label (styled text, not a heading element; e.g. a small uppercase caption).
 */
export interface PlanCardRead {
  heading: PlanCardHeading; same: PlanSameCard; label: PlanCardHeading; labelSame: PlanSameCard;
  /**
   * Observer only since run 45652762097 (it never matched Stripe's real page; `currentSubscriptionSection` decides now): the price element's nearest
   * card element (itself included) also holds the cadence in its own visible text (never a nested card's), fits the compact limit, names no amount but $10.00, and holds
   * exactly one listed heading or caption of its own, whose whole visible text is "Current subscription" (any case and spacing).
   */
  subscription: 'yes' | 'no';
}
/** What the observer needs inside the page, as plain data (patterns travel as source and flags; no code). */
export interface PlanProbeArgs {
  price: [string, string]; cadence: [string, string]; money: [string, string]; accept: string; lineMax: number; cardMax: number;
  labelMax: number;
  headings: Array<[string, string, string]>;
}
/** Longest visible text of an element read as a section label (a caption such as "CURRENT SUBSCRIPTION", not a sentence). */
export const PLAN_LABEL_TEXT_MAX = 40;
/** The portal's own plan wording, matched whole: the card's caption or heading must read exactly this, in any case and spacing. */
export const PLAN_SUBSCRIPTION_LABEL = 'current subscription';
/** The verdict's own price, cadence and line limit, PLAN_BLOCK_MAX as the compact card's limit, and the label text limit. */
export const PLAN_PROBE_ARGS: PlanProbeArgs = {
  price: [PLAN_PRICE.source, PLAN_PRICE.flags], cadence: [PLAN_CADENCE.source, PLAN_CADENCE.flags], money: [MONEY.source, MONEY.flags],
  accept: PLAN_SUBSCRIPTION_LABEL, lineMax: PLAN_LINE_MAX,
  cardMax: PLAN_BLOCK_MAX, labelMax: PLAN_LABEL_TEXT_MAX, headings: PLAN_PROBE_HEADINGS.map(([name, re]) => [name, re.source, re.flags]),
};

/**
 * The portal sample the J9 check reads, with a local-only observer beside it (Sam, 2026-11-25: PO approved preparing and testing
 * it locally). Runs in the portal page (the spec's single `evaluateAll`) and in a local DOM in the tests, so it is self-contained.
 * `chains` is computed by the same code as `visiblePlanChains`, over the same elements (same visibility rule, same first ten), and
 * is the only thing the verdict reads: the tests prove it equals `visiblePlanChains` on every fixture. Beside it, for those same
 * ten elements and nothing else on the page, and with no text leaving the page:
 *  - `shown`: how many matches were visible before the ten-element cap (a cap hit is said, never read past);
 *  - `roots`: where each lives, `document`, `shadow` (an open shadow root, whose chain stops at the boundary) or `other`;
 *  - `cards`: for each element that passes the verdict's own price, cadence and line checks (null otherwise), two reads.
 *    `heading`: the closed label of the visible semantic heading (h1 to h6, or role=heading) in the nearest ancestor, from the
 *    price/cadence line up, that holds one while its visible text is within `cardMax` (the most specific listed phrase when it holds
 *    several); `unknown` if `cardMax` is passed first; `none` if the root is reached first. `same`: `yes` only when the plan region
 *    is identified on its own, as the nearest ancestor at or above the line that is a card element (section, article, li,
 *    fieldset, or role region, group, listitem or article, or aria-labelledby) within `cardMax`, and that element holds exactly one
 *    visible heading. A short wrapper that merely joins two cards is never such an element, so it never yields `yes` (Sam,
 *    2026-11-25). `no` only when no heading is visible anywhere up to the page root within `cardMax`. Everything else, including
 *    no card element, a card element without exactly one heading, overflow, or a shadow or detached root, is `unknown`.
 *    `label` and `labelSame`: the same two reads for a section label, an element that is not a heading, link, button or form
 *    control, whose own visible text is at most `labelMax` and names a listed phrase, counting only the innermost such element.
 *    Stripe's portal may draw its caption as styled text rather than a heading element, so this is read alongside, never instead.
 *    A heading or label counts as visible when it and every ancestor up to the region are rendered, where a box-less (display: contents)
 *    wrapper with otherwise visible style counts: Chrome's `checkVisibility` reports such a wrapper as not visible because it has
 *    no box, and the verdict's text skips it. A failure here leaves that card null and the chains untouched.
 */
export interface PlanSample { chains: string[][]; roots: Array<'document' | 'shadow' | 'other'>; shown: number; cards: Array<PlanCardRead | null> }

export function visiblePlanSample(elements: Element[], args?: PlanProbeArgs): PlanSample {
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
  const textOf = (el: Element, keep: (e: Element) => boolean): string => {
    const parts: string[] = [];
    const walk = (node: Node): void => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) parts.push(child.nodeValue ?? '');
        else if (child.nodeType === 1 && !['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes((child as Element).tagName)
          && keep(child as Element)) walk(child);
      }
    };
    walk(el);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  };
  // Observer only: a box-less element counts as rendered when its style is otherwise visible; every other rule is unchanged.
  const boxTolerant = (el: Element): boolean => {
    if (rendered(el)) return true;
    const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
    return !!style && style.display === 'contents' && !(el as HTMLElement).hidden && style.visibility !== 'hidden'
      && style.visibility !== 'collapse' && style.opacity !== '0';
  };
  const card = (path: Element[], chain: string[], root: 'document' | 'shadow' | 'other'): PlanCardRead | null => {
    if (!args) return null;
    const re = ([source, flags]: [string, string]) => new RegExp(source, flags);
    if (!re(args.price).test(chain[0])) return null;
    const cadence = re(args.cadence);
    const line = chain.findIndex((t) => cadence.test(t));
    if (line < 0 || chain[line].length > args.lineMax) return null;
    const labels = args.headings.map(([name, source, flags]) => [name, new RegExp(source, flags)] as const);
    const visibleIn = (region: Element, el: Element): boolean => {
      for (let e: Element | null = el; e && e !== region; e = e.parentElement) if (!boxTolerant(e)) return false;
      return true;
    };
    const headsIn = (region: Element): Element[] => Array.from(region.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'))
      .filter((h) => visibleIn(region, h));
    const listed = (text: string): number => {
      const hit = labels.findIndex(([, phrase]) => phrase.test(text));
      return hit < 0 ? labels.length : hit;
    };
    const notLabel = 'h1, h2, h3, h4, h5, h6, [role="heading"], a, button, input, select, textarea, label, [role="button"], [role="link"]';
    const isLabel = (el: Element): boolean => {
      if (el.matches(notLabel) || el.closest('a, button, [role="button"], [role="link"]')) return false;
      const text = textOf(el, boxTolerant);
      return text.length > 0 && text.length <= args.labelMax && listed(text) < labels.length;
    };
    const labelsIn = (region: Element): Element[] => Array.from(region.querySelectorAll('*'))
      .filter((el) => isLabel(el) && visibleIn(region, el) && !Array.from(el.querySelectorAll('*')).some(isLabel));
    const labelOf = (found: Element[]): PlanCardHeading => {
      let best = labels.length;
      for (const el of found) best = Math.min(best, listed(textOf(el, boxTolerant)));
      return (best < labels.length ? labels[best][0] : 'other_text') as PlanCardHeading;
    };
    const cardElement = 'section, article, li, fieldset, [role="region"], [role="group"], [role="listitem"], [role="article"], [aria-labelledby]';
    // Only the price's nearest card element counts, and only with exactly one visible heading (or label) whose own nearest card
    // element is that same one.
    const region = path.slice(line).find((e, k) => chain[line + k].length <= args.cardMax && e.matches(cardElement));
    const readWith = (find: (r: Element) => Element[]): [PlanCardHeading, PlanSameCard] => {
      let name: PlanCardHeading = 'none';
      for (let i = line; i < path.length; i++) {
        if (chain[i].length > args.cardMax) { name = 'unknown'; break; }
        const found = find(path[i]);
        if (found.length > 0) { name = labelOf(found); break; }
      }
      // A heading or caption counts for the region only when the region is its own nearest card element too, counting the
      // element itself: one inside, or itself, a nested card belongs to that card, never to the outer one that holds the price.
      const own = region ? find(region).filter((e) => e.closest(cardElement) === region) : [];
      if (own.length === 1) return [labelOf(own), 'yes'];
      return [name, name === 'none' && root === 'document' ? 'no' : 'unknown'];
    };
    const [heading, same] = readWith(headsIn);
    const [label, labelSame] = readWith(labelsIn);
    // For the verdict only: bound to the price's own nearest card, which must hold the cadence line and one exact caption.
    const subscription = ((): 'yes' | 'no' => {
      const at = path.findIndex((e) => e.matches(cardElement));
      if (at < 0 || chain[at].length > args.cardMax) return 'no';
      const card = path[at];
      // The cadence must be the card's own visible text: text inside a nested card region never counts (Sam's mirror case).
      const owned = (e: Element): boolean => rendered(e) && !e.matches(cardElement);
      const own = path.slice(0, at + 1).find((e) => cadence.test(textOf(e, owned)));
      if (!own || textOf(own, owned).length > args.lineMax) return 'no';
      const amounts = chain[at].match(re(args.money)) ?? [];
      if (amounts.length === 0 || !amounts.every((a) => /^\$\s?10\.00$/.test(a))) return 'no';
      const heads = headsIn(card).filter((h) => h.closest(cardElement) === card && listed(textOf(h, boxTolerant)) < labels.length);
      const caps = labelsIn(card).filter((c) => c.closest(cardElement) === card && !heads.some((h) => h.contains(c) || c.contains(h)));
      const named = [...heads, ...caps];
      return named.length === 1 && textOf(named[0], boxTolerant).toLowerCase() === args.accept ? 'yes' : 'no';
    })();
    return { heading, same, label, labelSame, subscription };
  };
  const visible = elements.filter(shown);
  const sample: PlanSample = { chains: [], roots: [], shown: visible.length, cards: [] };
  for (const el of visible.slice(0, 10)) {
    const chain: string[] = [];
    const path: Element[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) { chain.push(textOf(e, rendered)); path.push(e); }
    sample.chains.push(chain);
    const rootNode = el.getRootNode();
    const root = rootNode.nodeType === 9 ? 'document' : rootNode.nodeType === 11 && 'host' in rootNode ? 'shadow' : 'other';
    sample.roots.push(root);
    let read: PlanCardRead | null = null;
    try { read = card(path, chain, root); } catch { read = null; }
    sample.cards.push(read);
  }
  return sample;
}

/**
 * J9.a and J9.b's verdict on one portal read. First the unchanged text rule on the sample's chains (`portalPlanMiss`, "Current
 * plan"). Only when that misses with `no_plan_block`, Stripe's own wording can pass instead, through the section rule read from
 * the real sandbox portal (`currentSubscriptionSection`, Akin's screenshot, 2026-11-25): the one "Current subscription" caption,
 * then this run's product name, then the $10.00 monthly line, all in one short section that joins no other portal section. Run
 * 45652762097 showed the compact-card read (`PlanCardRead.subscription`) never matches that page, so it no longer decides; it
 * stays in the observer only. Every other miss word is returned as it was, and a failed section read passes nothing.
 */
export function portalPlanVerdict(sample: unknown, section?: unknown): PortalPlanMiss | null {
  const miss = portalPlanMiss(planSampleChains(sample));
  if (miss !== 'no_plan_block') return miss;
  const read = section as Partial<SectionRead> | null | undefined;
  return read !== null && typeof read === 'object' && read.pass === true && read.miss === null ? null : miss;
}

/** The verdict's input from a sample: its chains, or null (read as `unreadable`, as a failed read always was). */
export function planSampleChains(sample: unknown): unknown {
  return sample !== null && typeof sample === 'object' && 'chains' in sample ? (sample as { chains: unknown }).chains : null;
}

const CARD_HEADINGS: readonly string[] = [...PLAN_PROBE_HEADINGS.map(([name]) => name), 'other_text', 'none', 'unknown'];

/**
 * The observer's fixed words for one sample: the card heading's closed label, whether it is in the same compact card as the
 * $10.00 monthly line, the same two for a section label, where the ten elements live, and how many were kept against the cap. Across candidates, one shared read is
 * reported as is; candidates that disagree read `mixed` and `unknown`; no candidate reads `not_reached`. Every word fits
 * `progressLine`'s checkpoint alphabet; anything malformed reads `portal_plan_probe_unreadable`. Diagnostic only: it reads the
 * sample the verdict already judged and changes nothing about it.
 */
export function portalPlanObserver(sample: unknown): string[] {
  const s = sample as Partial<PlanSample> | null;
  const kept = Array.isArray(s?.chains) ? s.chains.length : -1;
  const sameWord = (v: unknown) => v === 'yes' || v === 'no' || v === 'unknown';
  const isCard = (c: unknown): c is PlanCardRead | null => c === null || (typeof c === 'object' && CARD_HEADINGS.includes((c as PlanCardRead).heading)
    && sameWord((c as PlanCardRead).same) && CARD_HEADINGS.includes((c as PlanCardRead).label) && sameWord((c as PlanCardRead).labelSame)
    && ['yes', 'no'].includes((c as PlanCardRead).subscription));
  if (!s || typeof s !== 'object' || kept < 0 || kept > 10 || !Array.isArray(s.cards) || s.cards.length !== kept || !s.cards.every(isCard)
    || !Array.isArray(s.roots) || s.roots.length !== kept || !Number.isInteger(s.shown) || (s.shown as number) < kept
    || !s.roots.every((r) => r === 'document' || r === 'shadow' || r === 'other')) return ['portal_plan_probe_unreadable'];
  const cards = s.cards.filter((c): c is PlanCardRead => c !== null);
  const agree = (key: (c: PlanCardRead) => string): string[] => {
    const reads = Array.from(new Set(cards.map(key)));
    return reads.length === 0 ? ['not_reached', 'not_reached'] : reads.length === 1 ? reads[0].split(' ') : ['mixed', 'unknown'];
  };
  const [heading, same] = agree((c) => `${c.heading} ${c.same}`);
  const [label, labelSame] = agree((c) => `${c.label} ${c.labelSame}`);
  const kinds = (['document', 'shadow', 'other'] as const).filter((k) => s.roots!.includes(k));
  return [
    `portal_plan_probe_card_heading_${heading}`,
    `portal_plan_probe_same_card_${same}`,
    `portal_plan_probe_card_label_${label}`,
    `portal_plan_probe_label_same_card_${labelSame}`,
    `portal_plan_probe_roots_${kinds.length === 0 ? 'none' : kinds.length > 1 ? 'mixed' : kinds[0]}`,
    `portal_plan_probe_kept_${kept}_cap_${(s.shown as number) > 10 ? 'hit' : 'clear'}`,
  ];
}

/**
 * J9's "Current subscription" section rule, read from Stripe's real sandbox portal (Akin's screenshot, 2026-11-25): a styled
 * caption "CURRENT SUBSCRIPTION" (no heading element), then the product name, then "$10.00 per month", then the next billing
 * date, with "Cancel subscription" beside them; the Payment method, Billing information and Invoice history sections follow,
 * and the invoice row repeats "$10.00" with no cadence. Self-contained: it runs in the portal page (`evaluateAll`), in the tests'
 * local DOM, and pasted as-is into Chrome's console, so all three run the same code. It only reads the DOM.
 *
 * A $10.00 element passes when, for the one visible caption reading exactly `caption` (any case and spacing, not a control):
 *  - its line (the element itself or the nearest ancestor whose visible text adds the cadence) is at most `lineMax` long;
 *  - the caption comes before the product name, and the product name before the line, in document order;
 *  - their section (the nearest ancestor holding both the caption and the line) is at most `sectionMax` long, holds none of the
 *    `otherCaptions` (so a short wrapper that joins the subscription to another section never lends it a price), holds exactly one
 *    cadence, names no amount but $10.00, and holds exactly one visible element reading exactly `product`.
 * Otherwise the furthest condition reached is one fixed word (`SectionMiss`). Page text leaves only when `showText` is set (the
 * console check); the spec never sets it.
 */
export type SectionMiss = 'no_price' | 'no_caption' | 'caption_not_unique' | 'no_line' | 'line_too_long' | 'line_before_caption'
  | 'section_too_long' | 'other_section_inside' | 'cadence_not_unique' | 'other_amount' | 'product_not_unique' | 'product_out_of_order';
export interface SectionArgs {
  price: [string, string]; cadence: [string, string]; money: [string, string]; caption: string; product: string;
  otherCaptions: string[]; lineMax: number; sectionMax: number; showText: boolean;
}
export interface SectionRead { pass: boolean; miss: SectionMiss | null; text: { caption: string; product: string; line: string } | null }

export function currentSubscriptionSection(elements: Element[], args: SectionArgs): SectionRead {
  const order: SectionMiss[] = ['no_price', 'no_caption', 'caption_not_unique', 'no_line', 'line_too_long', 'line_before_caption',
    'section_too_long', 'other_section_inside', 'cadence_not_unique', 'other_amount', 'product_not_unique', 'product_out_of_order'];
  let furthest: SectionMiss = 'no_price';
  const reach = (m: SectionMiss): void => { if (order.indexOf(m) > order.indexOf(furthest)) furthest = m; };
  const rendered = (el: Element): boolean => {
    const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
    if (!style || (el as HTMLElement).hidden || style.display === 'none' || style.visibility === 'hidden'
      || style.visibility === 'collapse' || style.opacity === '0') return false;
    const check = (el as Element & { checkVisibility?: (options?: object) => boolean }).checkVisibility;
    return typeof check !== 'function' || check.call(el, { opacityProperty: true, visibilityProperty: true }) || style.display === 'contents';
  };
  const shown = (el: Element): boolean => { for (let e: Element | null = el; e; e = e.parentElement) if (!rendered(e)) return false; return true; };
  const text = (el: Element): string => {
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
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const control = 'a, button, input, select, textarea, label, [role="button"], [role="link"]';
  // Visible non-control elements whose whole visible text is exactly `want`, innermost only.
  const exactly = (root: Element, want: string): Element[] => Array.from(root.querySelectorAll('*'))
    .filter((el) => !el.matches(control) && !el.closest(control) && shown(el) && norm(text(el)) === want)
    .filter((el, _, all) => !all.some((o) => o !== el && el.contains(o)));
  const before = (a: Element, b: Element): boolean => (a.compareDocumentPosition(b) & 4) !== 0; // b follows a
  const re = ([source, flags]: [string, string], global = false) => new RegExp(source, global ? `${flags.replace('g', '')}g` : flags);
  const price = re(args.price);
  const cadence = re(args.cadence);
  const body = elements[0]?.ownerDocument?.body;
  for (const el of elements.filter(shown).slice(0, 10)) {
    if (!body || !price.test(text(el))) continue;
    const captions = exactly(body, norm(args.caption));
    if (captions.length === 0) { reach('no_caption'); continue; }
    if (captions.length > 1) { reach('caption_not_unique'); continue; }
    const caption = captions[0];
    let line: Element | null = el;
    while (line && !cadence.test(text(line))) line = line.parentElement;
    if (!line) { reach('no_line'); continue; }
    if (text(line).length > args.lineMax) { reach('line_too_long'); continue; }
    if (!before(caption, line) || line.contains(caption)) { reach('line_before_caption'); continue; }
    let section: Element | null = line;
    while (section && !section.contains(caption)) section = section.parentElement;
    const own = section ? text(section) : '';
    if (!section || own.length > args.sectionMax) { reach('section_too_long'); continue; }
    if (args.otherCaptions.some((c) => exactly(section!, norm(c)).length > 0)) { reach('other_section_inside'); continue; }
    if ((own.match(re(args.cadence, true)) ?? []).length !== 1) { reach('cadence_not_unique'); continue; }
    const amounts = own.match(re(args.money, true)) ?? [];
    if (amounts.length === 0 || !amounts.every((a) => /^\$\s?10\.00$/.test(a))) { reach('other_amount'); continue; }
    const products = exactly(section, norm(args.product));
    if (products.length !== 1) { reach('product_not_unique'); continue; }
    if (!before(caption, products[0]) || !before(products[0], line)) { reach('product_out_of_order'); continue; }
    return { pass: true, miss: null, text: args.showText ? { caption: text(caption), product: text(products[0]), line: text(line) } : null };
  }
  return { pass: false, miss: furthest, text: null };
}

/** The other Stripe portal section captions seen on the real page (Akin's screenshot, 2026-11-25). */
export const PORTAL_OTHER_CAPTIONS = ['payment method', 'payment methods', 'billing information', 'invoice history'];
/** The section rule's arguments: the verdict's own price, cadence and money patterns and limits; `product` is the run's own. */
export const sectionArgs = (product: string, showText = false): SectionArgs => ({
  price: [PLAN_PRICE.source, PLAN_PRICE.flags], cadence: [PLAN_CADENCE.source, PLAN_CADENCE.flags], money: [MONEY.source, MONEY.flags],
  caption: PLAN_SUBSCRIPTION_LABEL, product, otherCaptions: PORTAL_OTHER_CAPTIONS, lineMax: PLAN_LINE_MAX, sectionMax: PLAN_BLOCK_MAX, showText,
});

/**
 * The portal's visible text for a failed run's evidence file, never the log. Only the part above the Payment method caption is
 * kept (the subscription section; card, billing details and invoices are dropped). Anything that could identify or unlock
 * something is replaced: URLs, emails, Stripe ids and secrets, long codes and digit runs of five or more. Capped at 4,000 chars.
 */
export function redactPortalText(text: string): string {
  const cut = text.search(/^[ \t]*payment methods?[ \t]*$/im);
  return (cut >= 0 ? text.slice(0, cut) : text)
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[^\s@]+@[^\s@]+/g, '[email]')
    .replace(/\b(?:cus|sub|prod|price|pi|pm|in|ch|cs|bps|seti|si|ii|test|live|sk|pk|rk|whsec)_[A-Za-z0-9_]+/g, '[id]')
    .replace(/\b[A-Za-z0-9]{24,}\b/g, '[code]')
    .replace(/\d{5,}/g, '[n]')
    .slice(0, 4000);
}
