**Owner:** [unassigned]
**Last Reviewed:** 2026-08-19
**Last Updated:** 2026-08-19

# Working Instructions for SpeakSharp

This is the durable operating guide for anyone working in this repository: people,
coding agents, reviewers, test operators, and release operators. Keep it procedural.
Do not put changing release status, run IDs, or temporary plans here.

Instructions in a more deeply nested `AGENTS.md` override this file for that subtree.
Product Owner directions for the current task override repository defaults.

## Core Delivery Principle: Release And Iterate

SpeakSharp delivers through small, coherent, production-worthy increments. Release a
complete increment, verify it, learn from it, and then deliver the next increment.

An issue defines an outcome or body of work; it does not require one large PR. A broad
issue may be completed through multiple small, sequential PRs. Each PR must leave the
product in a coherent state and be independently reviewable, testable, releasable, and
verifiable.

Do not keep expanding an active PR to absorb every related discovery. Complete the
smallest safe increment, record remaining work against the parent issue, and address it
through the next scoped PR.

## Consult Repository Guidance Before Escalating

Before reporting a blocker or asking the Product Owner for repository, environment,
credential, CI, release, or deployment guidance:

1. Read this file and the applicable linked source-of-truth document.
2. Inspect the relevant code, script, and `.github/workflows/*.yml` file.
3. Search the repository with `rg` or `rg --files`.
4. Check GitHub state when the question concerns a PR, branch, workflow, secret name,
   variable name, deployment, or migration.

If the answer is still missing or contradictory, report exactly what was checked and
identify the unresolved gap. Do not declare a task blocked merely because a protected
value is unavailable locally; the intended execution environment may be GitHub Actions.
No ceremonial acknowledgement that this file was read is required.

## Authority And Current Truth

- [product_release/README.md](./product_release/README.md) is the documentation portal,
  precedence model, and canonical-document map. The 14-document consolidation is in
  progress; use the portal to resolve interim and final authorities.
- [product_release/RELEASE_STATUS.md](./product_release/RELEASE_STATUS.md) is the only
  authority for current release/deployment posture, blockers, baselines, and workflow
  evidence. Verify moving SHAs and live state; do not copy stale values into this file.
- [product_release/ENV_INVENTORY.md](./product_release/ENV_INVENTORY.md) is the authority
  for environment-variable names, storage homes, consumers, and scopes.
- [product_release/RC_GATES.md](./product_release/RC_GATES.md) defines release gates.
- [product_release/RC_TEST_INVENTORY.md](./product_release/RC_TEST_INVENTORY.md) defines
  which tests and workflows count as release evidence.
- [product_release/SOFT_RELEASE_TESTER_INSTRUCTIONS.md](./product_release/SOFT_RELEASE_TESTER_INSTRUCTIONS.md)
  owns current external tester instructions until the canonical tester guide replaces it.
- [product_release/OPS_HEALTH_DASHBOARD.md](./product_release/OPS_HEALTH_DASHBOARD.md)
  owns the current ops-health surface until operations documentation is consolidated.
- Historical reports, archived documents, and superseded PRs are evidence and provenance,
  not current product or release truth.

Tests are evidence, not truth. A green suite does not approve a code path that is wrong,
does not prove production behavior, and does not override product, security, privacy, or
data-integrity requirements.

## Product Owner Approval Boundaries

Do not perform any of these without explicit Product Owner authorization:

- merge a pull request;
- apply or repair a database migration;
- deploy the frontend or manually deploy production services;
- activate a feature, payment path, experiment, or tester cohort;
- invite testers;
- mutate production data or perform destructive production cleanup;
- change protected repository, environment, or branch-protection settings.

Treat merge, migration, deployment, activation, live proof, and tester invitations as
separate decisions. Read-only inspection and dry-run evidence do not authorize the
corresponding write.

