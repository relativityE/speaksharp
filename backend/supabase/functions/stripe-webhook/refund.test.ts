/**
 * Refund policy (Akin, 2026-11-12): a refunded customer keeps paid access until the period ends and is not
 * charged again. A refund of a Pro subscription invoice schedules cancel_at_period_end; nothing changes
 * entitlement directly. Fails closed on unverified ownership and on malformed or unconfirmed responses
 * (Sam's review of 34dab357). Offline only: Stripe and the database are in-memory fakes.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";
import { ENDED_STATES, SCHEDULABLE_STATES, followupOperationKey, recordRefundFollowup, reference,
  refundAmount, scheduleCancellationAfterRefund } from "./refund.ts";

const PRO = "price_pro_1282";
const env = (key: string) => ({ STRIPE_PRO_PRICE_ID: PRO, STRIPE_PRICE_CURRENCY: "usd" } as Record<string, string>)[key];

type Call = [string, ...unknown[]];

const proSub = (over: Record<string, unknown> = {}) => ({ id: "sub_1", customer: "cus_1", livemode: false, status: "active",
  cancel_at_period_end: false, current_period_end: 3000, latest_invoice: "in_1", items: { data: [{ price: { id: PRO } }] }, ...over });
const PAID_BEFORE_REFUND = 1000, REFUNDED_AT = 2000, PAID_AFTER_REFUND = 2500;
const invoiceFor = (over: Record<string, unknown> = {}) => ({ id: "in_1", customer: "cus_1", livemode: false, subscription: "sub_1", status: "paid", currency: "usd",
  amount_paid: 1000, status_transitions: { paid_at: PAID_BEFORE_REFUND }, ...over });

function fakeStripe(opts: {
  invoice?: any; invoices?: Record<string, any>; invoiceErr?: boolean; sub?: any; subErr?: boolean; updateErr?: boolean; updated?: any;
} = {}) {
  const calls: Call[] = [];
  const stripe = {
    webhooks: { constructEvent: (body: string) => JSON.parse(body) },
    invoices: {
      retrieve: (id: string) => { calls.push(["invoices.retrieve", id]);
        if (opts.invoiceErr) return Promise.reject(new Error("down"));
        // An Error in the map fails that one retrieval only, so a later invoice can fail while the refunded one reads.
        if (opts.invoices && id in opts.invoices) {
          return opts.invoices[id] instanceof Error ? Promise.reject(opts.invoices[id]) : Promise.resolve(opts.invoices[id]);
        }
        return Promise.resolve("invoice" in opts ? opts.invoice : invoiceFor({ id })); },
    },
    subscriptions: {
      retrieve: (id: string) => { calls.push(["subscriptions.retrieve", id]);
        return opts.subErr ? Promise.reject(new Error("down")) : Promise.resolve("sub" in opts ? opts.sub : proSub({ id })); },
      update: (id: string, params: unknown, options: unknown) => { calls.push(["subscriptions.update", id, params, options]);
        return opts.updateErr ? Promise.reject(new Error("down"))
          : Promise.resolve("updated" in opts ? opts.updated : proSub({ id, cancel_at_period_end: true })); },
      cancel: (id: string) => { calls.push(["subscriptions.cancel", id]); return Promise.resolve({ id, status: "canceled" }); },
      del: (id: string) => { calls.push(["subscriptions.del", id]); return Promise.resolve({ id, status: "canceled" }); },
    },
    refunds: { create: () => { calls.push(["refunds.create"]); return Promise.resolve({}); } },
    prices: { retrieve: () => Promise.reject(new Error("unused")) },
  };
  // Any Stripe method the fake does not define (invoices.voidInvoice, invoices.pay, subscriptions.resume, ...)
  // is still recorded before it fails, so "nothing else was written" can be asserted from calls alone.
  const recording = (resource: string, target: Record<string, unknown>) => new Proxy(target, {
    get: (object, prop) => typeof prop !== "string" || prop in object ? Reflect.get(object, prop)
      : (...args: unknown[]) => { calls.push([`${resource}.${prop}`, ...args] as Call); return Promise.reject(new Error("unexpected call")); },
  });
  // Only the money-moving resources are recorded this way; webhooks and prices keep their plain shape.
  const recorded = { ...stripe,
    invoices: recording("invoices", stripe.invoices), subscriptions: recording("subscriptions", stripe.subscriptions),
    refunds: recording("refunds", stripe.refunds), charges: recording("charges", {}), creditNotes: recording("creditNotes", {}),
    customers: recording("customers", {}), paymentIntents: recording("paymentIntents", {}) };
  return { stripe: recorded as unknown as typeof stripe, calls };
}

const fullCharge = (over: Record<string, unknown> = {}) =>
  ({ id: "ch_1", customer: "cus_1", livemode: false, amount: 1000, amount_refunded: 1000, refunded: true, currency: "usd",
    invoice: "in_1", ...over });

type Followup = { operation_key: string; livemode: boolean | null; status: "unresolved" | "reconciled"; reason: string;
  first_event_id: string; last_event_id: string; deliveries: number; reconciliation: string | null };
/**
 * The database as the webhook sees it. record_stripe_refund_followup follows the migration
 * (20261112130000_stripe_refund_followups.sql): one row per operation; the same event with the same reason again
 * only counts a delivery; a new event or a new reason reopens. The SQL itself runs in stripeRefundFollowups.test.ts. `fail` makes that write fail in the given way, for the "no false success" controls.
 */
