// #1294 — EXECUTED integration proof (Deno): the REAL stripe-webhook handler + an ephemeral migrated PGlite
// database + a RECORDING fake Stripe. Proves the full test-clock lifecycle drives correct DB entitlement, and
// asserts the exact Stripe request shapes + ordering the runner issues. No live Stripe, no production Supabase.
import { assert, assertEquals, assertRejects, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "../../backend/supabase/functions/stripe-webhook/index.ts";
import { runBillingQualification, assertStripeTestMode, REQUIRED_PHASES } from "./runner.ts";

const PRICE = "price_test_pro";
const TEST_PRICE = { id: PRICE, livemode: false, active: true, recurring: { interval: "month", interval_count: 1 }, unit_amount: 1000, currency: "usd" };
const sub = (status: string, extra: Record<string, unknown> = {}) => ({
  id: "sub_1", status, customer: "cus_1", cancel_at_period_end: false, current_period_end: 4_000_000_000,
  items: { data: [{ price: TEST_PRICE }] }, ...extra,
});

// A recording fake Stripe. `retrieveStatuses` is the scripted sequence of hydrated subscription states the
// handler will see, one per subscriptions.retrieve (== one per lifecycle phase).
function fakeStripe(opts: { livemode?: boolean; retrieveStatuses?: Array<() => unknown> } = {}) {
  const calls: Array<{ m: string; a?: unknown }> = [];
  const rec = (m: string, a?: unknown) => { calls.push({ m, a }); };
  const statuses = [...(opts.retrieveStatuses ?? [])];
  const deletedClocks = new Set<string>();
  return {
    calls,
    accounts: { retrieve: (..._a: unknown[]) => { rec("accounts.retrieve"); return Promise.resolve({ livemode: opts.livemode ?? false }); } },
    prices: { retrieve: (id: string) => { rec("prices.retrieve", id); return Promise.resolve(TEST_PRICE); } },
    customers: {
      create: (p: unknown) => { rec("customers.create", p); return Promise.resolve({ id: "cus_1" }); },
      update: (id: string, p: unknown) => { rec("customers.update", { id, p }); return Promise.resolve({ id }); },
    },
    paymentMethods: { attach: (pm: string, p: unknown) => { rec("paymentMethods.attach", { pm, p }); return Promise.resolve({ id: pm }); } },
    subscriptions: {
      create: (p: unknown) => { rec("subscriptions.create", p); return Promise.resolve(sub("active")); },
      update: (id: string, p: unknown) => { rec("subscriptions.update", { id, p }); return Promise.resolve(sub("active")); },
      retrieve: (id: string) => { rec("subscriptions.retrieve", id); const next = statuses.shift(); return Promise.resolve(next ? next() : sub("active")); },
    },
    testHelpers: {
      testClocks: {
        create: (p: unknown) => { rec("testClocks.create", p); return Promise.resolve({ id: "clock_1", status: "ready" }); },
        advance: (id: string, p: unknown) => { rec("testClocks.advance", { id, p }); return Promise.resolve({ id, status: "advancing" }); },
        // Real Stripe throws resource_missing once a clock is deleted — simulate that so cleanup verification is real.
        retrieve: (id: string) => { rec("testClocks.retrieve", id); if (deletedClocks.has(id)) return Promise.reject(Object.assign(new Error("No such test clock"), { code: "resource_missing" })); return Promise.resolve({ id, status: "ready" }); },
        del: (id: string) => { rec("testClocks.del", id); deletedClocks.add(id); return Promise.resolve({ id, deleted: true }); },
      },
    },
    webhooks: { constructEventAsync: (body: string) => JSON.parse(body) },
  };
}

const baseDeps = (stripe: ReturnType<typeof fakeStripe>) => ({
  stripe, handler, secretKey: "sk_test_x", webhookSecret: "whsec_test", priceId: PRICE,
  frozenTime: 1_700_000_000, clockTimeoutMs: 5_000, log: () => {},
});

Deno.test("full lifecycle: real handler + migrated PGlite proves every phase's entitlement", async () => {
  const stripe = fakeStripe({
    retrieveStatuses: [
      () => sub("active"),                                                  // checkout → pro
      () => sub("active"),                                                  // renewal → pro
      () => sub("past_due"),                                                // payment_failure → free
      () => sub("active", { cancel_at_period_end: true, current_period_end: 4_100_000_000 }), // continuation → pro
      () => sub("canceled"),                                                // cancellation → free
    ],
  });
  const out = await runBillingQualification(baseDeps(stripe));
  assertEquals(out.result, "PASSED");
  assertEquals(out.phases, REQUIRED_PHASES);

  // Request SHAPE: the subscription is created with a proper nested items array (the old encoder bug produced
  // items=[object Object] and could never create the subscription).
  const create = stripe.calls.find((c) => c.m === "subscriptions.create")!;
  assertEquals((create.a as { items: unknown[] }).items, [{ price: PRICE }]);

  // Request ORDERING: preflight before any object; clock created before the customer/subscription; each
  // advance is followed by a clock poll; cleanup deletes the clock last.
  const order = stripe.calls.map((c) => c.m);
  assert(order.indexOf("accounts.retrieve") < order.indexOf("testClocks.create"), "preflight precedes creation");
  assert(order.indexOf("testClocks.create") < order.indexOf("customers.create"), "clock precedes customer");
  assert(order.indexOf("customers.create") < order.indexOf("subscriptions.create"), "customer precedes subscription");
  for (let i = 0; i < order.length; i++) {
    if (order[i] === "testClocks.advance") assertEquals(order[i + 1], "testClocks.retrieve", "every advance is followed by a clock-ready poll");
  }
  assertEquals(order[order.length - 1], "testClocks.retrieve", "cleanup verifies the clock is gone last"); // del → assertClockDeleted(retrieve)
  assert(order.includes("testClocks.del"), "the run-owned clock is deleted");
});

Deno.test("fails closed at preflight on a live key / live Price / unproven livemode (no object created)", () => {
  assertStripeTestMode({ secretKey: "sk_test_x", accountLivemode: false, price: TEST_PRICE }); // ok
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ secretKey: "sk_live_x", accountLivemode: false, price: TEST_PRICE }, "LIVE Stripe secret key"],
    [{ secretKey: "rk_x", accountLivemode: false, price: TEST_PRICE }, "TEST secret key"],
    [{ secretKey: "sk_test_x", accountLivemode: true, price: TEST_PRICE }, "did not prove livemode=false"],
    [{ secretKey: "sk_test_x", accountLivemode: false, price: { ...TEST_PRICE, livemode: true } }, "LIVE object"],
    [{ secretKey: "sk_test_x", accountLivemode: false, price: { ...TEST_PRICE, unit_amount: 500 } }, "$10 amount"],
  ];
  for (const [cfg, msg] of bad) {
    try { assertStripeTestMode(cfg as never); throw new Error("expected throw"); }
    catch (e) { assertStringIncludes((e as Error).message, msg); }
  }
});