Repository automation can couple otherwise separate decisions. A push to `main` that
changes `backend/supabase/functions/**`, `backend/supabase/config.toml`, or
`backend/supabase/import_map.json` starts the path-filtered
`deploy-supabase-edge-release.yml` caller. Before requesting or executing any merge,
inspect the PR's Edge-function/config diff and disclose the resulting production action:

- if an Edge trigger path changes, merge and production deployment of the workflow's full
  reviewed Edge Function list are inseparable; obtain explicit Product Owner authorization
  for both before merging;
- if no Edge trigger path changes, the path-filtered Edge caller does not run; still disclose
  the inspected scope and do not infer frontend or migration deployment from the merge;
- do not interpret migration or frontend deployment as authorized by that decision.

## Work And Review Model

### Exact-Artifact Development And Review Contract

The repository issue form, pull-request template, and `PR Evidence Contract` workflow
are mandatory controls, not optional documentation.

The lifecycle below is fixed. Every PR names its current phase and single next transition
in the `PR lifecycle gate`. Implemented, merged, deployed, and customer-proven are distinct
phases; never report a later phase's confidence from an earlier phase's evidence.

- Phase 0 — Governing issue defined: outcome, falsifiable acceptance criteria, risk, allowlist, authorization gates.
- Phase 1 — Draft PR linked; implementation in progress; evidence may be pending.
- Phase 2 — Review-ready: exact-head source + required CI green, evidence complete, pending `None.`, status `QUALIFIED`.
- Phase 3 — Under review; one consolidated PM/consultant return being resolved.
- Phase 4 — Merge authorized and merged to `main` (separate Product Owner authorization).
- Phase 5 — Production application/apply + readback (migration/deploy; separate authorization).
- Phase 6 — Deployed; release identity re-read from `window.__APP_RELEASE__` and matched to the intended SHA.
- Phase 7 — Real-device/customer acceptance proven; governing issue CLOSED.

Velocity rules: do not restate a moving SHA or run ID as if fixed; a claim binds only to the
pushed SHA it names. Do not write per-commit essays — post one blocker/authority note or one
complete review-ready return, not a narrative per push. One consolidated PM review resolves a
review-ready PR; the consultant is engaged only for security/privacy, qualification-void, or
product-contract escalation. A second failed return on the same increment forces regenerate or
rescope, not a third patch.

- Create the governing issue first. Open a linked Draft PR before substantive
  implementation and use `Refs #<issue>` for an increment or `Closes #<issue>` only
  for the final accepted increment. Do not implement issue-only work.
- Before reporting status or requesting review, re-read and report the exact local HEAD,
  remote PR head, current `origin/main`, worktree state, changed-file allowlist,
  relevant tool versions, and hashes for reviewed/generated artifacts. A claim applies
  only to the pushed SHA it names.
- Before browser, deployed, or real-device evidence, use a new context or reload with
  cache disabled; read `window.__APP_RELEASE__`; compare it with the intended deployed
  SHA; and verify the harness/selectors against that exact release. Missing or mismatched
  release identity makes the run `VOID`, never `PASS`.
- Use only these implementation/qualification states: `OPEN`,
  `IMPLEMENTED/NOT QUALIFIED`, `VOID`, `QUALIFIED`, and `BLOCKED`. Implemented,
  merged, deployed, and real-device-proven are separate states.
- Every new gate must include a durable negative or mutation test that deliberately
  breaks the protected condition and proves a nonzero result. A check shown only to pass
  is not yet trusted as a gate.
- Mocks, PGlite, source-text checks, local substitutes, screenshots, historical runs,
  and selected test subsets may diagnose. They cannot replace the authoritative
  PostgreSQL, PostgREST, pinned-toolchain, exact-head CI, deployed-browser, or real-device
  proof required by the acceptance contract.
- A review request must separate evidence completed from evidence pending and state
  limitations, dependencies, mutation evidence, and exact status. Required pending
  evidence must be `None.` and status must be `QUALIFIED` before requesting review.
- Never report uncommitted or unpushed work as delivered. Each pushed checkpoint report
  names its SHA, review focus, completed checks, pending checks, and limitations.
