# RC Test Inventory And Gate Map

**Last reviewed:** 2026-05-25

This document maps the test estate into release-candidate buckets. The goal is not to count every test as equally valuable. The goal is to make clear which tests close RC gates, which tests are advisory, which are benchmark/probe-only, and where we have gaps or redundant spend.

## Executive Summary

Current test inventory by file count:

| Bucket | Test Files | Counts Toward RC Gate? | Notes |
|---|---:|---:|---|
| Frontend unit/component | 103 | Yes, selectively | Broad correctness coverage; release value depends on domain. |
| Supabase Edge Deno tests | 7 | Yes | High-value entitlement, quota, token, CORS, webhook coverage. |
| Mocked E2E | 11 | Yes | Main everyday browser regression suite. |
| E2E diagnostics / dump ground | 5 | Mostly no | Useful for investigation; should not inflate release confidence. |
| Live/deployed tests | 19 | Yes, selectively | Highest signal for production integration; slower and secret-dependent. |
| Benchmarks | 3 | No, unless engine changes | Performance/ceiling evidence, not release correctness. |
| Canary | 2 | Yes | Production smoke and minimal live sanity. |
| Release doc assertions | 1 | Yes | Keeps tester instructions aligned with removed promo-code flow and current copy. |
| Analytics standalone | 1 | Yes | High-value math integrity gate. |
| Soak | 1 | Advisory | Useful for durability, not every RC unless specifically needed. |
| STT correctness baseline | 1 | Advisory / targeted | Useful when changing STT engines or fixtures. |
| **Total** | **153** | Mixed | RC confidence comes from mapped gate evidence, not total count. |

## RC Gate Structure

The repo has five maintained release-candidate gates in `product_release/RC_GATES.md`:

| Gate | Name | High-Level Objective | Current Command / Evidence |
|---|---|---|---|
| Gate 1 | Product truth | Prove the product's business promises are true: tier access, STT mode behavior, transcript capture, save/history/detail, analytics, exports, and tester instructions. | `pnpm rc:gate:1:product`, CI Test Audit, deploy/canary, live matrix, Pro STT matrix, Native Chrome proof. |
| Gate 2 | SAST / code review | Prove code-level safety: access control, entitlement checks, secrets hygiene, quota fail-closed behavior, test-mode isolation, race/zombie protection. | `pnpm rc:gate:2:sast`. |
| Gate 3 | DAST / running app | Prove the deployed/running app behaves correctly against real Edge Functions, auth, Stripe, Cloud token gates, and live persistence paths. | `pnpm rc:gate:3:dast`. |
| Gate 4 | SCA / dependency review | Prove there is no known critical exploitable dependency/runtime risk blocking tester release. | `pnpm audit --audit-level critical` plus GitHub Actions/runtime warning review. |
| Gate 5 | UX smoke | Prove a human tester can understand, start, recover from errors, and complete the core flow without unusable friction. | `pnpm rc:gate:5:ux`, canary, selected E2E, tester-copy checks. |

RC gates are stricter than everyday CI. Everyday CI tells us the codebase is broadly healthy. RC gates tell us whether a controlled tester release is defensible.

## How Tests Are Decided Into Gates

Tests are folded into an RC gate when they prove one of that gate's release-blocking claims. Tests remain outside RC when they are diagnostic, exploratory, benchmarking-only, utility-only, or too environment-specific to run as a normal release blocker.

| Decision Question | If Yes | If No |
|---|---|---|
| Does this test prove a claim a tester/customer will directly rely on? | Gate 1 or Gate 5. | Consider advisory/diagnostic. |
| Does it prove users cannot bypass entitlement, quota, auth, CORS, Stripe, or token controls? | Gate 2 or Gate 3. | Do not count it as security evidence. |
| Does it require a deployed app, real secrets, or live Edge Function behavior? | Gate 3 or live matrix. | Keep in unit/mocked E2E if deterministic. |
| Does it check known vulnerable dependencies or runtime supply-chain risk? | Gate 4. | Do not mix into product truth. |
| Does it measure speed/quality ceiling but not pass/fail correctness? | Benchmark/advisory. | Promote only if it becomes a release SLA. |
| Is it a probe used to debug one incident? | Diagnostic/dump-ground. | Retire or promote once the incident becomes a maintained regression. |

## Contract Source Requirement

