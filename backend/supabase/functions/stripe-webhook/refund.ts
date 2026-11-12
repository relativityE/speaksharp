// Refund policy (Akin, 2026-11-12): a refunded customer keeps paid access until the current period ends and
// is not charged again ("the customer uses the balance days/time of the monthly subscription"). A refund of a
// SpeakSharp Pro subscription invoice therefore schedules the subscription to cancel at period end. Nothing
// here changes entitlement: Stripe then sends customer.subscription.updated (cancel_at_period_end), which the
// canonical snapshot path applies, and customer.subscription.deleted when the period ends.
//
// Never cancels immediately, never touches the database, and is idempotent: a subscription already set to
// cancel at period end, or already ended, is left alone. Refunds are full only (Akin, 2026-11-12).
//
// Classified defensively (Sam's v5 returns): only a verified FULL refund schedules anything. A well-formed
// partial refund is acknowledged and changes nothing (the product never offers one, and a later refund that
// completes the charge arrives as its own event); a zero, missing or inconsistent refund amount is unverified.
// A reference that is explicitly null is "no invoice / no subscription"; a reference that is missing or
// malformed is unverified, never acknowledged as a non-subscription charge.
//
// Renewal boundary (explicit rule): a refund of the subscription's latest invoice, or of an earlier invoice
// when the latest one is already paid, schedules cancel at period end, so the member keeps the period they
// have paid for and is not charged again. A refund of an earlier invoice while a later renewal invoice is
// still outstanding (draft, open or uncollectible) is unverified: cancel_at_period_end does not stop Stripe
// from collecting an invoice it has already issued, so an operator must decide. The same rule is applied again
// to Stripe's update answer, in case a renewal was issued between the read and the update.
//
// Fails closed (Sam's review of 34dab357): nothing is changed unless the charge, its invoice and the
// subscription all belong to the same customer and mode, and the subscription is the configured Pro price.
// Any response that is malformed, unsuccessful or does not confirm the change is "unverified" (non-2xx, so
// Stripe redelivers) and is never reported as scheduled. Every state that can still be charged again, not
// only active, is scheduled; a state that cannot be scheduled safely is unverified, never success.

type StripeClient = any;

export type RefundOutcome =
  | { outcome: "scheduled" | "already_scheduled" | "already_ended"; subscriptionId: string }
  | { outcome: "not_subscription_charge" | "not_pro_subscription" | "partial_refund_ignored" }
  | { outcome: "unverified"; reason: string };

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

const unverified = (reason: string): RefundOutcome => ({ outcome: "unverified", reason });

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

/**
 * Why the subscription's latest invoice makes scheduling unsafe, or null when it is safe: it is the refunded
 * invoice itself, or a later invoice of this subscription that is already paid or void. A later invoice that is
 * still outstanding, unknown, unreadable or not this subscription's is a problem.
 */
async function renewalBoundaryProblem(stripe: StripeClient, latestValue: unknown,
  expected: { invoiceId: string; subscriptionId: string; customer: string; livemode: boolean }): Promise<string | null> {
  const latestRef = reference(latestValue);
  if (latestRef.kind !== "id") return "subscription latest invoice unreadable";
  if (latestRef.id === expected.invoiceId) return null;
  let latest: any = latestValue && typeof latestValue === "object" ? latestValue : null;
  if (typeof latest?.status !== "string") {
    try { latest = await stripe.invoices.retrieve(latestRef.id); }
    catch { return "latest invoice retrieval failed"; }
  }
  if (objectId(latest) !== latestRef.id || objectId(latest.subscription) !== expected.subscriptionId
    || objectId(latest.customer) !== expected.customer || latest.livemode !== expected.livemode) {
    return "latest invoice is not this subscription's";
  }
  if (OUTSTANDING_INVOICE_STATES.includes(latest.status)) return "a later renewal invoice is still outstanding";
  if (latest.status !== "paid" && latest.status !== "void") return "latest invoice state unknown";
  return null;
}