const db = (fail?: "error" | "false" | "throw" | "legacy") => {
  const rpcs: string[] = [];
  const args: Record<string, unknown>[] = [];
  const followups = new Map<string, Followup>();
  const recordFollowup = (a: Record<string, unknown>) => {
    const key = a.p_operation_key as string, event = a.p_event_id as string;
    const row = followups.get(key);
    if (!row) {
      followups.set(key, { operation_key: key, livemode: a.p_livemode as boolean | null, status: "unresolved",
        reason: a.p_reason as string, first_event_id: event, last_event_id: event, deliveries: 1, reconciliation: null });
    } else {
      const seen = [row.first_event_id, row.last_event_id].includes(event) && row.reason === a.p_reason;
      Object.assign(row, { deliveries: row.deliveries + 1, last_event_id: event, reason: a.p_reason,
        status: seen ? row.status : "unresolved", reconciliation: seen ? row.reconciliation : null });
    }
    return true;
  };
  const supabase = { rpc: (name: string, a: Record<string, unknown>) => {
    rpcs.push(name);
    if (name !== "record_stripe_refund_followup") return Promise.resolve({ data: { success: true }, error: null });
    args.push(a);
    if (fail === "throw") return Promise.reject(new Error("db down"));
    if (fail === "error") return Promise.resolve({ data: null, error: { message: "permission denied" } });
    if (fail === "false") return Promise.resolve({ data: false, error: null });
    if (fail === "legacy") return Promise.resolve({ data: { success: true }, error: null });
    return Promise.resolve({ data: recordFollowup(a), error: null });
  } };
  return { rpcs, args, followups, supabase };
};

const refundEvent = (charge = fullCharge(), id = "evt_refund_1", created: unknown = REFUNDED_AT) =>
  new Request("http://localhost", { method: "POST", headers: { "Stripe-Signature": "mock" },
    body: JSON.stringify({ id, created, type: "charge.refunded", data: { object: charge } }) });

const updates = (calls: Call[]) => calls.filter(c => c[0] === "subscriptions.update");

