> Archived historical workflow audit.
> Current release status lives in `../../RELEASE_STATUS.md`; current gate definitions live in `../../RC_GATES.md`.

**Owner:** [unassigned]
**Last Reviewed:** 2026-05-15
**Version:** v0.6.19-rc0
**Last Updated:** 2026-05-15

# GitHub Workflow Utility Audit

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

This document controls which GitHub workflows matter for the test-release objective.

The objective is not to keep every historical workflow alive. The objective is to validate SpeakSharp for test release with the smallest reliable set of gates that prove product behavior, deployment safety, billing integrity, and observability.

---

## Current Workflow Evidence

| Workflow | Current Evidence | Status | Notes |
|---|---|---:|---|
| `.github/workflows/ci.yml` | `CI - Test Audit` run `25944598514` on `main` after `1066ba6d` | 🟢 PASSING | Includes unit, E2E, Lighthouse/SQM/report aggregation; Node 20 artifact annotation resolved by action upgrades. |
| `.github/workflows/canary.yml` | `Production Canary Smoke Test` run `25944598537` on `main` after `1066ba6d` | 🟢 PASSING | Deployed smoke remains required. |
| `.github/workflows/deploy-supabase-migrations.yml` | `Deploy Supabase` | 🟢 CONSOLIDATED | Edge Function deploy and manual migration/secrets deploy now share one workflow with operation flags. |
| Lighthouse/SQM | Performance 98, Accessibility 94, Best Practices 100, SEO 100 | 🟢 PASSING | Release score floor currently satisfied. |

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
| `.github/workflows/ci.yml` | Primary quality gate: prepare, Edge Function tests, mocked E2E shards, Lighthouse, SQM/report aggregation. | Push, PR, manual | Yes | 🟢 PASSING ON `1066ba6d` | **Keep required** | `CI - Test Audit` run `25944598514` passed on `main`; artifact actions are upgraded to Node 24-compatible versions. |
| `.github/workflows/canary.yml` | Production deployed smoke: provision canary user, login, Native session, save/read. | Main push, daily schedule, manual | Yes | 🟢 PASSING ON `1066ba6d` | **Keep required** | Production canary passed against `https://speaksharp-public.vercel.app` in run `25944598537`; keep as deployed smoke because it catches real route/runtime drift. |
| `.github/workflows/deploy-supabase-migrations.yml` | Deploy Supabase Edge Functions on push/manual, or manually run migrations/secrets/all with confirmation. | Main push, manual | No competing Edge deploy workflow remains | 🟢 CONSOLIDATED | **Keep** | This is now the authoritative Supabase deploy workflow. |
| **Next-session proposed: live user-filler persistence** | Manual GitHub-secret-backed live test for custom word persistence across logout/login. | Manual only | Yes before human tester confidence on custom words | ⚪ MISSING WORKFLOW | **Add or run through a controlled manual workflow** | Local `.env*` does not expose `E2E_BASIC_EMAIL`/`E2E_BASIC_PASSWORD`, but GitHub secrets do. Add/run a workflow that executes `VITE_USE_LIVE_DB=true tests/live/user-filler-words-persistence.live.spec.ts` with those secrets, then record add -> logout/relogin -> visible -> cleanup evidence. |
| **Next-session proposed: observability smoke** | Manual GitHub/dashboard checklist for frontend Sentry, Edge Function Sentry/log ingest, Stripe webhook smoke, PostHog launch events. | Manual only | Yes before broad tester rollout | ⚪ MISSING WORKFLOW / DASHBOARD CHECK | **Add checklist or manual dispatch helper** | Frontend trace showed Sentry ingest HTTP 200, but dashboard visibility, Edge Function ingest, Stripe webhook, and PostHog event verification remain unproven. |
| `.github/workflows/benchmarks.yml` | STT ceiling measurement for AssemblyAI and browser engines. | Weekly schedule, manual | Yes for accuracy claims; not required for every PR | 🟡 PARTIAL EVIDENCE / BROWSER RERUN PENDING | **Fix as manual/non-blocking release evidence** | AssemblyAI benchmark passed in run `25622187317` with 0.00% WER / 100.00% accuracy. Local Private CPU baseline passed at 4.11% WER / 95.89% accuracy. Browser Native/WebGPU still need valid transcript-producing runs. |
| `.github/workflows/soak-test.yml` | Real Supabase/browser/API load and memory smoke. | Daily schedule, manual | No for fast release gate; useful before broader launch | 🟡 ALIGNED / RERUN PENDING | **Keep manual/advisory** | YAML now calls the current soak command and manual dispatch accepts `new_basic_count` / `new_pro_count`; successful soak artifact or explicit deferral still needed. |
| `.github/workflows/setup-test-users.yml` | Test user admin: setup, query, or create. | Manual | Replaces previous `create-user.yml` and `query-users.yml` | 🟢 CONSOLIDATED | **Keep** | Single user-admin entrypoint. |

---

## Current Breakages Found

