// #1302 — EXECUTED integration proof (Deno): the REAL stripe-webhook handler + an ephemeral migrated PGlite
// database + a faithful, RECORDING fake Stripe. Proves the PRODUCT'S REAL ENTRY PATH — a 30-day free trial
// (fully entitled, no charge) converting into the FIRST $10 invoice at expiration, then renewal, payment
// failure, recovery, scheduled cancellation with continued access, and terminal revocation — drives correct
// DB entitlement, and asserts the exact Stripe request shapes + ordering. No live Stripe, no production
// Supabase. The fake mirrors the real SDK: livemode comes from Balance (not Account); the subscription
// becomes active from a trial ONLY when the clock passes trial_end (issuing a real $10 invoice), and returns
// to active after a failure ONLY once the failed invoice is genuinely paid — nothing is scripted to "active".
import { assert, assertEquals, assertRejects, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import Stripe from "npm:stripe@16";
import { handler } from "../../backend/supabase/functions/stripe-webhook/index.ts";
import { runBillingQualification, assertStripeTestMode, REQUIRED_PHASES } from "./runner.ts";

// The REAL Stripe SDK signature verifier (pure crypto, no network). The fake Stripe delegates webhook
// verification to this, so every event's signature scheme AND ~5-min timestamp tolerance are genuinely
// enforced — a stale or forged signature is rejected exactly as Stripe would reject it in production.
const REAL_VERIFIER = new Stripe("sk_test_verifieronly", { apiVersion: "2024-06-20" as Stripe.LatestApiVersion });

const PRICE = "price_test_pro";
const OK_PM = "pm_card_visa";
const FAIL_PM = "pm_card_chargeCustomerFail";
const AMT = 1000; // the $10 monthly charge, in cents
const DAY = 24 * 60 * 60;
const TEST_PRICE = { id: PRICE, livemode: false, active: true, recurring: { interval: "month", interval_count: 1 }, unit_amount: AMT, currency: "usd" };

// A faithful fake Stripe driven as a state machine. Status + invoices change ONLY via real operations:
// create-with-trial → trialing (+ a $0 trial invoice); advancing the clock PAST trial_end → active (+ the
// first $10 invoice); advancing again while active → a renewal $10 invoice; failing card + advance → past_due
// (+ an open, unpaid invoice); invoices.pay → active; scheduled cancel + advance → canceled. `earlyCharge`
// and `conversionAmount` inject faults to prove the trial/amount assertions are load-bearing.
function fakeStripe(opts: { livemode?: boolean; failCleanup?: boolean; badCustomer?: boolean; earlyCharge?: boolean; conversionAmount?: number } = {}) {
  const calls: Array<{ m: string; a?: unknown }> = [];
  const rec = (m: string, a?: unknown) => { calls.push({ m, a }); };
  const deleted = new Set<string>();
  const invoices = new Map<string, { id: string; amount_paid: number; status: string }>();
  let invSeq = 0;
  let latestInvoiceId = "";
  const addInvoice = (amount_paid: number, status: string) => {
    const id = `in_${++invSeq}`;
    invoices.set(id, { id, amount_paid, status });
    latestInvoiceId = id;
    return id;
  };
  let status = "trialing";
  let clockFrozen = 0;
  let trialEnd = Number.POSITIVE_INFINITY;
  let cancelAPE = false;
  let pendingFailure = false;
  const subObj = () => ({
    id: "sub_1", status, customer: opts.badCustomer ? null : "cus_1", cancel_at_period_end: cancelAPE,
    current_period_end: 4_100_000_000, latest_invoice: latestInvoiceId, items: { data: [{ price: TEST_PRICE }] },
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
    invoices: {
      pay: (id: string, p: unknown) => { rec("invoices.pay", { id, p }); const inv = invoices.get(id); if (inv) { inv.amount_paid = AMT; inv.status = "paid"; } status = "active"; return Promise.resolve({ id, status: "paid" }); },
      retrieve: (id: string) => { rec("invoices.retrieve", id); return Promise.resolve(invoices.get(id) ?? { id, amount_paid: 0, status: "open" }); },
    },
    subscriptions: {
      create: (p: unknown) => {
        rec("subscriptions.create", p);
        const days = Number((p as { trial_period_days?: unknown }).trial_period_days ?? 0);
        status = "trialing";
        trialEnd = clockFrozen + days * DAY;
        // A trialing subscription issues a $0 invoice — no real charge. `earlyCharge` wrongly bills it now.
        addInvoice(opts.earlyCharge ? AMT : 0, "paid");
        return Promise.resolve(subObj());
      },
      update: (id: string, p: Record<string, unknown>) => { rec("subscriptions.update", { id, p }); if (p.cancel_at_period_end === true) cancelAPE = true; return Promise.resolve(subObj()); },
      retrieve: (id: string) => { rec("subscriptions.retrieve", id); return Promise.resolve(subObj()); },
    },
    testHelpers: {
      testClocks: {
        create: (p: unknown) => { rec("testClocks.create", p); clockFrozen = Number((p as { frozen_time?: unknown }).frozen_time ?? 0); return Promise.resolve({ id: "clock_1", status: "ready" }); },
        advance: (id: string, p: unknown) => {
          rec("testClocks.advance", { id, p });
          const to = Number((p as { frozen_time?: unknown }).frozen_time ?? 0);
          if (status === "trialing") {
            // Only crossing trial_end converts the trial into the first paid invoice; a mid-trial advance holds.
            if (to >= trialEnd) { status = "active"; addInvoice(opts.conversionAmount ?? AMT, "paid"); }
          } else if (pendingFailure) { status = "past_due"; addInvoice(0, "open"); pendingFailure = false; }
          else if (cancelAPE && status === "active") { status = "canceled"; }
          else if (status === "active") { addInvoice(AMT, "paid"); } // routine monthly renewal
          return Promise.resolve({ id, status: "advancing" });
        },
        retrieve: (id: string) => { rec("testClocks.retrieve", id); if (deleted.has(id)) return Promise.reject(Object.assign(new Error("No such test clock"), { code: "resource_missing" })); return Promise.resolve({ id, status: "ready", deleted: opts.failCleanup ? false : undefined }); },
        del: (id: string) => { rec("testClocks.del", id); if (!opts.failCleanup) deleted.add(id); return Promise.resolve({ id, deleted: !opts.failCleanup }); },
      },
    },
    // Delegate to the REAL Stripe verifier so the runner's signature (scheme + fresh timestamp) is truly proven.
    webhooks: { constructEventAsync: (body: string, sig: string, secret: string) => REAL_VERIFIER.webhooks.constructEventAsync(body, sig, secret) },
  };
}

const baseDeps = (stripe: ReturnType<typeof fakeStripe>) => ({
  stripe, handler, secretKey: "sk_test_x", webhookSecret: "whsec_test", priceId: PRICE,
  frozenTime: 1_700_000_000, clockTimeoutMs: 5_000, okPaymentMethod: OK_PM, failPaymentMethod: FAIL_PM, log: () => {},
});

Deno.test("full lifecycle proves every phase: trial → first $10 conversion → renewal → failure → recovery → cancel", async () => {
  const stripe = fakeStripe();
  const out = await runBillingQualification(baseDeps(stripe));
  assertEquals(out.result, "PASSED");
  assertEquals(out.phases, REQUIRED_PHASES);

  // SHAPE: the subscription is created WITH a 30-day trial and a real nested items array.
  const create = stripe.calls.find((c) => c.m === "subscriptions.create")!.a as { items: unknown[]; trial_period_days: number };
  assertEquals(create.items, [{ price: PRICE }]);
  assertEquals(create.trial_period_days, 30);

  // The conversion + renewal charges settle AUTOMATICALLY on the test clock — the ONLY manual invoices.pay is
  // the failure recovery, and it uses the GOOD card (not a scripted active state).
  const pays = stripe.calls.filter((c) => c.m === "invoices.pay");
  assertEquals(pays.length, 1, "the only manual pay is the failure recovery");
  assertEquals((pays[0].a as { p: { payment_method: string } }).p.payment_method, OK_PM);

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

Deno.test("the 30-day free trial is fully entitled with NO charge, then converts to the first $10 payment", async () => {
  const stripe = fakeStripe();
  const out = await runBillingQualification(baseDeps(stripe));
  assertEquals(out.result, "PASSED");
  // The phase set explicitly includes the trial→paid transition the earlier qualification never proved.
  assert(REQUIRED_PHASES.includes("trial_start"), "trial_start is a required phase");
  assert(REQUIRED_PHASES.includes("conversion"), "conversion is a required phase");
  // The subscription reaches active ONLY by the clock crossing trial_end — there is no manual pay to force it.
  const order = stripe.calls.map((c) => c.m);
  assert(order.indexOf("subscriptions.create") < order.indexOf("invoices.pay"), "conversion is automatic, not a forced pay");
});

Deno.test("a charge DURING the free trial fails the qualification (no early billing)", async () => {
  const stripe = fakeStripe({ earlyCharge: true });
  await assertRejects(() => runBillingQualification(baseDeps(stripe)), Error, "NO charge during the free trial");
});

Deno.test("a conversion invoice that is not exactly $10 fails the qualification", async () => {
  const stripe = fakeStripe({ conversionAmount: 500 });
  await assertRejects(() => runBillingQualification(baseDeps(stripe)), Error, "expected a paid $10 invoice");
});

Deno.test("each webhook is signed with a FRESH timestamp; a stale one is rejected by the real verifier", async () => {
  // Sanity: the default (fresh) path is accepted end-to-end by the REAL verifier — the full lifecycle passes.
  assertEquals((await runBillingQualification(baseDeps(fakeStripe()))).result, "PASSED");

  // Force every signature ~10 min in the past — beyond Stripe's ~5-min tolerance. The real verifier must reject
  // the FIRST event, so the run fails at trial_start and never advances into the subscription lifecycle. This is
  // exactly the production failure mode of reusing the job's original timestamp across a multi-day test clock.
  const stripe = fakeStripe();
  await assertRejects(
    () => runBillingQualification({ ...baseDeps(stripe), signingNowSeconds: () => Math.floor(Date.now() / 1000) - 600 }),
    Error,
    "handler returned HTTP",
  );
  assert(!stripe.calls.some((c) => c.m === "invoices.pay"), "a rejected signature must not advance to invoice recovery");
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