Deno.test("refund → cancel at period end", async (t) => {
  await t.step("a refund of a Pro subscription invoice schedules cancel_at_period_end, once, keyed to the event", async () => {
    const { stripe, calls } = fakeStripe();
    const { rpcs, supabase } = db();
    const res = await handler(refundEvent(), stripe, supabase, "secret", env);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).refund, "scheduled");
    assertEquals(updates(calls), [["subscriptions.update", "sub_1", { cancel_at_period_end: true },
      { idempotencyKey: "refund-cancel-at-period-end-evt_refund_1" }]]);
    // Access is not changed here: no database write. The subscription.updated event that follows does it.
    assertEquals(rpcs, []);
  });

  await t.step("negative control: never cancels immediately and never refunds again", async () => {
    const { stripe, calls } = fakeStripe();
    await handler(refundEvent(), stripe, db().supabase, "secret", env);
    assertEquals(calls.filter(c => ["subscriptions.cancel", "subscriptions.del", "refunds.create"].includes(c[0])), []);
  });

  await t.step("every state that can still charge again is scheduled, past_due and unpaid included", async () => {
    assertEquals([...SCHEDULABLE_STATES], ["active", "trialing", "past_due", "unpaid", "paused"]);
    for (const status of SCHEDULABLE_STATES) {
      const { stripe, calls } = fakeStripe({ sub: proSub({ status }), updated: proSub({ status, cancel_at_period_end: true }) });
      const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
      assertEquals(res.status, 200, status);
      assertEquals((await res.json()).refund, "scheduled", status);
      assertEquals(updates(calls).length, 1, status);
    }
  });

  await t.step("already ended (canceled, incomplete_expired) or already scheduled makes no change", async () => {
    for (const status of ENDED_STATES) {
      const { stripe, calls } = fakeStripe({ sub: proSub({ status }) });
      const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
      assertEquals(res.status, 200, status);
      assertEquals((await res.json()).refund, "already_ended", status);
      assertEquals(updates(calls), [], status);
    }
    const { stripe, calls } = fakeStripe({ sub: proSub({ cancel_at_period_end: true }) });
    assertEquals((await (await handler(refundEvent(), stripe, db().supabase, "secret", env)).json()).refund, "already_scheduled");
    assertEquals(updates(calls), []);
  });

  await t.step("negative control: a state that cannot be scheduled safely is unverified (non-2xx), never success", async () => {
    for (const status of ["incomplete", "", "something_new", undefined]) {
      const { stripe, calls } = fakeStripe({ sub: proSub({ status }) });
      const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
      assertEquals(res.status >= 500, true, String(status));
      assertEquals(updates(calls), [], String(status));
    }
  });

  await t.step("negative control: an update answer that does not confirm cancel_at_period_end is never 'scheduled'", async () => {
    for (const updated of [proSub({ cancel_at_period_end: false }), proSub({ id: "sub_other", cancel_at_period_end: true }),
      proSub({ cancel_at_period_end: "true" }), proSub({ status: "canceled", cancel_at_period_end: true }), {}, null, undefined]) {
      const { stripe } = fakeStripe({ updated });
      const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
      assertEquals(res.status >= 500, true, JSON.stringify(updated));
    }
  });

  await t.step("negative control: an unrelated customer never reaches the mutation", async () => {
    const cases: Record<string, unknown>[] = [
      { invoice: invoiceFor({ customer: "cus_other" }) },
      { sub: proSub({ customer: "cus_other" }) },
      { sub: proSub({ customer: { id: "cus_other" } }) },
      { invoice: invoiceFor({ livemode: true }) },
      { sub: proSub({ livemode: true }) },
      { invoice: invoiceFor({ id: "in_other" }) },
      { sub: proSub({ id: "sub_other" }) },
    ];
    for (const opts of cases) {
      const { stripe, calls } = fakeStripe(opts);
      const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
      assertEquals(res.status >= 500, true, JSON.stringify(opts));
      assertEquals(updates(calls), [], JSON.stringify(opts));
    }
    for (const charge of [fullCharge({ customer: null }), fullCharge({ livemode: undefined }), fullCharge({ id: null })]) {
      const { stripe, calls } = fakeStripe();
      const res = await handler(refundEvent(charge), stripe, db().supabase, "secret", env);
      assertEquals(res.status >= 500, true, JSON.stringify(charge));
      assertEquals(updates(calls), [], JSON.stringify(charge));
    }
  });

  await t.step("negative control: another product's subscription is acknowledged but never changed", async () => {
    for (const sub of [proSub({ items: { data: [{ price: { id: "price_other" } }] } }), proSub({ items: { data: [] } })]) {
      const { stripe, calls } = fakeStripe({ sub });
      const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
      assertEquals(res.status, 200);
      assertEquals((await res.json()).refund, "not_pro_subscription");
      assertEquals(updates(calls), []);
    }
    // Unreadable items, or no configured Pro price, cannot be verified at all.
    const unreadable = fakeStripe({ sub: proSub({ items: null }) });
    assertEquals((await handler(refundEvent(), unreadable.stripe, db().supabase, "secret", env)).status >= 500, true);
    const unconfigured = fakeStripe();
    const res = await handler(refundEvent(), unconfigured.stripe, db().supabase, "secret", () => undefined);
    assertEquals(res.status >= 500, true);
    assertEquals(unconfigured.calls, []);
  });

  await t.step("a redelivered refund event after scheduling makes no second change", async () => {
    const first = fakeStripe();
    await handler(refundEvent(), first.stripe, db().supabase, "secret", env);
    const second = fakeStripe({ sub: proSub({ cancel_at_period_end: true }) });
    const res = await handler(refundEvent(), second.stripe, db().supabase, "secret", env);
    assertEquals((await res.json()).refund, "already_scheduled");
    assertEquals(updates(second.calls), []);
  });

  await t.step("a charge that is not a subscription invoice's does nothing", async () => {
    const noInvoice = fakeStripe();
    const first = await handler(refundEvent(fullCharge({ invoice: null })), noInvoice.stripe, db().supabase, "secret", env);
    assertEquals(first.status, 200);
    assertEquals((await first.json()).refund, "not_subscription_charge");
    assertEquals(noInvoice.calls, []);
    const { stripe, calls } = fakeStripe({ invoice: invoiceFor({ subscription: null }) });
    const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
    assertEquals((await res.json()).refund, "not_subscription_charge");
    assertEquals(updates(calls), []);
  });

  await t.step("Stripe uncertainty is retryable (non-2xx) and never reported as done", async () => {
    for (const opts of [{ invoiceErr: true }, { subErr: true }, { updateErr: true }, { invoice: null }, { sub: null }]) {
      const { stripe } = fakeStripe(opts);
      const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
      assertEquals(res.status >= 500, true, JSON.stringify(opts));
    }
  });

  await t.step("the follow-up names the subscription from the refunded invoice, not from the event", async () => {
    const { stripe, calls } = fakeStripe({ invoice: invoiceFor({ subscription: { id: "sub_from_invoice" } }) });
    const out = await scheduleCancellationAfterRefund(stripe, fullCharge({ subscription: "sub_spoofed" }), "evt", PRO);
    assertEquals(out, { outcome: "scheduled", subscriptionId: "sub_from_invoice" });
    assertEquals(updates(calls)[0]?.[1], "sub_from_invoice");
  });
  await t.step("v5 return: only a verified full refund schedules; partial is acknowledged and changes nothing", async () => {
    assertEquals(refundAmount(fullCharge()), "full");
    assertEquals(refundAmount(fullCharge({ amount_refunded: 1, refunded: false })), "partial");
    // A partial refund (1/1000) is acknowledged with no Stripe call, so nothing is cancelled.
    const partial = fakeStripe();
    const res = await handler(refundEvent(fullCharge({ amount_refunded: 1, refunded: false })), partial.stripe, db().supabase, "secret", env);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).refund, "partial_refund_ignored");
    assertEquals(partial.calls, []);
    // Zero, missing or inconsistent amounts are unverified (non-2xx), never scheduled.
    const unknown: Record<string, unknown>[] = [
      { amount_refunded: 0, refunded: false }, { amount_refunded: 0, refunded: true }, { amount_refunded: undefined },
      { amount_refunded: null }, { amount: undefined }, { amount: 0, amount_refunded: 0 }, { amount_refunded: "1000" },
      { amount_refunded: 999.5 }, { amount_refunded: 1001 }, { refunded: false }, { refunded: undefined },
      { amount_refunded: 1, refunded: true }, { amount: -1000, amount_refunded: -1000 },
    ];
    for (const over of unknown) {
      assertEquals(refundAmount(fullCharge(over)), "unknown", JSON.stringify(over));
      const { stripe, calls } = fakeStripe();
      const out = await handler(refundEvent(fullCharge(over)), stripe, db().supabase, "secret", env);
      assertEquals(out.status >= 500, true, JSON.stringify(over));
      assertEquals(calls, [], JSON.stringify(over));
    }
  });

  await t.step("v5 return: an explicit null is 'no invoice'; a missing or malformed reference is unverified", async () => {
    assertEquals(reference(null), { kind: "absent" });
    assertEquals(reference("in_1"), { kind: "id", id: "in_1" });
    assertEquals(reference({ id: "in_1" }), { kind: "id", id: "in_1" });
    for (const value of [undefined, "", "  ", 42, {}, { id: 7 }, { id: "" }, "in 1", "not-an-id", [], true]) {
      assertEquals(reference(value), { kind: "malformed" }, JSON.stringify(value));
    }
    for (const invoice of [undefined, "", 42, {}, { id: "" }, "not-an-id"]) {
      const { stripe, calls } = fakeStripe();
      const charge = fullCharge({ invoice });
      if (invoice === undefined) delete (charge as Record<string, unknown>).invoice;
      const res = await handler(refundEvent(charge), stripe, db().supabase, "secret", env);
      assertEquals(res.status >= 500, true, `charge.invoice ${JSON.stringify(invoice)}`);
      assertEquals(updates(calls), []);
    }
    for (const subscription of [undefined, "", 42, {}, { id: null }, "not-an-id"]) {
      const invoice = invoiceFor({ subscription });
      if (subscription === undefined) delete (invoice as Record<string, unknown>).subscription;
      const { stripe, calls } = fakeStripe({ invoice });
      const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
      assertEquals(res.status >= 500, true, `invoice.subscription ${JSON.stringify(subscription)}`);
      assertEquals(updates(calls), []);
    }
  });

  await t.step("v5 return: the refunded invoice must be the paid invoice for this charge", async () => {
    for (const over of [{ status: "open" }, { status: "void" }, { status: undefined }, { currency: "eur" }, { amount_paid: 1 },
      { amount_paid: undefined }]) {
      const { stripe, calls } = fakeStripe({ invoice: invoiceFor(over) });
      const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
      assertEquals(res.status >= 500, true, JSON.stringify(over));
      assertEquals(updates(calls), [], JSON.stringify(over));
    }
  });

  await t.step("v5 return: a cancellation answer with a missing or unknown status is never 'scheduled'", async () => {
    for (const status of [undefined, null, "", "something_new", "incomplete", "canceled"]) {
      const { stripe } = fakeStripe({ updated: proSub({ status, cancel_at_period_end: true }) });
      const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
      assertEquals(res.status >= 500, true, String(status));
    }
    for (const over of [{ customer: "cus_other" }, { customer: undefined }, { livemode: true }, { livemode: undefined }]) {
      const { stripe } = fakeStripe({ updated: proSub({ cancel_at_period_end: true, ...over }) });
      const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
      assertEquals(res.status >= 500, true, JSON.stringify(over));
    }
  });

  await t.step("renewal boundary: latest invoice schedules; an earlier one schedules only when the renewal is paid", async () => {
    // The refunded invoice is the subscription's latest: scheduled.
    const current = fakeStripe();
    assertEquals((await (await handler(refundEvent(), current.stripe, db().supabase, "secret", env)).json()).refund, "scheduled");
    // An earlier invoice, renewal already paid (or voided): scheduled, so the member keeps the paid month.
    for (const status of ["paid", "void"]) {
      const renewal = invoiceFor({ id: "in_2", status, amount_paid: status === "paid" ? 1000 : 0 });
      const { stripe, calls } = fakeStripe({ sub: proSub({ latest_invoice: "in_2" }), invoices: { in_2: renewal } });
      const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
      assertEquals((await res.json()).refund, "scheduled", status);
      assertEquals(updates(calls).length, 1, status);
    }
    // The same with the latest invoice expanded on the subscription: no extra read needed.
    const expanded = fakeStripe({ sub: proSub({ latest_invoice: invoiceFor({ id: "in_2" }) }) });
    assertEquals((await (await handler(refundEvent(), expanded.stripe, db().supabase, "secret", env)).json()).refund, "scheduled");
    assertEquals(expanded.calls.filter(c => c[0] === "invoices.retrieve").map(c => c[1]), ["in_1"]);
    // An earlier invoice while a renewal is outstanding: cancel at period end would not stop Stripe collecting
    // it, so this is unverified and nothing is changed.
    for (const status of ["draft", "open", "uncollectible", undefined, "something_new"]) {
      const renewal = invoiceFor({ id: "in_2", status });
      const { stripe, calls } = fakeStripe({ sub: proSub({ status: "past_due", latest_invoice: "in_2" }), invoices: { in_2: renewal } });
      const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
      assertEquals(res.status >= 500, true, String(status));
      assertEquals(updates(calls), [], String(status));
    }
    const named = fakeStripe({ sub: proSub({ latest_invoice: "in_2" }), invoices: { in_2: invoiceFor({ id: "in_2", status: "open" }) } });
    assertEquals(await scheduleCancellationAfterRefund(named.stripe, fullCharge(), "evt", PRO),
      { outcome: "unverified", reason: "a later renewal invoice is still outstanding", code: "renewal_outstanding" });
    // A latest invoice that is not this subscription's, unreadable, or missing: unverified.
    const cases: Record<string, unknown>[] = [
      { sub: proSub({ latest_invoice: "in_2" }), invoices: { in_2: invoiceFor({ id: "in_2", subscription: "sub_other" }) } },
      { sub: proSub({ latest_invoice: "in_2" }), invoices: { in_2: invoiceFor({ id: "in_2", customer: "cus_other" }) } },
      { sub: proSub({ latest_invoice: "in_2" }), invoices: { in_2: invoiceFor({ id: "in_3" }) } },
      { sub: proSub({ latest_invoice: "in_2" }), invoices: { in_2: null } },
      { sub: proSub({ latest_invoice: null }) },
      { sub: proSub({ latest_invoice: undefined }) },
      { sub: proSub({ latest_invoice: 42 }) },
    ];
    for (const opts of cases) {
      const { stripe, calls } = fakeStripe(opts);
      const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
      assertEquals(res.status >= 500, true, JSON.stringify(opts));
      assertEquals(updates(calls), [], JSON.stringify(opts));
    }
  });
  await t.step("Sam's c381f853 return: a missing or invalid currency never matches, so nothing is scheduled", async () => {
    const cases: [Record<string, unknown>, Record<string, unknown>][] = [
      [{ currency: undefined }, { currency: undefined }],
      [{ currency: null }, { currency: null }],
      [{ currency: "" }, { currency: "" }],
      [{ currency: "USD" }, { currency: "USD" }],
      [{ currency: "us" }, { currency: "us" }],
      [{ currency: 840 }, { currency: 840 }],
      [{ currency: "usd" }, { currency: undefined }],
      [{ currency: undefined }, { currency: "usd" }],
    ];
    for (const [chargeOver, invoiceOver] of cases) {
      const { stripe, calls } = fakeStripe({ invoice: invoiceFor(invoiceOver) });
      const res = await handler(refundEvent(fullCharge(chargeOver)), stripe, db().supabase, "secret", env);
      assertEquals(res.status >= 500, true, JSON.stringify([chargeOver, invoiceOver]));
      assertEquals(updates(calls), [], JSON.stringify([chargeOver, invoiceOver]));
    }
    const out = await scheduleCancellationAfterRefund(fakeStripe({ invoice: invoiceFor({ currency: undefined }) }).stripe,
      fullCharge({ currency: undefined }), "evt", PRO);
    assertEquals(out, { outcome: "unverified", reason: "charge currency unreadable", code: "refund_unreadable" });
  });

  await t.step("Sam's c381f853 return: an update answer that moved to an outstanding renewal is never 'scheduled'", async () => {
    // Read: latest is the refunded invoice. Update answer: a new renewal invoice was issued in between.
    for (const status of ["draft", "open", "uncollectible", undefined, "something_new"]) {
      const renewal = invoiceFor({ id: "in_2", status });
      const { stripe, calls } = fakeStripe({ invoices: { in_2: renewal },
        updated: proSub({ cancel_at_period_end: true, latest_invoice: "in_2" }) });
      const database = db();
      const res = await handler(refundEvent(), stripe, database.supabase, "secret", env);
      assertEquals(res.status >= 500, true, String(status));
      assertEquals(updates(calls).length, 1, String(status));
      // Detection and escalation only (Sam's adbec69d review): the one update stays applied (never reverted to
      // false) and nothing else is written, in Stripe or the database, so the issued renewal is not stopped here.
      // The fake records every Stripe method, defined or not, so a new write call would show up in calls.
      assertEquals(updates(calls).map(call => call[2]), [{ cancel_at_period_end: true }], String(status));
      assertEquals(calls.filter(call => !String(call[0]).endsWith(".retrieve") && call[0] !== "subscriptions.update"), [], String(status));
      // The only database write is the operator signal, and it is the closed after-update reason.
      assertEquals(database.rpcs, ["record_stripe_refund_followup"], String(status));
      assertEquals(database.followups.get("charge:ch_1")?.reason, status === "draft" || status === "open" || status === "uncollectible"
        ? "renewal_outstanding_after_update" : "boundary_unverified_after_update", String(status));
    }
    const named = fakeStripe({ invoices: { in_2: invoiceFor({ id: "in_2", status: "open" }) },
      updated: proSub({ cancel_at_period_end: true, latest_invoice: "in_2" }) });
    assertEquals(await scheduleCancellationAfterRefund(named.stripe, fullCharge(), "evt", PRO),
      { outcome: "unverified", reason: "after update: a later renewal invoice is still outstanding",
        code: "renewal_outstanding_after_update" });
    // An update answer whose latest invoice is missing, unreadable or another subscription's is unverified too.
    for (const latest_invoice of [undefined, null, 42, { id: "" }]) {
      const { stripe } = fakeStripe({ updated: proSub({ cancel_at_period_end: true, latest_invoice }) });
      const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
      assertEquals(res.status >= 500, true, JSON.stringify(latest_invoice));
    }
    const foreign = fakeStripe({ invoices: { in_2: invoiceFor({ id: "in_2", subscription: "sub_other" }) },
      updated: proSub({ cancel_at_period_end: true, latest_invoice: "in_2" }) });
    assertEquals((await handler(refundEvent(), foreign.stripe, db().supabase, "secret", env)).status >= 500, true);
    // A renewal that is already paid (or the same refunded invoice) after the update is still scheduled.
    for (const updated of [proSub({ cancel_at_period_end: true }),
      proSub({ cancel_at_period_end: true, latest_invoice: invoiceFor({ id: "in_2", status: "paid" }) })]) {
      const { stripe } = fakeStripe({ updated });
      assertEquals((await (await handler(refundEvent(), stripe, db().supabase, "secret", env)).json()).refund, "scheduled");
    }
    // A redelivery after such a failure still fails closed at the boundary, before "already_scheduled", but only
    // while the renewal is outstanding. Once Stripe has collected it (after the refund), a redelivery is 2xx
    // "already_scheduled" only with its own durable signal, "renewal_collected_after_refund" (security review of
    // 8958c6cc; Sam's 2026-11-12 decision; security review of 664b84f6).
    const redelivered = fakeStripe({ sub: proSub({ cancel_at_period_end: true, latest_invoice: "in_2" }),
      invoices: { in_2: invoiceFor({ id: "in_2", status: "open" }) } });
    const again = await handler(refundEvent(), redelivered.stripe, db().supabase, "secret", env);
    assertEquals(again.status >= 500, true);
    assertEquals(updates(redelivered.calls), []);
    const collected = fakeStripe({ sub: proSub({ cancel_at_period_end: true, latest_invoice: "in_2" }),
      invoices: { in_2: invoiceFor({ id: "in_2", status: "paid", status_transitions: { paid_at: PAID_AFTER_REFUND } }) } });
    const signal = db();
    const afterCharge = await handler(refundEvent(), collected.stripe, signal.supabase, "secret", env);
    assertEquals(afterCharge.status, 200);
    assertEquals(await afterCharge.json(), { received: true, refund: "already_scheduled", followup: "unresolved" });
    assertEquals(signal.followups.get("charge:ch_1")?.reason, "renewal_collected_after_refund");
    assertEquals(updates(collected.calls), []);
  });
});

