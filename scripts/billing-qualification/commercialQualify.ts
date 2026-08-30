// #1302 — commercial lifecycle entrypoint (Deno). TEST MODE ONLY.
//
// Wires the REAL stripe-webhook handler + the real test-mode Stripe SDK + an ephemeral migrated PGlite
// database, then runs the DB-trial → expiry → immediately-billable-checkout → webhook lifecycle
// qualification. Fails closed on any live/missing/misaligned configuration before creating anything, and
// emits only sanitized evidence.
import Stripe from "npm:stripe@16";
import { handler } from "../../backend/supabase/functions/stripe-webhook/index.ts";
import { runCommercialQualification, type CommercialDeps } from "./commercialRunner.ts";

const env = (k: string) => Deno.env.get(k);
const secretKey = env("STRIPE_SECRET_KEY") ?? "";
const priceId = env("STRIPE_PRO_PRICE_ID") ?? "";
const webhookSecret = env("STRIPE_WEBHOOK_SECRET") ?? "";

async function main() {
  if (/^sk_live_/.test(secretKey)) throw new Error("#1302 refused: a LIVE Stripe secret key was supplied");
  if (!/^sk_test_/.test(secretKey)) throw new Error("#1302 refused: a Stripe TEST secret key (sk_test_…) is required");
  if (!priceId) throw new Error("#1302 refused: STRIPE_PRO_PRICE_ID is required");
  if (!webhookSecret) throw new Error("#1302 refused: STRIPE_WEBHOOK_SECRET is required");
  // Never enable payments as a side effect of qualifying them.
  if (env("PAYMENTS_ENABLED") === "true") throw new Error("#1302 refused: PAYMENTS_ENABLED must not be set for a qualification run");

  const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" as Stripe.LatestApiVersion });
  const out = await runCommercialQualification({
    stripe: stripe as unknown as CommercialDeps["stripe"],
    handler, secretKey, webhookSecret, priceId,
    frozenTime: Math.floor(Date.now() / 1000),
    log: (m) => console.log(`[1302] ${m}`),
  });

  const artifact = {
    issue: 1302, mode: "test", livemode: false,
    result: out.result, phases: out.phases, record: out.record,
    finishedAt: new Date().toISOString(),
  };
  await Deno.writeTextFile("stripe-commercial-lifecycle.json", `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({ result: out.result, phases: out.phases }));
}

main().catch((err) => {
  console.error(`::error::#1302 commercial lifecycle failed closed: ${err instanceof Error ? err.message : String(err)}`);
  Deno.exit(1);
});
