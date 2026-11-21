/**
 * J9.b, `restore_access`: an expired trial is walled, and one Stripe TEST-MODE payment restores access on the same account.
 *
 * Akin, 2026-11-21: "There will be no "real charge". Test charge is the success criteria. Period." Any user gets the whole
 * product free for 30 days; an unpaid account then loses the app and its saved work; paying restores both (#1863).
 *
 * The browser journey (`journey.billing.spec.ts`, journey `restore_access`) feeds these checks:
 *   1. a take saved during the trial, read back by the member and listed on Progress,
 *   2. after the trial ends: the member's own read of that take is empty while the row is kept (walled, not deleted),
 *   3. after one $10 test-mode Checkout: exactly one succeeded charge, and it is the first invoice's,
 *   4. the member's own read returns the same take with the same content-free facts (restored, unchanged),
 *   5. Manage billing shows the $10 monthly plan.
 *
 * Pure checks only: no network, no secrets, no transcript text kept (rows arrive as digests, `sessionFactsFromRows`). Every
 * failure is a closed code. The offline controls are `restoreAccess.test.ts`. This journey never replays a webhook event. A
 * duplicate event is tested apart today: the handler against a mocked database (stripe-webhook index and adversarial tests) and
 * the snapshot RPC in PGlite (tests/db/webhook-lifecycle.integration.test.ts). The real handler and the payment ledger together
 * are not proven against a duplicate here (Sam, for review on this PR).
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
 * Walled, not deleted: the signed-in member's own read is a readable empty list, while the service read still holds the
 * same take. An unreadable member read is never "walled", and a missing row is deletion, not a wall.
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

/**
 * Manage billing (the Stripe portal) shows the plan: its own page text names the $10.00 price and a monthly interval. The
 * text is read in memory and never kept or reported; only this boolean leaves.
 */
export function portalShowsPlan(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  return /\$\s?10\.00(?!\d)/.test(text) && /(\bper month|\/\s?month|\bmonthly|\bevery month)\b/i.test(text);
}
