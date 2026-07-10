# Paid Soft-Launch Ops Hardening Runbook (no live keys required)

Owner: Dev. Branch: `dev/paid-ops-hardening` (off `main@4726b55a`). Purpose: document and
verify the operational guardrails for the paid soft launch that do **not** require live
Stripe keys or real payment. Live-money proof remains a separate Product/Ops + Test gate.

> Hard rules: a **synthetic / signed test webhook is code-path evidence only — NOT
> live-money proof.** No paid GO without a real live-money charge proven by Test.

> **STATUS UPDATE — 2026-07-10 (live Stripe key now in prod).** The live publishable key is now
> injected in production: the deployed runtime reports `window.__APP_RUNTIME_CONFIG__.stripeKeyClass
> === "live"`, so `arePaymentsEnabledFor` returns `true` and the checkout kill switch is in its
> **enabled (live)** state — the "no live keys required" framing below described the pre-injection
> hardening pass, not the current deployed state. ops-health Stripe check = 🟡 REVIEW
> (`balance=200 · pro=200 · basic=404`): the live **Pro** price is reachable/working; **Basic** is
> intentionally reserved/not-launched (`404`, non-blocking). **Still NOT proven:** a real live-money
> human charge end-to-end (the LIVE-MONEY gate below) — a present live key is not a completed charge.
> Whether public checkout is deliberately exposed to users is a separate product decision; ship
> posture / blockers live only in `RELEASE_STATUS.md`.

## How the paid path is gated (architecture)

There is **no `STRIPE_RUNTIME_MODE` env**. The kill switch is the **publishable-key class**
plus **webhook-signature-verified entitlement**:

1. **Frontend kill switch** — `frontend/src/config/appRuntimeConfig.ts`
   - `classifyStripeKey(key)` → `'live' | 'test' | 'missing' | 'unknown'`
     (`pk_live_*`→live, `pk_test_*`→test, empty→missing, else→unknown).
   - `arePaymentsEnabledFor(key) = classifyStripeKey(key) === 'live'`.
   - Release rule: a production deploy MUST run `live`; `test`/`missing`/`unknown` **hide/disable
     all public checkout surfaces** (a test-mode checkout shown in production is a monetized-funnel
     release risk). `missing` is **fail-closed** → `ConfigurationNeededPage` (`main.tsx`).
   - Wired at: `Navigation.tsx` (entry points hidden when `!arePaymentsEnabled()`),
     `UpgradePromptDialog.tsx` (`return null`), `FreePlanSupport.tsx` (conditional).
2. **Backend entitlement gate** — `backend/supabase/functions/stripe-webhook/index.ts`
   - Reads `Stripe-Signature`, verifies via `constructStripeEvent(stripe, body, signature, webhookSecret)`
     before any mutation; only signature-verified `checkout.session.completed` /
     `customer.subscription.{updated,deleted}` events drive entitlement.
   - **No Pro unlock without a verified webhook** → entitlement is server-confirmed, not client-claimed.

## Checklist — verifiable now (no live keys)

| # | Item | Status / where | Evidence |
|---|---|---|---|
| 1 | Live env variable checklist | documented below | this runbook |
| 2 | Checkout kill switch behaves | `arePaymentsEnabledFor==='live'`; test/missing/unknown hide checkout | **Already covered** by `appRuntimeConfig.test.ts` (`classifyStripeKey` + `arePaymentsEnabledFor`: live→true, test/missing/unknown/null/undefined→false). #4 confirms — no new test needed |
| 3 | Live-config blocked cleanly when live env absent | `missing`→fail-closed `ConfigurationNeededPage`; no broken checkout shown | `main.tsx` wiring + classifier test |
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
Acceptance once injected (Test runs, not Dev): `classifyStripeKey === 'live'`,
`price.livemode === true`, `checkoutSession.livemode === true`, live webhook delivers a
signature-verified event, entitlement flips in Supabase, app unlocks Pro ONLY after that.

## Live-config / live-money proof procedure (Test, after Product/Ops supplies keys)

```text
LIVE-CONFIG:  inject live keys -> confirm payments enabled (key class 'live'),
              price.livemode true, webhook endpoint reachable + signature verifies.
LIVE-MONEY:   a human completes ONE real checkout -> Stripe live event -> webhook ->
              Supabase entitlement -> app unlocks Pro. Refund the test charge.
BLOCKED:      if live keys absent -> classifier 'missing' -> checkout hidden /
              ConfigurationNeededPage. This is the clean "blocked by live env" state.
```

## What is NOT proven here

- Real live-money charge + live webhook + live entitlement (live keys are now in prod; this still needs a completed human payment).
- Pricing/Analytics checkout-failure copy audit (queued follow-up; Nav already customer-safe).

## Guardrails honored

v2-base default unchanged; no v4 touched; `0d5f87c9` not touched; no live Stripe secrets handled;
no real payment; synthetic webhook never labeled live-money; no merges.
