// Refund policy (Akin, 2026-11-12): a refunded customer keeps paid access until the current period ends and
// is not charged again ("the customer uses the balance days/time of the monthly subscription"). A refund of a
// SpeakSharp Pro subscription invoice therefore schedules the subscription to cancel at period end. That stops
// the next renewal; it is not by itself a guarantee of no further charge (see Renewal boundary below). Nothing
// here changes entitlement: Stripe then sends customer.subscription.updated (cancel_at_period_end), which the
// canonical snapshot path applies, and customer.subscription.deleted when the period ends.
//
// Never cancels immediately and is idempotent: a subscription already set to cancel at period end, or already
// ended, is left alone. Refunds are full only (Akin, 2026-11-12). The scheduling itself never touches the
// database; the only write is the operator signal below (recordRefundFollowup), made by the webhook.
//
// Classified defensively (Sam's v5 returns): only a verified FULL refund schedules anything. A well-formed
// partial refund is acknowledged and changes nothing (the product never offers one, and a later refund that
// completes the charge arrives as its own event); a zero, missing or inconsistent refund amount is unverified.
// A reference that is explicitly null is "no invoice / no subscription"; a reference that is missing or
// malformed is unverified, never acknowledged as a non-subscription charge.
//
// Renewal boundary (explicit rule): a refund of the subscription's latest invoice, or of an earlier invoice
// when the latest one is already paid, schedules cancel at period end, so the member keeps the period they
// have paid for and the next renewal is stopped. A refund of an earlier invoice while a later renewal invoice is
// still outstanding (draft, open or uncollectible) is unverified: cancel_at_period_end does not stop Stripe
// from collecting an invoice it has already issued, so an operator must decide. The same rule is applied again
// to Stripe's update answer, in case a renewal was issued between the read and the update.
//
// "unverified" is detection and escalation, not prevention (Sam's adbec69d review). It returns non-2xx, so the
// failure is logged and Stripe redelivers the event; it changes nothing in Stripe. Each unverified outcome, and
// each partial refund, also records a durable operator signal (Sam's 2026-11-12 decision): one row per refunded
// charge in stripe_refund_followups, a closed reason code and Stripe's ids, no customer content. It stays
// unresolved until an operator reconciles it; nothing here resolves it. In particular, when it is
// found only on the update answer, cancel_at_period_end has already been set and is left set, and the
// outstanding renewal invoice is neither voided nor otherwise stopped, so Stripe may still collect it.
// Redelivery does not keep the alarm up: a redelivery fails closed only while that renewal is still
// outstanding. Once Stripe has collected (or voided) it, the boundary check passes and the redelivery returns
// 2xx "already_scheduled" only once its own signal is durable: a later renewal that Stripe collected at or
// after the refund (its paid_at against the refund event's created) records "renewal_collected_after_refund",
// and a failed write of that signal is non-2xx, so Stripe redelivers. A signal whose first write failed is
// therefore not lost when the renewal is then collected (security review of 664b84f6). Whether to void or
// refund that invoice is an operator's decision, and this handler never makes it. A redelivery that reads
// clean never resolves a signal; only an operator's reconciliation does.
//
// Fails closed (Sam's review of 34dab357): nothing is changed unless the charge, its invoice and the
// subscription all belong to the same customer and mode, and the subscription is the configured Pro price.
// Any response that is malformed, unsuccessful or does not confirm the change is "unverified" (non-2xx, so
// Stripe redelivers) and is never reported as scheduled. Every state that can still be charged again, not
// only active, is scheduled; a state that cannot be scheduled safely is unverified, never success.

type StripeClient = any;

/**
 * Closed reason codes for the operator signal (stripe_refund_followups.reason, Sam's 2026-11-12 decision). The
 * database refuses any other value, so a reason can never carry free text, customer content or payment details.
 */
export const FOLLOWUP_REASONS = Object.freeze([
  "configuration_missing", "refund_unreadable", "stripe_read_failed", "ownership_mismatch",
  "subscription_state_unverified", "renewal_outstanding", "update_failed", "update_unconfirmed",
  "renewal_outstanding_after_update", "boundary_unverified_after_update", "partial_refund",
  "renewal_collected_after_refund",
] as const);
export type FollowupReason = typeof FOLLOWUP_REASONS[number];

export type RefundOutcome =
  | { outcome: "scheduled" | "already_scheduled"; subscriptionId: string; followup?: "renewal_collected_after_refund" }
  | { outcome: "already_ended"; subscriptionId: string; followup?: "renewal_collected_after_refund" }
  | { outcome: "not_subscription_charge" | "not_pro_subscription" | "partial_refund_ignored" }
  | { outcome: "unverified"; reason: string; code: FollowupReason };

