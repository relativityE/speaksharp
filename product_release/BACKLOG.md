**Owner:** [unassigned]
**Last Reviewed:** 2026-05-15
**Version:** v0.1
**Last Updated:** 2026-05-15

# Release Backlog

<!-- PRODUCT_RELEASE_SYNC_START -->

## Current Evidence Snapshot (2026-05-15)

| Item | Current Status |
|---|---|
| Controlled desktop tester release | GO WITH LIMITATIONS; see `RELEASE_DECISION.md` and `TESTER_RELEASE_MATRIX.md`. |
| Broad public launch | NO-GO until remaining public-launch gates are proven; see `PUBLIC_LAUNCH_LEDGER.md`. |
| Latest release evidence commit | `1066ba6d` (`Use Node 24 artifact actions`). |
| CI/Test Audit | PASS: GitHub run `25944598514` on `main`. |
| Production canary | PASS: GitHub run `25944598537` on `main`. |
| Edge Function deploy | PASS: GitHub run `25944598524` on `main`. |
| Lighthouse release scores | Performance 98, Accessibility 94, Best Practices 100, SEO 100. |
| Artifact action runtime | Node 20 artifact warning resolved by upgrading `actions/upload-artifact` to `v6` and `actions/download-artifact` to `v7`. |
| Documentation rule | This snapshot supersedes older run IDs or stale status tables lower in this file until those sections are next deeply reconciled. |

<!-- PRODUCT_RELEASE_SYNC_END -->

This file tracks known issues, tech debt, and deferred cleanup that should not interrupt active P0/P1 release stabilization unless explicitly promoted.

## Triage Rules

| Priority | Meaning | Release Handling |
|---|---|---|
| P0 | Blocks tester release or risks billing/privacy/data integrity. | Fix before share. |
| P1 | Should fix before broader release or if it blocks validation. | Fix after active P0s are stable. |
| P2 | Workflow, maintainability, polish, or velocity debt. | Schedule after release gates are green. |

## Current Backlog

## Recently Closed

| Closed Date | Area | Result | Evidence |
|---|---|---|---|
| 2026-05-15 | GitHub Actions maintenance | Closed. Artifact actions now run on Node 24-compatible versions. | Commit `1066ba6d` upgraded `actions/upload-artifact` to `v6` and `actions/download-artifact` to `v7`; `CI - Test Audit` run `25944598514` passed without the prior Node 20 artifact annotation. |
| 2026-05-15 | Test user workflows | Closed. `scripts/setup-test-users.mjs` now accepts both the documented workflow inputs (`NEW_FREE_COUNT` / `NEW_PRO_COUNT`) and legacy local names (`NUM_FREE_USERS` / `NUM_PRO_USERS`). | This prevents manual workflow counts from being ignored when provisioning Basic/Pro pools. |

| Priority | Area | Issue | Impact | Recommended Action |
|---|---|---|---|---|
| P2 | Promo workflows | `.github/workflows/generate-promo.yml` and `.github/workflows/live-release-matrix.yml` both call `apply-promo/generate` with similar shell logic. | Duplicated admin-promo code can drift and create inconsistent evidence paths. | Keep both workflows for now; later extract a shared script/action or make live matrix consume a generated promo output. |
| P2 | CI performance | Split setup actions into minimal paths: `setup-node-pnpm`, `setup-playwright`, `setup-supabase`, `setup-deno-edge`, and `setup-report`. | CI Audit can exceed the improved target when edge/report setup drags, slowing iteration without implying product failure. | Optimize after release correctness gates are green. |
| P2 | Workflow consolidation | `create-user.yml` and `setup-test-users.yml` both provision admin-created users, but at different scopes. | Some evidence can be mislabeled if admin-created accounts are confused with public signup/promo evidence. | Keep both for now; document evidence type whenever used. Consolidate only if maintenance burden grows. |
| P2 | CI artifact hygiene | CI health-check can warn: `No files were found with the provided path: test-results/playwright-infra/blob-report. No artifacts will be uploaded.` | Non-blocking when the health check itself passes, but warnings make it harder to spot real release issues quickly. | Make upload conditional on artifact existence or ensure the health-check step always creates the expected empty/report artifact. |
| P2 | RC/CI reporting performance | Final report aggregation and RC Gate 3 setup can take longer than the actual product test work. | Slows release feedback even when all product gates are green. | Include report-job minimization in the CI setup split: install only report dependencies and avoid unnecessary Playwright/Supabase setup for report-only work. |
| P2 | Session UI polish | Session page still has post-release polish opportunities around exact hierarchy density, mobile screenshots, and final visual tuning beyond the controlled-tester flow. | The page can be improved, but current controlled desktop tester gates are no longer blocked by Session layout/status. | Schedule after controlled-tester release. Keep any follow-up visual work separate from STT lifecycle changes and validate with screenshots. |
| P2 | Manual mic proof environment | Agent-run Chrome CDP evidence is not the same as a normal human speaking into a physical mic. | Public-launch claims should not overstate CDP proof as `manual-real-mic`. | Keep evidence labels explicit. Reserve `manual-real-mic` for a visible Chrome pass using a human-spoken phrase and normal browser mic settings. |
| P2 | Manual validation tooling | During the Basic/Pro live walkthrough, the Codex in-app browser became wedged on `/session`; navigation away and creating a clean tab timed out at `about:blank`. A later dedicated Chrome CDP session on port `9222` allowed Basic and Pro UI operation, but it still needs clear evidence labeling because Chrome was launched with mic permission auto-allow and speech stimulus came from macOS `say`. | Tool choice can change the apparent STT result, and mislabeled evidence can create false confidence or false blockers. | Prefer the dedicated Chrome CDP session for agent-operated live UI checks. Label evidence as `Chrome CDP live UI`, include account source, media setup, and artifact paths. Reserve `manual-real-mic` for a visible Chrome pass using a human-spoken phrase and normal browser mic settings. |