- Unrelated tooling or infrastructure discoveries are logged rather than fixed inline
  unless they can expose security/privacy, corrupt data, or create a false green on the
  active critical path.
- After two correction rounds on the same document, gate, packet, or evidence artifact,
  stop incremental patching and regenerate it from authoritative sources or rescope it.
- Consolidate Product Owner, PM, and consultant findings into one prioritized correction
  packet before Dev resumes. Security, privacy, and qualification-voiding findings may
  interrupt immediately; otherwise avoid competing incremental instructions.

- Keep one active implementation PR at a time unless the Product Owner explicitly changes
  priority. An issue may span multiple PRs, but those PRs land sequentially rather than
  accumulating as parallel implementation branches.
- Use small, coherent PRs with one concern. Do not open scaffold or placeholder PRs.
- Implement the final approved direction; do not add temporary product states that create
  avoidable cleanup work.
- During development, run focused tests. At a completed checkpoint, reconcile the scope,
  run risk-appropriate local validation once, push one coherent checkpoint, and let the
  required exact-head CI lane run. Reserve the full local suite for broad or high-risk
  checkpoints, or when the Product Owner explicitly requests it.
- Avoid CI runs, PR-body rewrites, and ledger edits after every micro-edit. Update them at
  checkpoint boundaries.
- Independently verify implementation claims against code and GitHub evidence.
- “Captured” is not implemented. “Superseded” is not completed. A requirement is complete
  only when it is shipped, explicitly queued, rejected by the Product Owner, or archived
  with provenance.

### Issue, PR, And Forward-Fix Model

- Treat an issue as the durable outcome or body of work, similar to an epic or delivery
  ticket. Treat each PR as one independently releasable increment against that issue.
- Scope a PR around one coherent user outcome or internal responsibility and its risk,
  not an arbitrary file count.
- Before implementation, identify the parent issue, the specific increment, its
  acceptance criteria, user/tester impact, and explicit out-of-scope work.
- Use `Refs #<issue>` for intermediate PRs. Use `Closes #<issue>` only for the final PR
  that satisfies the issue's remaining acceptance criteria.
- Keep the parent issue open while accepted work remains. At checkpoint boundaries,
  record what each merged increment shipped and what remains.
- Do not absorb adjacent findings into the active PR merely because they were discovered
  during implementation. Capture out-of-scope findings as successor issues or clearly
  defined next increments and address them after the active PR closes.
- If a broad PR begins to sprawl, stop at the nearest safe, coherent release boundary.
  Complete and verify that increment, then move the remaining work to subsequent PRs.
- Do not use a future PR to excuse a known defect that violates the active PR's existing
  acceptance criteria. Fix that defect before merging the active PR.
- Treat a merged PR as an immutable delivery checkpoint. Do not restore its automatically
  deleted branch, rewrite its history, or keep treating it as active work.
- If a defect is discovered after merge, create a narrowly scoped forward-fix issue and
  PR from current `main`. Link the fix to the originating PR and issue, verify it against
  the original failure, and release it independently before resuming the planned sequence.
- Do not revert a successfully merged PR merely because a later defect is found when a
  safe, narrow forward fix is available. A production rollback or revert is exceptional
  incident containment, used only when leaving the change live creates greater immediate
  risk and only with the required Product Owner authorization.

When reporting a review, lead with a plain disposition such as:

- `Approved.`
- `Not ready.`
- `Safe to merge, but not deploy.`
- `Background-only; testers will not notice.`
- `Tester-visible change.`

Then state code evidence, user/tester impact, remaining risk, and the next decision.

## Change Discipline

Follow this sequence:

1. Observe the failure or gap with code, logs, browser evidence, or a focused test.
2. Prove the responsible boundary before editing.
3. Fix the narrowest complete cause.
4. Confirm with the original reproduction and appropriate regression evidence.

Inspect `git status` and the branch before editing. The worktree may contain someone
else's work; preserve unrelated changes and never silently overwrite them. Use `rg` for
searches and `apply_patch` for manual edits.

