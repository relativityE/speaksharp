// #1294 — EXECUTED integration proof (Deno): the REAL stripe-webhook handler + an ephemeral migrated PGlite
// database + a faithful, RECORDING fake Stripe. Proves the full test-clock lifecycle drives correct DB
// entitlement, that failed payments are actually recovered (not scripted active), and asserts the exact Stripe
// request shapes + ordering. No live Stripe, no production Supabase. It mirrors the real SDK surface:
// livemode comes from Balance (not Account), and the subscription only becomes active again once the failed
// invoice is genuinely paid.
import { assert, assertEquals, assertRejects, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "../../backend/supabase/functions/stripe-webhook/index.ts";
import { runBillingQualification, assertStripeTestMode, REQUIRED_PHASES } from "./runner.ts";

const PRICE = "price_test_pro";
const OK_PM = "pm_card_visa";
const FAIL_PM = "pm_card_chargeCustomerFail";
const TEST_PRICE = { id: PRICE, livemode: false, active: true, recurring: { interval: "month", interval_count: 1 }, unit_amount: 1000, currency: "usd" };

// A faithful fake Stripe driven as a state machine — subscription status changes only via the real operations
// (failing card + advance → past_due; invoices.pay → active; scheduled cancel + advance → canceled).
function fakeStripe(opts: { livemode?: boolean; failCleanup?: boolean; badCustomer?: boolean } = {}) {
  const calls: Array<{ m: string; a?: unknown }> = [];
  const rec = (m: string, a?: unknown) => { calls.push({ m, a }); };
  const deleted = new Set<string>();
  let status = "active";
  let cancelAPE = false;
  let pendingFailure = false;
  const subObj = () => ({
    id: "sub_1", status, customer: opts.badCustomer ? null : "cus_1", cancel_at_period_end: cancelAPE,
    current_period_end: 4_100_000_000, latest_invoice: "in_1", items: { data: [{ price: TEST_PRICE }] },
  });
  return {
    calls,
    balance: { retrieve: () => { rec("balance.retrieve"); return Promise.resolve({ livemode: opts.livemode ?? false }); } },
    prices: { retrieve: (id: string) => { rec("prices.retrieve", id); return Promise.resolve(TEST_PRICE); } },
    customers: {
      create: (p: unknown) => { rec("customers.create", p); return Promise.resolve({ id: "cus_1" }); },
      update: (id: string, p: Record<string, unknown>) => {
        rec("customers.update", { id, p });
        const settings = (p.invoice_settings ?? {}) as { default_payment_method?: string };
        if (settings.default_payment_method === FAIL_PM) pendingFailure = true;
        return Promise.resolve({ id });
      },
    },
    paymentMethods: { attach: (pm: string, p: unknown) => { rec("paymentMethods.attach", { pm, p }); return Promise.resolve({ id: pm }); } },
    invoices: { pay: (id: string, p: unknown) => { rec("invoices.pay", { id, p }); status = "active"; return Promise.resolve({ id, status: "paid" }); } },
    subscriptions: {
      create: (p: unknown) => { rec("subscriptions.create", p); status = "active"; return Promise.resolve(subObj()); },
      update: (id: string, p: Record<string, unknown>) => { rec("subscriptions.update", { id, p }); if (p.cancel_at_period_end === true) cancelAPE = true; return Promise.resolve(subObj()); },
      retrieve: (id: string) => { rec("subscriptions.retrieve", id); return Promise.resolve(subObj()); },
    },
    testHelpers: {
      testClocks: {
        create: (p: unknown) => { rec("testClocks.create", p); return Promise.resolve({ id: "clock_1", status: "ready" }); },
        advance: (id: string, p: unknown) => {
          rec("testClocks.advance", { id, p });
          if (pendingFailure) { status = "past_due"; pendingFailure = false; }
          else if (cancelAPE && status === "active") { status = "canceled"; }
          return Promise.resolve({ id, status: "advancing" });
        },
        retrieve: (id: string) => { rec("testClocks.retrieve", id); if (deleted.has(id)) return Promise.reject(Object.assign(new Error("No such test clock"), { code: "resource_missing" })); return Promise.resolve({ id, status: "ready", deleted: opts.failCleanup ? false : undefined }); },
        del: (id: string) => { rec("testClocks.del", id); if (!opts.failCleanup) deleted.add(id); return Promise.resolve({ id, deleted: !opts.failCleanup }); },
      },
    },
    webhooks: { constructEventAsync: (body: string) => JSON.parse(body) },
  };
}

const baseDeps = (stripe: ReturnType<typeof fakeStripe>) => ({
  stripe, handler, secretKey: "sk_test_x", webhookSecret: "whsec_test", priceId: PRICE,
  frozenTime: 1_700_000_000, clockTimeoutMs: 5_000, okPaymentMethod: OK_PM, failPaymentMethod: FAIL_PM, log: () => {},
});

Deno.test("full lifecycle proves every phase, with a REAL failed-invoice recovery", async () => {
  const stripe = fakeStripe();
  const out = await runBillingQualification(baseDeps(stripe));
  assertEquals(out.result, "PASSED");
  assertEquals(out.phases, REQUIRED_PHASES);

  // SHAPE: subscription created with a real nested items array (the old encoder produced items=[object Object]).
  assertEquals((stripe.calls.find((c) => c.m === "subscriptions.create")!.a as { items: unknown[] }).items, [{ price: PRICE }]);
  // SHAPE: the failed invoice is genuinely paid with the good card (not a scripted active state).
  const pay = stripe.calls.find((c) => c.m === "invoices.pay")!;
  assertEquals((pay.a as { id: string }).id, "in_1");
  assertEquals((pay.a as { p: { payment_method: string } }).p.payment_method, OK_PM);

  // ORDERING: preflight before creation; every clock advance is polled; recovery pay happens AFTER the failing
  // default is set and BEFORE the scheduled cancellation; cleanup verifies the clock is gone last.
  const order = stripe.calls.map((c) => c.m);
  assert(order.indexOf("balance.retrieve") < order.indexOf("testClocks.create"), "preflight precedes creation");
  const payIdx = order.indexOf("invoices.pay");
  const cancelIdx = order.findIndex((m, i) => m === "subscriptions.update" && (stripe.calls[i].a as { p?: { cancel_at_period_end?: unknown } }).p?.cancel_at_period_end === true);
  assert(payIdx > 0 && payIdx < cancelIdx, "the failed invoice is paid before scheduling cancellation");
  for (let i = 0; i < order.length; i++) if (order[i] === "testClocks.advance") assertEquals(order[i + 1], "testClocks.retrieve", "every advance is followed by a clock-ready poll");
  assert(order.includes("testClocks.del"), "the run-owned clock is deleted");
});

Deno.test("preflight uses Balance.livemode and fails closed on any live/misaligned signal", () => {
  assertStripeTestMode({ secretKey: "sk_test_x", livemode: false, price: TEST_PRICE }); // ok
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ secretKey: "sk_live_x", livemode: false, price: TEST_PRICE }, "LIVE Stripe secret key"],
    [{ secretKey: "rk_x", livemode: false, price: TEST_PRICE }, "TEST secret key"],
    [{ secretKey: "sk_test_x", livemode: undefined, price: TEST_PRICE }, "did not prove livemode=false"], // Account has no livemode → undefined
    [{ secretKey: "sk_test_x", livemode: true, price: TEST_PRICE }, "did not prove livemode=false"],
    [{ secretKey: "sk_test_x", livemode: false, price: { ...TEST_PRICE, livemode: true } }, "LIVE object"],
    [{ secretKey: "sk_test_x", livemode: false, price: { ...TEST_PRICE, unit_amount: 500 } }, "$10 amount"],
  ];
  for (const [cfg, msg] of bad) {
    try { assertStripeTestMode(cfg as never); throw new Error("expected throw"); }
    catch (e) { assertStringIncludes((e as Error).message, msg); }
  }
});

