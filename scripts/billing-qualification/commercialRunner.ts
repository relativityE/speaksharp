// #1302 — the COMMERCIAL lifecycle qualification, test mode only.
//
// #1301's weekly runner proves paid-subscription MECHANICS. This proves SpeakSharp's commercial shape,
// whose first three steps contain no Stripe object at all: a DB-backed 30-day trial, its expiry, and only
// then an immediately billable $10/month subscription with NO Stripe trial.
//
// It fails closed BEFORE creating anything unless Stripe proves livemode=false with an sk_test_ key and a
// test-mode Price, and every run-owned object — including the Test Clock — is deleted and VERIFIED gone.
import { createHmac } from "node:crypto";
import { migratedDb, effectiveTier, freshTrialProfile, expireTrialWindow } from "./pglite_supabase.ts";
import {
  assertDbTrialWithoutStripe, assertTrialExpired, assertCheckoutHasNoStripeTrial,
  assertFirstPaidInvoice, assertTestObjectsCleaned, assertAllCommercialPhasesProven,
  type CommercialPhase,
} from "./commercialLifecycle.ts";
import { assertStripeTestMode, type StripeLike, type HandlerFn, type SupabaseLike } from "./runner.ts";

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v ?? {}) as Obj;
const DAY = 24 * 60 * 60;

export interface CommercialDeps {
  stripe: StripeLike & { invoices: { pay(id: string, p: Obj): Promise<unknown>; retrieve(id: string, p?: Obj): Promise<unknown> } };
  handler: HandlerFn;
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  frozenTime: number;
  log?: (m: string) => void;
  clockTimeoutMs?: number;
}