/** Stripe states that can still bill again, so a refund must stop the next charge. */
export const SCHEDULABLE_STATES = Object.freeze(["active", "trialing", "past_due", "unpaid", "paused"]);
/** Terminal states: nothing is left to charge, so there is nothing to schedule. */
export const ENDED_STATES = Object.freeze(["canceled", "incomplete_expired"]);

function objectId(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  }
  return null;
}

const unverified = (code: FollowupReason, reason: string): RefundOutcome => ({ outcome: "unverified", reason, code });

type Reference = { kind: "absent" } | { kind: "id"; id: string } | { kind: "malformed" };
/** null is an explicit "none"; a usable id or expanded object is an id; anything else (missing too) is malformed. */
export function reference(value: unknown): Reference {
  if (value === null) return { kind: "absent" };
  const id = objectId(value);
  return id && /^[a-z]+_[A-Za-z0-9_]+$/.test(id) ? { kind: "id", id } : { kind: "malformed" };
}

export type RefundAmount = "full" | "partial" | "unknown";
/**
 * Whether the refunded charge is refunded in full, from the charge's own amounts: a positive whole amount, the
 * same amount refunded, and Stripe's refunded flag. A smaller positive refund is partial. Anything else
 * (zero, missing, non-integer, more than charged, or a flag that disagrees with the amounts) is unknown.
 */
export function refundAmount(charge: any): RefundAmount {
  const amount = charge?.amount;
  const refunded = charge?.amount_refunded;
  if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(refunded) || amount <= 0 || refunded <= 0) return "unknown";
  if (refunded === amount && charge.refunded === true) return "full";
  if (refunded < amount && charge.refunded === false) return "partial";
  return "unknown";
}

/** A Stripe currency: three lowercase ISO letters. */
const CURRENCY = /^[a-z]{3}$/;

/** Invoice states in which Stripe may still collect money. */
const OUTSTANDING_INVOICE_STATES = Object.freeze(["draft", "open", "uncollectible"]);

type BoundaryProblem = "subscription latest invoice unreadable" | "latest invoice retrieval failed"
  | "latest invoice is not this subscription's" | "a later renewal invoice is still outstanding" | "latest invoice state unknown";

/** The closed code for a renewal-boundary problem, before or after the update was applied. */
function boundaryCode(problem: BoundaryProblem, afterUpdate: boolean): FollowupReason {
  if (problem === "a later renewal invoice is still outstanding") {
    return afterUpdate ? "renewal_outstanding_after_update" : "renewal_outstanding";
  }
  if (afterUpdate) return "boundary_unverified_after_update";
  if (problem === "latest invoice retrieval failed") return "stripe_read_failed";
  if (problem === "latest invoice is not this subscription's") return "ownership_mismatch";
  return "subscription_state_unverified";
}

/**
 * Why the subscription's latest invoice makes scheduling unsafe (`problem`), or null when it is safe: it is the
 * refunded invoice itself, or a later invoice of this subscription that is already paid or void. A later invoice
 * that is still outstanding, unknown, unreadable or not this subscription's is a problem.
 *
 * A later invoice that is paid is safe to schedule after, but when Stripe collected it at or after the refund
 * (`collectedAfterRefund`), the member was charged again after the refund: scheduling still goes ahead, and the
 * webhook records an operator signal. When the payment time or the refund's time is unreadable, the answer is
 * "unknown": the caller still schedules (so the member is not left to renew), then reports unverified, so it is
 * never passed over silently (second security review of 06e63a11).
 */
type Boundary = { problem: BoundaryProblem | null; collectedAfterRefund: boolean | "unknown" };
const BOUNDARY_SAFE: Boundary = Object.freeze({ problem: null, collectedAfterRefund: false });
const boundaryProblem = (problem: BoundaryProblem): Boundary => ({ problem, collectedAfterRefund: false });

/** A Stripe timestamp: whole seconds since the epoch. */
const isTimestamp = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

async function renewalBoundary(stripe: StripeClient, latestValue: unknown,
  expected: { invoiceId: string; subscriptionId: string; customer: string; livemode: boolean; refundedAt: unknown }): Promise<Boundary> {
  const latestRef = reference(latestValue);
  if (latestRef.kind !== "id") return boundaryProblem("subscription latest invoice unreadable");
  if (latestRef.id === expected.invoiceId) return BOUNDARY_SAFE;
  let latest: any = latestValue && typeof latestValue === "object" ? latestValue : null;
  if (typeof latest?.status !== "string") {
    try { latest = await stripe.invoices.retrieve(latestRef.id); }
    catch { return boundaryProblem("latest invoice retrieval failed"); }
  }
  if (objectId(latest) !== latestRef.id || objectId(latest.subscription) !== expected.subscriptionId
    || objectId(latest.customer) !== expected.customer || latest.livemode !== expected.livemode) {
    return boundaryProblem("latest invoice is not this subscription's");
  }
  if (OUTSTANDING_INVOICE_STATES.includes(latest.status)) return boundaryProblem("a later renewal invoice is still outstanding");
  if (latest.status === "void") return BOUNDARY_SAFE;
  if (latest.status !== "paid") return boundaryProblem("latest invoice state unknown");
  const paidAt = latest.status_transitions?.paid_at;
  if (!isTimestamp(paidAt) || !isTimestamp(expected.refundedAt)) return { problem: null, collectedAfterRefund: "unknown" };
  return { problem: null, collectedAfterRefund: paidAt >= expected.refundedAt };
}

