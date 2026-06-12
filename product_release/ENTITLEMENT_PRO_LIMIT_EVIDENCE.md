# Entitlement Evidence (#1) — Pro daily/monthly limit drift + AI-quota verification

Source-level verification that the **deployed DB entitlement functions / tier configs** match the
**current entitlement policy**. Outcome: **one real drift to decide on** (Pro daily/monthly cap), plus
a maintainability note. The "live/prod matches latest migration" confirmation still needs a prod DB
query (ops) — see *Open / needs-ops* below.

## Release closeout summary (#1 / #4 / #5)

| Item | Status | Where |
|---|---|---|
| **#5** AI suggestions server-side quota | ✅ **Verified closed — no code.** Already implemented + enforced (HTTP 429 on exceed, cached bypass, atomic RLS counter). | edge fn `get-ai-suggestions` + `consume_ai_suggestion_quota()` |
| **#4** Stripe customer-id persistence | ✅ **Verified closed on `main` — no code.** Migration `20260608190000` + webhook extraction + `p_stripe_customer_id` RPC; 11 customer-id test assertions. The `paid-soft-launch-*` branches are **behind main** (only deletions), so nothing to merge from them. | `stripe-webhook/index.ts` + migration |
| **#1** Entitlement Pro-limit drift | ✅ **Decided + fixed for this release** (consistency fix, **PR #769**). | this doc + PR #769 |

**Release-owner decision (recorded):** **Pro = 2h/day, 50h/month for this release; DB `tier_configs` is the
source of truth; do NOT raise the DB to unlimited** — that is a separate post-release Product/pricing
decision. The #1 fix (PR #769) aligns the dead `subscriptionTiers.ts` constant (`Infinity` → `7200`),
corrects the "Want unlimited sessions?" upsell copy → "Need more recording time?", and adds an
entitlement-consistency guard test so config can't silently drift back to an "unlimited" claim.

---

## Finding 1 (decide): Pro tier daily/monthly limit — policy constant vs deployed DB

| Source | Pro daily | Pro monthly | Evidence |
|---|---|---|---|
| **Policy constant** `frontend/src/constants/subscriptionTiers.ts` | **`Infinity` (unlimited)** | (none) | `PRO: { dailySeconds: Infinity, … }` |
| **Deployed DB** `tier_configs` `pro` row | **7200s (2h)** | **180000s (50h)** | seeded by `backend/.../20260309000000_phase2_integration.sql` → `('pro', 7200, 180000, 3, …)` |

**What actually enforces / displays the limit (the live path):**
- Pre-session gate: `check-usage-limit` edge fn → `check_usage_limit()` RPC. Latest definition =
  `20260528183000_remove_free_to_basic_usage_mutation.sql` — reads `tier_configs` by tier with
  `COALESCE(…, 3600/90000)` fallback, **no Pro-unlimited special-case**.
- Record path: frontend `lib/storage.ts:161` → `create_session_and_update_usage()`. Latest definition =
  `20260522120000_drop_stale_session_rpc_overloads.sql` — also reads `tier_configs`
  (`WHERE tier_name = COALESCE(v_user_tier, 'basic')`).
- The earlier Pro-unlimited special-case (`restore_tier_limits` returning `remaining_seconds = -1`) was
  **superseded** by the above.
- The usage UI hook `useUsageLimit.ts` consumes the **DB response** (`daily_limit` / `remaining_seconds`
  / `limit_seconds`), i.e. it reflects the DB (7200), not the policy constant.

**Net effect:** **paying Pro users are actually capped at 2h/day, 50h/month** — they would hit
`daily_limit_reached` from the DB guard.

**Severity nuance (so this is not over-stated):**
- `subscriptionTiers.ts`'s `dailySeconds` (incl. `Pro: Infinity`) has **no consumers** in the frontend
  (no `getTierLimits().dailySeconds` reads) — it is effectively **dead config** for daily usage, so the
  drift is primarily a **source-of-truth / cleanliness** issue rather than a direct enforcement bug
  caused by that constant.
- BUT there is a marketing-copy implication: `AnalyticsDashboard.tsx:845` shows **"Want unlimited
  sessions?"** as an upsell — which implies Pro = unlimited and **contradicts** the 2h/day Pro cap.
  Whether that's shown to convert users to Pro should be checked for truthfulness.

### Decision options
1. **Pro should be UNLIMITED** (constant is right, DB row is stale). Fix: update the `tier_configs` `pro`
   row to an effectively-unlimited daily/monthly value (and confirm no live function re-caps it). This is
   a **paying-customer-impacting** correction — should land before/with paid launch.
2. **Pro should be 2h/day, 50h/month** (DB is right, constant is stale dead config). Fix: correct
   `subscriptionTiers.ts` `Pro.dailySeconds` to `7200` (monthly to match), and review the "unlimited
   sessions" upsell copy so marketing matches reality. Lower urgency (consistency + truthful copy).
3. **Record as evidence only** — release-owner decides later; no code change now.

> This is a **product/release-owner decision** (what *should* Pro's limit be) — Dev should not pick it
> unilaterally. Once chosen, the fix is small and Dev-ownable.

---

## Finding 2 (note): overlapping, repeatedly-redefined usage functions

`check_usage_limit`, `update_user_usage`, and `create_session_and_update_usage` are each
`CREATE OR REPLACE`-defined across **4+ migrations** (`usage_tier_refactor`, `restore_tier_limits`,
`fail_closed_usage_guards`, `remove_free_to_basic_usage_mutation`, `drop_stale_session_rpc_overloads`,
…). Effective behavior is "whichever migration defines it last," which is hard to reason about and a
maintainability/drift risk. Recommend a future consolidation pass (single canonical definition per
function) — not release-blocking.

---

## Verified OK

- **Fail-closed guards** (`20260325000000_fail_closed_usage_guards.sql`) return `success:false` for
  `profile_not_found` / `engine_not_allowed_for_tier` / `daily_limit_reached` / `monthly_limit_reached` /
  `invalid_duration` — i.e. usage checks fail closed, not open. Good.
- **#5 AI-suggestion server-side quota** — **complete**: `consume_ai_suggestion_quota()` (atomic
  `ON CONFLICT … WHERE count < limit`, RLS, `SECURITY DEFINER`, 20/day) + `get-ai-suggestions` edge fn
  enforces it (HTTP **429** on `allowed:false`; cached suggestions bypass the quota). Covered by the
  edge-fn test. No code needed.

## Open / needs-ops (not Dev-runnable here)
- Confirm the **live/prod** `tier_configs` rows equal the latest migration intent (a prod DB query) —
  this is the only part of "deployed matches policy" that can't be verified from source.