Every RC-counted test must identify the independent source of truth it enforces. Coverage from implementation-mirroring tests is not RC confidence.

| Contract Source | Use For | Example |
|---|---|---|
| Math | Audio utilities, analytics formulas | RMS, WPM, filler count, sample duration |
| State machine | Browser/STT/session lifecycle | `onend` while listening restarts once after debounce |
| Message protocol | Workers, engines, Edge Functions | `transcribe` request returns `result` or `error`, never silence |
| Security/product rule | Tiering, quota, auth, CORS, Stripe | Basic Cloud token returns 403 and provider is not called |
| Human journey | UX smoke and live tester paths | Fresh trial user can record, review analytics, save, and reopen history |

Existing tests whose expected values were copied from the current implementation are **suspect**. They can remain in the suite, but they should not be promoted to RC-counted evidence until reviewed against one of the contract sources above.

## Gate Coverage Map

### Gate 1 - Product Truth

Objective: prove SpeakSharp behaves according to its product contract.

| Folded Under Gate 1 | Why It Belongs |
|---|---|
| `CI - Test Audit` workflow | Baseline correctness: unit, Edge, build, health, E2E, Lighthouse/report. |
| `tests/e2e/primary-journey.e2e.spec.ts` | Core tier/STT user journey under deterministic mocks. |
| `tests/e2e/analytics-truth.e2e.spec.ts` | Transcript -> analytics -> reload/export truth. |
| `tests/e2e/user-features.e2e.spec.ts` | Pro/basic feature matrix, AI Coach, PDF/export behavior. |
| `tests/e2e/user-filler-words.e2e.spec.ts` | Custom filler words affect analysis and persist. |
| `tests/analytics/math-integrity.test.ts` | Analytics formulas stay truthful. |
| `frontend/src/services/transcription/modes/__tests__/NativeBrowser.test.ts` | Native Web Speech state-machine contract: start/stop, restart debounce, duplicate `onend`, recoverable errors, interim/final emission. |
| `frontend/src/services/transcription/modes/__tests__/nativeBrowserStrategies.test.ts` | Browser strategy contract for Chrome/Edge/Safari/generic/unsupported and Web Speech result-slot extraction. |
| `frontend/src/services/transcription/engines/__tests__/TransformersJSEngine.worker.test.ts` | Private worker boundary contract: init response and timeout instead of infinite hang. |
| `frontend/src/services/transcription/engines/__tests__/transformers-js.worker.protocol.test.ts` | Direct Private worker protocol: E2E init, pre-init transcribe error, transcribe result, destroy acknowledgement. |
| `frontend/src/services/transcription/__tests__/ModelManager.test.ts` | Private model availability decision table for missing, unrelated, partial, and complete model cache. |
| `tests/live/pro-stt-artifact-matrix.live.spec.ts` / `Pro STT Artifact Matrix` workflow | Real Pro STT artifact path: transcript, save, history/detail, AI/PDF. |
| `tests/live/private-cache.live.spec.ts` / live matrix | Private setup/cache path. |
| `tests/live/first-time-tester-private-trial.live.spec.ts` / live matrix | Fresh trial tester path. |
| Native Chrome mic proof | Browser-dependent Web Speech behavior that mocks cannot prove. |
| `tests/release/tester-instructions.test.ts` | Release instructions match actual product behavior. |

Not folded by default: benchmarks, soak, dump-ground diagnostics.

### Gate 2 - SAST / Code Review

Objective: prove code-level controls are fail-closed and secrets/test branches are not leaking into production.

| Folded Under Gate 2 | Why It Belongs |
|---|---|
| `pnpm quality` | Lint/typecheck/no stray eslint-disable baseline. |
| `scripts/rc-secret-scan.mjs` | Frontend/repo secret hygiene. |
| `scripts/rc-production-hardening.mjs` | Production build cannot activate test-only branches. |
| `pnpm test:edge` | Edge auth, quota, token, CORS, webhook unit evidence. |
| `backend/supabase/functions/assemblyai-token/index.test.ts` | Cloud token entitlement, quota, auth fail-closed. |
| `backend/supabase/functions/check-usage-limit/*.test.ts` | Usage/quota access control. |
| `backend/supabase/functions/stripe-webhook/*.test.ts` | Webhook idempotency/replay resistance. |
| `backend/supabase/functions/_shared/cors.test.ts` | Request-aware CORS behavior. |
| `frontend/src/config/__tests__/env.test.ts` | Env/test-mode isolation. |
| `frontend/src/constants/__tests__/subscriptionTiers.test.ts` | Tier rules. |
| `frontend/src/hooks/__tests__/useSessionLifecycle.test.tsx` | Entitlement/lifecycle correctness. |
| `frontend/src/services/transcription/__tests__/TranscriptionService.race.test.ts` | Race protection. |
| `frontend/src/services/transcription/__tests__/TranscriptionService.zombie.test.ts` | Zombie callback protection. |
| `frontend/src/utils/__tests__/fillerWordUtils.test.ts` | Regex/custom-word abuse safety. |