Deno.test("a live key aborts the run before ANY Stripe object is created", async () => {
  const stripe = fakeStripe();
  await assertRejects(
    () => runBillingQualification({ ...baseDeps(stripe), secretKey: "sk_live_x" }),
    Error, "LIVE Stripe secret key",
  );
  // Only the two preflight reads happened; nothing was created.
  assert(!stripe.calls.some((c) => ["testClocks.create", "customers.create", "subscriptions.create"].includes(c.m)),
    "no Stripe object was created after a live-key refusal");
});

Deno.test("a non-2xx handler response rejects the phase at the boundary, and cleanup still deletes the clock", async () => {
  const stripe = fakeStripe({ retrieveStatuses: [() => sub("active", { customer: null })] }); // incomplete identity → handler non-2xx
  await assertRejects(() => runBillingQualification(baseDeps(stripe)), Error, "handler returned HTTP");
  assert(stripe.calls.some((c) => c.m === "testClocks.del"), "the clock is deleted even on a mid-lifecycle failure");
});

Deno.test("cleanup failure fails the run when the lifecycle otherwise succeeded", async () => {
  const stripe = fakeStripe({
    retrieveStatuses: [() => sub("active"), () => sub("active"), () => sub("past_due"),
      () => sub("active", { cancel_at_period_end: true, current_period_end: 4_100_000_000 }), () => sub("canceled")],
  });
  // The clock deletion "succeeds" but the fixture is still present on the verification read → cleanup fails closed.
  stripe.testHelpers.testClocks.del = (id: string) => { stripe.calls.push({ m: "testClocks.del", a: id }); return Promise.resolve({ id, deleted: false }); };
  stripe.testHelpers.testClocks.retrieve = (id: string) => { stripe.calls.push({ m: "testClocks.retrieve", a: id }); return Promise.resolve({ id, status: "ready", deleted: false }); };
  await assertRejects(() => runBillingQualification(baseDeps(stripe)), Error, "cleanup failed");
});
