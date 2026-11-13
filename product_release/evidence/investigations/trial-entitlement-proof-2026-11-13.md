# test: prove trial and paid entitlement boundaries

## Deliverable
Map and test current signup, full-feature one-month trial, expiry, paid subscription and explicit grant entitlement paths.

## Expected outcome
A valid trial retains full-feature access for its intended month, while expired or unauthorized access does not persist, and legitimate paid/grant access remains correct.

## Implementation and acceptance
Read exact effective function bodies, RLS, grants and Focus callers, inspect existing #1795 and #1817, reproduce surviving subscription-ID mutant with the loaded overload and raw results. Test trial and paid/grant states distinctly. Do not presume a subscription identifier is required during trial or impose constraints until model is verified. No production changes or live payments.

Status: draft scope only, no implementation or qualification claimed. Maintain one-writer boundaries; final code, tests, exact-head review and CI required before any merge. This document does not authorize a production action.

## Findings (Elon, 2026-11-13, read-only plus local PGlite)

1. **Canonical resolver.** `effective_subscription_tier` has two overloads in `20260812040000_thirty_day_trial_lifecycle_1282.sql`:
   - the 5-argument canonical one grants full access when status is `pro` AND the Stripe subscription id is non-blank (paid), or when the immutable commercial-grant marker AND an unexpired server window are present (trial);
   - the 4-argument legacy one fails trial closed.
   The trial never needs a Stripe id, so the intended one-month full-feature trial is preserved.
2. **Mutant E4 reproduced.** Removing the Stripe-id condition from the 5-argument overload left `trial-journey`, `runtime-cap` and `webhook-lifecycle` green (40/40). Only 5 DB test files load the real resolver; about 17 stub it.
3. **Not user-writable in the migration-defined state.** Since `20260522090000`, `user_profiles` has a SELECT-only policy, so clients cannot update their own `subscription_status`. That makes this an integrity rule that only server code can break. Production's live policies were not read here.
4. **Documented divergence, a product decision.** `has_objective_capability()` (Focus Points, `20260928120000`) grants on `subscription_status = 'pro'` with no Stripe id. Its comment says this intentionally includes comped/QA Pro. So a `pro` row without a Stripe id gets Focus Points but not paid practice. Whether comped Pro should get both, or neither, is the PO's call. This change does not alter it.

## Change in this PR

- `tests/db/trial-journey.integration.test.ts` adds 9 executed boundary rows: paid with Stripe; pro with a null, blank or legacy-only id; pro without Stripe but with an active trial; an active trial without Stripe; an expired trial; an unmarked future window; a Stripe id without pro status. Each asserts the resolved tier and the matching Private recording outcome.
- Kill check, with each mutant applied to the 5-argument overload and the migration restored byte-identical afterwards:
  - E4 (drop the Stripe-id requirement) fails 3 rows;
  - E1 (drop the grant-marker requirement) fails 2;
  - E2 (drop trial expiry) fails 6.
- No migration, constraint or product change.