Do not use destructive cleanup such as `git reset --hard`, broad `git checkout --`,
`git clean`, migration repair, or recovery scripts unless the exact destructive action
has been authorized. `pnpm reset:clean` is for local environment recovery only; inspect
its scope first. Avoid `pnpm reset:env` during active development because it can restore
files.

## Testing And CI

### Risk-Proportionate Evidence

Evidence applies to every implementation PR, but its depth must match the change's actual
risk. Collect the smallest reliable evidence set that proves the acceptance criteria and
protects the affected boundary.

For low-risk presentation changes—such as copy, labels, icons, badges, styling, layout,
responsive presentation, or accessibility semantics that do not change application state
or business behavior—normally require:

- focused component or unit tests for the changed surface;
- targeted accessibility assertions when semantics change;
- one affected browser/E2E path when interaction or rendering changes;
- desktop/mobile screenshots only when visual review materially helps;
- Treat screenshots created only for PR review as ephemeral evidence. Do not commit them to
  the repository unless the Product Owner explicitly approves them as durable documentation,
  test fixtures, or product assets. Upload review screenshots through the approved GitHub
  Actions artifact path with `retention-days: 1`, and record the workflow-run and artifact
  provenance.
- `pnpm quality` and the required exact-head merge-candidate CI lane.

Do not require production synthetic accounts, database queries, live-provider tests,
repeated screenshot sets, or a full local suite for low-risk presentation work unless the
change depends on a production-only condition or a specific discovered risk requires it.

For behavioral implementation changes—such as navigation, state transitions, save/retry
behavior, authenticated journeys, or user interactions—normally require focused tests at
the responsible boundary, one targeted integration or E2E path proving the complete user
outcome, regression coverage for the identified failure, `pnpm quality`, and the required
exact-head merge-candidate CI lane. Use live production proof only when the behavior cannot
be established faithfully in local or CI environments, or when a binding release contract
explicitly requires it.

High-risk changes—such as migrations, authentication, authorization, entitlements,
payments, production data, privacy boundaries, recording persistence, deployment
automation, or destructive cleanup—require evidence appropriate to that risk. This may
include real-database integration, failure-path coverage, idempotency and isolation
assertions, migration dry-runs, production-equivalent tests, or explicitly authorized live
proof.

Evidence sufficiency and stopping rules:

- Map each acceptance criterion to at least one meaningful assertion or review artifact.
- Prefer one strong end-to-end proof over several overlapping text-only checks.
- Do not add evidence merely because another test, screenshot, or live run is possible.
- Reuse still-valid evidence when later commits do not affect the behavior or visual output
  it proves; record the evidence's exact provenance. This general allowance does NOT relax the
  stricter release-candidate rule: for RC gate artifacts, apply the Artifact Freshness Rule in
  [product_release/RC_GATES.md](product_release/RC_GATES.md) — any change to a gate item's
  dependency surface makes its artifact stale, even a behavior-neutral one, and it must be rerun.
- After the acceptance criteria are proven, focused checks pass, required exact-head CI is
  green, and review threads are resolved, stop expanding the PR and return it for the
  Product Owner's decision.
- If review finds an in-scope correctness defect, group related corrections into one
  coherent batch when practical, then rerun affected evidence plus required CI.
- Capture unrelated findings as successor issues or PRs. Do not delay the active PR for
  unrelated proof or cleanup.
- Never describe a targeted diagnostic as a complete release gate, and never overstate
  what an evidence source proves.

Use repository package scripts instead of inventing alternate runners.

| Purpose | Command |
|---|---|
| Local development | `pnpm dev` |
| Complete static quality gate | `pnpm quality` |
| Focused unit test | `pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false <files>` |
| Unit suite | `pnpm test:unit` |
| Infrastructure confidence | `pnpm test` or `pnpm test:infra` |
| Full test suite | `pnpm test:full` |
| Full local CI parity | `pnpm ci:local` |
| Release-candidate gates | `pnpm rc:gates` |

