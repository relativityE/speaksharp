**Owner:** [unassigned]
**Last Updated:** 2026-06-15

# PR & Merge Workflow — landing a change on `main`

Durable procedure for getting any change (code, tests, or docs) from a local edit onto `main`.
`main` is **branch-protected**: there are **no direct pushes**, and a change lands **only** through a
pull request whose **required CI checks pass**. This applies to Dev, Test, and humans alike.

> Source of truth for gate health is **GitHub CI**, not local runs. See "Source of truth" below.

## TL;DR
branch → commit → push → open PR → watch CI green → squash-merge → (if it touches the live DAST gate) re-run `rc-gates` on `main`.

## Steps

1. **Branch off the latest `main`:**
   ```bash
   git checkout main && git pull --ff-only
   git checkout -b <type>/<short-name>      # fix/… test/… docs/… ci/…
   ```
2. **Make the change + verify locally** (lint / typecheck / the relevant unit or e2e tests). Keep the branch to **one concern**.
3. **Commit** (agents end the message with the `Co-Authored-By` trailer):
   ```bash
   git add <files> && git commit -m "<type>: …"
   ```
4. **Push the branch** — this is what puts it on GitHub:
   ```bash
   git push -u origin <type>/<short-name>
   ```
5. **Open the PR** against `main` — this is what GitHub recognizes as a mergeable change:
   ```bash
   gh pr create --base main --head <type>/<short-name> --title "…" --body-file <file>
   ```
   A PR = a pushed branch + a pull request opened against `main`. Nothing else is required.
6. **CI runs automatically** on the PR (the push triggers `ci.yml`). Required checks (branch protection): `build`, `edge-tests`, `unit-shard-1..4`, `e2e-shard-1..4`.
7. **Watch CI to green:**
   ```bash
   gh pr checks <PR#> --watch --interval 30
   ```
   On red: `gh pr checks <PR#>` → open the failing job's log → fix on the same branch (pushing again re-runs CI).
8. **Merge — only after green, and run the guard from the authorized base, never the PR checkout.**
   The privileged token must not be exposed to candidate-controlled package scripts, hooks, loaders, or
   executables. Create a clean detached worktree at the exact authorized base SHA and run that trusted
   base's guard directly:
   ```bash
   AUTHORIZED_BASE_SHA=<exact-base-sha>
   TRUSTED_MERGE_ROOT=$(mktemp -d)
   NODE_BIN=$(command -v node)
   GH_BIN=$(command -v gh)
   git fetch origin "$AUTHORIZED_BASE_SHA"
   git worktree add --detach "$TRUSTED_MERGE_ROOT" "$AUTHORIZED_BASE_SHA"
   test "$(git -C "$TRUSTED_MERGE_ROOT" rev-parse HEAD)" = "$AUTHORIZED_BASE_SHA"
   test -z "$(git -C "$TRUSTED_MERGE_ROOT" status --porcelain)"
   (
     cd "$TRUSTED_MERGE_ROOT"
     env -u NODE_OPTIONS -u NODE_PATH \
       GITHUB_TOKEN="$GH_TOKEN" GUARDED_MERGE_GH_BIN="$GH_BIN" \
       "$NODE_BIN" scripts/pre-merge-gate.mjs \
       --repo=relativityE/speaksharp --pr=<PR#> --sha=<exact-head-sha> \
       --base-sha="$AUTHORIZED_BASE_SHA" \
       --receipt=<absolute-review-qualification.json-from-the-green-run>
   )
   git worktree remove "$TRUSTED_MERGE_ROOT"
   ```
   GitHub emits no workflow event when a review thread is
   resolved or unresolved, so a green `review-qualification` check stays green after a P0/P1 thread is
   reopened — nothing re-runs and nothing revalidates. The base-pinned guard is the normal merge path:
   immediately before merging it re-reads live thread state over GraphQL, revalidates
   the age of the green run's receipt, and refuses on a reopened thread, a stale or undated receipt, an
   unreadable read, a head or base that moved since authorization, a pull request in another repository, or a `main` whose "require branches to be up to date" protection is not readable and enforced for admins (GitHub then also rejects an out-of-date head at merge time). On a hold it exits non-zero having called
   nothing. The one-time #1430 bootstrap is the sole exception because its authorized base predates the
   guard: after exact-head/base/bootstrap PO authorization, Dev runs the trusted installed `gh` binary
   from a neutral temporary directory with explicit `--repo` and `--match-head-commit`, executes no
   candidate repository code with the token, and stops if GitHub's server-side protection refuses.
