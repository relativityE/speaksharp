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
| P2 | GitHub Actions maintenance | CI and RC runs emit Node.js 20 action deprecation warnings for `actions/upload-artifact@v4` / `actions/download-artifact@v4`; GitHub will force Node 24 by default on 2026-06-02 and remove Node 20 on 2026-09-16. | Not a current release blocker, but future GitHub runner changes may make artifact upload/download behavior noisy or brittle. | Schedule workflow cleanup: verify newer action versions or set/validate the Node 24 opt-in path before GitHub's cutoff. |
| P2 | CI artifact hygiene | CI health-check can warn: `No files were found with the provided path: test-results/playwright-infra/blob-report. No artifacts will be uploaded.` | Non-blocking when the health check itself passes, but warnings make it harder to spot real release issues quickly. | Make upload conditional on artifact existence or ensure the health-check step always creates the expected empty/report artifact. |
| P2 | RC/CI reporting performance | Final report aggregation and RC Gate 3 setup can take longer than the actual product test work. | Slows release feedback even when all product gates are green. | Include report-job minimization in the CI setup split: install only report dependencies and avoid unnecessary Playwright/Supabase setup for report-only work. |
| P1 | Session UI polish | Session page still reads as white / near-white instead of a clearly intentional light grey canvas, and the page needs the full layout hierarchy pass: primary real-time tools above the fold should be Recording Control, Filler Words, and Live Transcript; Speaking Pace, Clarity, Pause Analysis, and tips should be secondary below. STT mode selector should live inside the Recording Control card header, and Session toasts must not cover status, controls, filler words, transcript, or mobile navigation. | The core practice page feels flatter and busier than intended, reducing visual hierarchy and adding cognitive load while users are trying to speak. | After active P0 STT validation is stable, implement the Session layout spec: full canvas/gutters visible light grey (`#F3F4F6` preferred), white cards (`#FFFFFF`) with soft borders/shadows, no Session gradients/radials, 2-column desktop grid with Recording + Filler first row, full-width Live Transcript second row, secondary metrics below, mobile stack order Recording/Filler/Transcript/Metrics, and route-aware one-toast Session placement. Validate with desktop/mobile screenshots, typecheck, focused Session tests, and primary journey E2E. |