`pnpm quality` is repository-wide: lint, TypeScript, and the banned
`eslint-disable` check. Do not substitute a curated changed-file lint and then claim the
complete quality gate passed.

CI has two PR modes:

- A narrow **Draft PR** may receive the affected-test `draft-checks` lane. This is fast
  development feedback, not merge authorization.
- A non-draft PR, a push to `main`, a migration/control-path change, or a
  `workflow_dispatch` with `force_full=true` receives the full merge-candidate lane.

Before merge, the required full-lane contexts must pass on the exact current PR head.
Skipped or absent required contexts are not green. If marking a Draft ready does not
start the full lane, dispatch it on the PR branch:

```bash
gh workflow run ci.yml --ref <branch> -f force_full=true
```

Inspect and watch the exact run:

```bash
gh run list --workflow=ci.yml --branch <branch>
gh run view <run-id> --json headSha,status,conclusion
gh run watch <run-id> --exit-status
```

GitHub Actions is authoritative for protected merge checks. Local results remain useful
development evidence. For release signoff, workflow evidence is valid only for the exact
SHA it tested. A later merge makes earlier signoff evidence historical.

If local browser proof reports `sandbox_eperm_preview_bind`, it is not release evidence.
Re-run from an environment that can launch the browser or use the approved GitHub
workflow.

## GitHub Actions, Variables, And Secrets

Protected CI/test credentials are intentionally consumed in GitHub-hosted Actions.
When a task requires them:

1. Inspect the applicable `.github/workflows/*.yml` and any package-script wrapper.
2. Confirm the required secret and variable **names** exist with `gh secret list` and
   `gh variable list`, or through GitHub repository metadata.
3. Run the existing approved workflow with `gh workflow run <workflow>.yml --ref <ref>`
   and the documented inputs.
4. Verify the run's `headSha`, steps, conclusion, summary, and artifacts.

Do not ask for, extract, print, download, or copy secret values into chat, commands,
commits, PR bodies, local `.env` files, logs, screenshots, or artifacts. Avoid shell
tracing and diagnostic commands that echo the environment. GitHub masking is a safeguard,
not permission to expose values.

Environment ownership is scoped, not universal:

- **GitHub Actions Secrets/Variables:** CI, test automation, deployment credentials, and
  explicitly documented synchronization inputs.
- **Vercel:** production frontend/build configuration.
- **Supabase:** production Edge runtime secrets and provider-managed production values.
- **Local gitignored `.env*`:** local development/test values only, as permitted by
  `ENV_INVENTORY.md`.

Do not assume a production runtime secret should be copied into GitHub. In particular,
the current deployment workflow intentionally does not synchronize live Stripe runtime
secrets from GitHub to Supabase. Follow `ENV_INVENTORY.md` and the workflow comments.

If GitHub access or a workflow is unavailable, confirm the repository documentation,
workflow filename, authentication state, and required secret/variable names before
escalating. Report names and availability only—never values.

## Reusable Test Accounts And Live Verification

SpeakSharp has reusable authenticated test accounts for production/live validation.
Anyone with repository Actions permission may use them through the approved GitHub
workflows without learning or copying their credential values.

| Account variables | Intended use |
|---|---|
| `FREE_TEST_EMAIL` / `FREE_TEST_PASSWORD` | Reusable Free authentication and ordinary Free-path live checks (SpeakSharp has no Basic product) |
| `PRO_TEST_EMAIL` / `PRO_TEST_PASSWORD` | Reusable Pro authentication and authenticated STT live checks |
| `CHECKOUT_TEST_EMAIL` / `CHECKOUT_TEST_PASSWORD` | Dedicated paid-checkout proof only; do not substitute a general account when clean checkout state matters |
| `SOAK_TEST_PASSWORD` with the soak registry | Stress/endurance workflows only; not the default account for feature verification |

