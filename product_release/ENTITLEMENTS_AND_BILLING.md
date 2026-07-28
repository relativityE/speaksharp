**Status:** Authoritative (SSOT for tier model, entitlement authority, quota provenance, and the billing fail-closed contract)
**Owner:** Product Owner (relativityE)
**Last Reviewed:** 2026-07-28
**Last Verified:** 2026-07-28 — reconciled from `PRD.operational.md` §1, `PAID_OPS_HARDENING_RUNBOOK.md`, and `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` (Finding 1), checked against the cited code/DB paths. Observed values are labeled by provenance category; they are not asserted as approved policy. No volatile run IDs or SHAs are carried here — release posture lives in `RELEASE_STATUS.md`.
**Applies To:** The SpeakSharp beta — Free and paid-Pro tiers under the no-billing beta. Enterprise packaging is future direction (→ `#1048`), not current scope.
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

## 2. Tier model

- **Free** — the default beta tier. Private (on-device) STT + Browser "quick preview". No Cloud. Metered by the server-side quota (see §4).
- **Paid-Pro** — adds **Cloud** STT eligibility. During the no-billing beta, new Free testers cannot purchase Pro (checkout is closed, §5); **existing/comped Pro accounts retain access**.
- **No-billing beta** — the current release posture: both payment switches OFF; Pro is reachable only via an existing subscription or an explicitly approved comped DB entitlement (§6).

## 3. Entitlement authority (mechanics; ADR in `ARCHITECTURE.md`)

Per `ARCHITECTURE.md` ADR-1 — **payment status and product capability are distinct**:

- **Verified paid-Pro** requires **real Stripe subscription evidence**; `subscription_status = 'pro'` alone (and any frontend-derived boolean) is **advisory, never sufficient**. The server function `effective_subscription_tier()` (migration `20260621120000`) returns Pro only when `subscription_status = 'pro'` **AND** a `stripe_subscription_id` is present; the legacy `subscription_id` argument is **deprecated and ignored**, and legacy trial timestamps do not grant Pro.
- **`canUsePrivate` / `canUseCloud`** are **server-derived capability entitlements** and MAY include explicitly approved **comped or legacy grants** — capability ≠ payment.
- **`check-usage-limit`** enforces server-side **quota** policy; it is **not** proof of payment.
- The client selector (`getEffectiveSubscriptionStatus` / `hasPaidProEntitlement`) is advisory for UI; centralizing it is **#1036** (which must not change these boundaries).

## 4. Quota — the daily/monthly limit, by provenance (NOT asserted as blanket policy)

> The quota is the canonical example of category separation. Do **not** read "1h Free / 2h Pro" as blanket approved policy — read the categories.

| Provenance | Free daily | Pro daily | Pro monthly | Source |
| :--- | :--- | :--- | :--- | :--- |
| **(1) Observed code** | `3600s` (1h) | `7200s` (2h) | — | `frontend/src/constants/subscriptionTiers.ts` — `TIER_LIMITS.pro.dailySeconds = 7200`, `free = 3600`. The historical `Infinity` special-case was **removed (PR #769)** and a consistency test now rejects `Infinity`; the code no longer disagrees with the DB. |
| **(2) DB config** (migration-seeded) | `3600s` (1h) | `7200s` (2h) | `180000s` (50h) | `tier_configs` per `20260309000000_phase2_integration.sql`; enforced by `check_usage_limit()` RPC via the `check-usage-limit` edge fn; `useUsageLimit.ts` reflects the DB. **Prod-equality to the latest migration is NOT yet verified — it requires a read-only prod DB query** (`ENTITLEMENT_PRO_LIMIT_EVIDENCE.md`). |
| **(3) Marketing** | — | (was "unlimited") | — | older "Want unlimited sessions?" upsell — **corrected** to "Need more recording time?" (PR #769). |
| **(4) PO-approved policy** | — | **2h/day** | **50h/month** | **Release-owner decision (recorded, `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` Finding 1):** for this release Pro = 2h/day, 50h/month; **DB `tier_configs` is the source of truth**; do **not** raise the DB to unlimited. |
| **(5) Unresolved → ROADMAP** | Free-quota ratification | — | — | Whether to raise Pro to unlimited (or re-tier Free) is a **separate post-release pricing/packaging decision** — `OPEN_GAP` → `ROADMAP.md`. |

**Net observed effect:** code and the seeded migration now **agree** — Pro is capped at **2h/day, 50h/month** (the `Infinity` special-case was removed, PR #769). **Whether the live prod `tier_configs` equals the latest migration is not yet confirmed** — a read-only ops query remains outstanding (`ENTITLEMENT_PRO_LIMIT_EVIDENCE.md`).

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

## 8. Open gaps (→ ROADMAP)

- **Pro-unlimited vs capped** — future pricing/packaging decision; DB stays the truth at 2h/day, 50h/month for this release (`OPEN_GAP`).
- **Exact quotas, pricing, packaging, comped-access policy** — owned here as the *questions*; the Product Owner records the *decisions*. Enterprise packaging → `#1048`.
- **Prod-DB-vs-latest-migration entitlement confirmation** — evidence item (→ `EVIDENCE_INDEX.md` / `ENTITLEMENT_PRO_LIMIT_EVIDENCE.md`).