| Area | Evidence | Impact | Fix Direction |
|---|---|---|---|
| Canary login route | `tests/e2e/helpers.ts` previously navigated to `/log-in`; app routes sign-in at `/auth/signin`. | Fixed; current production canary passes. | Keep canary required and investigate immediately on regression. |
| Supabase deploy YAML | `.github/workflows/deploy-supabase-migrations.yml` uses `run: \|pab` near line 44. | Workflow cannot parse, so production migration/deploy path is unavailable. | Replace with valid multiline block syntax and validate workflow. |
| Benchmark pnpm mismatch | `.github/workflows/benchmarks.yml` pins pnpm 9 while `package.json` declares `pnpm@10.29.1`. | Benchmark jobs fail before measuring WER. | Remove explicit pnpm version pins and let `packageManager` control version. |
| Benchmark command naming | `benchmark:cloud` is the canonical workflow command; `benchmark:assemblyai` remains as the vendor-specific implementation alias. | Avoids baking the current vendor into release workflow language while preserving local specificity. | ✅ Fixed; workflow calls `pnpm benchmark:cloud`. |
| Benchmark spec drift | `benchmarks.yml` calls `tests/live/benchmark.live.spec.ts`; current files are engine-specific benchmark specs. | Browser benchmark job targets a missing/stale file. | Target existing benchmark specs or create a single orchestrating spec intentionally. |
| Soak dispatch/count alignment | `soak-test.yml` calls `pnpm test:soak:ui:cloud`; manual dispatch now accepts `new_basic_count` / `new_pro_count`, and `scripts/trigger-soak.mjs` sends those names. | Workflow naming is aligned; proof still requires a fresh manual soak run. | Keep soak manual/advisory and attach the next successful artifact when broader-launch evidence is needed. |
| Duplicate Edge Function deploy paths | Previously both `deploy-edge-functions.yml` and `deploy-supabase-migrations.yml` deployed Edge Functions. | Risk of partial/stale deploys and unclear owner. | Resolved by consolidating into `Deploy Supabase`. |
| Edge/Deno tests absent from required CI | Edge Function Deno tests were runnable locally but not part of `.github/workflows/ci.yml`. | Runtime/security regressions in quota, token, trial, webhook, or AI functions could miss the main gate. | ✅ Fixed in CI; latest `CI - Test Audit` run `25610699098` passed on `56ce972`. |
| Report job masks upstream failure when E2E is skipped | Latest `CI - Test Audit` failed unit tests first, then report also failed because E2E did not run and `test-results/playwright/results.json` was absent. | CI became noisier than the true failure. | 🟡 Local fix applied: report metrics default E2E counts to zero when upstream required jobs prevent E2E artifacts. |
| Local Codex sandbox blocks focused E2E preview bind | Focused local Playwright trial journey failed before test execution with `listen EPERM: operation not permitted 127.0.0.1:4173`. | Not app evidence; it prevents local browser validation inside this sandbox. | ⚪ Revisit only if normal Terminal or GitHub Actions reproduces the same bind failure. |
| CI Audit wall-clock is too slow for release iteration | Latest current `CI - Test Audit` run `25944598514` passed. Runtime remains a release-velocity concern rather than a correctness blocker. | This slows every release blocker fix and makes the gate feel fragile even when individual jobs are healthy. | 🟡 Keep as near-term release-velocity work: split/shard unit coverage by domain or package, start independent jobs earlier where dependency-safe, and preserve one aggregate required result. Correctness still outranks speed. |
| Canary scope ambiguity | `playwright.canary.config.ts` only matches `smoke.canary.spec.ts`; `user-filler-words.canary.spec.ts` is not part of `test:deploy:prod`. | Passing canary does not validate Cloud user-word boost. | Keep smoke slim, but document Cloud/user-words canary as separate manual/live test if desired. |

Workflow evidence status on 2026-05-15: `CI - Test Audit` run `25944598514`, production canary run `25944598537`, and Edge Function deploy run `25944598524` passed on `main` after commit `1066ba6d`. This marks the workflow gate green, but does not by itself close the remaining public-launch live Stripe or physical real-device evidence gaps. Physical real-mic Cloud proof is tracked separately in `PUBLIC_LAUNCH_LEDGER.md`.

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
| `setup-test-users.yml` | Keep for setup, query, and one-off test-user creation. |
| `create-user.yml` | Retired. One-off user provisioning now uses `setup-test-users.yml` with `action=create`. |
| `query-users.yml` | Retired. Soak-user inspection now uses `setup-test-users.yml` with `action=query`. |

---

## Immediate CI/Deploy Repair Order

1. Keep `CI - Test Audit`, production canary, and Edge Function deploy required for release evidence.
2. Keep Supabase migration deploy evidence attached to backend release decisions; latest manual runs passed on 2026-05-08.
3. Decide the authoritative Edge Function deploy path and remove/disable ambiguity.
4. Move CI Audit runtime optimization up as release-velocity work: shard/split unit tests and reduce required-gate wall-clock without weakening the aggregate gate.
5. Fix benchmark workflow setup, command names, and benchmark spec targets if benchmark claims are promoted.
6. Rerun or explicitly defer `soak-test.yml` advisory evidence.
7. Keep observability smoke and tester-feedback fallback as launch-support gates.
8. Keep public-launch ledger gates separate from controlled-tester workflow evidence.

---

## Decision

Current GitHub workflow status: **GREEN FOR CONTROLLED TESTER RELEASE / PUBLIC LAUNCH STILL GATED ELSEWHERE**.

Reason: CI/Test Audit, production canary, and Edge Function deploy are green on the latest workflow hygiene commit. Public launch remains NO-GO because live Stripe and physical validation gates are tracked in `PUBLIC_LAUNCH_LEDGER.md`, not because the current workflow gate is red.