`FREE_TEST_*` and legacy `E2E_FREE_*` names remain compatibility aliases in some scripts.
Workflows resolve `FREE_TEST_*` directly — the legacy `BASIC_TEST_*` fallback was retired in
#1294 (SpeakSharp has no Basic product); inspect the specific spec's resolution order instead of guessing. Do not report authenticated testing
as blocked merely because credentials are not present in the local shell or cannot be
revealed from GitHub Secrets.

Before declaring an authenticated or persisted-row proof unavailable:

1. Inspect the target test for its accepted account variables.
2. Check the applicable workflow for those variable/secret names.
3. Use `.github/workflows/rc-gates.yml` for a targeted live diagnostic or full release
   gate, or `.github/workflows/live-release-matrix.yml` for its maintained live suites.
4. Let GitHub Actions inject credentials and sign in through the test. Never print them or
   move them into chat/local files.
5. For scoped production-row verification, use an existing or narrowly targeted live test
   with `SUPABASE_SERVICE_ROLE_KEY` injected by GitHub Actions. A direct database password
   is not required for a row read available through the Supabase client/API. Query only
   marked synthetic identifiers and emit sanitized assertions, not row contents.

Use `pnpm verify:test-users` inside its credentialed workflow to confirm that configured
reviewer accounts exist and have the expected profile tier. If a maintained reusable
account fits the test, use it rather than creating another account.

Reusable accounts are shared fixtures:

- do not delete them, rotate their passwords, change durable entitlement/billing state,
  or consume one-time state unless the owning test explicitly restores it;
- do not assume a reusable account has a clean or unconsumed state;
- tests requiring fresh signup, unused sample, clean checkout, or another stateful
  precondition must use the dedicated account/workflow for that contract or a marked
  disposable synthetic account;
- account creation, entitlement mutation, forced-failure injection, and cleanup are
  production writes and still require the applicable Product Owner authorization;
- `.github/workflows/setup-test-users.yml` and `pnpm make:test-user <free|pro>` are the
  approved provisioning paths when a disposable account is authorized;
- live suites must own cleanup for disposable fixtures and prove no marked orphan remains.

Choose the account path from the test's state contract:

1. Reuse a maintained account only when the test needs ordinary authentication/tier state
   and does not consume or depend on one-time mutable state.
2. If the repository already has a live spec that creates its own synthetic account, use
   that spec through its GitHub workflow. Do not provision a second account first.
3. Use `.github/workflows/setup-test-users.yml` or
   `pnpm make:test-user <free|pro>` only when the target test expects supplied disposable
   credentials and no self-provisioning contract exists.
4. For fresh signup, unused sample, clean checkout, or similar one-time state, create a
   uniquely marked disposable account, seed the exact precondition, and remove only that
   run's fixtures.
5. Treat cleanup as proven only when a post-cleanup scoped query returns zero matching
   synthetic identifiers. `Promise.allSettled`, a cleanup attempt, or an overall green
   test does not by itself prove that no orphan remains.

The maintained production Free-path STT-switching proof is
`tests/live/stt-switching-contract.live.spec.ts`. Its Free-path case creates and seeds a
fresh account using `SUPABASE_SERVICE_ROLE_KEY`; it must not reuse a shared reviewer
account. Run the single case in GitHub Actions with:

```bash
gh workflow run rc-gates.yml \
  --ref main \
  -f gate=gate-3-dast \
  -f base_url=https://speaksharp-public.vercel.app \
  -f diagnostic_dast_spec=tests/live/stt-switching-contract.live.spec.ts \
  -f diagnostic_dast_grep='Free user with an UNUSED Private sample: Private enabled, Cloud disabled'
```

This diagnostic is evidence for that exact contract, not a full Gate 3 pass. Before
claiming the proof complete, verify the tested SHA, fixture creation, entitlement request
and assertion, and a zero-result post-cleanup query for the run-specific
`stt-switching-free-sample-*` marker. If the current spec only attempts deletion without
asserting the zero-result query, harden the test or use an approved scoped GitHub-hosted
cleanup-verification step; do not report cleanup as proven.

