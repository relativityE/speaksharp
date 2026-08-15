// #1294 — WEEKLY billing-qualification entrypoint (Deno). Wires the REAL stripe-webhook handler + the real
// test-mode Stripe SDK + an ephemeral migrated PGlite database, then runs the no-live-charge lifecycle
// qualification. Fails closed on any live/missing/misaligned Stripe configuration before creating anything.
// Emits only sanitized evidence (no secrets/PII). Run by canary.yml on the weekly schedule.
import Stripe from "npm:stripe@16";
import { handler } from "../../backend/supabase/functions/stripe-webhook/index.ts";
import { runBillingQualification, type StripeLike } from "./runner.ts";

const env = (k: string) => Deno.env.get(k);
const secretKey = env("STRIPE_SECRET_KEY") ?? "";
const priceId = env("STRIPE_PRO_PRICE_ID") ?? "";
const webhookSecret = env("STRIPE_WEBHOOK_SECRET") ?? "";

async function main() {
  // Defence in depth (the runner's assertStripeTestMode also proves livemode=false before any object): refuse
  // a live key up front, and require the test-scoped configuration.
  if (/^sk_live_/.test(secretKey)) throw new Error("billing qualification refused: a LIVE Stripe secret key was supplied");
  if (!/^sk_test_/.test(secretKey)) throw new Error("billing qualification refused: a Stripe TEST secret key (sk_test_…) is required");
  if (!priceId) throw new Error("billing qualification refused: STRIPE_PRO_PRICE_ID is required");
  if (!webhookSecret) throw new Error("billing qualification refused: STRIPE_WEBHOOK_SECRET is required");

  const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" as Stripe.LatestApiVersion });
  const out = await runBillingQualification({
    // The runner speaks to a deliberately minimal StripeLike surface (the handful of calls the lifecycle uses);
    // the full SDK is a structural superset, so narrow it to that contract at this single boundary.
    stripe: stripe as unknown as StripeLike,
    handler,
    secretKey,
    webhookSecret,
    priceId,
    frozenTime: Math.floor(Date.now() / 1000),
    log: (m) => console.log(`[billing-qualification] ${m}`),
  });
  console.log(JSON.stringify({ result: out.result, mode: "test", livemode: false, phases: out.phases }));
}

main().catch((err) => {
  // Content-free failure — never leak keys/PII. Non-zero exit so a partial run can never read as a pass.
  console.error(`::error::billing qualification failed closed: ${err instanceof Error ? err.message : String(err)}`);
  Deno.exit(1);
});