Not folded by default: UX copy tests unless they also enforce a security boundary.

### Gate 3 - DAST / Running App

Objective: prove the running app and deployed services behave correctly with real integration boundaries.

| Folded Under Gate 3 | Why It Belongs |
|---|---|
| `pnpm rc:dast:local` | Running local app flow against built app. |
| `pnpm rc:dast:live` | Deployed live checks. |
| `tests/live/cloud-token-gates.live.spec.ts` | Live Cloud token denials: Basic/expired/over-quota. |
| `tests/live/stripe-checkout-readiness.live.spec.ts` | Live Stripe checkout readiness without production-charge assumptions. |
| `tests/live/stripe-webhook-readiness.live.spec.ts` | Live webhook readiness. |
| `tests/live/user-filler-words-persistence.live.spec.ts` | Live persistence of custom words. |
| `tests/live/stt-switching-contract.live.spec.ts` | Deployed STT switching contract. |
| `deploy-supabase-migrations.yml` | Latest Edge deploy/migration status. |
| `canary.yml` | Production smoke after deploy. |

Not folded by default: local mocked E2E if a live boundary is required; benchmarks unless a deployed performance SLA is defined.

### Gate 4 - SCA / Dependency Review

Objective: prove no known critical exploitable dependency/runtime risk blocks release.

| Folded Under Gate 4 | Why It Belongs |
|---|---|
| `pnpm audit --audit-level critical` | Node package critical vulnerability check. |
| GitHub Actions runtime warning review | CI supply-chain/runtime health, for example artifact/runtime deprecation warnings. |
| Supabase CLI pin/review when deploy is affected | Toolchain version can block Edge deploy or mis-handle lockfiles. |
| Deno/Supabase dependency lock review when Edge tests/deploy change | Edge runtime dependency surface. |

Gate 4 does **not** mean every dependency warning blocks release. The release rule is narrower: a critical runtime exploit with an available safe fix blocks tester release. Non-critical advisories and runtime deprecation warnings are P2 unless they break CI/deploy or expose secrets.

### Gate 5 - UX Smoke

Objective: prove a normal human tester can understand the path, start recording, see meaningful states, recover from common failures, and understand output.

| Folded Under Gate 5 | Why It Belongs |
|---|---|
| `pnpm rc:ux:smoke` | Core UX smoke: primary journey, user features, error states. |
| `tests/e2e/error-states.e2e.spec.ts` | Recoverable user-visible errors. |
| `tests/e2e/user-facing-regressions.e2e.spec.ts` | Humanized analytics guidance and user-facing copy. |
| `tests/release/tester-instructions.test.ts` | Prevents distributing stale tester instructions. |
| `frontend/src/components/session/__tests__/LiveRecordingCard.test.tsx` | Private setup/listening/processing state expectations. |
| `canary.yml` | Minimal production ability to enter the app. |
| Manual Native/Safari/browser wording check | Browser STT support is provider-dependent and needs clear expectation setting. |

Not folded by default: visual polish tests unless the issue makes onboarding/core use confusing or blocked.

## Where Workflows Fit

| Workflow | Gate Fit | Counted As |
|---|---|---|
| `ci.yml` | Gate 1 baseline, partial Gate 2, partial Gate 5, Lighthouse advisory | Counted baseline. |
| `deploy-supabase-migrations.yml` | Gate 3, partial Gate 4 toolchain/deploy health | Counted when backend/Edge changed. |
| `canary.yml` | Gate 1/Gate 5 production smoke | Counted. |
| `rc-gates.yml` | All gates | Counted umbrella workflow. |
| `live-release-matrix.yml` | Gate 1 and Gate 3 | Counted release-time evidence. |
| `pro-stt-artifact-matrix.yml` | Gate 1/Gate 3 paid-Pro STT artifact path | Counted release-time evidence. |
| `observability-api-smoke.yml` | Public launch observability/support evidence | Advisory for controlled tester release; counted for public launch readiness. |
| `benchmarks.yml` | STT/model/provider performance ceiling | Advisory; counted only when changing engine/model/performance SLA. |
| `soak-test.yml` | Durability/stability | Advisory unless stability is the current release risk. |
| `setup-test-users.yml` | Test data utility | Utility, not a gate. |

