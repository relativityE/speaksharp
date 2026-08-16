// #1294 — WEEKLY, automated, NO-live-charge Stripe billing lifecycle qualification.
//
// It fails closed BEFORE creating anything unless Stripe proves livemode=false with an sk_test_ key and a
// test-mode Price. It then drives the PRODUCT'S REAL ENTRY PATH on a Stripe TEST CLOCK with test payment
// methods: a 30-DAY FREE TRIAL (fully entitled, no charge) → the trial expiring into the FIRST $10 invoice
// (the "first month free → first monthly payment" transition) → monthly renewal → payment failure →
// recovery → scheduled cancellation with continued access → terminal revocation. Each event is fed to the
// REAL stripe-webhook handler, backed by an ephemeral migrated PGlite database (no production Supabase, no
// mocks). Entitlement is read from the DB via effective_subscription_tier after each phase, and the trial /
// conversion / renewal charges are verified against the real Stripe invoices (amount_paid). Run-owned Stripe
// fixtures are torn down in `finally`, with deletion errors inspected and verified. The `stripe` client is
// injected so the same runner is driven by a fake in tests (asserting exact request shapes + ordering) and by
// the real SDK on the weekly schedule.
import { createHmac } from "node:crypto";
import { migratedDb, effectiveTier } from "./pglite_supabase.ts";

export const REQUIRED_PHASES = Object.freeze([
  "trial_start", "trial_active", "conversion", "renewal", "payment_failure", "continuation", "cancellation",
] as const);
export type Phase = (typeof REQUIRED_PHASES)[number];

const PRO_UNIT_AMOUNT = 1000;
const DAY = 24 * 60 * 60;
const TRIAL_DAYS = 30; // the promised 30-day free trial before the first $10 charge

// The dynamic Stripe objects are read structurally at each use site (no `any`, no lint suppressions).
type StripeObj = Record<string, unknown>;
/** The minimal Stripe surface the runner + the real webhook handler touch; the real SDK satisfies it. */
export interface StripeLike {
  balance: { retrieve(): Promise<unknown> };
  prices: { retrieve(id: string): Promise<unknown> };
  customers: { create(p: StripeObj): Promise<unknown>; update(id: string, p: StripeObj): Promise<unknown> };
  paymentMethods: { attach(pm: string, p: StripeObj): Promise<unknown> };
  invoices: { pay(id: string, p: StripeObj): Promise<unknown>; retrieve(id: string): Promise<unknown> };
  subscriptions: { create(p: StripeObj): Promise<unknown>; update(id: string, p: StripeObj): Promise<unknown>; retrieve(id: string): Promise<unknown> };
  testHelpers: { testClocks: { create(p: StripeObj): Promise<unknown>; advance(id: string, p: StripeObj): Promise<unknown>; retrieve(id: string): Promise<unknown>; del(id: string): Promise<unknown> } };
  webhooks: { constructEventAsync(...a: unknown[]): unknown };
}
export interface SupabaseLike { rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> }
export type HandlerFn = (
  req: Request,
  stripe: StripeLike,
  supabase: SupabaseLike,
  webhookSecret: string,
  getEnv: (k: string) => string | undefined,
) => Promise<Response>;
const asObj = (v: unknown): StripeObj => (v ?? {}) as StripeObj;

export interface RunnerDeps {
  stripe: StripeLike;
  handler: HandlerFn;
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  frozenTime: number; // the test CLOCK's simulated unix seconds (drives frozen_time + event.created), NOT signing time
  okPaymentMethod?: string;
  failPaymentMethod?: string;
  log?: (m: string) => void;
  clockTimeoutMs?: number;
  makeDb?: typeof migratedDb;
  // REAL wall-clock seconds used to stamp each webhook SIGNATURE. Stripe's verifier rejects a signature whose
  // timestamp is outside its tolerance (~5 min) of now, so this MUST be the current time at each POST — never the
  // test clock's frozen time. Injectable only so a test can force a stale stamp and prove the verifier rejects it.
  signingNowSeconds?: () => number;
}

/** Fail closed unless Stripe is PROVABLY in test mode before any object is created. Throws on any live signal.
 *  `livemode` MUST come from an object that actually carries it (e.g. Balance) — the v1 Account object does not. */