Deno.test("refund follow-up → durable operator signal (Sam's 2026-11-12 decision)", async (t) => {
  const outstanding = () => fakeStripe({ invoices: { in_2: invoiceFor({ id: "in_2", status: "open" }) },
    updated: proSub({ cancel_at_period_end: true, latest_invoice: "in_2" }) });
  const partialCharge = () => fullCharge({ amount_refunded: 1, refunded: false });

  // That these codes are exactly the migration's closed list is checked in tests/unit/stripeRefundFollowups.test.ts,
  // which may read files (the edge tests run without read access).

  await t.step("an unverified follow-up records one unresolved, content-free row, and still answers non-2xx", async () => {
    const database = db();
    const { stripe, calls } = outstanding();
    const res = await handler(refundEvent(), stripe, database.supabase, "secret", env);
    assertEquals(res.status >= 500, true);
    assertEquals(database.args, [{ p_operation_key: "charge:ch_1", p_event_id: "evt_refund_1", p_livemode: false,
      p_reason: "renewal_outstanding_after_update" }]);
    assertEquals([...database.followups.values()], [{ operation_key: "charge:ch_1", livemode: false, status: "unresolved",
      reason: "renewal_outstanding_after_update", first_event_id: "evt_refund_1", last_event_id: "evt_refund_1",
      deliveries: 1, reconciliation: null }]);
    // Recording is not acting: one cancel_at_period_end update, nothing else written in Stripe.
    assertEquals(calls.filter(call => !String(call[0]).endsWith(".retrieve")).map(call => call[0]), ["subscriptions.update"]);
  });

  await t.step("repeat delivery keeps one row and counts it; a clean-looking redelivery never resolves it", async () => {
    const database = db();
    await handler(refundEvent(), outstanding().stripe, database.supabase, "secret", env);
    const again = fakeStripe({ sub: proSub({ cancel_at_period_end: true, latest_invoice: "in_2" }),
      invoices: { in_2: invoiceFor({ id: "in_2", status: "open" }) } });
    assertEquals((await handler(refundEvent(), again.stripe, database.supabase, "secret", env)).status >= 500, true);
    assertEquals(database.followups.size, 1);
    assertEquals(database.followups.get("charge:ch_1")?.deliveries, 2);
    assertEquals(database.followups.get("charge:ch_1")?.reason, "renewal_outstanding");
    // Stripe has since collected the renewal. The redelivery is 2xx only with the signal kept unresolved, now
    // naming the charge after the refund; nothing in the webhook resolves it.
    const collected = fakeStripe({ sub: proSub({ cancel_at_period_end: true, latest_invoice: "in_2" }),
      invoices: { in_2: invoiceFor({ id: "in_2", status: "paid", status_transitions: { paid_at: PAID_AFTER_REFUND } }) } });
    const clean = await handler(refundEvent(), collected.stripe, database.supabase, "secret", env);
    assertEquals([clean.status, (await clean.json()).refund], [200, "already_scheduled"]);
    assertEquals(database.followups.size, 1);
    assertEquals(database.followups.get("charge:ch_1")?.status, "unresolved");
    assertEquals(database.followups.get("charge:ch_1")?.reason, "renewal_collected_after_refund");
    assertEquals(database.followups.get("charge:ch_1")?.deliveries, 3);
    // A renewal paid BEFORE the refund is the member's current month: scheduled, no signal.
    const earlier = fakeStripe({ sub: proSub({ cancel_at_period_end: true, latest_invoice: "in_2" }),
      invoices: { in_2: invoiceFor({ id: "in_2", status: "paid" }) } });
    const quiet = db();
    assertEquals(await (await handler(refundEvent(), earlier.stripe, quiet.supabase, "secret", env)).json(),
      { received: true, refund: "already_scheduled" });
    assertEquals(quiet.rpcs, []);
  });

  await t.step("a partial refund is acknowledged only once its signal is durable", async () => {
    const database = db();
    const { stripe, calls } = fakeStripe();
    const res = await handler(refundEvent(partialCharge()), stripe, database.supabase, "secret", env);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { received: true, refund: "partial_refund_ignored", followup: "unresolved" });
    assertEquals(database.followups.get("charge:ch_1")?.reason, "partial_refund");
    assertEquals(database.followups.get("charge:ch_1")?.status, "unresolved");
    assertEquals(calls, []);
  });

  await t.step("negative control: a failed signal write is never reported as success", async () => {
    for (const fail of ["error", "false", "throw", "legacy"] as const) {
      const partial = await handler(refundEvent(partialCharge()), fakeStripe().stripe, db(fail).supabase, "secret", env);
      assertEquals(partial.status >= 500, true, `partial, ${fail}`);
      assertEquals((await partial.json()).refund, undefined, `partial, ${fail}`);
      const unverified = await handler(refundEvent(), outstanding().stripe, db(fail).supabase, "secret", env);
      assertEquals(unverified.status >= 500, true, `unverified, ${fail}`);
    }
  });

  await t.step("a verified outcome writes no signal", async () => {
    for (const opts of [{}, { sub: proSub({ cancel_at_period_end: true }) }, { sub: proSub({ status: "canceled" }) }]) {
      const database = db();
      const res = await handler(refundEvent(), fakeStripe(opts).stripe, database.supabase, "secret", env);
      assertEquals(res.status, 200, JSON.stringify(opts));
      assertEquals(database.rpcs, [], JSON.stringify(opts));
    }
  });

  await t.step("the operation is the charge, or the event when the charge id is unreadable; neither means no write", async () => {
    assertEquals(followupOperationKey({ id: "evt_1", data: { object: { id: "ch_9" } } }), "charge:ch_9");
    assertEquals(followupOperationKey({ id: "evt_1", data: { object: { id: "py_9" } } }), "charge:py_9");
    for (const id of [undefined, null, "", "ch_", "cus_9", "ch_9; drop", { id: "ch_9" }]) {
      assertEquals(followupOperationKey({ id: "evt_1", data: { object: { id } } }), "event:evt_1", JSON.stringify(id));
    }
    assertEquals(followupOperationKey({ id: "evt_bad id", data: { object: {} } }), null);
    const database = db();
    assertEquals(await recordRefundFollowup(database.supabase, { id: "bad", data: { object: { id: "ch_1" } } }, "partial_refund"), false);
    assertEquals(await recordRefundFollowup(database.supabase, { id: "evt_1", data: { object: { id: "ch_1" } } },
      "free text" as never), false);
    assertEquals(database.args, []);
    // A malformed charge still gets a signal, keyed to its event.
    const malformed = db();
    const res = await handler(refundEvent(fullCharge({ id: 42 })), fakeStripe().stripe, malformed.supabase, "secret", env);
    assertEquals(res.status >= 500, true);
    assertEquals([...malformed.followups.keys()], ["event:evt_refund_1"]);
    assertEquals(malformed.followups.get("event:evt_refund_1")?.reason, "refund_unreadable");
  });

  await t.step("a failed first write is not lost when Stripe then collects the renewal (security review of 664b84f6)", async () => {
    // Delivery 1: renewal outstanding after the update; the signal write fails, so nothing is recorded (non-2xx).
    const failed = db("error");
    assertEquals((await handler(refundEvent(), outstanding().stripe, failed.supabase, "secret", env)).status >= 500, true);
    assertEquals(failed.followups.size, 0);
    // Delivery 2: Stripe has collected that renewal after the refund. Acknowledged only with a durable signal.
    const collectedSub = { sub: proSub({ cancel_at_period_end: true, latest_invoice: "in_2" }),
      invoices: { in_2: invoiceFor({ id: "in_2", status: "paid", status_transitions: { paid_at: PAID_AFTER_REFUND } }) } };
    const stillFailing = db("throw");
    assertEquals((await handler(refundEvent(), fakeStripe(collectedSub).stripe, stillFailing.supabase, "secret", env)).status >= 500, true);
    const recovered = db();
    const res = await handler(refundEvent(), fakeStripe(collectedSub).stripe, recovered.supabase, "secret", env);
    assertEquals(res.status, 200);
    assertEquals(recovered.followups.get("charge:ch_1")?.reason, "renewal_collected_after_refund");
    // The same when the renewal was outstanding before any update (renewal_outstanding), then collected: the
    // redelivery schedules and records.
    const before = fakeStripe({ sub: proSub({ latest_invoice: "in_2" }),
      invoices: { in_2: invoiceFor({ id: "in_2", status: "paid", status_transitions: { paid_at: PAID_AFTER_REFUND } }) } });
    const scheduled = db();
    assertEquals(await (await handler(refundEvent(), before.stripe, scheduled.supabase, "secret", env)).json(),
      { received: true, refund: "scheduled", followup: "unresolved" });
    assertEquals(updates(before.calls).length, 1);
    assertEquals(scheduled.followups.get("charge:ch_1")?.reason, "renewal_collected_after_refund");
    // Found only on the update answer: still scheduled, still signalled.
    const onAnswer = fakeStripe({ invoices: { in_2: invoiceFor({ id: "in_2", status: "paid", status_transitions: { paid_at: REFUNDED_AT } }) },
      updated: proSub({ cancel_at_period_end: true, latest_invoice: "in_2" }) });
    const answered = db();
    assertEquals((await (await handler(refundEvent(), onAnswer.stripe, answered.supabase, "secret", env)).json()).followup, "unresolved");
    assertEquals(answered.followups.get("charge:ch_1")?.reason, "renewal_collected_after_refund");
  });

  await t.step("a subscription that ended before the redelivery does not hide a renewal collected after the refund", async () => {
    const ended = (paid_at: number) => fakeStripe({ sub: proSub({ status: "canceled", latest_invoice: "in_2" }),
      invoices: { in_2: invoiceFor({ id: "in_2", status: "paid", status_transitions: { paid_at } }) } });
    const failing = await handler(refundEvent(), ended(PAID_AFTER_REFUND).stripe, db("false").supabase, "secret", env);
    assertEquals(failing.status >= 500, true);
    const database = db();
    const res = await handler(refundEvent(), ended(PAID_AFTER_REFUND).stripe, database.supabase, "secret", env);
    assertEquals(await res.json(), { received: true, refund: "already_ended", followup: "unresolved" });
    assertEquals(database.followups.get("charge:ch_1")?.reason, "renewal_collected_after_refund");
    const quiet = db();
    const { stripe, calls } = ended(PAID_BEFORE_REFUND);
    assertEquals(await (await handler(refundEvent(), stripe, quiet.supabase, "secret", env)).json(), { received: true, refund: "already_ended" });
    assertEquals(quiet.rpcs, []);
    assertEquals(updates(calls), []);
  });

  await t.step("an ended subscription whose later invoice cannot be verified is never acknowledged (Sam's 866ee807 hold)", async () => {
    const endedWith = (latest_invoice: unknown, in_2?: unknown) =>
      fakeStripe({ sub: proSub({ status: "canceled", latest_invoice }), ...(in_2 === undefined ? {} : { invoices: { in_2 } }) });
    const cases: [string, ReturnType<typeof endedWith>, string][] = [
      ["later invoice read fails", endedWith("in_2", new Error("down")), "stripe_read_failed"],
      ["latest invoice reference malformed", endedWith(42), "subscription_state_unverified"],
      ["later invoice is another customer's", endedWith("in_2", invoiceFor({ id: "in_2", customer: "cus_other" })), "ownership_mismatch"],
      ["later renewal still outstanding", endedWith("in_2", invoiceFor({ id: "in_2", status: "open" })), "renewal_outstanding"],
      ["later invoice state unknown", endedWith("in_2", invoiceFor({ id: "in_2", status: "mystery" })), "subscription_state_unverified"],
    ];
    for (const [name, { stripe, calls }, reason] of cases) {
      const database = db();
      const res = await handler(refundEvent(), stripe, database.supabase, "secret", env);
      assertEquals(res.status >= 500, true, name);
      assertEquals(database.followups.get("charge:ch_1")?.reason, reason, name);
      assertEquals(database.followups.get("charge:ch_1")?.status, "unresolved", name);
      assertEquals(updates(calls), [], name);
      assertEquals(calls.filter(([method]) => !method.endsWith(".retrieve")), [], name);
    }
    // The loss case: the first delivery saw the collected renewal but its signal write failed; the subscription
    // then ended and the redelivery cannot read the renewal. Still non-2xx, so Stripe keeps redelivering, and the
    // signal is attempted every time until it is durable; a later readable delivery names the collected renewal.
    const collected = () => endedWith("in_2", invoiceFor({ id: "in_2", status: "paid", status_transitions: { paid_at: PAID_AFTER_REFUND } }));
    const firstWrite = db("false");
    assertEquals((await handler(refundEvent(), collected().stripe, firstWrite.supabase, "secret", env)).status >= 500, true);
    assertEquals(firstWrite.args.length, 1);
    const store = db();
    for (const writer of [db("throw"), store, store]) {
      const res = await handler(refundEvent(), endedWith("in_2", new Error("down")).stripe, writer.supabase, "secret", env);
      assertEquals(res.status >= 500, true);
      assertEquals(writer.args.length >= 1, true);
    }
    assertEquals(store.followups.get("charge:ch_1")?.reason, "stripe_read_failed");
    assertEquals(store.followups.get("charge:ch_1")?.deliveries, 2);
    const recovered = await handler(refundEvent(), collected().stripe, store.supabase, "secret", env);
    assertEquals(await recovered.json(), { received: true, refund: "already_ended", followup: "unresolved" });
    assertEquals(store.followups.get("charge:ch_1")?.reason, "renewal_collected_after_refund");
    assertEquals(store.followups.get("charge:ch_1")?.status, "unresolved");
  });

  await t.step("an unreadable payment or refund time is never passed over", async () => {
    const paidLater = (transitions: unknown) => fakeStripe({ sub: proSub({ latest_invoice: "in_2" }),
      invoices: { in_2: invoiceFor({ id: "in_2", status: "paid", status_transitions: transitions }) } });
    // Unreadable: still scheduled (the member is not left to renew), then reported unverified after the update.
    for (const transitions of [undefined, null, {}, { paid_at: null }, { paid_at: "2500" }, { paid_at: 0 }, { paid_at: 2500.5 }]) {
      const { stripe, calls } = paidLater(transitions);
      const out = await scheduleCancellationAfterRefund(stripe, fullCharge(), "evt", PRO, REFUNDED_AT);
      assertEquals(out.outcome === "unverified" ? out.code : out.outcome, "boundary_unverified_after_update", JSON.stringify(transitions));
      assertEquals(updates(calls).length, 1, JSON.stringify(transitions));
    }
    // Already scheduled, or already ended: nothing to apply, so unverified straight away.
    for (const sub of [proSub({ cancel_at_period_end: true, latest_invoice: "in_2" }), proSub({ status: "canceled", latest_invoice: "in_2" })]) {
      const { stripe, calls } = fakeStripe({ sub, invoices: { in_2: invoiceFor({ id: "in_2", status: "paid", status_transitions: {} }) } });
      const out = await scheduleCancellationAfterRefund(stripe, fullCharge(), "evt", PRO, REFUNDED_AT);
      assertEquals(out.outcome === "unverified" ? out.code : out.outcome, "subscription_state_unverified", sub.status);
      assertEquals(updates(calls), []);
    }
    // "missing" leaves created out of the event altogether (a default parameter would fill in undefined).
    for (const created of ["missing", null, "2000", -1, 2000.5]) {
      const database = db();
      const event = created === "missing"
        ? new Request("http://localhost", { method: "POST", headers: { "Stripe-Signature": "mock" },
          body: JSON.stringify({ id: "evt_refund_1", type: "charge.refunded", data: { object: fullCharge() } }) })
        : refundEvent(fullCharge(), "evt_refund_1", created);
      const res = await handler(event, paidLater({ paid_at: 1 }).stripe,
        database.supabase, "secret", env);
      assertEquals(res.status >= 500, true, JSON.stringify(created));
      assertEquals(database.followups.get("charge:ch_1")?.reason, "boundary_unverified_after_update", JSON.stringify(created));
    }
    // A void renewal, or the refunded invoice itself, needs no time: scheduled without a signal.
    const voided = fakeStripe({ sub: proSub({ latest_invoice: "in_2" }), invoices: { in_2: invoiceFor({ id: "in_2", status: "void", status_transitions: {} }) } });
    assertEquals((await scheduleCancellationAfterRefund(voided.stripe, fullCharge(), "evt", PRO)).outcome, "scheduled");
    assertEquals((await scheduleCancellationAfterRefund(fakeStripe().stripe, fullCharge(), "evt", PRO)).outcome, "scheduled");
  });

  await t.step("every unverified path carries a closed code", async () => {
    const paths: [Record<string, unknown>, Record<string, unknown>, string][] = [
      [{}, { invoiceErr: true }, "stripe_read_failed"],
      [{}, { subErr: true }, "stripe_read_failed"],
      [{}, { updateErr: true }, "update_failed"],
      [{}, { updated: proSub({ cancel_at_period_end: false }) }, "update_unconfirmed"],
      [{}, { invoice: invoiceFor({ customer: "cus_other" }) }, "ownership_mismatch"],
      [{}, { sub: proSub({ status: "incomplete" }) }, "subscription_state_unverified"],
      [{ amount_refunded: 0 }, {}, "refund_unreadable"],
    ];
    for (const [charge, opts, code] of paths) {
      const out = await scheduleCancellationAfterRefund(fakeStripe(opts).stripe, fullCharge(charge), "evt", PRO);
      assertEquals(out.outcome === "unverified" ? out.code : out.outcome, code, JSON.stringify([charge, opts]));
    }
    assertEquals((await scheduleCancellationAfterRefund(fakeStripe().stripe, fullCharge(), "evt", undefined)).outcome === "unverified"
      ? "configuration_missing" : "x", "configuration_missing");
  });
});
