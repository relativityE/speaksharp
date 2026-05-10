**Owner:** [unassigned]
**Last Reviewed:** 2026-05-10
**Version:** v0.6.18
**Last Updated:** 2026-05-10

# GitHub Workflow Utility Audit

This document controls which GitHub workflows matter for the test-release objective.

The objective is not to keep every historical workflow alive. The objective is to validate SpeakSharp for test release with the smallest reliable set of gates that prove product behavior, deployment safety, billing integrity, and observability.

---

## Release Workflow Principles

1. **Required workflows must answer a launch decision question.**
2. **Mocked CI and live/deploy checks must not be conflated.**
3. **A broken harness is not product evidence.**
4. **Accuracy claims require successful benchmark execution, not just benchmark scripts existing.**
5. **Cloud-cost paths require stricter gates than local/private paths.**
6. **Manual/admin workflows should not block release unless their output is required for launch.**

---

## Workflow Inventory

| Workflow | Intended Purpose | Trigger | Required For Test Release? | Current Status | Keep/Fix/Defer/Retire | Evidence Needed |
|---|---|---|---|---|---|---|
| `.github/workflows/ci.yml` | Primary quality gate: prepare, Edge Function tests, mocked E2E shards, Lighthouse, SQM/report aggregation. | Push, PR, manual | Yes | 🔴 LATEST GITHUB RUN FAILED / LOCAL FIX APPLIED | **Keep required** | Latest `208be4ac` run `25621064008` failed on stale pricing-page unit expectations and report artifact handling. Local `pnpm ci:unit` passes after fixes; GitHub rerun pending. |
| `.github/workflows/canary.yml` | Production deployed smoke: provision canary user, login, Native session, save/read. | Main push, daily schedule, manual | Yes | 🟢 PASSING ON `56ce972` | **Keep required** | Production canary passed against `https://speaksharp-public.vercel.app` on `56ce972` (run `25610699109`); keep as deployed smoke because it caught real route/runtime drift. |
| `.github/workflows/deploy-supabase-migrations.yml` | Manual production DB migration and Edge Function deployment. | Manual only | Yes, before backend release | 🟢 MANUAL RUNS PASSING | **Keep or split deliberately** | Manual runs `25576997106` and `25573238473` passed on 2026-05-08. Negative-increment and promo-throttle live smokes are still required after deploy. |
| `.github/workflows/deploy-edge-functions.yml` | Deploy Edge Functions on main push/manual. | Main push, manual | Yes if used instead of migration workflow deploy step | 🟢 PASSING ON `56ce972` | **Consolidate decision needed** | Edge Function deploy passed on `56ce972` (run `25610699101`) with the broader function list. Explicit owner still needed: either this deploys functions, or migration workflow does, not both ambiguously. |
| `.github/workflows/benchmarks.yml` | STT ceiling measurement for AssemblyAI and browser engines. | Weekly schedule, manual | Yes for accuracy claims; not required for every PR | 🟡 PARTIAL EVIDENCE / BROWSER RERUN PENDING | **Fix as manual/non-blocking release evidence** | AssemblyAI benchmark passed in run `25622187317` with 0.00% WER / 100.00% accuracy. Local Private CPU baseline passed at 4.11% WER / 95.89% accuracy. Browser Native/WebGPU still need valid transcript-producing runs. |
| `.github/workflows/soak-test.yml` | Real Supabase/browser/API load and memory smoke. | Daily schedule, manual | No for fast release gate; useful before broader launch | 🟡 FIX APPLIED / RERUN PENDING | **Fix, then make manual/advisory** | Successful soak artifact or explicit deferral. |
| `.github/workflows/setup-test-users.yml` | Admin utility to provision E2E/soak users. | Manual | No, except as dependency for soak/live suites | 🟡 USEFUL UTILITY | **Keep manual** | Confirm current secrets and scripts work when soak/live tests are needed. |
| `.github/workflows/create-user.yml` | Manual call to `create-user` Edge Function. | Manual | No | 🟡 UTILITY / POSSIBLY REDUNDANT | **Keep or retire after deploy decision** | Decide whether `setup-test-users` supersedes it. |
| `.github/workflows/query-users.yml` | Admin utility for soak user inspection. | Manual | No | 🟡 UTILITY | **Keep manual** | Optional; not a release gate. |

---

## Current Breakages Found

