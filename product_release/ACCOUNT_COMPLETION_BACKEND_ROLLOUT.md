# Account-deletion completion backend rollout

**Deliverable:** A decision-ready rollout plan for migration 129 and the `account-closure` Edge bundle. This document doesn't change executable code or grant authority to apply, deploy, activate, or delete.

**Expected outcome:** Verify the exact database and Edge changes with completion **OFF and unbound**. Customer completion remains **HOLD** until separately approved proof on a disposable account. This plan is independent of the frontend-only J1 → J3.b → J7.c release.

## Source, contract and evidence

- [PR #1740](https://github.com/relativityE/speaksharp/pull/1740) merged the backend implementation. The migration file is `backend/supabase/migrations/20261027192550_account_completion_billing_settlement.sql` (SQL SHA-256 `398aa50b8db168acc0cee68a11a433b40bd3101af03e3051dcdc2c87b2bef45d` at the scoped source). It adds a single privileged function, `settle_account_completion_billing_v1(uuid,uuid,uuid,text,jsonb)`, with empty search path and execute restricted to `service_role`. The transaction requires the completion configuration to be disabled with no bound scope. Settlement binds the owner, request, execution, scope and billing customer, consumes the recorded settlement intent and checks resulting billing records before accepting completion.
- The Edge boundary is `backend/supabase/functions/account-closure/index.ts` plus its reviewed shared imports and deployment configuration. Pin the complete bundle manifest and digest in the successor. Preserve the existing request/status contract, keys and copy. No Stripe webhook, Portal, checkout or other Edge publication is in scope.
- [Issue #1643](https://github.com/relativityE/speaksharp/issues/1643) owns the historical account-exit requirements: account-owned confirmation and pending state, verified drain and billing obligations, verified deletion, and no effect on unrelated accounts. Administrative closure does not qualify these outcomes.
- The [historical rollout](https://github.com/relativityE/speaksharp/actions/runs/40623613966) failed at the read-only prerequisite. Invalidation, database apply, Edge deployment and verification were skipped. The [release ledger](https://github.com/relativityE/speaksharp/blob/50bfe1b0/product_release/RELEASE_STATUS.md#L764-L771) records completion OFF and migration 129 absent as a dated observation. Do not substitute it for current production evidence.

## Why the existing workflows are not the rollout

1. Exact apply does not allowlist 129, and the [current Edge catalog check](https://github.com/relativityE/speaksharp/blob/50bfe1b0/scripts/lib/t2MigrationPostflight.mjs#L558-L575) requires it absent. Do not apply first, change migration history by hand, or bypass the check.
2. The [current Edge workflow](https://github.com/relativityE/speaksharp/blob/50bfe1b0/.github/workflows/deploy-supabase-migrations.yml#L162-L238) invalidates authority (a production generation write) and publishes ten functions. It cannot prove a single-function rollout. A broad backend release would require its own scope, impact analysis and approval.
3. The frontend does not establish completion readiness. A successful generic status read does not prove an owner- and request-bound authorization to delete.

## Recommended sequence and stop rules

1. **Document and review.** Approve only this plan or return findings. Nothing executes.
2. **Build and qualify the narrow successor.** In a separate code PR for review/CI, pin the exact approved migration and applied migration ledger including already-installed later migrations. Build an explicit pre-/post-129 release contract and an account-closure-only publish-and-verify path. Do not introduce a generic bypass, broad migration push, wider grant, or unrelated Edge deployment.
3. **Rehearse and preflight.** In disposable native Postgres 17, reconstruct the verified production ledger, insert just the reviewed migration, and prove the catalog/grant delta exactly. Test a missing or unexpected migration, stale or wrong-owner readiness, role-denied RPC access, a ledger/catalog/hash mismatch and a deployment plan containing an extra function. Confirm the release path refuses each before mutation. Before seeking production approval, use read-only checks on the verified production project to confirm actual ledger, catalog, function version, effective grants, generation and disabled/unbound state; do not expose account IDs or credentials. Stop for any discrepancy.
4. **Apply 129 with separate approval.** Only after the successor is qualified and the exact production snapshot matches. Postflight must show only the expected ledger entry and restricted RPC and completion still OFF and unbound. Stop if postflight fails or any other state changed.
5. **Publish only account-closure with separate approval.** Recheck step 4 and the exact bundle and approved authority boundary. If invalidation is required, identify its effect, target and generation change before approval. Verify the deployed version and full reviewed bundle identity, no changes to other function versions, and completion still OFF and unbound. Reconcile any partial failure before considering a repeat.
6. **Treat activation and acceptance as another decision.** Review frontend readiness for both the trial-wall and Account entry. Keep it fail closed without the verified backend and fresh owner/request binding. Separately scope and approve any narrowly fenced disposable unpaid-account demonstration of J1.f/J7.d: prove final Auth/account absence, counted residue and no Stripe effects on unrelated or paid accounts. Record the end state before considering any customer exposure. A hosted-disabled deployment is not a journey pass.

Alternative: stop after steps 1–3 for review/CI proof only and leave both journey rows on HOLD. Do not use a broad release or an early activation to shortcut the sequence.

## Risks and rollback boundary

- An out-of-order or misidentified migration can block Edge releases or change unexpected permissions. An overbroad or partial Edge release can affect billing and other functions. Require exact identities, receipts and abort on mismatch.
- Once enabled, the completion worker may delete Auth and owned data and may cancel or delete Stripe objects for a paid account. Disablement can block fresh authorizations, not undo effects already started or committed. Fence/drain and reconcile in-flight work; do not blindly retry an unknown outcome.
- Before any production apply or upload, require an independently reviewed compatible recovery path and a captured previous bundle. A previous bundle is not safe to restore until compatibility is proven. Prefer a reviewed forward repair for schema issues; no unreviewed down migration or ledger edits. Database backup and point-in-time recovery have separate recovery costs and [do not restore underlying Storage objects](https://supabase.com/docs/guides/platform/backups).
- If stages 4 or 5 pass, attach exact release and receipt links. Keep activation, customer deletion, Stripe actions and further deployment out of this PR.
