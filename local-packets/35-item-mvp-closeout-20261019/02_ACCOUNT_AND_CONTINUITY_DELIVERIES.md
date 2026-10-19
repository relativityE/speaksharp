# Surviving MVP deliveries: account exit and same-target continuity

Browser PM → Sam (central PM), @relativityE; CLI Dev accountable implementation, App Dev owns Session/shared product lifecycle. Main c9d46b2d; no shared code edits.

## Subtract delivered source before selecting more work

- **#1611 merged52623c6bc6f065fdf43633ed99d48b7b643e63e6**: disabled backend stage, verification/billing/unknown-Auth recovery/residue/invalidation tooling. Reuse it; do not replay the old full backend or call it a usable customer deletion flow. Its historical global-drain wording is superseded as product policy by6251767298, not silently removed from actual implementation guards.
- **#1636 mergedea4564a73cd72c43a477d7f30760a8d3fba410c3**: persisted metric/direction/target/units beside repeat outcome, independent of saved AI advice. This is the narrow1621 increment already delivered, not the whole1548 canonical-content contract. Do not restore1621 or repeat that implementation.
- **#1658 d77ef78f** remains unmerged, inactive pending-before-checkout settlement slice. It returns202 pending and never enters destructive adapters. Until schema/runtime prerequisites exist, structured503/no-store is intentional fail-closed behavior. Its source acceptance and historical43SQL/request+34Deno/23step author evidence do not complete customer exit.
- **UI/status6fb19b9c8105e761529790241ac80ed4ca2b64b7** is accepted retained preparation: pending hydration, immutable account/request, generation/deadline fences and no automatic confirmation replay/reopening/sign-out. Its README explicitly says App route, startup token capture and pricing entry are not wired. Author80-test/quality evidence is retained, not PM-rerun.
- **Admission558b53feb5ea954d72f4c5fb7cacab40ab0e2545 /7e9f84cfb893e836294fcac051e66cab9fe2e3c6** is retained source, not current-main/hosted proof. Actual migration source wraps lease acquisition with profile→account-billing→recording lock order, rejects pending/closing new admission and revokes bypass writes; same accepted lease heartbeat/Stop/completion stays unchanged. The17native race/settlement controls are author evidence; PM read source and handoff, did not rerun native PostgreSQL.

## #1643: smallest receiving slices, in existing ownership

| Delivery | Exact receiving surfaces | Observable completion and regressions | Remaining boundary |
|---|---|---|---|
| A. Integrate inactive pending/billing foundation |1658 account-closure/stripe-webhook and migration20261018170000|Explicit verified confirmation records pending before waiting; lost reply recovers owner status; accepted checkout settles; no destructive transition or blind retry|Current-main exact source/CI; separate migration apply/runtime binding and ten-function coupled deployment authority|
| B. Account admission plus accepted-work settlement |Retained recording admission migration20261019055102; existing Start/create-session/lease, coaching, portal, checkout and background admission seams|A pending blocks new account work while accepted saves/coaching/billing can finish; B continues; concurrent pending/admission both lock orders; forced/same-ID/old-client bypass negatives; no indefinite unknown treated settled|Lease slice is not all per-work admission or settlement. Reuse existing recording source; do not rebuild it. Hosted/complete-chain/provider evidence separate|
| C. Customer route/verification/status plus App departure |Retained AccountDeletionPage/verification/attempt guard; App.tsx/main.tsx/PricingPage wiring; Session lifecycle departure|Navigation starts no new STT/LLM; verification is account-bound; visit/email alone never pending; explicit confirm→pending; remount/account-switch/late reply cannot erase known request; accepted work retires safely; timeout is not permission to replay|App owns lifecycle/routing conflict handoff; CLI owns account UI/service. No parallel edits inferred. Source route registration is not feature activation authority|
| D. Settlement-to-final deletion and verification |Existing closure attempt journal, billing fences, DB/storage/Auth executor/readback|Only proven account-scoped terminal settlement permits deletion. Lost/unknown Auth/provider outcomes stay journaled/pending; exact operation recovery; final residue/sign-in result verified. Cancellation remains distinct|Explicit separately authorized destructive/provider tests and runtime/schema/config prerequisite; no live operation in this package|

