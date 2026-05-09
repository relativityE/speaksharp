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
| `.github/workflows/ci.yml` | Primary quality gate: prepare, Edge Function tests, mocked E2E shards, Lighthouse, SQM/report aggregation. | Push, PR, manual | Yes | 🟡 LATEST RERUN REQUIRED | **Keep required** | `CI - Test Audit` passed on `9dff649` (`25602605844`), but the newer `7da01c8` run exposed a Deno Edge test import issue around `npm:stripe@16`. Local fix lazy-loads Stripe/Supabase in the webhook runtime and `pnpm test:edge` passes; push and rerun required. |
| `.github/workflows/canary.yml` | Production deployed smoke: provision canary user, login, Native session, save/read. | Main push, daily schedule, manual | Yes | 🟢 PASSING ON `7da01c8` | **Keep required** | Production canary passed against `https://speaksharp-public.vercel.app` on `7da01c8` (run `25606491521`); keep as deployed smoke because it caught real route/runtime drift. |
| `.github/workflows/deploy-supabase-migrations.yml` | Manual production DB migration and Edge Function deployment. | Manual only | Yes, before backend release | 🟢 MANUAL RUNS PASSING | **Keep or split deliberately** | Manual runs `25576997106` and `25573238473` passed on 2026-05-08. Negative-increment and promo-throttle live smokes are still required after deploy. |
| `.github/workflows/deploy-edge-functions.yml` | Deploy Edge Functions on main push/manual. | Main push, manual | Yes if used instead of migration workflow deploy step | 🟢 PASSING ON `7da01c8` | **Consolidate decision needed** | Edge Function deploy passed on `7da01c8` (run `25606491505`) with the broader function list. Explicit owner still needed: either this deploys functions, or migration workflow does, not both ambiguously. |
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
| Edge/Deno tests absent from required CI | Edge Function Deno tests were runnable locally but not part of `.github/workflows/ci.yml`. | Runtime/security regressions in quota, token, promo, webhook, or AI functions could miss the main gate. | ✅ Fixed in CI; latest `CI - Test Audit` run `25607518542` passed on `744fea8`. |
| Canary scope ambiguity | `playwright.canary.config.ts` only matches `smoke.canary.spec.ts`; `user-filler-words.canary.spec.ts` is not part of `test:deploy:prod`. | Passing canary does not validate Cloud user-word boost. | Keep smoke slim, but document Cloud/user-words canary as separate manual/live test if desired. |

Workflow evidence status on 2026-05-09: GitHub `CI - Test Audit` passed on `744fea8` (run `25607518542`), production canary passed on the same push (run `25607518535`), Edge Function deploy passed on the same push (run `25607518527`), and Supabase migration deploy has successful manual evidence from `7da01c8` (run `25606499810`). This updates the workflow gate, but it does not mark live feature paths green.

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

1. Keep `CI - Test Audit`, `canary.yml`, and Edge Function deploy green after each push; latest green evidence is `9dff649`, with newer `5166712` runs pending.
2. Keep Supabase migration deploy evidence attached to release decisions; latest manual runs passed on 2026-05-08.
3. Decide the authoritative Edge Function deploy path and remove/disable ambiguity.
4. Fix benchmark workflow setup, command names, and benchmark spec targets.
5. Fix or defer `soak-test.yml` command drift.
6. Run the live feature matrix and the new deployed promo artifact spec before marking user-visible paths green.

---

## Decision

Current GitHub workflow status: **NOT RELEASE-READY**.

Reason: required CI/canary/deploy workflow evidence is now green for `9dff649`, but benchmark, soak, live feature matrix, Stripe/Sentry, and deployed product-path smokes remain pending.