export function assertStripeTestMode(
  { secretKey, livemode, price }: { secretKey: string; livemode: unknown; price: unknown },
): void {
  if (/^sk_live_/.test(secretKey ?? "")) throw new Error("billing qualification refused: a LIVE Stripe secret key was supplied");
  if (!/^sk_test_/.test(secretKey ?? "")) throw new Error("billing qualification refused: a Stripe TEST secret key (sk_test_…) is required");
  if (livemode !== false) throw new Error("billing qualification refused: Stripe did not prove livemode=false");
  if (!price || typeof price !== "object") throw new Error("billing qualification refused: the Stripe Price could not be read");
  const p = price as { livemode?: unknown; active?: unknown; unit_amount?: unknown; recurring?: { interval?: unknown; interval_count?: unknown } };
  if (p.livemode !== false) throw new Error("billing qualification refused: the configured Price is a LIVE object");
  if (p.active !== true) throw new Error("billing qualification refused: the configured Price is not active");
  if (p.recurring?.interval !== "month" || p.recurring?.interval_count !== 1) {
    throw new Error("billing qualification refused: the Price is not a $/month recurring plan");
  }
  if (p.unit_amount !== PRO_UNIT_AMOUNT) throw new Error("billing qualification refused: the Price is not the configured $10 amount");
}

export function assertAllPhasesProven(evidence: Partial<Record<Phase, boolean>>): void {
  const missing = REQUIRED_PHASES.filter((p) => evidence[p] !== true);
  if (missing.length) throw new Error(`billing qualification incomplete: unproven lifecycle phase(s): ${missing.join(", ")}`);
}

