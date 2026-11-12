// Refund policy (Akin, 2026-11-12): a refunded customer keeps paid access until the current period ends and
// is not charged again. A FULL refund of a subscription invoice therefore schedules the subscription to
// cancel at period end. Nothing here changes entitlement: Stripe then sends customer.subscription.updated
// (cancel_at_period_end, still active), which the canonical snapshot path applies as "Pro until period end",
// and customer.subscription.deleted at period end moves the account to Free.
//
// Never cancels immediately, never touches the database, and is idempotent: a subscription already set to
// cancel at period end, or no longer active, is left alone. Refunds are full only (Akin, 2026-11-12): the
// product issues no partial refunds, so there is no partial-refund path here.

type StripeClient = any;

export type RefundOutcome =
  | { outcome: "scheduled" | "already_scheduled" | "not_active"; subscriptionId: string }
  | { outcome: "not_subscription_charge" }
  | { outcome: "retry"; reason: string };

function objectId(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  }
  return null;
}

export async function scheduleCancellationAfterRefund(
  stripe: StripeClient,
  charge: any,
  eventId: string,
): Promise<RefundOutcome> {
  const invoiceId = objectId(charge?.invoice);
  if (!invoiceId) return { outcome: "not_subscription_charge" };

  let invoice: any;
  try { invoice = await stripe.invoices.retrieve(invoiceId); }
  catch { return { outcome: "retry", reason: "invoice retrieval failed" }; }
  const subscriptionId = objectId(invoice?.subscription);
  if (!subscriptionId) return { outcome: "not_subscription_charge" };

  let subscription: any;
  try { subscription = await stripe.subscriptions.retrieve(subscriptionId); }
  catch { return { outcome: "retry", reason: "subscription retrieval failed" }; }
  const status = String(subscription?.status ?? "");
  if (status !== "active" && status !== "trialing") return { outcome: "not_active", subscriptionId };
  if (subscription?.cancel_at_period_end === true) return { outcome: "already_scheduled", subscriptionId };

  try {
    // One idempotency key per refund event, so a redelivered event cannot make a second change.
    await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true },
      { idempotencyKey: `refund-cancel-at-period-end-${eventId}` });
  } catch {
    return { outcome: "retry", reason: "subscription update failed" };
  }
  return { outcome: "scheduled", subscriptionId };
}
