/**
 * Refund policy (Akin, 2026-11-12): a refunded customer keeps paid access until the period ends and is not
 * charged again. A full refund schedules cancel_at_period_end; nothing changes entitlement directly.
 * Offline only: Stripe and the database are in-memory fakes.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";
import { isFullRefund, scheduleCancellationAfterRefund } from "./refund.ts";

const env = (key: string) => ({ STRIPE_PRO_PRICE_ID: "price_pro_1282", STRIPE_PRICE_CURRENCY: "usd" } as Record<string, string>)[key];

type Call = [string, ...unknown[]];

function fakeStripe(opts: {
  invoice?: any; invoiceErr?: boolean; sub?: any; subErr?: boolean; updateErr?: boolean;
} = {}) {
  const calls: Call[] = [];
  const stripe = {
    webhooks: { constructEvent: (body: string) => JSON.parse(body) },
    invoices: {
      retrieve: (id: string) => { calls.push(["invoices.retrieve", id]);
        return opts.invoiceErr ? Promise.reject(new Error("down")) : Promise.resolve(opts.invoice ?? { id, subscription: "sub_1" }); },
    },
    subscriptions: {
      retrieve: (id: string) => { calls.push(["subscriptions.retrieve", id]);
        return opts.subErr ? Promise.reject(new Error("down"))
          : Promise.resolve(opts.sub ?? { id, status: "active", cancel_at_period_end: false, current_period_end: 3000 }); },
      update: (id: string, params: unknown, options: unknown) => { calls.push(["subscriptions.update", id, params, options]);
        return opts.updateErr ? Promise.reject(new Error("down")) : Promise.resolve({ id, cancel_at_period_end: true }); },
      cancel: (id: string) => { calls.push(["subscriptions.cancel", id]); return Promise.resolve({ id, status: "canceled" }); },
      del: (id: string) => { calls.push(["subscriptions.del", id]); return Promise.resolve({ id, status: "canceled" }); },
    },
    refunds: { create: () => { calls.push(["refunds.create"]); return Promise.resolve({}); } },
    prices: { retrieve: () => Promise.reject(new Error("unused")) },
  };
  return { stripe, calls };
}

const fullCharge = (over: Record<string, unknown> = {}) =>
  ({ id: "ch_1", amount: 1000, amount_refunded: 1000, refunded: true, invoice: "in_1", ...over });

const db = () => {
  const rpcs: string[] = [];
  return { rpcs, supabase: { rpc: (name: string) => { rpcs.push(name); return Promise.resolve({ data: { success: true }, error: null }); } } };
};

const refundEvent = (charge = fullCharge(), id = "evt_refund_1") =>
  new Request("http://localhost", { method: "POST", headers: { "Stripe-Signature": "mock" },
    body: JSON.stringify({ id, type: "charge.refunded", data: { object: charge } }) });

Deno.test("refund → cancel at period end", async (t) => {
  await t.step("a full refund of a subscription invoice schedules cancel_at_period_end, once, keyed to the event", async () => {
    const { stripe, calls } = fakeStripe();
    const { rpcs, supabase } = db();
    const res = await handler(refundEvent(), stripe, supabase, "secret", env);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).refund, "scheduled");
    const updates = calls.filter(c => c[0] === "subscriptions.update");
    assertEquals(updates, [["subscriptions.update", "sub_1", { cancel_at_period_end: true },
      { idempotencyKey: "refund-cancel-at-period-end-evt_refund_1" }]]);
    // Access is not changed here: no database write. The subscription.updated event that follows does it.
    assertEquals(rpcs, []);
  });

  await t.step("negative control: never cancels immediately and never refunds again", async () => {
    const { stripe, calls } = fakeStripe();
    await handler(refundEvent(), stripe, db().supabase, "secret", env);
    assertEquals(calls.filter(c => ["subscriptions.cancel", "subscriptions.del", "refunds.create"].includes(c[0])), []);
  });

  await t.step("idempotent: already scheduled, or no longer active, makes no change", async () => {
    for (const sub of [{ id: "sub_1", status: "active", cancel_at_period_end: true },
      { id: "sub_1", status: "canceled", cancel_at_period_end: false },
      { id: "sub_1", status: "past_due", cancel_at_period_end: false }]) {
      const { stripe, calls } = fakeStripe({ sub });
      const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
      assertEquals(res.status, 200, sub.status);
      assertEquals(calls.filter(c => c[0] === "subscriptions.update"), [], sub.status);
    }
  });

  await t.step("a redelivered refund event after scheduling makes no second change", async () => {
    const first = fakeStripe();
    await handler(refundEvent(), first.stripe, db().supabase, "secret", env);
    const second = fakeStripe({ sub: { id: "sub_1", status: "active", cancel_at_period_end: true } });
    const res = await handler(refundEvent(), second.stripe, db().supabase, "secret", env);
    assertEquals((await res.json()).refund, "already_scheduled");
    assertEquals(second.calls.filter(c => c[0] === "subscriptions.update"), []);
  });

  await t.step("partial refunds and non-subscription charges do nothing", async () => {
    for (const charge of [fullCharge({ amount_refunded: 500, refunded: false }), fullCharge({ amount_refunded: 999 }),
      fullCharge({ refunded: false }), fullCharge({ amount: 0, amount_refunded: 0 }), fullCharge({ invoice: null })]) {
      const { stripe, calls } = fakeStripe();
      const res = await handler(refundEvent(charge), stripe, db().supabase, "secret", env);
      assertEquals(res.status, 200, JSON.stringify(charge));
      assertEquals(calls.filter(c => c[0] === "subscriptions.update"), [], JSON.stringify(charge));
    }
    const { stripe, calls } = fakeStripe({ invoice: { id: "in_1", subscription: null } });
    const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
    assertEquals((await res.json()).refund, "not_subscription_charge");
    assertEquals(calls.filter(c => c[0] === "subscriptions.update"), []);
  });

  await t.step("Stripe uncertainty is retryable (non-2xx) and never reported as done", async () => {
    for (const opts of [{ invoiceErr: true }, { subErr: true }, { updateErr: true }]) {
      const { stripe } = fakeStripe(opts);
      const res = await handler(refundEvent(), stripe, db().supabase, "secret", env);
      assertEquals(res.status >= 500, true, JSON.stringify(opts));
    }
  });

  await t.step("isFullRefund requires refunded, a positive amount and the whole amount back", () => {
    assertEquals(isFullRefund(fullCharge()), true);
    assertEquals(isFullRefund(fullCharge({ amount_refunded: 999 })), false);
    assertEquals(isFullRefund(fullCharge({ refunded: false })), false);
    assertEquals(isFullRefund({ refunded: true }), false);
    assertEquals(isFullRefund(null), false);
  });

  await t.step("the follow-up names the subscription from the refunded invoice, not from the event", async () => {
    const { stripe, calls } = fakeStripe({ invoice: { id: "in_1", subscription: { id: "sub_from_invoice" } } });
    const out = await scheduleCancellationAfterRefund(stripe, fullCharge({ subscription: "sub_spoofed" }), "evt");
    assertEquals(out, { outcome: "scheduled", subscriptionId: "sub_from_invoice" });
    assertEquals(calls.find(c => c[0] === "subscriptions.update")?.[1], "sub_from_invoice");
  });
});