An inability to perform manual interactive login is not, by itself, a blocker when an
approved GitHub-hosted Playwright or API proof can exercise the same authenticated path.
State clearly whether evidence is manual-browser, automated-browser, API/database, or a
combination; do not present one as another.

## Pull Requests, Merge, And Branch Hygiene

`main` is branch-protected. No direct pushes and no admin bypass. Follow
[.agent/workflows/pr-merge-workflow.md](./.agent/workflows/pr-merge-workflow.md), with
these durable rules:

- branch from current `main`;
- keep the PR to one concern;
- squash-merge only after exact-head required checks pass and the Product Owner approves;
- land PRs serially and update a behind branch before merging it;
- automatic deletion of a successfully merged source branch is expected repository
  hygiene;
- do not restore a merged branch or disable delete-on-merge merely because GitHub removed
  it.

Before closing an **unmerged** superseded PR or deleting an unmerged branch, reconcile
its requirements to shipped work, an open successor, an explicit rejection, or an
archive. Preserve substantial unique code with immutable provenance when required.

A push to `main` that changes an Edge trigger path starts `Deploy Supabase Edge release`
and deploys the workflow's complete reviewed function list. Database migration application
remains a separately confirmed manual workflow action. A push without an Edge trigger path
does not start that caller. The frontend may remain undeployed because Vercel can ignore a
build. Never infer that Edge, migration, or frontend deployed merely because a PR merged;
inspect the changed paths, job breakdown, and live release identity.

## Speech-To-Text Integrity

- One recording uses exactly one STT engine.
- Lock engine selection at Start intent and keep it locked through recording, stopping,
  processing, saving, retry, recovery, or confirmed discard.
- A selection change applies only to the next recording. Never silently fall back or
  hand off between engines during a recording.
- Only user-facing STT is Private; `native` remains an internal
  engine token and must not be exposed as the product label.
- Cloud requires explicit user selection. Private must never silently fall back to Cloud
  because that changes privacy and cost.
- Private model download requires visible user intent and truthful readiness/progress.
- Only persisted `verified` attribution may support engine-specific analytics,
  benchmarks, or conclusions.
- A save failure must preserve recoverable work and an actionable retry. Attribution-only
  failure must not offer deletion of an already-saved transcript.

## Signals And Readiness

- Signals are observable outputs and must not change behavior.
- Flags are inputs/test controls and may change behavior.
- Selectors identify elements; they are not readiness proof.
- `data-app-ready` proves the React boot/render path. User-visible browser tests wait for
  `data-app-visible-ready` through the shared helper.
- Route tests wait for route-specific interactive controls when the journey needs them.
- Prefer the centralized E2E signal contract over one-off readiness probes.

## Documentation Changes

Use [product_release/README.md](./product_release/README.md) to find the authoritative
home; do not guess based on a familiar legacy filename.

- Current status, deployment identity, blockers, and run IDs belong only in
  `product_release/RELEASE_STATUS.md`.
- Stable product promises belong in the current product-requirements authority.
- Architecture invariants and ADRs belong in the current architecture authority.
- Environment and secret ownership belongs in `product_release/ENV_INVENTORY.md` until
  consolidated into `OPERATIONS_AND_SECURITY.md`.
- Temporary implementation plans belong in issues and PR descriptions, not permanent
  documentation.
- Archived and evidence documents retain provenance but must not be revived as current
  truth.

Update documentation only at a coherent checkpoint. When code and documentation
conflict, classify the conflict under the portal's precedence rules; do not silently
rewrite a binding product promise to match defective behavior.

## Blocker Report

When genuinely blocked, report:

1. Plain conclusion and user/tester impact.
2. Exact repository guidance, files, workflows, code paths, and GitHub state checked.
3. Evidence and the precise missing, denied, or contradictory item.
4. What remains safe to continue without additional authority.
5. Two or three options with consequences.
6. A recommended option.

Permission failures, protected environments, missing Product Owner authority, and
irreconcilable source-of-truth conflicts are stop conditions. Do not work around them.