## Tests Added Or Tightened In The Latest Release Push

Recent release-hardening commits added or tightened the following tests/evidence paths:

| Change | File | RC Relevance |
|---|---|---|
| Tester instructions no longer reference removed promo-code flow; Private/Cloud expectations are enforced by test. | `tests/release/tester-instructions.test.ts` | Gate 5 UX / tester readiness. |
| First-time tester Private trial live spec now asserts explicit evidence criteria, not just navigation. | `tests/live/first-time-tester-private-trial.live.spec.ts` | Gate 1 product truth and Gate 3 DAST. |
| Private STT setup/processing copy and state expectations tightened. | `frontend/src/components/session/__tests__/LiveRecordingCard.test.tsx` | Gate 5 UX and Private STT perceived-latency bridge. |
| Analytics guidance copy assertion updated to current humanized guidance. | `tests/e2e/user-facing-regressions.e2e.spec.ts` | Gate 1 analytics truth / Gate 5 UX. |
| Analytics math integrity participates in unit/quality evidence. | `tests/analytics/math-integrity.test.ts` | Gate 1 analytics truth. |
| Session lifecycle entitlement tests tightened after Private/Cloud trial policy work. | `frontend/src/hooks/__tests__/useSessionLifecycle.test.tsx` | Gate 1 product truth and Gate 2 access control. |
| PrivateSTT and test setup adjusted for current engine/contract behavior. | `frontend/src/services/transcription/engines/PrivateSTT.ts`, `frontend/tests/setup.ts` | Gate 1 STT behavior and Gate 2 lifecycle safety. |

## GitHub Workflows

| Workflow | Trigger | RC Role | Keep? |
|---|---|---|---|
| `ci.yml` / CI - Test Audit | Push, PR, manual | Everyday correctness: prepare, unit shards, unit coverage, Edge tests, build, health, E2E shards, Lighthouse advisory, report. | Yes, required baseline. |
| `deploy-supabase-migrations.yml` | Push to Supabase paths, manual | Deploy Edge Functions and DB migrations. | Yes. |
| `canary.yml` | Push, manual, schedule | Production smoke. | Yes. |
| `rc-gates.yml` | Manual | Runs the five explicit RC gates. | Yes. |
| `live-release-matrix.yml` | Manual | Live product truth matrix: custom words, Native preflight, Cloud gates/artifacts, Private cache, first-time tester, Stripe readiness. | Yes, release-time. |
| `pro-stt-artifact-matrix.yml` | Manual | Paid-Pro STT artifact path. | Yes, release-time or STT changes. |
| `observability-api-smoke.yml` | Manual | Sentry/PostHog API readback. | Yes, release-time/advisory depending launch scope. |
| `benchmarks.yml` | Schedule/manual | STT ceiling benchmarks. | Advisory, required only for engine/model changes. |
| `soak-test.yml` | Schedule/manual | Durability/memory/API stress. | Advisory unless investigating stability. |
| `setup-test-users.yml` | Manual | Test user provisioning. | Utility, not a correctness gate. |

## What Counts For Release Confidence

### Highest Signal

| Bucket | Why It Counts |
|---|---|
| `tests/e2e/primary-journey.e2e.spec.ts` | Main mocked user journey by tier and STT mode. |
| `tests/e2e/user-facing-regressions.e2e.spec.ts` | Protects human-readable analytics, guidance, and UI expectations. |
| `tests/e2e/analytics-truth.e2e.spec.ts` | Ensures transcript events produce meaningful analytics and survive reload/export. |
| `tests/e2e/user-features.e2e.spec.ts` | Protects Pro/basic feature matrix and export behavior. |
| `tests/e2e/error-states.e2e.spec.ts` | Ensures users see recoverable errors instead of silent failures. |
| `backend/supabase/functions/*/*.test.ts` | High-value access control, quota, token, CORS, webhook, AI suggestion protection. |
| `tests/live/cloud-token-gates.live.spec.ts` | Proves deployed Cloud token denials and entitlement statuses. |
| `tests/live/pro-stt-artifact-matrix.live.spec.ts` | Proves real Pro Cloud/Private artifact path: transcript, save, history/detail, AI/PDF. |
| `tests/live/private-cache.live.spec.ts` | Proves Private model/cache flow works across starts. |
| `tests/live/first-time-tester-private-trial.live.spec.ts` | Maps directly to soft-release tester journey. |
| `tests/canary/smoke.canary.spec.ts` | Minimal production tripwire. |

