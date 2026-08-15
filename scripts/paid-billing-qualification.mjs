#!/usr/bin/env node
/**
 * #1294 — WEEKLY, automated, NO-live-charge Stripe billing lifecycle qualification (test mode + test clocks).
 *
 * Thin CLI that wires REAL clients onto the injectable core in scripts/lib/billingQualification.mjs:
 *   - Stripe REST via fetch with CORRECT form encoding (encodeStripeForm);
 *   - a throwaway Supabase test user (cleaned up in finally);
 *   - signed test-mode webhooks POSTed to the deployed stripe-webhook (proving SpeakSharp entitlement);
 *   - server-authoritative profile reads.
 * It fails closed BEFORE creating anything unless Stripe proves livemode=false (assertStripeTestMode). No
 * secrets/PII are printed. Per the PR authorization boundary it is NOT executed during development; its
 * request shapes, ordering, poll-to-ready, entitlement proof, and finally-cleanup are covered by mock tests.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  assertStripeTestMode, encodeStripeForm, signStripeWebhook, runBillingLifecycle,
} from './lib/billingQualification.mjs';

const {
  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRO_PRICE_ID,
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EDGE_FN_URL,
} = process.env;
const TEST_PM_OK = process.env.STRIPE_TEST_PM_OK || 'pm_card_visa';
const TEST_PM_FAIL = process.env.STRIPE_TEST_PM_FAIL || 'pm_card_chargeCustomerFail';
const STRIPE_API = 'https://api.stripe.com/v1';
const WEBHOOK_URL = `${(EDGE_FN_URL || `${SUPABASE_URL}/functions/v1`).replace(/\/$/, '')}/stripe-webhook`;

async function stripe(method, path, body) {
  const res = await fetch(`${STRIPE_API}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? encodeStripeForm(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`stripe ${method} ${path} → ${res.status} ${json?.error?.type || ''}`);
  if (json && json.livemode === true) throw new Error(`stripe ${method} ${path} returned a LIVE object`);
  return json;
}

async function main() {
  for (const [k, v] of Object.entries({ STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRO_PRICE_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
    if (!v) throw new Error(`billing qualification refused: ${k} is required`);
  }

  // Preflight: PROVE test mode BEFORE creating anything.
  const account = await stripe('GET', 'account');
  const price = await stripe('GET', `prices/${encodeURIComponent(STRIPE_PRO_PRICE_ID)}`);
  assertStripeTestMode({ secretKey: STRIPE_SECRET_KEY, accountLivemode: account.livemode, price });
  console.log('[billing-qualification] preflight OK — Stripe proved livemode=false');

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `billing-qual-${randomUUID()}@example.test`;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password: randomUUID(), email_confirm: true });
  if (createErr || !created?.user?.id) throw new Error(`billing qualification refused: could not create throwaway test user (${createErr?.message || 'no id'})`);
  const userId = created.user.id;

  const readProfile = async () => {
    const { data } = await admin.from('user_profiles').select('subscription_status,stripe_subscription_id,stripe_customer_id').eq('id', userId).maybeSingle();
    return data || {};
  };
  const postWebhook = async (type, dataObject) => {
    // Carry the SpeakSharp user id so the webhook resolves the right profile, then sign per Stripe's scheme.
    const event = { id: `evt_${randomUUID()}`, type, livemode: false, data: { object: { ...dataObject, metadata: { user_id: userId } } } };
    const payload = JSON.stringify(event);
    const sig = signStripeWebhook(STRIPE_WEBHOOK_SECRET, payload, createHmac, Math.floor(Date.now() / 1000));
    const res = await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': sig }, body: payload });
    return { ok: res.ok, status: res.status };
  };

  try {
    const io = { stripe, postWebhook, readProfile, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), nowSec: () => Math.floor(Date.now() / 1000) };
    const result = await runBillingLifecycle(io, { priceId: STRIPE_PRO_PRICE_ID, testPmOk: TEST_PM_OK, testPmFail: TEST_PM_FAIL, userId });
    console.log(JSON.stringify(result));
  } finally {
    // Always remove the throwaway user (best-effort) — pairs with the lifecycle's own test-clock cleanup.
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
}

main().catch((err) => {
  console.error(`::error::billing qualification failed closed: ${err.message}`);
  process.exit(1);
});
