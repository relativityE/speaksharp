# RC test-account and canary closeout work packet

**Status:** Temporary implementation packet; remove this file before final review.
**Base:** `e58298f341a9e5dfe1ffbb9426dd27555b8cfca3`
**Authority:** Product Owner direction plus the canonical product/release documents linked below.
**No operational authorization:** This packet does not authorize a migration, account mutation, Stripe operation, deployment, activation, tag, or release.

## Product and account contract

- One Private Practice product.
- Complete product free for 30 days, then exactly $10/month for the same product.
- Active-trial and paid-continuation users have the same Private-only customer capabilities.
- No permanent Free/Basic product, Private sample, aggregate quota, Browser/Cloud entitlement, or customer Native entitlement.
- The 600-second per-recording technical cap remains.
- CI may verify account state but may never grant, extend, synthesize, or repair entitlement.

Canonical sources:
- `product_release/PRODUCT_REQUIREMENTS.md`
- `product_release/ENTITLEMENTS_AND_BILLING.md`
- `product_release/TESTER_OPERATIONS.md`
- `product_release/QUALITY.md`
- `product_release/RELEASE_PROCESS.md`

Archives are provenance, not current authority. Do not rewrite pinned archive/evidence files to make historical claims appear current.

## A. Purge BASIC_TEST from active repository authority

Remove every active reference to:
- `BASIC_TEST_EMAIL`
- `BASIC_TEST_PASSWORD`
- `E2E_BASIC_EMAIL`
- `E2E_BASIC_PASSWORD`

The initial exact-name audit found active references in:

- `.env.test.example`
- `.github/workflows/billing-freeze-check.yml`
- `.github/workflows/live-release-matrix.yml`
- `.github/workflows/rc-gates.yml`
- `.github/workflows/setup-test-users.yml`
- `AGENTS.md`
- `frontend/tests/integration/auth-real.spec.ts`
- `product_release/ENV_INVENTORY.md`
- `scripts/billing-freeze-check.mjs`
- `scripts/manual-stt-corpus-proof.mjs`
- `scripts/ops/reclassify-github-env.sh`
- `scripts/rc-dast-live-preflight.mjs`
- `scripts/sync-reviewer-test-users.mjs`
- `scripts/verify-test-users.mjs`
- `tests/config/testerEvidenceAudit.test.ts`
- `tests/live/auth.live.spec.ts`
- `tests/live/report-page-context.live.spec.ts`
- `tests/live/report-session-attribution.live.spec.ts`
- `tests/live/stale-chunk-preview.live.spec.ts`
- `tests/live/stripe-checkout-readiness.live.spec.ts`
- `tests/live/user-filler-words-persistence.live.spec.ts`

Do not merely rename a permanent Basic account to Free. Route each live/customer-contract test to an explicit account class:
- active-trial;
- genuine paid-continuation;
- expired;
- isolated test-mode checkout fixture;
- synthetic unit/E2E fixture.

Add a fail-closed repository guard for the retired exact names across active source, workflows, config examples, tests, `AGENTS.md`, and active `product_release` Markdown. Exclude pinned `product_release/archive/**` and dated `product_release/evidence/**` only as explicitly enumerated provenance; no active workflow may consume an archive claim.

## B. Robust Test User Admin credential creation for canaries

Keep the existing Test User Admin workflow and its current `action=create` seam. Do not create a second provisioning system. Preserve existing standard Free/Pro/soak behavior unless a specific retired Basic reference is removed elsewhere in this PR.

### Canonical GitHub Secret pairs

- `CANARY_TRIAL_EMAIL` = a valid, operator-controlled and recoverable email address
- `CANARY_TRIAL_PASSWORD` = that account's protected password
- `CANARY_PAID_EMAIL` = a different valid, operator-controlled and recoverable email address
- `CANARY_PAID_PASSWORD` = that account's protected password

All four values are GitHub Secrets. Never hard-code, commit, print, or pass the canary passwords through workflow-dispatch text inputs.

### Extend the existing create action

Add a `create_purpose` choice to the current `action=create` path:

- `standard` — preserves the existing email/password/tier behavior for current test users;
- `canary_trial` — resolves email/password from `CANARY_TRIAL_EMAIL` / `CANARY_TRIAL_PASSWORD`;
- `canary_paid` — resolves email/password from `CANARY_PAID_EMAIL` / `CANARY_PAID_PASSWORD`.

For the two canary purposes:

1. Resolve the chosen secret pair only at runtime.
2. Validate nonblank email/password, valid email syntax, controlled/recoverable operator attestation, and reject the unaffiliated exact/subdomain `speaksharp.app`.
3. Ensure trial and paid canary email values are different.
4. Mask identity output and never log password content.
5. Query Supabase Auth by normalized email.
6. If absent, create the confirmed auth user with the supplied email/password.
7. If present, reuse it only when the canonical profile and intended purpose are safe; report a masked `REUSED` result. Never create a duplicate.
8. Do not silently reset an existing password. Password reset/rotation remains an explicit separately authorized Test User Admin operation.
9. Do not route a canary purpose through `buildProfilePatchForTier('pro')`, generate `sub_test_*`, or write trial/paid entitlement fields.
10. Rely on the accepted new-account database foundation to create the canonical profile and immutable trial fields; read them back and fail closed if foundation state is missing or ambiguous.
11. For `canary_trial`, require a currently active server-time trial and prove reuse does not alter its window.
12. For `canary_paid`, Test User Admin creates/reuses credentials only. Genuine paid state is established separately through the authorized Stripe customer/subscription/exact-$10-price/database binding path.
13. Emit only `CREATED | REUSED | BLOCKED`, masked identity, purpose, and content-free verification facts.

