**Status:** Authoritative (SSOT for tier model, entitlement authority, quota provenance, and the billing fail-closed contract)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-07-28
**Last Verified:** 2026-07-28 — reconciled from `PRD.operational.md` §1, `PAID_OPS_HARDENING_RUNBOOK.md`, and `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` (Finding 1), checked against the cited code/DB paths. Observed values are labeled by provenance category; they are not asserted as approved policy. No volatile run IDs or SHAs are carried here — release posture lives in `RELEASE_STATUS.md`.
**Applies To:** SpeakSharp — the ONE Private Practice product under the #1266 30-day-trial → $10/month model (Private-only; Cloud globally off). Enterprise packaging is future direction (→ `#1048`), not current scope.
**Class:** Entitlement & billing policy (product decision).
**Authority:** The source for the tier model, the entitlement authoritative-source (mechanics), Cloud eligibility, quota provenance, the billing fail-closed contract, comped-entitlement QA, and the live-activation contract.
**Not Authoritative For:** the structural entitlement *authority ADR* (→ `ARCHITECTURE.md` ADR-1); the entitlement selector *implementation* refactor (→ `#1036`); STT runtime/Cloud data contracts (→ `STT.md`); deferred pricing/packaging sequencing & unresolved quota decisions (→ `ROADMAP.md`); current deployment posture (→ `RELEASE_STATUS.md`); dated live billing evidence (→ `EVIDENCE_INDEX.md`).
**Supersedes:** the billing/entitlement material interim-held in `PRD.operational.md` §1, `PAID_OPS_HARDENING_RUNBOOK.md`, and `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` (archived/retained at closeout per `DOC_MIGRATION_LEDGER.md`).
**Evidence Sources:** `DOC_MIGRATION_LEDGER.md` §2/§3.I mapping; the `frontend/` + `backend/` code and `tier_configs` DB paths cited inline; `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` Finding 1.

# SpeakSharp Entitlements & Billing (v1)

Canonical statement of the tier model, who is entitled to what, how quotas are provenance-labeled, and how billing stays fail-closed during the no-billing beta. This is a **policy/contract** doc: observed code and DB values are recorded **by provenance category** and are **not** promoted to approved policy without a Product Owner decision. It changes by Product Owner decision, carries no volatile release facts, and routes implementation to its owning code paths.

This is a **documentation** artifact. It defines the contract; it does not change any code, DB configuration, quota, price, payment switch, or entitlement behavior, and authorizes no billing activation or live charge.

---

## 1. How to read this doc — five separated categories

Every quantitative claim below is tagged with exactly one provenance category. **They are not interchangeable.**

1. **Observed code policy** — a constant in the codebase (may be dead/unused).
2. **Deployed DB configuration** — the read-only value in the production `tier_configs` / RPC path.
3. **Marketing statement** — user-facing copy (may lag reality).
4. **Product Owner-approved policy** — an explicitly recorded PO/release-owner decision.
5. **Unresolved conflict** — a disagreement routed to `ROADMAP.md` as `OPEN_GAP`; not decided here.

## 2. Product & lifecycle model (#1266 one product)

SpeakSharp is **ONE product** — the Private Practice product (Open Mic + Focus Points, saved review, Progress, History, PDF), built on **Private on-device** transcription. There is **no permanent feature-limited Free tier and no feature-tiered Private**. The distinction between states is **lifecycle, not features** — the same complete product throughout:

- **Trial** — a new account has the **complete** product free for its first **30 days** (`effective_subscription_tier` → `pro` while the trial window is live). No card required.
- **Paid (Pro)** — after the trial, **$10/month** continues the **same complete product** (requires `subscription_status='pro'` AND a real `stripe_subscription_id`).
- **Expired (unpaid)** — the 30-day trial has ended and the account is unpaid: new recording/persistence/analysis **fail closed**; reading existing sessions, PDF export, account management, billing portal, and upgrade remain available. Metered by the server-side quota (see §4) only while entitled.