Deno.test("a live key aborts before ANY object is created (via the real Balance livemode)", async () => {
  const stripe = fakeStripe({ livemode: true });
  await assertRejects(() => runBillingQualification(baseDeps(stripe)), Error, "did not prove livemode=false");
  assert(!stripe.calls.some((c) => ["testClocks.create", "customers.create", "subscriptions.create"].includes(c.m)), "no object created on a live-mode mismatch");
});

Deno.test("a non-2xx handler response rejects the phase; cleanup still deletes the clock", async () => {
  const stripe = fakeStripe({ badCustomer: true }); // hydrated identity incomplete → handler non-2xx on checkout
  await assertRejects(() => runBillingQualification(baseDeps(stripe)), Error, "handler returned HTTP");
  assert(stripe.calls.some((c) => c.m === "testClocks.del"), "the clock is deleted even on a mid-lifecycle failure");
});

Deno.test("when the lifecycle AND cleanup both fail, BOTH are preserved (AggregateError)", async () => {
  const stripe = fakeStripe({ badCustomer: true, failCleanup: true });
  const err = await runBillingQualification(baseDeps(stripe)).then(() => null, (e) => e);
  assert(err instanceof AggregateError, "an AggregateError preserves both failures");
  const msgs = (err as AggregateError).errors.map((e) => (e as Error).message).join("\n");
  assertStringIncludes(msgs, "handler returned HTTP");     // the original lifecycle failure
  assertStringIncludes(msgs, "cleanup failed");            // the leaked-fixture evidence
});