| Area | Evidence | Impact | Fix Direction |
|---|---|---|---|
| Canary login route | `tests/e2e/helpers.ts` previously navigated to `/log-in`; app routes sign-in at `/auth/signin`. | Fixed; current production canary passes. | Keep canary required and investigate immediately on regression. |
| Supabase deploy YAML | `.github/workflows/deploy-supabase-migrations.yml` uses `run: \|pab` near line 44. | Workflow cannot parse, so production migration/deploy path is unavailable. | Replace with valid multiline block syntax and validate workflow. |
| Benchmark pnpm mismatch | `.github/workflows/benchmarks.yml` pins pnpm 9 while `package.json` declares `pnpm@10.29.1`. | Benchmark jobs fail before measuring WER. | Remove explicit pnpm version pins and let `packageManager` control version. |
| Benchmark command naming | `benchmark:cloud` is the canonical workflow command; `benchmark:assemblyai` remains as the vendor-specific implementation alias. | Avoids baking the current vendor into release workflow language while preserving local specificity. | ✅ Fixed; workflow calls `pnpm benchmark:cloud`. |
| Benchmark spec drift | `benchmarks.yml` calls `tests/live/benchmark.live.spec.ts`; current files are engine-specific benchmark specs. | Browser benchmark job targets a missing/stale file. | Target existing benchmark specs or create a single orchestrating spec intentionally. |
| Soak command drift | `soak-test.yml` calls `pnpm test:soak:memory`; package scripts expose `test:soak:ui:cloud`, `test:soak:api:cloud`, and `test:soak:verify:local`. | Soak workflow cannot run as written. | Align workflow to current soak scripts or intentionally add the missing alias. |
| Duplicate Edge Function deploy paths | Both `deploy-edge-functions.yml` and `deploy-supabase-migrations.yml` deploy Edge Functions. | Risk of partial/stale deploys and unclear owner. | Pick one authoritative production function deploy path. |
| Edge/Deno tests absent from required CI | Edge Function Deno tests were runnable locally but not part of `.github/workflows/ci.yml`. | Runtime/security regressions in quota, token, promo, webhook, or AI functions could miss the main gate. | ✅ Fixed in CI; latest `CI - Test Audit` run `25610699098` passed on `56ce972`. |
| Report job masks upstream failure when E2E is skipped | Latest `CI - Test Audit` failed unit tests first, then report also failed because E2E did not run and `test-results/playwright/results.json` was absent. | CI became noisier than the true failure. | 🟡 Local fix applied: report metrics default E2E counts to zero when upstream required jobs prevent E2E artifacts. |
| Local Codex sandbox blocks focused E2E preview bind | Focused local Playwright promo journey failed before test execution with `listen EPERM: operation not permitted 127.0.0.1:4173`. | Not app evidence; it prevents local browser validation inside this sandbox. | ⚪ Revisit only if normal Terminal or GitHub Actions reproduces the same bind failure. |
| Unit job is the slowest CI leg | Latest `CI - Test Audit` shows prepare, Edge tests, build, Lighthouse advisory, and health-check finishing while `unit` continues beyond ~6 minutes. | CI feedback loop remains sluggish even when the suite is healthy. | ⚪ Backlog: shard/split unit coverage by domain or package while preserving a single required aggregate result. This is speed work, not a release correctness blocker. |
| Canary scope ambiguity | `playwright.canary.config.ts` only matches `smoke.canary.spec.ts`; `user-filler-words.canary.spec.ts` is not part of `test:deploy:prod`. | Passing canary does not validate Cloud user-word boost. | Keep smoke slim, but document Cloud/user-words canary as separate manual/live test if desired. |

Workflow evidence status on 2026-05-10: production canary passed on `208be4ac` (run `25621064004`) and Edge Function deploy passed on the same push (run `25621064007`). GitHub `CI - Test Audit` is still red on `208be4ac` (run `25621064008`), with local fixes now applied and awaiting push/rerun. This does not mark live feature paths green.

---

## Recommended Workflow Set For Test Release

### Required

| Gate | Workflow/Command | Purpose |
|---|---|---|
| Main CI | `.github/workflows/ci.yml` | Proves code quality, unit truth, mocked app E2E, build, artifact/report aggregation. |
| Deploy Smoke | `.github/workflows/canary.yml` | Proves deployed auth/session/save/analytics path with real Supabase. |
| Backend Deploy | One authoritative Supabase deploy workflow | Applies migrations/functions safely and visibly. |

### Manual Release Evidence

| Gate | Workflow/Command | Purpose |
|---|---|---|
| STT Accuracy | `.github/workflows/benchmarks.yml` plus headed local WebGPU as needed | Produces WER evidence for Cloud, Native, Private CPU, Private WebGPU. |
| Soak | `.github/workflows/soak-test.yml` | Finds load, auth, RLS, and browser endurance problems. |
| Live Browser Hardware | `product_release/MANUAL_HARDWARE_VALIDATION.md` | Covers real microphone, Safari, iPhone, Bluetooth, and WebGPU reality. |

### Admin Utilities

| Workflow | Release Role |
|---|---|
| `setup-test-users.yml` | Keep for provisioning live/soak users. |
| `create-user.yml` | Keep only if it remains useful for one-off user provisioning. |
| `query-users.yml` | Keep as non-blocking inspection tool. |

---

## Immediate CI/Deploy Repair Order

1. Push the local CI-audit fixes and make `CI - Test Audit`, `canary.yml`, and Edge Function deploy green on the same latest commit.
2. Keep Supabase migration deploy evidence attached to release decisions; latest manual runs passed on 2026-05-08.
3. Decide the authoritative Edge Function deploy path and remove/disable ambiguity.
4. Fix benchmark workflow setup, command names, and benchmark spec targets.
5. Fix or defer `soak-test.yml` command drift.
6. Run the live feature matrix and the new deployed promo artifact spec before marking user-visible paths green.

---

## Decision

Current GitHub workflow status: **NOT RELEASE-READY**.

Reason: deploy/canary are green on the latest pushed commit, but required GitHub CI is still red until the local fixes are pushed and rerun; benchmark, soak, live feature matrix, Stripe/Sentry, and deployed product-path smokes also remain pending.
