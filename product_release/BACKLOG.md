**Owner:** [unassigned]
**Last Reviewed:** 2026-05-13
**Version:** v0.1
**Last Updated:** 2026-05-13

# Release Backlog

This file tracks known issues, tech debt, and deferred cleanup that should not interrupt active P0/P1 release stabilization unless explicitly promoted.

## Triage Rules

| Priority | Meaning | Release Handling |
|---|---|---|
| P0 | Blocks tester release or risks billing/privacy/data integrity. | Fix before share. |
| P1 | Should fix before broader release or if it blocks validation. | Fix after active P0s are stable. |
| P2 | Workflow, maintainability, polish, or velocity debt. | Schedule after release gates are green. |

## Current Backlog

| Priority | Area | Issue | Impact | Recommended Action |
|---|---|---|---|---|
| P1/P2 | Test user workflows | `.github/workflows/setup-test-users.yml` passes `NEW_FREE_COUNT` / `NEW_PRO_COUNT`, but `scripts/setup-test-users.mjs` reads `NUM_FREE_USERS` / `NUM_PRO_USERS`. | Manual count inputs can be ignored, so the workflow may provision the default E2E/soak shape instead of the requested Basic/Pro pool. | Fix narrowly by aligning env names. Promote to P1 only if this workflow is needed for current validation. |
| P2 | Promo workflows | `.github/workflows/generate-promo.yml` and `.github/workflows/live-release-matrix.yml` both call `apply-promo/generate` with similar shell logic. | Duplicated admin-promo code can drift and create inconsistent evidence paths. | Keep both workflows for now; later extract a shared script/action or make live matrix consume a generated promo output. |
| P2 | CI performance | Split setup actions into minimal paths: `setup-node-pnpm`, `setup-playwright`, `setup-supabase`, `setup-deno-edge`, and `setup-report`. | CI Audit can exceed the improved target when edge/report setup drags, slowing iteration without implying product failure. | Optimize after release correctness gates are green. |
| P2 | Workflow consolidation | `create-user.yml` and `setup-test-users.yml` both provision admin-created users, but at different scopes. | Some evidence can be mislabeled if admin-created accounts are confused with public signup/promo evidence. | Keep both for now; document evidence type whenever used. Consolidate only if maintenance burden grows. |

