# Paid Soft-Launch Ops Hardening Runbook (no live keys required)

Owner: relativityE. Purpose: document and verify the operational guardrails for a **future** paid
cutover that do **not** require live Stripe keys or real payment. Live-money proof remains a separate
Product/Ops + Test gate.

> **Policy reconciliation (2026-07-15):** the current release is a **controlled, no-billing beta** —
> paid checkout is intentionally NOT open — **closed by the payment switches (`VITE_PAYMENTS_ENABLED` /
> `PAYMENTS_ENABLED` both OFF), NOT by the key class.** Production runtime is `stripeKeyClass="test"`, the
> checkout CTA does not render (`arePaymentsEnabled()` is false), and the Beta-50 billing freeze is active (no
> live Stripe charges/subscriptions/refunds; comped-DB entitlement only for Pro QA). **This runbook is
> the procedure for a LATER paid cutover, not an active step.** Enabling paid is a separate, written
> owner-approved Ops action (deploy `pk_live_`/`sk_live_`/live `whsec_`/live price IDs, register the
> live webhook, verify `stripeKeyClass==="live"`).

> Hard rules: a **synthetic / signed test webhook is code-path evidence only — NOT
> live-money proof.** No paid GO without a real live-money charge proven by Test.

## How the paid path is gated (architecture)

Checkout is closed by **two independent payment switches**, one on each side. **Either switch
unset/OFF keeps checkout closed.** The Stripe **key class validates configuration** but does **not**
by itself open or close checkout — it is a config-validity check layered on top of the switches, not
the gate.

1. **Frontend closure switch** — `VITE_PAYMENTS_ENABLED`
   - Frontend checkout requires `VITE_PAYMENTS_ENABLED=true` **and** valid, aligned live frontend
     Stripe configuration (a `pk_live_*` publishable key).
   - Key-class **validation** helper — `frontend/src/config/appRuntimeConfig.ts`:
     `classifyStripeKey(key)` → `'live' | 'test' | 'missing' | 'unknown'`
     (`pk_live_*`→live, `pk_test_*`→test, empty→missing, else→unknown). This validates that the
     shipped config is a live key; it does **not** independently open checkout — the switch does.
   - `missing` config is additionally **fail-closed** to `ConfigurationNeededPage` (`main.tsx`),
     independent of the payment switches — a broken-config safety net, not the closure control.
   - Checkout surfaces are hidden unless the frontend switch is ON with aligned live config
     (`Navigation.tsx`, `UpgradePromptDialog.tsx` `return null`, `FreePlanSupport.tsx`).
2. **Backend closure switch** — `PAYMENTS_ENABLED`
   - Backend checkout requires `PAYMENTS_ENABLED=true` **and** valid, aligned live backend Stripe
     configuration (`sk_live_*` secret, live `whsec_`, live price IDs).
3. **Backend entitlement gate** — `backend/supabase/functions/stripe-webhook/index.ts`
   - Reads `Stripe-Signature`, verifies via `constructStripeEvent(stripe, body, signature, webhookSecret)`
     before any mutation; only signature-verified `checkout.session.completed` /
     `customer.subscription.{updated,deleted}` events drive entitlement.
   - **No Pro unlock without a verified webhook** → entitlement is server-confirmed, not client-claimed.

**Opening paid enrollment requires ALL of:** both payment switches ON (`VITE_PAYMENTS_ENABLED=true`
**and** `PAYMENTS_ENABLED=true`), aligned live Stripe keys/webhook/prices, and entitlement
verification. **A key swap alone does not open paid enrollment** — with either switch OFF, checkout
stays closed regardless of key class.

## Checklist — verifiable now (no live keys)

| # | Item | Status / where | Evidence |
|---|---|---|---|
| 1 | Live env variable checklist | documented below | this runbook |
| 2 | Payment switches close checkout | Either `VITE_PAYMENTS_ENABLED` or `PAYMENTS_ENABLED` unset/OFF keeps checkout closed; opening it needs both switches ON with aligned live config. Key-class validation (`classifyStripeKey`) checks config validity but is not the switch. | Switch behavior + `appRuntimeConfig.test.ts` (`classifyStripeKey`: live→valid, test/missing/unknown→invalid config, not the closure control) |
| 3 | Missing live config is fail-closed | `missing`→fail-closed `ConfigurationNeededPage`; no broken checkout shown. This is a config-validity safety net, independent of the two closure switches. | `main.tsx` wiring + classifier test |
| 4 | No raw Stripe errors in UI | Nav checkout-fail → customer-safe toast (trust-leak #6 ✅). **Verify** PricingPage/AnalyticsPage catch blocks surface customer-safe copy, not raw Stripe/provider strings | code audit (Pricing/Analytics = follow-up verify) |
| 5 | No Pro unlock without Supabase entitlement | webhook signature-verified before entitlement mutation; client gates Pro on confirmed entitlement | `stripe-webhook/index.ts` |
| 6 | Billing portal / cancel / refund path clear | `PricingPage` `BillingManagementPanel` → `stripe-billing-portal`; refund copy "reviewed case by case"; Report Issue (Billing) path | trust closeout |
| 7 | Synthetic webhook is NOT live-money proof | labeled as code-path evidence only | this runbook hard rule |

## Live env variable checklist (Product/Ops supplies; Dev never handles secrets)

```text
Frontend (publishable, safe to ship in bundle):
  VITE_STRIPE_PUBLISHABLE_KEY = pk_live_...      # class must classify as 'live'

Backend (Supabase function secrets — NEVER in repo / NEVER to Dev):
  STRIPE_SECRET_KEY           = sk_live_...
  STRIPE_WEBHOOK_SECRET       = whsec_...        # live endpoint signing secret
  STRIPE_PRICE_ID (Pro)       = price_...        # livemode === true price
```
Acceptance once injected (Test runs, not Dev) — config-validity checks that layer on top of the two
switches, they do **not** replace them: `classifyStripeKey === 'live'`, `price.livemode === true`,
`checkoutSession.livemode === true`, live webhook delivers a signature-verified event, entitlement
flips in Supabase. Checkout only opens once **both** `VITE_PAYMENTS_ENABLED=true` and
`PAYMENTS_ENABLED=true` are set alongside that aligned live config; injecting live keys alone is not
sufficient. App unlocks Pro ONLY after the verified webhook flips entitlement.

## Live-config / live-money proof procedure (Test, after Product/Ops supplies keys)

```text
LIVE-CONFIG:  set BOTH payment switches ON (VITE_PAYMENTS_ENABLED / PAYMENTS_ENABLED) AND inject
              aligned live config -> validate key class 'live', price.livemode true, webhook
              endpoint reachable + signature verifies. (Live keys without both switches = still closed.)
LIVE-MONEY:   a human completes ONE real checkout -> Stripe live event -> webhook ->
              Supabase entitlement -> app unlocks Pro. Refund the test charge.
BLOCKED:      either switch OFF keeps checkout closed regardless of key class; separately, missing
              live config is fail-closed (classifier 'missing' -> ConfigurationNeededPage).
```

## What is NOT proven here

- Real live-money charge + live webhook + live entitlement (needs live keys + a human payment).
- Pricing/Analytics checkout-failure copy audit (queued follow-up; Nav already customer-safe).

## Guardrails honored

v2-base default unchanged; no v4 touched; STT engine defaults not touched; no live Stripe secrets handled;
no real payment; synthetic webhook never labeled live-money; no merges.
