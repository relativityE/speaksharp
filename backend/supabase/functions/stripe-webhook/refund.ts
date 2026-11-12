// Refund policy (Akin, 2026-11-12): a refunded customer keeps paid access until the current period ends and
// is not charged again ("the customer uses the balance days/time of the monthly subscription"). A refund of a
// SpeakSharp Pro subscription invoice therefore schedules the subscription to cancel at period end. Nothing
// here changes entitlement: Stripe then sends customer.subscription.updated (cancel_at_period_end), which the
// canonical snapshot path applies, and customer.subscription.deleted when the period ends.
//
// Never cancels immediately, never touches the database, and is idempotent: a subscription already set to
// cancel at period end, or already ended, is left alone. Refunds are full only (Akin, 2026-11-12).
//
// Fails closed (Sam's review of 34dab357): nothing is changed unless the charge, its invoice and the
// subscription all belong to the same customer and mode, and the subscription is the configured Pro price.
// Any response that is malformed, unsuccessful or does not confirm the change is "unverified" (non-2xx, so
// Stripe redelivers) and is never reported as scheduled. Every state that can still be charged again, not
// only active, is scheduled; a state that cannot be scheduled safely is unverified, never success.

type StripeClient = any;

export type RefundOutcome =
  | { outcome: "scheduled" | "already_scheduled" | "already_ended"; subscriptionId: string }
  | { outcome: "not_subscription_charge" | "not_pro_subscription" }
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

export async function scheduleCancellationAfterRefund(
  stripe: StripeClient,
  charge: any,
  eventId: string,
  proPriceId: string | undefined,
): Promise<RefundOutcome> {
  const priceId = proPriceId?.trim();
  if (!priceId) return unverified("pro price is not configured");
  if (!charge || typeof charge !== "object" || !objectId(charge.id)) return unverified("charge is malformed");
  const invoiceId = objectId(charge.invoice);
  if (!invoiceId) return { outcome: "not_subscription_charge" };
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
  const subscriptionId = objectId(invoice.subscription);
  if (!subscriptionId) return { outcome: "not_subscription_charge" };

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
  if (objectId(updated) !== subscriptionId || updated?.cancel_at_period_end !== true
    || ENDED_STATES.includes(String(updated?.status ?? ""))) {
    return unverified("subscription update not confirmed");
  }
  return { outcome: "scheduled", subscriptionId };
}