/** A valid Stripe signature header for a synthetic event body, so the REAL handler's verifier accepts it. */
function signature(body: string, secret: string, ts: number): string {
  const v1 = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return `t=${ts},v1=${v1}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Advancing a test clock is ASYNC — block until it reaches `ready`; fail closed on internal_failure/timeout. */
async function pollClockReady(stripe: StripeLike, clockId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = asObj(await stripe.testHelpers.testClocks.retrieve(clockId)).status;
    if (status === "ready") return;
    if (status === "internal_failure") throw new Error("billing qualification failed: test clock reported internal_failure");
    if (Date.now() > deadline) throw new Error(`billing qualification failed: test clock did not reach ready within ${timeoutMs}ms`);
    await sleep(500);
  }
}

/** Poll the hydrated subscription STATE until it reaches an expected status; fail closed on timeout. */
async function pollSubscriptionStatus(stripe: StripeLike, subId: string, want: string, timeoutMs: number): Promise<StripeObj> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const sub = asObj(await stripe.subscriptions.retrieve(subId));
    if (String(sub.status) === want) return sub;
    if (Date.now() > deadline) throw new Error(`billing qualification failed: subscription did not reach '${want}' within ${timeoutMs}ms (got '${String(sub.status)}')`);
    await sleep(500);
  }
}

/** Advance the test clock to an absolute frozen time, then block until it settles ready. */
async function advanceClock(stripe: StripeLike, clockId: string, toSeconds: number, timeoutMs: number): Promise<void> {
  await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: toSeconds });
  await pollClockReady(stripe, clockId, timeoutMs);
}

/** Assert the subscription is currently in the expected Stripe status (read fresh from Stripe). */
async function assertSubStatus(stripe: StripeLike, subId: string, want: string, phase: string): Promise<void> {
  const status = String(asObj(await stripe.subscriptions.retrieve(subId)).status);
  if (status !== want) throw new Error(`billing qualification failed: expected subscription status '${want}' at ${phase}, got '${status}'`);
}

/** During the free trial NOTHING may be charged: the latest invoice must show amount_paid = 0. */
async function assertNoChargeYet(stripe: StripeLike, subId: string, phase: string): Promise<void> {
  const ref = asObj(await stripe.subscriptions.retrieve(subId)).latest_invoice;
  if (ref === null || ref === undefined) return; // no invoice at all is also "nothing charged"
  const invoice = typeof ref === "string" ? asObj(await stripe.invoices.retrieve(ref)) : asObj(ref);
  const paid = Number(invoice.amount_paid ?? 0);
  if (paid !== 0) throw new Error(`billing qualification failed: expected NO charge during the free trial at ${phase}, but an invoice already paid ${paid}`);
}

/** Prove a real invoice for the expected amount was PAID (the conversion/renewal charge actually settled). */
async function assertInvoicePaid(stripe: StripeLike, invoiceRef: unknown, expectedAmount: number, phase: string): Promise<void> {
  const id = typeof invoiceRef === "string" ? invoiceRef : String(asObj(invoiceRef).id ?? "");
  if (!id) throw new Error(`billing qualification failed: no invoice to verify at ${phase}`);
  // Always read the invoice fresh from Stripe by id — the expanded reference on the subscription may be stale.
  const invoice = asObj(await stripe.invoices.retrieve(id));
  const paid = Number(invoice.amount_paid ?? 0);
  const status = String(invoice.status ?? "");
  if (paid !== expectedAmount) throw new Error(`billing qualification failed: expected a paid $${expectedAmount / 100} invoice at ${phase}, got amount_paid=${paid}`);
  if (status !== "paid") throw new Error(`billing qualification failed: expected invoice status 'paid' at ${phase}, got '${status}'`);
}

/** Post a signed synthetic event to the REAL handler; reject the phase at the response boundary on non-2xx. */
async function applyEvent(
  deps: RunnerDeps, supabase: SupabaseLike, event: Record<string, unknown>, phase: string,
): Promise<void> {
  const body = JSON.stringify(event);
  // Sign with a FRESH real-wall-clock timestamp at POST time — Stripe's verifier rejects anything outside its
  // ~5-min tolerance, and the test clock's frozen_time (spanning +32/64/96 days) would always be rejected.
  const ts = (deps.signingNowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
  const req = new Request("https://webhook.local/stripe-webhook", {
    method: "POST",
    headers: { "Stripe-Signature": signature(body, deps.webhookSecret, ts), "Content-Type": "application/json" },
    body,
  });
  const res = await deps.handler(req, deps.stripe, supabase, deps.webhookSecret, (k) => {
    if (k === "STRIPE_PRO_PRICE_ID") return deps.priceId;
    if (k === "STRIPE_PRICE_CURRENCY") return "usd";
    return undefined;
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`billing qualification failed: handler returned HTTP ${res.status} for the ${phase} phase`);
  }
}

/** Verify a run-owned test clock (and its cascaded objects) is gone; a lingering fixture fails the run. */
async function assertClockDeleted(stripe: StripeLike, clockId: string): Promise<void> {
  try {
    const clock = asObj(await stripe.testHelpers.testClocks.retrieve(clockId));
    if (clock.deleted !== true) throw new Error(`billing qualification cleanup failed: test clock ${clockId} still exists`);
  } catch (err) {
    // A "resource missing" error is the desired proof of deletion; anything else is a real cleanup failure.
    const e = err as { code?: unknown; rawType?: unknown };
    if (e.code !== "resource_missing" && e.rawType !== "resource_missing") throw err;
  }
}

export async function runBillingQualification(deps: RunnerDeps): Promise<{ result: "PASSED"; phases: readonly string[] }> {
  const log = deps.log ?? (() => {});
  const okPm = deps.okPaymentMethod ?? "pm_card_visa";
  const failPm = deps.failPaymentMethod ?? "pm_card_chargeCustomerFail";
  const clockTimeout = deps.clockTimeoutMs ?? 120_000;
  const makeDb = deps.makeDb ?? migratedDb;

  // ── Preflight: PROVE test mode before creating anything. Balance carries livemode (Account does not). ──
  const balance = await deps.stripe.balance.retrieve();
  const price = await deps.stripe.prices.retrieve(deps.priceId);
  assertStripeTestMode({ secretKey: deps.secretKey, livemode: asObj(balance).livemode, price });
  log("preflight OK — Stripe proved livemode=false; no live object can be created");

  const userId = "00000000-0000-0000-0000-00000000b111";
  const { db, supabase } = await makeDb(userId);
  const evidence: Partial<Record<Phase, boolean>> = {};
  let clockId: string | null = null;
  let originalError: unknown = null;
  let result: { result: "PASSED"; phases: readonly string[] } | null = null;

  try {
    const cid = String(asObj(await deps.stripe.testHelpers.testClocks.create({ frozen_time: deps.frozenTime })).id);
    clockId = cid;
    const customerId = String(asObj(await deps.stripe.customers.create({ test_clock: cid, description: "canary weekly billing qualification (test-mode)" })).id);
    await deps.stripe.paymentMethods.attach(okPm, { customer: customerId });
    await deps.stripe.customers.update(customerId, { invoice_settings: { default_payment_method: okPm } });
    // The product entry path is a 30-DAY FREE TRIAL, not an immediate charge: create the subscription WITH a
    // trial so the first real $10 invoice is only issued when the trial expires.
    const subId = String(asObj(await deps.stripe.subscriptions.create({
      customer: customerId, items: [{ price: deps.priceId }], trial_period_days: TRIAL_DAYS,
      expand: ["latest_invoice.payment_intent"],
    })).id);

    const tierNow = () => effectiveTier(db, userId);
    const require = async (want: string, phase: string) => {
      const t = await tierNow();
      if (t !== want) throw new Error(`billing qualification failed: expected effective tier '${want}' after ${phase}, got '${t}'`);
    };

    // trial_start: bind the fresh profile to the TRIALING subscription — the 30-day free trial grants full Pro
    // access with NO charge yet.
    await applyEvent(deps, supabase, {
      id: "evt_trial_start", type: "checkout.session.completed", created: deps.frozenTime,
      data: { object: { metadata: { userId }, client_reference_id: userId, subscription: subId, customer: customerId } },
    }, "trial_start");
    await require("pro", "trial_start");
    await assertSubStatus(deps.stripe, subId, "trialing", "trial_start");
    await assertNoChargeYet(deps.stripe, subId, "trial_start");
    evidence.trial_start = true;
    log("trial_start: 30-day free trial bound to Pro; no invoice charged");

    // trial_active: advance to MID-trial (day 15) — access must persist and STILL nothing is charged.
    await advanceClock(deps.stripe, cid, deps.frozenTime + 15 * DAY, clockTimeout);
    await assertSubStatus(deps.stripe, subId, "trialing", "trial_active");
    await applyEvent(deps, supabase, { id: "evt_trial_mid", type: "customer.subscription.updated", created: deps.frozenTime + 15 * DAY, data: { object: { id: subId } } }, "trial_active");
    await require("pro", "trial_active");
    await assertNoChargeYet(deps.stripe, subId, "trial_active");
    evidence.trial_active = true;
    log("trial_active: mid-trial still Pro; still no charge");

    // conversion: advance PAST trial_end (day 31) — Stripe issues the FIRST $10 invoice, paid by the default
    // card, and the subscription becomes active. This is the "first month free → first monthly payment" step.
    await advanceClock(deps.stripe, cid, deps.frozenTime + (TRIAL_DAYS + 1) * DAY, clockTimeout);
    const converted = await pollSubscriptionStatus(deps.stripe, subId, "active", clockTimeout);
    await assertInvoicePaid(deps.stripe, converted.latest_invoice, PRO_UNIT_AMOUNT, "conversion");
    await applyEvent(deps, supabase, { id: "evt_convert", type: "customer.subscription.updated", created: deps.frozenTime + (TRIAL_DAYS + 1) * DAY, data: { object: { id: subId } } }, "conversion");
    await require("pro", "conversion");
    evidence.conversion = true;
    log("conversion: trial expired → first $10 invoice paid → active; Pro continuous across the transition");

    // renewal: advance one more month → the second $10 invoice settles → Pro continues.
    await advanceClock(deps.stripe, cid, deps.frozenTime + (TRIAL_DAYS + 32) * DAY, clockTimeout);
    const renewed = await pollSubscriptionStatus(deps.stripe, subId, "active", clockTimeout);
    await assertInvoicePaid(deps.stripe, renewed.latest_invoice, PRO_UNIT_AMOUNT, "renewal");
    await applyEvent(deps, supabase, { id: "evt_renew", type: "customer.subscription.updated", created: deps.frozenTime + (TRIAL_DAYS + 32) * DAY, data: { object: { id: subId } } }, "renewal");
    await require("pro", "renewal");
    evidence.renewal = true;
    log("renewal: second $10 invoice settled; Pro continues");

    // payment_failure: failing card → advance → the next renewal invoice fails → past_due → Free (recoverable).
    await deps.stripe.paymentMethods.attach(failPm, { customer: customerId });
    await deps.stripe.customers.update(customerId, { invoice_settings: { default_payment_method: failPm } });
    await advanceClock(deps.stripe, cid, deps.frozenTime + (TRIAL_DAYS + 64) * DAY, clockTimeout);
    const pastDue = await pollSubscriptionStatus(deps.stripe, subId, "past_due", clockTimeout);
    await applyEvent(deps, supabase, { id: "evt_fail", type: "customer.subscription.updated", created: deps.frozenTime + (TRIAL_DAYS + 64) * DAY, data: { object: { id: subId } } }, "payment_failure");
    await require("free", "payment_failure");
    evidence.payment_failure = true;
    log("payment_failure: renewal invoice failed → past_due → access revoked (recoverable)");

    // continuation: RECOVER by actually paying the failed open invoice (changing the default alone never settles
    // it), then schedule cancel_at_period_end on the ACTIVE subscription — access must PERSIST through the period.
    const latestInvoice = pastDue.latest_invoice;
    const failedInvoice = typeof latestInvoice === "string" ? latestInvoice : String(asObj(latestInvoice).id ?? "");
    if (!failedInvoice) throw new Error("billing qualification failed: no failed invoice to recover in the payment_failure phase");
    await deps.stripe.paymentMethods.attach(okPm, { customer: customerId });
    await deps.stripe.customers.update(customerId, { invoice_settings: { default_payment_method: okPm } });
    await deps.stripe.invoices.pay(failedInvoice, { payment_method: okPm });
    await pollSubscriptionStatus(deps.stripe, subId, "active", clockTimeout);
    await deps.stripe.subscriptions.update(subId, { cancel_at_period_end: true });
    await applyEvent(deps, supabase, { id: "evt_scheduled", type: "customer.subscription.updated", created: deps.frozenTime + (TRIAL_DAYS + 65) * DAY, data: { object: { id: subId } } }, "continuation");
    await require("pro", "continuation");
    evidence.continuation = true;
    log("continuation: recovered the failed invoice, then scheduled cancellation keeps Pro through the paid period");

    // cancellation: advance to period end → terminal canceled → revocation.
    await advanceClock(deps.stripe, cid, deps.frozenTime + (TRIAL_DAYS + 96) * DAY, clockTimeout);
    await applyEvent(deps, supabase, { id: "evt_cancel", type: "customer.subscription.deleted", created: deps.frozenTime + (TRIAL_DAYS + 96) * DAY, data: { object: { id: subId } } }, "cancellation");
    await require("free", "cancellation");
    evidence.cancellation = true;
    log("cancellation: terminal cancellation revoked access");

    assertAllPhasesProven(evidence);
    result = { result: "PASSED", phases: REQUIRED_PHASES };
  } catch (err) {
    originalError = err;
  }

  // Cleanup is PROVEN, not best-effort: delete the run-owned clock (cascades customer/subscription), inspect the
  // result, and verify it is gone. It runs on BOTH the success and failure paths — deliberately NOT in a
  // `finally`, so no control-flow statement lives in a finally block and both failures can be surfaced together.
  const failures: string[] = [];
  if (clockId) {
    try {
      await deps.stripe.testHelpers.testClocks.del(clockId);
      await assertClockDeleted(deps.stripe, clockId);
    } catch (cleanupErr) {
      failures.push(`test clock ${clockId}: ${(cleanupErr as Error).message}`);
    }
  }
  try { await db.close(); } catch { /* pglite close is best-effort; it owns no external fixture */ }

  if (failures.length) {
    const cleanupErr = new Error(`billing qualification cleanup failed (fixtures may leak): ${failures.join("; ")}`);
    // Preserve BOTH failures: if the lifecycle also threw, surface an aggregate so neither is hidden.
    if (originalError) throw new AggregateError([originalError, cleanupErr], `${(originalError as Error).message} | ${cleanupErr.message}`);
    throw cleanupErr;
  }
  if (originalError) throw originalError;
  return result ?? { result: "PASSED", phases: REQUIRED_PHASES };
}