### Important But Not Sufficient Alone

| Bucket | Why |
|---|---|
| Frontend component tests | Good for local UI regressions, but they do not prove browser journey success. |
| STT unit tests | Necessary for contracts/gates, but real mic/browser traces still matter for Native/Private. |
| Lighthouse | Good release hygiene, but does not prove product correctness. |
| Coverage | Useful risk signal; global percent is less important than coverage on critical paths. |

### Advisory / Not Counted As RC Green By Default

| Bucket | Reason |
|---|---|
| `tests/e2e/dump-ground/*` | Diagnostics and forensic probes. Keep out of RC pass/fail accounting unless promoted. |
| `tests/live/benchmark-*.live.spec.ts` | Benchmark/ceiling evidence; required for model/provider changes, not normal release. |
| `tests/stt-correctness/wer-baseline.spec.ts` | Useful for STT engine comparison; not a human journey proof. |
| `tests/soak/*` | Durability evidence; run before broad public launch or when stability is suspected. |

## Current Gaps

| Gap | Why It Matters | Recommended Action |
|---|---|---|
| STT/transcription coverage is uneven. | Private/Native/Cloud are release-critical, but several engine/worker/model files remain under-covered. | Add targeted floors for `services/transcription`, worker, audio utils, and NativeBrowser instead of relying only on global coverage. |
| `transformers-js.worker.ts` previously had 0% meaningful contract coverage. | This is the Private latency architecture. | Initial worker message-protocol tests now cover E2E init, pre-init error, transcribe result, and destroy acknowledgement. Remaining gap: explicit pipeline-load failure branch. |
| `ModelManager.ts` had very low coverage. | Model availability/download/cache choices can break Private first-use. | Initial decision-table tests now cover no cache, empty cache, unrelated cache, partial Whisper cache, and complete model cache. Remaining gap: download/status/error event behavior. |
| Native Browser still depends on real browser evidence. | Web Speech behavior cannot be fully mocked. | Keep unit tests for strategy/restart; require latest Chrome trace artifact for RC green. |
| Analytics UI has some 0% component coverage. | Scoring math is covered better than user interpretation surfaces. | Prioritize tests around exact displayed guidance, not decorative charts. |
| PRD/SQM metrics aggregation has known reporting caveats. | Raw Lighthouse/coverage artifacts are valid; generated PRD artifact may show stale/null Lighthouse. | Treat raw CI artifacts as source of truth until aggregator is fixed. |

## Redundancy / Waste Candidates

| Candidate | Current Use | Recommendation |
|---|---|---|
| `tests/e2e/dump-ground/*` | Investigation probes. | Keep locally available, but exclude from RC language and timing dashboards unless explicitly invoked. |
| Multiple older live STT integration specs | Some overlap with Pro STT matrix and first-time tester path. | Compare coverage against `pro-stt-artifact-matrix` and retire or mark diagnostic if duplicated. |
| Component tests for purely static UI shells | Low release confidence per minute. | Keep only if cheap; do not expand before critical-path coverage. |
| Benchmarks on routine release commits | Expensive and noisy. | Run on engine/provider/model changes, not every RC by default. |

## Recommended RC Reporting Format

Every RC gate should report:

| Field | Required |
|---|---|
| Gate ID | Gate 1-5. |
| Definition of green | Binary pass/fail condition. |
| Latest artifact | GitHub run ID, trace path, report path, screenshot, or log path. |
| Last updated by/date | Prevents stale evidence being mistaken for current truth. |
| Scope | Mocked, live, production, manual browser, or benchmark. |
| Counted? | RC-counted, advisory, diagnostic, or utility. |

The release rule stays simple: the latest evidence for each blocking RC gate must be green. If one blocking gate is red or stale after relevant code changed, RC is not green.
