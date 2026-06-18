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
8. **Merge — only after green** (auto-merge is **disabled** on this repo, so merge manually):
   ```bash
   gh pr merge <PR#> --squash --delete-branch
   ```
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