The next existing implementation lane should receive A and then the smallest complete B/C increment approved by Sam; do not create four concurrent PRs or claim these are four new assigned writers. CLI returns the exact chosen path manifest including unpublished edits before App touches shared lifecycle files.

## Designer conflicts: policy disposition, not silent implementation

The controlling [PO-confirmed policy6251767298](https://github.com/relativityE/speaksharp/issues/1643#issuecomment-6251767298) is account-scoped: durable confirmed pending, no new admission, finish/reconcile accepted work, delete only after settlement and verify DB/storage/Auth. Ordinary deletion has no global-worker shutdown requirement.

1. **“Deleted” at request acceptance: RETURN/conflicts with the settled policy.**202 pending proves accepted intent, not final deletion. Existing6fb already preserves pending/no sign-out. Keep the designer package unchanged as design provenance; explicitly annotate this disagreement for PO/design reconciliation. Do not weaken final settlement to match the image.
2. **Timeout deletion while accepted work remains: RETURN/conflicts with the settled policy.**A timeout establishes unknown, not completion, cancellation or destructive authority. Keep pending/recovery and preserve accepted operations. If the designer intends to change that policy, Sam/PO must decide explicitly; no implementation choice here overrides6251767298.

Still PO/provider-specific: final destructive launch scope, actual hosted portal behavior, entitlement period-end/reversal only if offered, precise erasure promises/SLA and any newly proposed data/target retention. Cancellation stops future renewal while preserving account/login/history and verified remaining access; it neither implies deletion nor authorizes refunds/invented dates. A normal RWT human session cannot close these provider/destructive outcomes.

## #1548: canonical target is still different from a metric label

Actual current source paths:

- Session `AISuggestions.tsx` and shared `PracticeLoopReviewPair.tsx` render persisted1+1 advice.
- Home `AuthenticatedHome.tsx`/`lastSessionFix.ts` read that saved `what_to_try_next` verbatim, with no new persistence.
- Saved Progress `SavedPracticeLoopReview.tsx`/`loadSessionProgress.ts` and `useLinkedRepeat.ts` select a stored recommendation/attempt and its metric target. `openAttempt.ts`/`recordProgress.ts` preserve the recommendation/attempt identity.
- The strict `nextActionSignal.ts` is enum/numeric, not a free-form content-target evaluator. No arbitrary derived private advice may be persisted through it.

**Executed current-main regression:**the existing34 linked-repeat controls pass inside the136-test surface batch. Their deliberate example displays AI advice **“Name the price first”** beside a stored **7% filler target**; the actual linked action records the metric recommendation and the result truthfully describes that stored target. That protects attribution, but it **does not implement one canonical AI-content target through repeat or measure following the content advice**. This is existing accepted scope evidence, not a newly discovered wrong-metric computation.

Smallest surviving CLI receiving outcome: select one authoritative target/criterion from the existing agreed1548 contract, bind its immutable source/recommendation/attempt identity through Session→Home→saved Progress→repeat, preserve it on reload/supersession/failed reads, and report only an outcome supported by that criterion. Reuse the existing single action, cached advice, linked-repeat transaction and measured-label source; do not broad-restack1548, add competing actions or infer content improvement from unrelated metrics.

Minimum regressions for the receiving manifest: (1) same target/identity on all four surfaces; (2) unrelated AI advice versus stored metric is explicitly distinct and never credited as semantic improvement; (3) prior target A cannot acquire later target B's result after reload/account/session change; (4) pending/error cannot navigate unlinked; (5) criterion unavailable/not comparable remains honest; (6) one action/one accepted attempt, no new content persistence without reviewed privacy/schema contract. Existing1636 positives stay credited.

**Decision-needed, not an invented feature:**the original canonical AI-content requirement cannot be silently replaced with “metric labels are honest.”Sam/PO must select the bounded content criterion/authority and any retention/assessment change not already approved. No new semantic model, provider spend, word-count rejection, truncation policy, study threshold or broader personalized UX is commissioned by this handoff. Until a selected implementation is integrated and observed,1548 remains OPEN/HOLD for its surviving contract.
