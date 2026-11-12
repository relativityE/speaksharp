/**
 * Refund policy (Akin, 2026-11-12): a refunded customer keeps paid access until the period ends and is not
 * charged again. A refund of a Pro subscription invoice schedules cancel_at_period_end; nothing changes
 * entitlement directly. Fails closed on unverified ownership and on malformed or unconfirmed responses
 * (Sam's review of 34dab357). Offline only: Stripe and the database are in-memory fakes.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";
import { ENDED_STATES, SCHEDULABLE_STATES, reference, refundAmount, scheduleCancellationAfterRefund } from "./refund.ts";

const PRO = "price_pro_1282";
const env = (key: string) => ({ STRIPE_PRO_PRICE_ID: PRO, STRIPE_PRICE_CURRENCY: "usd" } as Record<string, string>)[key];

type Call = [string, ...unknown[]];

const proSub = (over: Record<string, unknown> = {}) => ({ id: "sub_1", customer: "cus_1", livemode: false, status: "active",
  cancel_at_period_end: false, current_period_end: 3000, latest_invoice: "in_1", items: { data: [{ price: { id: PRO } }] }, ...over });
const invoiceFor = (over: Record<string, unknown> = {}) => ({ id: "in_1", customer: "cus_1", livemode: false, subscription: "sub_1", status: "paid", currency: "usd",
  amount_paid: 1000, ...over });

function fakeStripe(opts: {
  invoice?: any; invoices?: Record<string, any>; invoiceErr?: boolean; sub?: any; subErr?: boolean; updateErr?: boolean; updated?: any;
} = {}) {
  const calls: Call[] = [];
  const stripe = {
    webhooks: { constructEvent: (body: string) => JSON.parse(body) },
    invoices: {
      retrieve: (id: string) => { calls.push(["invoices.retrieve", id]);
        if (opts.invoiceErr) return Promise.reject(new Error("down"));
        if (opts.invoices && id in opts.invoices) return Promise.resolve(opts.invoices[id]);
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
  return { stripe, calls };
}

const fullCharge = (over: Record<string, unknown> = {}) =>
  ({ id: "ch_1", customer: "cus_1", livemode: false, amount: 1000, amount_refunded: 1000, refunded: true, currency: "usd",
    invoice: "in_1", ...over });

const db = () => {
  const rpcs: string[] = [];
  return { rpcs, supabase: { rpc: (name: string) => { rpcs.push(name); return Promise.resolve({ data: { success: true }, error: null }); } } };
};

const refundEvent = (charge = fullCharge(), id = "evt_refund_1") =>
  new Request("http://localhost", { method: "POST", headers: { "Stripe-Signature": "mock" },
    body: JSON.stringify({ id, type: "charge.refunded", data: { object: charge } }) });

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
      { outcome: "unverified", reason: "a later renewal invoice is still outstanding" });
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
    assertEquals(out, { outcome: "unverified", reason: "charge currency unreadable" });
  });

  await t.step("Sam's c381f853 return: an update answer that moved to an outstanding renewal is never 'scheduled'", async () => {
    // Read: latest is the refunded invoice. Update answer: a new renewal invoice was issued in between.
    for (const status of ["draft", "open", "uncollectible", undefined, "something_new"]) {
      const renewal = invoiceFor({ id: "in_2", status });
      const { stripe, calls } = fakeStripe({ invoices: { in_2: renewal },
        updated: proSub({ cancel_at_period_end: true, latest_invoice: "in_2" }) });
      const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
      assertEquals(res.status >= 500, true, String(status));
      assertEquals(updates(calls).length, 1, String(status));
    }
    const named = fakeStripe({ invoices: { in_2: invoiceFor({ id: "in_2", status: "open" }) },
      updated: proSub({ cancel_at_period_end: true, latest_invoice: "in_2" }) });
    assertEquals(await scheduleCancellationAfterRefund(named.stripe, fullCharge(), "evt", PRO),
      { outcome: "unverified", reason: "after update: a later renewal invoice is still outstanding" });
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
    // A redelivery after such a failure still fails closed at the boundary, before "already_scheduled".
    const redelivered = fakeStripe({ sub: proSub({ cancel_at_period_end: true, latest_invoice: "in_2" }),
      invoices: { in_2: invoiceFor({ id: "in_2", status: "open" }) } });
    const again = await handler(refundEvent(), redelivered.stripe, db().supabase, "secret", env);
    assertEquals(again.status >= 500, true);
    assertEquals(updates(redelivered.calls), []);
  });
});
