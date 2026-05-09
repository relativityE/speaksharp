**Owner:** [unassigned]
**Last Reviewed:** 2026-05-07
**Version:** v0.6.18
**Last Updated:** 2026-05-09

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
| `.github/workflows/ci.yml` | Primary quality gate: prepare, mocked E2E shards, Lighthouse, SQM/report aggregation. | Push, PR, manual | Yes | 🟡 LOCAL PARITY GREEN / GITHUB RERUN PENDING | **Keep + prove now** | Latest pushed run failed before the current local fixes. Local parity is now green: `pnpm ci:unit` passed and `pnpm test:e2e` passed `40/40` with `0 flaky`. Do not mark ready until GitHub run is green with unit, mocked E2E, build, artifact aggregation, and Lighthouse policy outcome. |
| `.github/workflows/canary.yml` | Production deployed smoke: provision canary user, login, Native session, save/read. | Main push, daily schedule, manual | Yes | 🟢 PASSING | **Keep required** | Latest main-branch scheduled and push canaries pass against `https://speaksharp-public.vercel.app`; keep as deployed smoke because it caught real route/runtime drift. |
| `.github/workflows/deploy-supabase-migrations.yml` | Manual production DB migration and Edge Function deployment. | Manual only | Yes, before backend release | 🟡 FIX APPLIED / RERUN PENDING | **Fix or split** | Valid YAML plus successful dry/manual run with migration summary. |
| `.github/workflows/deploy-edge-functions.yml` | Deploy Edge Functions on main push/manual. | Main push, manual | Yes if used instead of migration workflow deploy step | 🟡 DUPLICATIVE | **Consolidate decision needed** | Explicit owner: either this deploys functions, or migration workflow does, not both ambiguously. |
| `.github/workflows/benchmarks.yml` | STT ceiling measurement for AssemblyAI and browser engines. | Weekly schedule, manual | Yes for accuracy claims; not required for every PR | 🟡 FIX APPLIED / RERUN PENDING | **Fix as manual/non-blocking release evidence** | AssemblyAI, Native, Private CPU, and headed WebGPU WER evidence recorded. |
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
| Benchmark command drift | `benchmarks.yml` calls `pnpm benchmark:cloud`; package script is `benchmark:assemblyai`. | Benchmark will fail after pnpm setup is fixed. | Update workflow command to current script name. |
| Benchmark spec drift | `benchmarks.yml` calls `tests/live/benchmark.live.spec.ts`; current files are engine-specific benchmark specs. | Browser benchmark job targets a missing/stale file. | Target existing benchmark specs or create a single orchestrating spec intentionally. |
| Soak command drift | `soak-test.yml` calls `pnpm test:soak:memory`; package scripts expose `test:soak:ui:cloud`, `test:soak:api:cloud`, and `test:soak:verify:local`. | Soak workflow cannot run as written. | Align workflow to current soak scripts or intentionally add the missing alias. |
| Duplicate Edge Function deploy paths | Both `deploy-edge-functions.yml` and `deploy-supabase-migrations.yml` deploy Edge Functions. | Risk of partial/stale deploys and unclear owner. | Pick one authoritative production function deploy path. |
| Canary scope ambiguity | `playwright.canary.config.ts` only matches `smoke.canary.spec.ts`; `user-filler-words.canary.spec.ts` is not part of `test:deploy:prod`. | Passing canary does not validate Cloud user-word boost. | Keep smoke slim, but document Cloud/user-words canary as separate manual/live test if desired. |

Local repair status on 2026-05-09: stale workflow strings were removed from executable workflow/test code, workflow YAML parses locally, targeted script/backend lint passed, local `pnpm ci:unit` passed, and local `pnpm test:e2e` passed `40/40` with `0 flaky`. GitHub Actions reruns are still required before any row can be marked READY.

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

1. Fix `deploy-supabase-migrations.yml` YAML syntax so backend deploy can run.
2. Keep `canary.yml` green after each deploy; latest run is passing.
3. Decide the authoritative Edge Function deploy path and remove/disable ambiguity.
4. Fix benchmark workflow setup, command names, and benchmark spec targets.
5. Fix or defer `soak-test.yml` command drift.
6. Re-run the required gates and attach run IDs/evidence in `RELEASE_READINESS.md`.

---

## Decision

Current GitHub workflow status: **NOT RELEASE-READY**.

Reason: the local release gate is green, but required GitHub CI, backend deploy, benchmark, soak, and post-deploy canary evidence must be rerun after the current fixes are pushed.