const signature = (body: string, secret: string, ts: number): string =>
  `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;

/** Feed an event to the REAL webhook handler and return its HTTP status. */
async function deliver(
  deps: CommercialDeps, supabase: SupabaseLike, event: Obj, opts: { forgeSignature?: boolean } = {},
): Promise<number> {
  const body = JSON.stringify(event);
  const ts = Math.floor(Date.now() / 1000);
  const sig = opts.forgeSignature
    ? `t=${ts},v1=${"0".repeat(64)}`
    : signature(body, deps.webhookSecret, ts);
  const req = new Request("https://webhook.local/stripe-webhook", {
    method: "POST", body,
    headers: { "Stripe-Signature": sig, "Content-Type": "application/json" },
  });
  const res = await deps.handler(req, deps.stripe as unknown as StripeLike, supabase, deps.webhookSecret, (k) => {
    if (k === "STRIPE_PRICE_ID") return deps.priceId;
    if (k === "STRIPE_PRICE_CURRENCY") return "usd";
    return undefined;
  });
  return res.status;
}

async function pollClockReady(stripe: StripeLike, clockId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = asObj(await stripe.testHelpers.testClocks.retrieve(clockId)).status;
    if (status === "ready") return;
    if (status === "internal_failure") throw new Error("#1302: the Stripe test clock reported internal_failure");
    if (Date.now() > deadline) throw new Error("#1302: the Stripe test clock did not become ready in time");
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export interface CommercialEvidence {
  result: "PASSED";
  phases: readonly CommercialPhase[];
  /** SANITIZED — timestamps, ordering, amounts, statuses and readbacks. No keys, no PII, no object ids. */
  record: Obj;
}

export async function runCommercialQualification(deps: CommercialDeps): Promise<CommercialEvidence> {
  const log = deps.log ?? (() => {});
  const clockTimeout = deps.clockTimeoutMs ?? 120_000;
  const userId = "00000000-0000-0000-0000-0000000c1302";

  // ── Preflight: PROVE test mode before ANY object exists. ───────────────────
  const balance = await deps.stripe.balance.retrieve();
  const price = await deps.stripe.prices.retrieve(deps.priceId);
  assertStripeTestMode({ secretKey: deps.secretKey, livemode: asObj(balance).livemode, price });
  log("preflight OK — livemode=false proven before any object was created");

  const { db, supabase } = await migratedDb(userId);
  const evidence: Partial<Record<CommercialPhase, boolean>> = {};
  const created: string[] = [];
  const confirmedDeleted: string[] = [];
  const record: Obj = { startedAt: new Date().toISOString(), events: [] as Obj[], casualties: [] as Obj[] };
  const events = record.events as Obj[];
  const casualties = record.casualties as Obj[];
  let clockId: string | null = null;
  let originalError: unknown = null;
  let out: CommercialEvidence | null = null;

  try {
    // ── 1-3. DB trial, granted by the PRODUCTION path, with ZERO Stripe objects ──
    const profile = await freshTrialProfile(db, userId);
    const tierOnTrial = await effectiveTier(db, userId);
    assertDbTrialWithoutStripe({
      trialStartedAt: profile.trialStartedAt, trialEndsAt: profile.trialEndsAt,
      stripeCustomerId: profile.stripeCustomerId, stripeSubscriptionId: profile.stripeSubscriptionId,
      entitlement: "trial",
    });
    if (tierOnTrial !== "pro") {
      throw new Error(`#1302: a LIVE 30-day trial must grant full product access; effective tier was '${tierOnTrial}'`);
    }
    record.dbTrial = {
      windowDays: Math.round((Date.parse(profile.trialEndsAt!) - Date.parse(profile.trialStartedAt!)) / 86_400_000),
      effectiveTier: tierOnTrial, stripeCustomer: null, stripeSubscription: null,
    };
    evidence.db_trial_granted = true;
    evidence.db_trial_has_no_stripe_objects = true;
    log("db trial: 30 days granted by the production path, with no Stripe customer or subscription");

    // ── 4-5. Expiry — the SAME resolver decides, against a window in the past ──
    await expireTrialWindow(db, userId);
    const tierAfterExpiry = await effectiveTier(db, userId);
    assertTrialExpired({
      trialEndsAt: new Date(Date.now() - 86_400_000).toISOString(),
      now: new Date().toISOString(),
      entitlement: tierAfterExpiry === "pro" ? "pro" : "free",
    });
    record.trialExpiry = { effectiveTier: tierAfterExpiry };
    evidence.db_trial_expired = true;
    log(`trial expiry: entitlement dropped to '${tierAfterExpiry}'`);

    // ── 6-7. Checkout: immediately billable, NO Stripe trial ──────────────────
    const cid = String(asObj(await deps.stripe.testHelpers.testClocks.create({ frozen_time: deps.frozenTime })).id);
    clockId = cid; created.push(cid);
    const customerId = String(asObj(await deps.stripe.customers.create({
      test_clock: cid, description: "#1302 commercial lifecycle qualification (test-mode)",
    })).id);
    created.push(customerId);
    await deps.stripe.paymentMethods.attach("pm_card_visa", { customer: customerId });
    await deps.stripe.customers.update(customerId, { invoice_settings: { default_payment_method: "pm_card_visa" } });
    // NO trial_period_days — the DB trial was the only free period.
    const sub = asObj(await deps.stripe.subscriptions.create({
      customer: customerId, items: [{ price: deps.priceId }], expand: ["latest_invoice.payment_intent"],
    }));
    const subId = String(sub.id);
    created.push(subId);
    assertCheckoutHasNoStripeTrial(sub);
    evidence.checkout_without_stripe_trial = true;

    const latest = sub.latest_invoice;
    const invoiceId = typeof latest === "string" ? latest : String(asObj(latest).id ?? "");
    if (!invoiceId) throw new Error("#1302: the new subscription produced no first invoice");
    const invoice = asObj(await deps.stripe.invoices.retrieve(invoiceId));
    assertFirstPaidInvoice(invoice);
    record.firstInvoice = {
      amountPaid: invoice.amount_paid, currency: invoice.currency,
      status: invoice.status, billingReason: invoice.billing_reason,
    };
    evidence.first_paid_invoice = true;
    log(`checkout: immediately active, first invoice ${String(invoice.amount_paid)} ${String(invoice.currency)}`);

    // ── 8-9. The REAL signed webhook handler against the ephemeral migrated DB ──
    const send = async (id: string, type: string, created_at: number, object: Obj, note: string) => {
      const status = await deliver(deps, supabase, { id, type, created: created_at, data: { object } });
      const tier = await effectiveTier(db, userId);
      events.push({ id, type, created: created_at, httpStatus: status, effectiveTier: tier, note });
      return { status, tier };
    };

    const bind = await send("evt_1302_checkout", "checkout.session.completed", deps.frozenTime, {
      metadata: { userId }, client_reference_id: userId, subscription: subId, customer: customerId,
    }, "first paid binding");
    if (bind.status !== 200 || bind.tier !== "pro") {
      throw new Error(`#1302: first payment did not bind Pro (http ${bind.status}, tier ${bind.tier})`);
    }

    // ── 10. Duplicate and OUT-OF-ORDER delivery ───────────────────────────────
    const dup = await send("evt_1302_checkout", "checkout.session.completed", deps.frozenTime, {
      metadata: { userId }, client_reference_id: userId, subscription: subId, customer: customerId,
    }, "DUPLICATE of the binding event");
    if (dup.tier !== "pro") throw new Error(`#1302: a duplicate event changed entitlement to '${dup.tier}'`);

    await deps.stripe.testHelpers.testClocks.advance(cid, { frozen_time: deps.frozenTime + 32 * DAY });
    await pollClockReady(deps.stripe, cid, clockTimeout);
    const renew = await send("evt_1302_renew", "customer.subscription.updated", deps.frozenTime + 32 * DAY, { id: subId }, "renewal");
    if (renew.tier !== "pro") throw new Error(`#1302: renewal did not keep Pro (tier ${renew.tier})`);

    // An OLDER event delivered AFTER a newer one must not resurrect stale state.
    const stale = await send("evt_1302_stale", "customer.subscription.updated", deps.frozenTime - 10 * DAY, { id: subId }, "OUT-OF-ORDER (older than the last applied)");
    if (stale.tier !== "pro") {
      throw new Error(`#1302: an out-of-order older event regressed entitlement to '${stale.tier}'`);
    }

    // ── 11. Casualties — each must be REFUSED, and named ──────────────────────
    const forged = await deliver(deps, supabase, {
      id: "evt_1302_forged", type: "customer.subscription.deleted",
      created: deps.frozenTime + 33 * DAY, data: { object: { id: subId } },
    }, { forgeSignature: true });
    const tierAfterForged = await effectiveTier(db, userId);
    casualties.push({ name: "forged_signature", httpStatus: forged, refused: forged >= 400, effectiveTier: tierAfterForged });
    if (forged < 400) throw new Error(`#1302: a FORGED webhook signature was accepted (http ${forged})`);
    if (tierAfterForged !== "pro") throw new Error("#1302: a forged event mutated entitlement");

    for (const [name, bad] of [
      ["wrong_currency", { ...invoice, currency: "eur" }],
      ["wrong_amount", { ...invoice, amount_paid: 500 }],
      ["unpaid_first_invoice", { ...invoice, status: "open" }],
    ] as const) {
      let refused = false; let detail = "";
      try { assertFirstPaidInvoice(bad); } catch (e) { refused = true; detail = (e as Error).message; }
      casualties.push({ name, refused, detail });
      if (!refused) throw new Error(`#1302: casualty '${name}' was NOT refused`);
    }

    let prematureRefused = false;
    try {
      // A Stripe object existing DURING the DB trial must abort — the premature-object casualty.
      assertDbTrialWithoutStripe({
        trialStartedAt: profile.trialStartedAt, trialEndsAt: profile.trialEndsAt,
        stripeCustomerId: customerId, stripeSubscriptionId: null, entitlement: "trial",
      });
    } catch { prematureRefused = true; }
    casualties.push({ name: "premature_stripe_object", refused: prematureRefused });
    if (!prematureRefused) throw new Error("#1302: a premature Stripe object during the DB trial was NOT refused");

    // ── 9 (cont). Failure, recovery, scheduled cancel, terminal revocation ────
    await deps.stripe.paymentMethods.attach("pm_card_chargeCustomerFail", { customer: customerId });
    await deps.stripe.customers.update(customerId, { invoice_settings: { default_payment_method: "pm_card_chargeCustomerFail" } });
    await deps.stripe.testHelpers.testClocks.advance(cid, { frozen_time: deps.frozenTime + 64 * DAY });
    await pollClockReady(deps.stripe, cid, clockTimeout);
    const failed = await send("evt_1302_fail", "customer.subscription.updated", deps.frozenTime + 64 * DAY, { id: subId }, "payment failure");
    if (failed.tier !== "free") throw new Error(`#1302: a failed renewal did not revoke access (tier ${failed.tier})`);

    const failing = asObj(await deps.stripe.subscriptions.retrieve(subId));
    const openInvoice = typeof failing.latest_invoice === "string"
      ? failing.latest_invoice : String(asObj(failing.latest_invoice).id ?? "");
    await deps.stripe.paymentMethods.attach("pm_card_visa", { customer: customerId });
    await deps.stripe.customers.update(customerId, { invoice_settings: { default_payment_method: "pm_card_visa" } });
    if (openInvoice) await deps.stripe.invoices.pay(openInvoice, { payment_method: "pm_card_visa" });
    const recovered = await send("evt_1302_recover", "customer.subscription.updated", deps.frozenTime + 65 * DAY, { id: subId }, "recovery");
    if (recovered.tier !== "pro") throw new Error(`#1302: recovery did not restore Pro (tier ${recovered.tier})`);

    await deps.stripe.subscriptions.update(subId, { cancel_at_period_end: true });
    const scheduled = await send("evt_1302_scheduled", "customer.subscription.updated", deps.frozenTime + 66 * DAY, { id: subId }, "cancel_at_period_end");
    if (scheduled.tier !== "pro") throw new Error("#1302: a scheduled cancellation revoked access early");

    await deps.stripe.testHelpers.testClocks.advance(cid, { frozen_time: deps.frozenTime + 96 * DAY });
    await pollClockReady(deps.stripe, cid, clockTimeout);
    const terminal = await send("evt_1302_cancel", "customer.subscription.deleted", deps.frozenTime + 96 * DAY, { id: subId }, "terminal revocation");
    if (terminal.tier !== "free") throw new Error(`#1302: terminal cancellation did not revoke access (tier ${terminal.tier})`);

    assertAllCommercialPhasesProven({ ...evidence, test_objects_cleaned: true });
    out = { result: "PASSED", phases: Object.keys(evidence) as CommercialPhase[], record };
  } catch (err) {
    originalError = err;
  }

  // ── 12. Cleanup, PROVEN. Deleting the clock cascades its customer/subscription. ──
  const failures: string[] = [];
  if (clockId) {
    try {
      await deps.stripe.testHelpers.testClocks.del(clockId);
      let gone = false;
      try {
        const after = asObj(await deps.stripe.testHelpers.testClocks.retrieve(clockId));
        gone = after.deleted === true;
      } catch { gone = true; }   // a 404 IS the proof
      if (!gone) throw new Error("the test clock still exists after deletion");
      confirmedDeleted.push(...created);
    } catch (e) { failures.push(`test clock ${clockId}: ${(e as Error).message}`); }
  }
  try { assertTestObjectsCleaned({ created, confirmedDeleted }); } catch (e) { failures.push((e as Error).message); }
  record.cleanup = { created: created.length, confirmedDeleted: confirmedDeleted.length, failures };
  try { await db.close(); } catch { /* the ephemeral DB owns no external fixture */ }

  if (failures.length) {
    const cleanupErr = new Error(`#1302 cleanup failed (fixtures may leak): ${failures.join("; ")}`);
    if (originalError) throw new AggregateError([originalError, cleanupErr], `${(originalError as Error).message} | ${cleanupErr.message}`);
    throw cleanupErr;
  }
  if (originalError) throw originalError;
  return out!;
}
