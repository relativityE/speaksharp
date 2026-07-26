**Owner:** [unassigned]
**Last Reviewed:** 2026-07-26
**Last Updated:** 2026-07-26

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

Repository automation can couple otherwise separate decisions. Every push to `main`
currently starts `deploy-edge-functions`. Before requesting or executing any merge,
inspect the PR's Edge-function diff and disclose this automatic production action:

- if Edge-function source changes, merge and production Edge deployment are inseparable;
  obtain explicit Product Owner authorization for both before merging;
- if Edge-function source is unchanged, disclose that the merge will still redeploy the
  unchanged functions and obtain acceptance of that no-op production action;
- do not interpret migration or frontend deployment as authorized by that decision.

## Work And Review Model

- Keep one active implementation PR at a time unless the Product Owner explicitly changes
  priority. An issue may span multiple PRs, but those PRs land sequentially rather than
  accumulating as parallel implementation branches.
- Use small, coherent PRs with one concern. Do not open scaffold or placeholder PRs.
- Implement the final approved direction; do not add temporary product states that create
  avoidable cleanup work.
- During development, run focused tests. At a completed checkpoint, reconcile the scope,
  run the appropriate full validation once, push one coherent checkpoint, and let CI run.
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
| `BASIC_TEST_EMAIL` / `BASIC_TEST_PASSWORD` | Reusable Free/Basic authentication and ordinary Free-path live checks |
| `PRO_TEST_EMAIL` / `PRO_TEST_PASSWORD` | Reusable Pro authentication, Cloud/Pro checks, and authenticated STT live checks |
| `CHECKOUT_TEST_EMAIL` / `CHECKOUT_TEST_PASSWORD` | Dedicated paid-checkout proof only; do not substitute a general account when clean checkout state matters |
| `SOAK_TEST_PASSWORD` with the soak registry | Stress/endurance workflows only; not the default account for feature verification |

`FREE_TEST_*` and legacy `E2E_*` names remain compatibility aliases in some scripts.
Current workflows commonly fall back from `FREE_TEST_*` to `BASIC_TEST_*`; inspect the
specific spec's resolution order instead of guessing. Do not report authenticated testing
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
- do not assume the Basic account has an unused Private sample or another clean state;
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

The maintained production proof for a Free user with an unused Private sample is
`tests/live/stt-switching-contract.live.spec.ts`. Its exact Free-path case creates and
seeds a new account using `SUPABASE_SERVICE_ROLE_KEY`; it must not use the shared Basic
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

A push to `main` currently triggers the normal `Deploy Supabase` Edge-function job.
Database migration application remains a separately confirmed manual workflow action.
The frontend may remain undeployed because Vercel can ignore a build. Never infer that
the migration or frontend deployed merely because a PR merged; inspect the job breakdown
and live release identity.

## Speech-To-Text Integrity

- One recording uses exactly one STT engine.
- Lock engine selection at Start intent and keep it locked through recording, stopping,
  processing, saving, retry, recovery, or confirmed discard.
- A selection change applies only to the next recording. Never silently fall back or
  hand off between engines during a recording.
- User-facing choices are `Private`, `Browser`, and `Cloud`; `native` remains an internal
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