export async function scheduleCancellationAfterRefund(
  stripe: StripeClient,
  charge: any,
  eventId: string,
  proPriceId: string | undefined,
): Promise<RefundOutcome> {
  const priceId = proPriceId?.trim();
  if (!priceId) return unverified("pro price is not configured");
  if (!charge || typeof charge !== "object" || reference(charge.id).kind !== "id") return unverified("charge is malformed");
  const amount = refundAmount(charge);
  if (amount === "unknown") return unverified("refund amount unverified");
  if (amount === "partial") return { outcome: "partial_refund_ignored" };
  const invoiceRef = reference(charge.invoice);
  if (invoiceRef.kind === "absent") return { outcome: "not_subscription_charge" };
  if (invoiceRef.kind === "malformed") return unverified("charge invoice reference malformed");
  const invoiceId = invoiceRef.id;
  const customer = objectId(charge.customer);
  if (!customer) return unverified("charge has no customer");
  if (typeof charge.livemode !== "boolean") return unverified("charge mode unknown");

  let invoice: any;
  try { invoice = await stripe.invoices.retrieve(invoiceId); }
  catch { return unverified("invoice retrieval failed"); }
  if (objectId(invoice) !== invoiceId) return unverified("invoice response is not the charged invoice");
  if (objectId(invoice.customer) !== customer || invoice.livemode !== charge.livemode) {
    return unverified("invoice does not belong to the refunded customer");
  }
  // The refunded charge paid this invoice in full: a paid invoice in the charge's currency for the same amount.
  // Both currencies must be read and valid: two missing currencies are not a match (Sam's c381f853 return).
  if (!CURRENCY.test(`${charge.currency ?? ""}`)) return unverified("charge currency unreadable");
  if (invoice.status !== "paid" || invoice.currency !== charge.currency || invoice.amount_paid !== charge.amount) {
    return unverified("refunded invoice is not the charge's paid invoice");
  }
  const subscriptionRef = reference(invoice.subscription);
  if (subscriptionRef.kind === "absent") return { outcome: "not_subscription_charge" };
  if (subscriptionRef.kind === "malformed") return unverified("invoice subscription reference malformed");
  const subscriptionId = subscriptionRef.id;

  let subscription: any;
  try { subscription = await stripe.subscriptions.retrieve(subscriptionId); }
  catch { return unverified("subscription retrieval failed"); }
  if (objectId(subscription) !== subscriptionId) return unverified("subscription response is not the invoiced subscription");
  if (objectId(subscription.customer) !== customer || subscription.livemode !== charge.livemode) {
    return unverified("subscription does not belong to the refunded customer");
  }
  const items: unknown = subscription?.items?.data;
  if (!Array.isArray(items)) return unverified("subscription items unreadable");
  if (!items.some((item) => objectId(item?.price) === priceId)) return { outcome: "not_pro_subscription" };

  const status = typeof subscription.status === "string" ? subscription.status : "";
  if (ENDED_STATES.includes(status)) return { outcome: "already_ended", subscriptionId };
  if (!SCHEDULABLE_STATES.includes(status)) return unverified(`subscription state ${status || "unknown"} cannot be scheduled`);
  // Renewal boundary: see the rule at the top of this file.
  const boundary = await renewalBoundaryProblem(stripe, subscription.latest_invoice,
    { invoiceId, subscriptionId, customer, livemode: charge.livemode });
  if (boundary) return unverified(boundary);
  if (subscription.cancel_at_period_end === true) return { outcome: "already_scheduled", subscriptionId };
  if (subscription.cancel_at_period_end !== false) return unverified("cancel_at_period_end unreadable");

  let updated: any;
  try {
    // One idempotency key per refund event, so a redelivered event cannot make a second change.
    updated = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true },
      { idempotencyKey: `refund-cancel-at-period-end-${eventId}` });
  } catch {
    return unverified("subscription update failed");
  }
  // Only Stripe's own answer confirming the change counts as scheduled.
  // Its status must be read and still schedulable: a missing or unknown status is not a confirmation.
  if (objectId(updated) !== subscriptionId || updated?.cancel_at_period_end !== true
    || typeof updated?.status !== "string" || !SCHEDULABLE_STATES.includes(updated.status)
    || objectId(updated.customer) !== customer || updated.livemode !== charge.livemode) {
    return unverified("subscription update not confirmed");
  }
  // The update answer is a newer reading of the subscription. If its latest invoice is no longer the one checked
  // above (a renewal was issued in between), check the boundary again on that answer: an outstanding renewal is
  // not something cancel at period end can stop, so it is unverified, never "scheduled" (Sam's c381f853 return).
  const after = await renewalBoundaryProblem(stripe, updated.latest_invoice,
    { invoiceId, subscriptionId, customer, livemode: charge.livemode });
  if (after) return unverified(`after update: ${after}`);
  return { outcome: "scheduled", subscriptionId };
}