/**
 * The operation an operator signal is kept for: the refunded charge, or the event when the charge id itself is
 * unreadable. One row per operation, so a redelivered event never adds a second signal. Null when neither id is
 * well formed, which the caller must treat as a failed write.
 */
export function followupOperationKey(event: any): string | null {
  const chargeId = event?.data?.object?.id;
  if (typeof chargeId === "string" && /^(ch|py)_[A-Za-z0-9_]{1,200}$/.test(chargeId)) return `charge:${chargeId}`;
  const eventId = event?.id;
  if (typeof eventId === "string" && /^evt_[A-Za-z0-9_]{1,200}$/.test(eventId)) return `event:${eventId}`;
  return null;
}

/**
 * Records the durable, operator-visible signal (stripe_refund_followups) for a refund follow-up that was not
 * verified, or a partial refund. True only when the database confirms the write; a malformed id, an error, a
 * thrown call or any answer other than `true` is a failed write, so the caller never reports success on it.
 * It records only: no Stripe call, no retry of the refund, no void, no second cancellation.
 */
export async function recordRefundFollowup(supabase: any, event: any, reason: FollowupReason): Promise<boolean> {
  const operationKey = followupOperationKey(event);
  const eventId = event?.id;
  if (!operationKey || typeof eventId !== "string" || !/^evt_[A-Za-z0-9_]{1,200}$/.test(eventId)) return false;
  if (!FOLLOWUP_REASONS.includes(reason)) return false;
  const livemode = event?.data?.object?.livemode;
  try {
    const { data, error } = await supabase.rpc("record_stripe_refund_followup", {
      p_operation_key: operationKey, p_event_id: eventId,
      p_livemode: typeof livemode === "boolean" ? livemode : null, p_reason: reason,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function scheduleCancellationAfterRefund(
  stripe: StripeClient,
  charge: any,
  eventId: string,
  proPriceId: string | undefined,
  /** When the refund happened: the charge.refunded event's `created`, in Stripe seconds. */
  refundedAt?: unknown,
): Promise<RefundOutcome> {
  const priceId = proPriceId?.trim();
  if (!priceId) return unverified("configuration_missing", "pro price is not configured");
  if (!charge || typeof charge !== "object" || reference(charge.id).kind !== "id") return unverified("refund_unreadable", "charge is malformed");
  const amount = refundAmount(charge);
  if (amount === "unknown") return unverified("refund_unreadable", "refund amount unverified");
  if (amount === "partial") return { outcome: "partial_refund_ignored" };
  const invoiceRef = reference(charge.invoice);
  if (invoiceRef.kind === "absent") return { outcome: "not_subscription_charge" };
  if (invoiceRef.kind === "malformed") return unverified("refund_unreadable", "charge invoice reference malformed");
  const invoiceId = invoiceRef.id;
  const customer = objectId(charge.customer);
  if (!customer) return unverified("refund_unreadable", "charge has no customer");
  if (typeof charge.livemode !== "boolean") return unverified("refund_unreadable", "charge mode unknown");

  let invoice: any;
  try { invoice = await stripe.invoices.retrieve(invoiceId); }
  catch { return unverified("stripe_read_failed", "invoice retrieval failed"); }
  if (objectId(invoice) !== invoiceId) return unverified("ownership_mismatch", "invoice response is not the charged invoice");
  if (objectId(invoice.customer) !== customer || invoice.livemode !== charge.livemode) {
    return unverified("ownership_mismatch", "invoice does not belong to the refunded customer");
  }
  // The refunded charge paid this invoice in full: a paid invoice in the charge's currency for the same amount.
  // Both currencies must be read and valid: two missing currencies are not a match (Sam's c381f853 return).
  if (!CURRENCY.test(`${charge.currency ?? ""}`)) return unverified("refund_unreadable", "charge currency unreadable");
  if (invoice.status !== "paid" || invoice.currency !== charge.currency || invoice.amount_paid !== charge.amount) {
    return unverified("ownership_mismatch", "refunded invoice is not the charge's paid invoice");
  }
  const subscriptionRef = reference(invoice.subscription);
  if (subscriptionRef.kind === "absent") return { outcome: "not_subscription_charge" };
  if (subscriptionRef.kind === "malformed") return unverified("refund_unreadable", "invoice subscription reference malformed");
  const subscriptionId = subscriptionRef.id;

  let subscription: any;
  try { subscription = await stripe.subscriptions.retrieve(subscriptionId); }
  catch { return unverified("stripe_read_failed", "subscription retrieval failed"); }
  if (objectId(subscription) !== subscriptionId) return unverified("ownership_mismatch", "subscription response is not the invoiced subscription");
  if (objectId(subscription.customer) !== customer || subscription.livemode !== charge.livemode) {
    return unverified("ownership_mismatch", "subscription does not belong to the refunded customer");
  }
  const items: unknown = subscription?.items?.data;
  if (!Array.isArray(items)) return unverified("subscription_state_unverified", "subscription items unreadable");
  if (!items.some((item) => objectId(item?.price) === priceId)) return { outcome: "not_pro_subscription" };

  const status = typeof subscription.status === "string" ? subscription.status : "";
  const boundaryExpected = { invoiceId, subscriptionId, customer, livemode: charge.livemode, refundedAt };
  if (ENDED_STATES.includes(status)) {
    // Nothing to schedule, but a renewal collected after the refund still needs an operator, even when the
    // subscription ended before this delivery (second security review of 06e63a11). Ended means no cancellation
    // is needed, not that the renewal outcome was verified: a boundary that cannot be read (a failed or foreign
    // latest invoice read, or a renewal still outstanding) is unverified with its closed code, exactly as for a
    // live subscription, so the signal is recorded and the delivery is never acknowledged (Sam's 866ee807 hold).
    // Detection only: nothing is written to Stripe here.
    const ended = await renewalBoundary(stripe, subscription.latest_invoice, boundaryExpected);
    if (ended.problem) return unverified(boundaryCode(ended.problem, false), ended.problem);
    if (ended.collectedAfterRefund === "unknown") {
      return unverified("subscription_state_unverified", "latest invoice payment time unknown");
    }
    return { outcome: "already_ended", subscriptionId,
      ...(ended.collectedAfterRefund === true ? { followup: "renewal_collected_after_refund" as const } : {}) };
  }
  if (!SCHEDULABLE_STATES.includes(status)) return unverified("subscription_state_unverified", `subscription state ${status || "unknown"} cannot be scheduled`);
  // Renewal boundary: see the rule at the top of this file.
  const boundary = await renewalBoundary(stripe, subscription.latest_invoice, boundaryExpected);
  if (boundary.problem) return unverified(boundaryCode(boundary.problem, false), boundary.problem);
  const collected = (b: Boundary) => b.collectedAfterRefund === true ? { followup: "renewal_collected_after_refund" as const } : {};
  if (subscription.cancel_at_period_end === true) {
    if (boundary.collectedAfterRefund === "unknown") {
      return unverified("subscription_state_unverified", "latest invoice payment time unknown");
    }
    return { outcome: "already_scheduled", subscriptionId, ...collected(boundary) };
  }
  if (subscription.cancel_at_period_end !== false) return unverified("subscription_state_unverified", "cancel_at_period_end unreadable");

  let updated: any;
  try {
    // One idempotency key per refund event, so a redelivered event cannot make a second change.
    updated = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true },
      { idempotencyKey: `refund-cancel-at-period-end-${eventId}` });
  } catch {
    return unverified("update_failed", "subscription update failed");
  }
  // Only Stripe's own answer confirming the change counts as scheduled.
  // Its status must be read and still schedulable: a missing or unknown status is not a confirmation.
  if (objectId(updated) !== subscriptionId || updated?.cancel_at_period_end !== true
    || typeof updated?.status !== "string" || !SCHEDULABLE_STATES.includes(updated.status)
    || objectId(updated.customer) !== customer || updated.livemode !== charge.livemode) {
    return unverified("update_unconfirmed", "subscription update not confirmed");
  }
  // The update answer is a newer reading of the subscription. If its latest invoice is no longer the one checked
  // above (a renewal was issued in between), check the boundary again on that answer: an outstanding renewal is
  // not something cancel at period end can stop, so it is unverified, never "scheduled" (Sam's c381f853 return).
  // This only detects and escalates: the update above stays applied and the renewal invoice is not touched.
  const after = await renewalBoundary(stripe, updated.latest_invoice, boundaryExpected);
  if (after.problem) return unverified(boundaryCode(after.problem, true), `after update: ${after.problem}`);
  // Scheduled either way; an unreadable payment time is reported only now, after the update is applied.
  if (boundary.collectedAfterRefund === "unknown" || after.collectedAfterRefund === "unknown") {
    return unverified("boundary_unverified_after_update", "after update: latest invoice payment time unknown");
  }
  return { outcome: "scheduled", subscriptionId,
    ...collected({ problem: null, collectedAfterRefund: boundary.collectedAfterRefund || after.collectedAfterRefund }) };
}