This keeps Test User Admin as the single account credential creator: the operator supplies the email/password pair, and the existing create seam creates or safely reuses the account.

### Canary consumption

- Canary execution remains read-only with respect to credentials and entitlement.
- Update the existing paid canary to consume `CANARY_PAID_PASSWORD`.
- Retire legacy `CANARY_PASSWORD` only after the new secret is configured and both lanes are proven.
- The lifecycle-aware read-only verifier must prove immutable active trial and genuine Stripe-authoritative paid continuation; a raw `subscription_status` label is insufficient.

## C. Migration readiness and ordered production prerequisites

`20260812041500_flawless_launch_runtime_convergence_1290.sql` is unapplied because:
- it entered `main` only with PR #1290;
- #1290 merge authorization explicitly excluded migration application;
- migration application requires separate Product Owner authorization; and
- the checked-in exact gate requires all prior staged migrations before selecting `41500`.

The ordered staged set is:

1. `20260811143000_harden_exposed_security_definer_acl.sql`
2. `20260812030000_progress_cohort_mode_separation_1265.sql`
3. `20260812039500_webhook_duplicate_snapshot_convergence_1282.sql`
4. `20260812040000_thirty_day_trial_lifecycle_1282.sql`
5. `20260812041000_trial_expiry_fail_closed_1282.sql`
6. `20260812041500_flawless_launch_runtime_convergence_1290.sql`

`20260812002000_webhook_lifecycle_completeness_1282.sql` is already applied.

Keep `20260812042000_trial_activation_stamp_1282.sql` held. It is a separate commercial-activation operation.

Fix canary readiness so it verifies the complete required staged set and exact migration history, not merely the presence of `41500`. Any missing predecessor must produce explicit HOLD and no product qualification.

No migration is applied by this PR.

## D. Canary execution and qualification

After separately authorized migrations and account preparation:

- Primary lane: real active 30-day trial, Private-only.
- Secondary lane: genuine Stripe-backed paid continuation at exactly $10/month, Private-only.
- Both lanes prove deployed SHA equality, sign-in, authoritative entitlement readback, setup/start, transcript, save, exact-session reopen, Progress/analysis, and appropriate retained permissions.
- CI cannot create, grant, extend, bind, repair, or rotate either account.
- Missing secrets, invalid account state, migration drift, deploy-SHA mismatch, or product failure is a failure/HOLD with zero claimed product evidence.
- A workflow-level success caused by intentional precondition HOLD must not be described as a green product canary.

Repair the Edge hosted-readback dependency condition found after #1290: required hosted verification must run after an authorized Edge deployment even when an unrelated upstream job is intentionally skipped. Add a regression contract for the job condition.

## E. Documentation reconciliation

Update active operational authority only:
- `AGENTS.md`
- canonical `product_release/OPERATIONS_AND_SECURITY.md`
- canonical `product_release/TESTER_OPERATIONS.md`
- canonical `product_release/QUALITY.md` / `RELEASE_PROCESS.md` where account/gate behavior changes
- `product_release/RELEASE_STATUS.md`, because it is the current-posture SSOT and still carries retired Free/Browser/Cloud/sample claims
- interim `product_release/ENV_INVENTORY.md` while it remains active

Do not rewrite pinned archive or dated evidence. Enumerate stale historical Basic/Free/Pro claims as provenance and ensure their non-authoritative classification is explicit. Remove or correct stale active-root claims; do not let an interim superseded document remain usable as current authority. Final root-document archival/canonical closeout remains #1272.

## Closure evidence

The final exact head must include:

1. Zero active references to `BASIC_TEST_*` and `E2E_BASIC_*`.
2. No permanent-Free/Basic semantics introduced as replacements.
3. Source tests proving symmetric trial/paid canary secret pairs and rejection of missing/equal/uncontrolled identities.
4. Read-only lifecycle verifier proofs for active trial, expired trial, genuine paid continuation, wrong price, mismatched customer/subscription, synthetic binding, and ambiguous state.
5. Exact migration-readiness proofs for every predecessor missing individually, all staged migrations present, drift/remote-only/malformed history, and activation still held.
6. Workflow contract showing scheduled/push canary CI never mutates entitlement or credentials, and Test User Admin mutates credentials only under an explicit manual authorization path.
7. Hosted Edge readback job-condition regression proof.
8. Focused workflow/script tests, documentation contract, full unit/E2E, typecheck, lint, build, Edge tests, PG 15/16/17 where database contracts change, CI, U3, SCA, and zero-reference terminal green.
9. After separately authorized operations, both deployed product lanes green on the same integrated merge SHA.
10. PR body closure matrix mapping every item above to source and exact-head evidence.

## Authorization boundary

Dev may implement, test, push coherent heads, update this PR, and request PM review.

Without separate Product Owner authorization, Dev must not merge, deploy, apply migrations, create/reset canary accounts, mutate Stripe, activate the commercial trial, change secrets/configuration, tag, close issues/PRs, or delete branches.