9. **Strict mode / serial landing:** every merge advances `main`, so any other open PR goes **BEHIND**. Bring it current first (this re-runs its CI), then merge — land PRs one at a time:
   ```bash
   gh pr update-branch <PR#>   # then re-watch checks, then merge
   ```
10. **If the change touches the live DAST gate (Gate 3)**, confirm on `main` afterward — `rc-gates` is **manual** (`workflow_dispatch`):
    ```bash
    gh workflow run rc-gates.yml --ref main
    gh run list --workflow=rc-gates.yml --branch main -L 1   # copy the run id
    gh run watch <run-id> --exit-status                       # expect all 5 gates green
    ```

## Roles
- **Dev** — authors the change, opens the PR, watches CI, and **merges** after green.
- **Test** — **watches** the PR's CI and the `rc-gates` run and reports green/red on `/private/tmp/ACTIVE_COORDINATION.md` (`RC-*` tags). **Test does not merge.**
- **Release-owner** — owns branch-protection settings and approves outward steps (e.g. live launch).

## Source of truth (read this before reporting a "failure")
- **GitHub CI is authoritative.** Always validate against a run whose `headSha` equals the current `main` HEAD: `gh run view <id> --json headSha` and compare to `git ls-remote origin main`. Reporting an **old** run's failures (a pre-fix SHA) is the #1 source of confusion.
- **A local `pnpm rc:gates` failure is NOT a gate failure.** Local can't fully run: Gate 3 (`rc:dast:live`) needs live credentials + the deployed app, and the impact-detection step can hit local tooling limits (e.g. `execSync` ENOBUFS on large output). The real result is `rc-gates.yml` on `main`.
- **"2 skipped" in a run** = environment-gated `test.skip(...)` (Pro creds / feature flags) — expected, not a failure.

## Final-SHA gate freshness (release signoff)
- **Every merge to `main` resets the signoff clock.** A passing RC-gate / CI run is *final-signoff* evidence only for the exact `headSha` it ran on. The moment any PR merges, `main` HEAD advances and that prior pass becomes **stale for final signoff** (it remains valid *historical* evidence). A code-readiness review ("approve with non-blocking follow-ups") clears **source posture only** — it never clears operational gates.
- **Before tester invites / final signoff:** finish all intended merges first, confirm the final signoff SHA, then re-dispatch `rc-gates.yml` (`gate=all`) **once** on that exact SHA and confirm green. Do not run final gates while merges are still pending — every merge invalidates the prior run.
- **Reviewer escalation:** if `rc-gates` is green on the final SHA, no extra reviewers are needed. If **Gate 3 (live-DAST)** fails again, assign a focused **Runtime/Test-Gate** reviewer for that gate — do **not** restart a broad/general release review.

## Test-agent environment self-check
The Test agent's sandbox can regress (no GitHub/npm network, invalid `gh` token, Playwright can't launch). When it does, Test **cannot** own GitHub/CI/RC-gate/STT-proof work — Dev covers it until the env returns.
- **Run at every session start:** `bash scripts/test-env-selfcheck.sh` (checks github/npm reachability, `gh` auth, gh-Actions read, `.git` writable, Playwright launch).
- **VERDICT ENV GREEN** → post `TEST resuming (env green <date>)` on `/private/tmp/ACTIVE_COORDINATION.md` and resume ownership.
- **VERDICT ENV BLOCKED** → post the FAIL line(s) + date there; Dev keeps GitHub/CI/RC ownership meanwhile.
- Reminder: live-DAST (Gate 3) and the cloud `rc-gates.yml` dispatch both need a green env; a blocked sandbox is an env problem, not a gate failure.

## Hard rules
- No direct pushes to `main`; no merging a PR with red or pending required checks (enforce-admins is ON — no admin bypass).
- One concern per PR; do not bundle unrelated code/docs.
