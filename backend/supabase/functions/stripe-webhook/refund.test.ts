/**
 * Refund policy (Akin, 2026-11-12): a refunded customer keeps paid access until the period ends and is not
 * charged again. A refund of a Pro subscription invoice schedules cancel_at_period_end; nothing changes
 * entitlement directly. Fails closed on unverified ownership and on malformed or unconfirmed responses
 * (Sam's review of 34dab357). Offline only: Stripe and the database are in-memory fakes.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";
import { ENDED_STATES, SCHEDULABLE_STATES, scheduleCancellationAfterRefund } from "./refund.ts";

const PRO = "price_pro_1282";
const env = (key: string) => ({ STRIPE_PRO_PRICE_ID: PRO, STRIPE_PRICE_CURRENCY: "usd" } as Record<string, string>)[key];

type Call = [string, ...unknown[]];

const proSub = (over: Record<string, unknown> = {}) => ({ id: "sub_1", customer: "cus_1", livemode: false, status: "active",
  cancel_at_period_end: false, current_period_end: 3000, items: { data: [{ price: { id: PRO } }] }, ...over });
const invoiceFor = (over: Record<string, unknown> = {}) => ({ id: "in_1", customer: "cus_1", livemode: false, subscription: "sub_1", ...over });

function fakeStripe(opts: {
  invoice?: any; invoiceErr?: boolean; sub?: any; subErr?: boolean; updateErr?: boolean; updated?: any;
} = {}) {
  const calls: Call[] = [];
  const stripe = {
    webhooks: { constructEvent: (body: string) => JSON.parse(body) },
    invoices: {
      retrieve: (id: string) => { calls.push(["invoices.retrieve", id]);
        return opts.invoiceErr ? Promise.reject(new Error("down")) : Promise.resolve("invoice" in opts ? opts.invoice : invoiceFor({ id })); },
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
  ({ id: "ch_1", customer: "cus_1", livemode: false, amount: 1000, amount_refunded: 1000, refunded: true, invoice: "in_1", ...over });

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
});