**Cloud STT is globally off** in the current model and is **not** a paid differentiator — the product is Private-only (per the #1142/#1269 product truth), and the only paid distinction is trial-vs-paid continuation. Browser transcription is an explicit convenience path, never an equivalent to Private and never the paid line.

**No-billing beta posture:** both payment switches stay OFF (§5); paid continuation is reachable only via an existing subscription or an explicitly approved comped DB entitlement (§6); existing/comped Pro accounts retain access. Server-authoritative mechanics are in §2a.

### 2a. #1266/#1282 commercial contract (30-day full-product trial → $10/month)

The locked commercial model is **ONE product**: the complete Private Practice product (Open Mic + Focus Points, saved review, Progress, History, PDF) is **free for a new account's first 30 days**, then **$10/month** to continue. It is NOT a permanent feature-limited Free tier. Server-authoritative mechanics (migrations `20260812000000`/`…001000`/`…002000`):

- **Trial grant** — `effective_subscription_tier()` resolves to `pro` for a **live** trial window (`trial_expires_at > now()`) OR paid (`subscription_status='pro'` AND real `stripe_subscription_id`). New accounts are stamped a 30-day window; existing unpaid beta accounts received a one-time, non-retroactive fresh-30-day activation stamp. Legacy (long-expired) timestamps never grant Pro.
- **Expiry fails closed** — once the trial expires and the account is unpaid, `check_usage_limit`/`update_user_usage` refuse new recording/persistence/analysis (`trial_expired`). Reading existing sessions, PDF export, account management, billing portal and upgrade remain available. The prior 300s private-sample fallback is retired for this model.
- **Checkout price** — `stripe-checkout` verifies `STRIPE_PRO_PRICE_ID` is an active recurring **monthly** price of **exactly 1000 cents** in the configured currency (`STRIPE_PRICE_CURRENCY`, default `usd`) before creating a session; the amount is server-owned, never caller-supplied. Any mismatch fails closed (`CONFIG_INVALID_PRICE`).
- **Webhook lifecycle** — activation, renewal (`invoice.payment_succeeded` → `renew_pro`), cancel-through-period-end, payment-failure → lapse, duplicate/replay (event id), and **out-of-order** (a `last_stripe_event_at` watermark ignores events older than the newest applied one). Existing paid customers stay manageable with new enrollment closed.

**Merge/deploy note (corrected):** merging the #1282 branch to `main` **auto-deploys the changed Edge Functions** (`stripe-checkout`, `stripe-webhook`) via `deploy-supabase-edge-release.yml` (triggered by a push to `main` touching `backend/supabase/functions/**`). This deploys the *code* but **activates no billing** — the fail-closed enrollment guard (`PAYMENTS_ENABLED` + a live `sk_live_` secret) keeps checkout returning `403` until both switches are deliberately enabled (§5). **Migrations do NOT apply on merge** — they run only via the separately-dispatched migrations workflow. So: merge = Edge code deploy (fail-closed, no charge) + no migration; enabling the paid model remains a distinct, explicitly-authorized step.

## 3. Entitlement authority (mechanics; ADR in `ARCHITECTURE.md`)

Per `ARCHITECTURE.md` ADR-1 — **payment status and product capability are distinct**:

- **Full-product access** resolves to `pro` when EITHER (a) **paid**: `subscription_status = 'pro'` **AND** a real `stripe_subscription_id` is present, OR (b) a **live 30-day trial**: `trial_expires_at > now()` (`effective_subscription_tier()`, #1282 migration `20260812000000`, building on `20260621120000`). `subscription_status = 'pro'` alone (and any frontend-derived boolean) is **advisory, never sufficient** for the paid path; the legacy `subscription_id` argument is **deprecated and ignored**; **legacy (expired) trial timestamps never grant Pro** — only a live window does. Billing-portal access is gated separately on `stripe_subscription_id`, so a trial user gets the full product but no billing management (nothing to manage yet).
- **`canUsePrivate` / `canUseCloud`** are **server-derived capability entitlements** and MAY include explicitly approved **comped or legacy grants** — capability ≠ payment.
- **`check-usage-limit`** enforces server-side **quota** policy; it is **not** proof of payment.
- The client selector (`getEffectiveSubscriptionStatus` / `hasPaidProEntitlement`) is advisory for UI; centralizing it is **#1036** (which must not change these boundaries).

## 4. Quota — the daily/monthly limits are provisional configuration, NOT policy

> The current numeric limits are **observed implementation values only** — provisional development configuration, **subject to change**, and **not customer commitments or approved policy**. Preserving current behavior (the prior direction) is *not* the same as approving these values. The current implementation is numerically limited (not unlimited); that is a fact about the code, not a commercial policy.

| Provenance | Free daily | Pro daily | Pro monthly | Source |
| :--- | :--- | :--- | :--- | :--- |
| **(1) Observed code** | `3600s` (1h) | `7200s` (2h) | — | `frontend/src/constants/subscriptionTiers.ts` — `TIER_LIMITS.pro.dailySeconds = 7200`, `free = 3600`; the historical `Infinity` special-case was removed (PR #769) and a consistency test rejects `Infinity`. **Provisional dev config.** |
| **(2) Migration-seeded DB** | `3600s` (1h) | `7200s` (2h) | `180000s` (50h) | `tier_configs` per `20260309000000_phase2_integration.sql`; enforced by `check_usage_limit()` RPC via the `check-usage-limit` edge fn; `useUsageLimit.ts` reflects the DB. **Prod-equality to the latest migration is unverified** — a read-only ops query (`ENTITLEMENT_PRO_LIMIT_EVIDENCE.md`): **evidence about deployed state, not policy approval.** |
| **(3) Marketing** | — | (was "unlimited") | — | older "Want unlimited sessions?" upsell — corrected to "Need more recording time?" (PR #769). |
| **(4) PO-approved policy** | **none** | **none** | **none** | **No quota is approved as policy.** The prior "leave the configuration unchanged" direction preserved current dev behavior; it did **not** approve these values as policy or customer commitments, and did **not** adopt "not unlimited" as future positioning. |
| **(5) Unresolved → ROADMAP** | final Free quota | final Pro quota | final Pro quota | Final quotas, pricing, packaging, **unlimited positioning**, and comped-access rules are **unresolved product decisions** — `OPEN_GAP` → `ROADMAP.md`, to be decided in **later product/pricing work informed by product readiness and usage evidence**. |

**Net (facts only):** the current code and the seeded migration are numerically limited to 1h/day (Free) and 2h/day + 50h/month (Pro); the `Infinity` special-case was removed. These are **provisional implementation values, not approved policy or customer commitments.** Whether live prod `tier_configs` equals the latest migration is unverified (ops query outstanding).

## 5. Billing fail-closed contract

- **Dual switch, both must be ON to enable payments; both are OFF in the beta:**
  - **Frontend** — `VITE_PAYMENTS_ENABLED` (`arePaymentsEnabled()` in `appRuntimeConfig.ts`); when off, checkout entry points are hidden (no broken checkout).
  - **Backend** — `PAYMENTS_ENABLED` gating the `stripe-checkout` edge function.
- **Key-class validates configuration; it does NOT open checkout.** Presence of a Stripe key never by itself enables purchase — both switches gate it.
- **Freeze proof in CI** — `scripts/billing-freeze-check.mjs` asserts billing is CLOSED; enabling billing is the separate, explicitly-authorized paid-launch sequence.
- **No live charge** is authorized by this document.

## 6. Cloud eligibility & comped entitlement

- **Cloud = paid-Pro only, and never a silent fallback.** Private STT MUST NOT auto-switch to Cloud (privacy + variable-cost change); Cloud is entered only by explicit user selection with the capability entitlement (`ARCHITECTURE.md` §7).
- **Comped / legacy grants — actual mechanism (no separate comped id).** There is **no separate "comped entitlement" table or id.** Per `effective_subscription_tier()` (§3), Pro requires `subscription_status = 'pro'` **AND** a `stripe_subscription_id`; the legacy `subscription_id` is deprecated/ignored. Comped or QA Pro is therefore granted by setting those DB profile fields directly (an **evidence/QA convention** using a synthetic test subscription id, **never a live Stripe charge**); live Stripe stays read-only. Whether a synthetic id qualifies as "real" is an implementation detail owned by the RPC / #1036.

## 7. Live-activation contract (future; separate PO authorization)

Enabling paid billing is a **deliberate activation sequence**, **not a key swap**: it requires flipping **both** payment switches, real live Stripe configuration validated server-side, the paid-launch approval, and live-activation verification (per `PAID_OPS_HARDENING_RUNBOOK.md`). Until then this doc records the contract; it activates nothing.

## 7a. Enterprise / organization entitlement posture (requirements only)

No organization tier exists, and none is being built. This records what an organization tier **would have to satisfy**, so that no partial version ships by accident. Requirement classification and triggers live in `PRODUCT_REQUIREMENTS.md` §10a.

- **The entitlement authority does not change.** Today entitlement is per-user and record-time authoritative. An organization tier would add a **seat grant** that resolves to the same per-user entitlement — it must **not** introduce a second, parallel authority.
- **Seat entitlement is explicit, never inherited by domain.** Sharing an email domain with a customer grants nothing; a seat is assigned.
- **Fail-closed is unchanged.** An unresolvable org or seat yields the **Free** entitlement, never an elevated one.
- **No org-level quota pooling** is defined. Any pooled or transferable quota is a new product decision, not an implementation detail.
- **Billing stays fail-closed and PO-authorized.** Nothing about an organization tier relaxes the live-activation contract in §7.

**Not authorized:** creating an organization tier, seat model, or admin surface. This section is a specification of constraints, not a plan to build.

## 8. Open gaps (→ ROADMAP)

- **Final quotas, pricing, packaging, unlimited positioning, and comped-access rules — all UNRESOLVED product decisions.** The current numeric limits are provisional development configuration, not policy or customer commitments. **Decision timing:** later product/pricing work, informed by product readiness and usage evidence. Enterprise packaging → `#1048`.
- **Prod-DB-vs-latest-migration entitlement equality** — a read-only **evidence** item about deployed state (→ `EVIDENCE_INDEX.md` / `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md`), **not** a policy approval.
