# RC Test Inventory And Gate Map

**Last reviewed:** 2026-05-25

This document maps the test estate into release-candidate buckets. The goal is not to count every test as equally valuable. The goal is to make clear which tests close RC gates, which tests are advisory, which are benchmark/probe-only, and where we have gaps or redundant spend.

## Executive Summary

Current test inventory by file count:

| Bucket | Test Files | Counts Toward RC Gate? | Notes |
|---|---:|---:|---|
| Frontend unit/component | 106 | Yes, selectively | Broad correctness coverage; release value depends on domain. |
| Supabase Edge Deno tests | 7 | Yes | High-value entitlement, quota, token, CORS, webhook coverage. |
| Mocked E2E | 10 | Yes | Main everyday browser regression suite. |
| E2E diagnostics / dump ground | 5 | Mostly no | Useful for investigation; should not inflate release confidence. |
| Live/deployed tests | 19 | Yes, selectively | Highest signal for production integration; slower and secret-dependent. |
| Benchmarks | 3 | No, unless engine changes | Performance/ceiling evidence, not release correctness. |
| Canary | 2 | Yes | Production smoke and minimal live sanity. |
| Release doc assertions | 1 | Yes | Keeps tester instructions aligned with removed promo-code flow and current copy. |
| Analytics standalone | 1 | Yes | High-value math integrity gate. |
| Soak | 2 | Advisory | Useful for durability, not every RC unless specifically needed. |
| STT correctness baseline | 1 | Advisory / targeted | Useful when changing STT engines or fixtures. |
| **Total** | **157** | Mixed | RC confidence comes from mapped gate evidence, not total count. |

## Per-File Triage Status

The current inventory is complete for release-candidate purposes: every RC-counted file is named in a ledger with a contract source, and every unlisted test/spec file is advisory, diagnostic, or refactor-confidence only until explicitly promoted. This avoids ship-time judgment calls while leaving room to upgrade useful advisory tests into gates later.

| Area | Status | Next Step |
|---|---|---|
| Workflows and maintained scripts | Bucket-triaged | Keep as gate/advisory/utility unless a workflow changes release meaning. |
| Edge Deno tests | Gate-triaged | Preserve as Gate 2/Gate 3 security/product-rule evidence. |
| STT worker, Private engine, ModelManager | Contract-triaged | Done for current release-critical rows; expand only if new engine paths are promoted. |
| Analytics math/guidance | Contract-triaged | Done for current Cloud transcript baseline and UI evidence. |
| Mocked E2E/live/canary | RC-counted files named | Non-counted browser/live diagnostics remain advisory until promoted with a contract source. |
| Frontend unit/component tests | RC-counted files named | Non-ledger component, hook, lib, mock, page shell, and dump-ground tests remain advisory/refactor-confidence until promoted with a contract source. |
| Diagnostics, benchmarks, soak, WER baseline | Bucket-triaged | Keep advisory/diagnostic unless a release SLA explicitly promotes one. |

## RC Gate Structure

The repo has five maintained release-candidate gates in `product_release/RC_GATES.md`:

Terminology:

- **SAST** means Static Application Security Testing: code-level release safety checks such as lint/typecheck, secret scanning, production hardening, and targeted unit/Edge Function tests.
- **DAST** means Dynamic Application Security Testing: browser/runtime release safety checks against the running app, including local mocked Playwright flows and live deployed flows.
- **SCA** means Software Composition Analysis: dependency and runtime supply-chain checks, including the critical dependency audit.

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

## STT Corpus Gate Layers

STT correctness now has two different release layers because they catch different classes of failures.

| Layer | Mic Path | Purpose | Gate Role |
|---|---|---|---|
| Fake-device corpus | Chrome fake media device plus checked-in WAV fixtures | Deterministic code-correctness proof for chunking, buffering, RMS gates, worker messages, WER, transcript output, and filler analytics. | RC-counted only for engines proven to receive the intended fixture audio. |
| Real-mic corpus | `pnpm rc:stt:corpus` plays fixtures with `afplay` through the machine's speaker into the real browser microphone | Product-readiness proof for mic permission, hardware input, `AudioContext`, browser audio processing, Native Web Speech provider behavior, transcript, save/history, and analytics. | RC-counted release-time evidence. |

The fake-device layer is not a shortcut around real-mic testing. Fake-device failures usually point at app-controlled code. Real-mic failures point at the full user path and still block RC until triaged. Native Chrome is launch-critical, so its real-mic corpus and journey evidence must be green for the onboarding path to close.

Native regression note, 2026-05-25: `fc0ffc39` changed Chrome/Edge Web Speech from `continuous=true` to `continuous=false` after index-based final-result dedup already existed. The May 25 A/B artifacts showed `continuous=false` heard audio/speech but emitted zero results and multiple VAD truncation drops; `continuous=true` emitted interim/final results and completed save/history/analytics. The maintained Native strategy tests and manual proof must preserve `continuous=true` for Chrome/Edge unless a new real-mic A/B proves otherwise.

Additional Native repeat coverage required before release sign-off:

| Scenario | Counted Claim |
|---|---|
| Intentional repeat in one continuous session | Legitimate repeated content appears exactly as spoken and is not multiplied by result-slot dedup. |
| Intentional repeat across a recognition restart | Clearing `finalizedResultIndexes` on restart does not re-admit stale Chrome results and multiply the transcript. |

Edge support is not counted as proven by Chrome evidence. Until an Edge proof is captured, tester/UI copy must prefer `Chrome recommended` or equivalent browser-dependent wording rather than implying Edge parity.

Current fake-device Native probe status:

| Probe | Artifact | Result | RC Meaning |
|---|---|---|---|
| Chrome Native Web Speech with `--use-file-for-fake-audio-capture=tests/fixtures/stt-isomorphic/audio/h1_1.wav` | `/private/tmp/speaksharp-native-fake-audio-probe.json` | Web Speech events fired, but transcript was `this one still has a bit next`, not the expected `stale smell old beer lingers`. | Native fake-device WER is diagnostic only until a probe proves the selected fixture audio reaches Web Speech. Private/Cloud fake-device gates can still be developed as deterministic code-correctness checks. |

STT corpus sub-gates:

| Sub-Gate | Corpus | Contract Source | Counted Claim |
|---|---|---|---|
| STT-A Accuracy | Ten canonical Harvard sentence WAV/truth fixtures | Ground-truth transcript plus WER arithmetic | Each engine's transcript remains within its calibrated WER floor and produces artifact-backed first-text timing. |
| STT-B Browser Journey | One or two representative fixtures per engine | Human journey | Recording, transcript, stop/save, history/detail, and analytics complete without fatal console/page/network errors. |
| STT-C Filler Value | `conv_01.wav`, `conv_02.wav`, and checked-in filler truth | Product rule / math | Filler counts match explicit fixture truth and analytics guidance remains useful. |

## Contract Source Requirement

Every RC-counted test must identify the independent source of truth it enforces. Coverage from implementation-mirroring tests is not RC confidence.

| Contract Source | Use For | Example |
|---|---|---|
| Math | Audio utilities, analytics formulas | RMS, WPM, filler count, sample duration |
| State machine | Browser/STT/session lifecycle | `onend` while listening restarts once after debounce |
| Message protocol | Workers, engines, Edge Functions | `transcribe` request returns `result` or `error`, never silence |
| Security/product rule | Tiering, quota, auth, CORS, Stripe | Free Cloud token returns 403 and provider is not called |
| Human journey | UX smoke and live tester paths | Fresh trial user can record, review analytics, save, and reopen history |

Existing tests whose expected values were copied from the current implementation are **suspect**. They can remain in the suite, but they should not be promoted to RC-counted evidence until reviewed against one of the contract sources above.

## RC-Counted Browser And Live Ledger

These are the named browser/live/canary files that currently count toward RC status. Files outside this ledger may still run in CI, but they do not close an RC gate unless promoted here with a contract source.

| File / Workflow | Gate | Contract Source | Counted Claim |
|---|---|---|---|
| `tests/e2e/primary-journey.e2e.spec.ts` | Gate 1 / Gate 5 | Human journey | Core mocked user journey reaches session flow by tier and STT mode. |
| `tests/e2e/user-features.e2e.spec.ts` | Gate 1 / Gate 5 | Product rule / human journey | Free/Pro feature matrix, export, and visible feature access behave as promised. |
| `tests/e2e/error-states.e2e.spec.ts` | Gate 5 | Human journey | Common failures surface actionable UI instead of silent or cryptic breakage. |
| `tests/e2e/analytics-truth.e2e.spec.ts` | Gate 1 / Gate 3 | Math / persistence contract | Transcript-derived analytics persist through reload/history/export with expected arithmetic. |
| `tests/e2e/user-facing-regressions.e2e.spec.ts` | Gate 1 / Gate 5 | Human journey | Analytics guidance and release-critical copy remain understandable and actionable. |
| `tests/e2e/user-filler-words.e2e.spec.ts` | Gate 1 | Product rule / regex safety | Custom filler words persist and affect analysis without query/regex regressions. |
| `tests/e2e/engine-lifecycle.e2e.spec.ts` | Gate 1 | State machine | Engine selection/lifecycle remains coherent through browser-level flows. |
| `tests/e2e/goal-setting.e2e.spec.ts` | Gate 5 | Human journey | Goal-setting UX remains usable; advisory unless current release scope includes goals. |
| `tests/e2e/analytics-suite.e2e.spec.ts` | Gate 1 | Product truth / math | Analytics page aggregates meaningful session data; secondary to `analytics-truth` when overlapping. |
| `tests/e2e/infra.probe.e2e.spec.ts` | Gate 1 baseline | Message/probe contract | Built app boots with expected readiness markers; not product proof alone. |
| `tests/live/cloud-token-gates.live.spec.ts` | Gate 3 | Security/product rule | Deployed Cloud token denials for Free, expired trial, and over-quota are fail-closed. |
| `tests/live/pro-stt-artifact-matrix.live.spec.ts` | Gate 1 / Gate 3 | Human journey / running app | Real Pro STT path creates transcript, save/history/detail, AI feedback, and PDF artifact. |
| `tests/live/private-cache.live.spec.ts` | Gate 1 / Gate 3 | State machine / running app | Private model/cache path starts and remains usable across repeated starts. |
| `tests/live/first-time-tester-private-trial.live.spec.ts` | Gate 1 / Gate 5 | Human journey | Fresh active-trial tester can reach Private STT path and produce release evidence. |
| `tests/live/user-filler-words-persistence.live.spec.ts` | Gate 1 / Gate 3 | Product rule / persistence | Custom filler words persist in the deployed app and are retrievable for the same user. |
| `tests/live/stt-switching-contract.live.spec.ts` | Gate 3 | State machine / running app | Deployed STT mode switching follows entitlement and lifecycle rules. |
| `tests/live/stripe-checkout-readiness.live.spec.ts` | Gate 3 | Running app / payment rule | Stripe checkout readiness works in test mode without production-charge assumptions. |
| `tests/live/stripe-webhook-readiness.live.spec.ts` | Gate 3 | Running app / webhook rule | Stripe webhook readiness is observable against deployed infrastructure. |
| `tests/live/stripe-security.canary.spec.ts` | Gate 2 / Gate 3 | Security rule | Checkout origin cannot be client-spoofed into unsafe redirects. |
| `tests/canary/smoke.canary.spec.ts` | Gate 1 / Gate 5 | Human journey / running app | Production app is reachable and minimally usable with provisioned user. |
| `tests/canary/user-filler-words.canary.spec.ts` | Gate 1 | Product rule / running app | Production custom-filler path remains alive; secondary to live persistence matrix. |

Non-counted unless explicitly promoted: `tests/e2e/dump-ground/*`, `tests/e2e/diagnostics/*`, `tests/live/benchmark-*.live.spec.ts`, `tests/live/stt-accuracy-integration.live.spec.ts`, `tests/live/stt-integration.live.spec.ts`, `tests/live/live-transcript.live.spec.ts`, `tests/live/analytics-live-native-probe.live.spec.ts`, `tests/live/analytics-journey.live.spec.ts`, `tests/live/auth.live.spec.ts`, `tests/live/upgrade.live.spec.ts`, `tests/live/tester-b-private-native-stt.live.spec.ts`, `tests/live/driver-dependent/private-stt.live.spec.ts`, `tests/soak/*`, and `tests/stt-correctness/wer-baseline.spec.ts`. These remain diagnostic, advisory, legacy-overlap, or release-scope-dependent until a specific RC contract promotes them.

## RC-Counted Unit / Component Ledger

These unit/component files currently count toward RC because they enforce a product, security, math, state-machine, or message-protocol contract. Other unit/component files may remain useful, but they are advisory unless promoted here.

| File | Gate | Contract Source | Counted Claim |
|---|---|---|---|
| `backend/supabase/functions/assemblyai-token/index.test.ts` | Gate 2 / Gate 3 | Security/product rule | Cloud token auth, Pro entitlement, quota, and provider-call behavior are fail-closed. |
| `backend/supabase/functions/check-usage-limit/index.test.ts` | Gate 2 | Security/product rule | Usage/quota checks deny unsafe starts instead of failing open. |
| `backend/supabase/functions/check-usage-limit/adversarial.test.ts` | Gate 2 | Security/product rule | Adversarial quota/auth cases remain fail-closed. |
| `backend/supabase/functions/_shared/cors.test.ts` | Gate 2 | Security rule | Trusted origins are echoed and untrusted origins are not. |
| `backend/supabase/functions/stripe-webhook/index.test.ts` | Gate 2 / Gate 3 | Security/payment rule | Stripe webhook happy path mutates state through the expected contract. |
| `backend/supabase/functions/stripe-webhook/adversarial.test.ts` | Gate 2 / Gate 3 | Security/payment rule | Duplicate/replayed webhook events are idempotent and safe. |
| `backend/supabase/functions/get-ai-suggestions/index.test.ts` | Gate 2 | Security/product rule | AI suggestion function validates auth/input and returns structured errors. |
| `frontend/src/constants/__tests__/subscriptionTiers.test.ts` | Gate 1 / Gate 2 | Product rule | Free, future Basic, active trial, expired trial, and Pro tier semantics match product access. |
| `frontend/src/hooks/__tests__/useSessionLifecycle.test.tsx` | Gate 1 / Gate 2 | State machine / product rule | Session lifecycle enforces STT entitlement and mode availability rules. |
| `frontend/src/config/__tests__/env.test.ts` | Gate 2 | Security/product rule | Test/E2E flags do not leak into production assumptions. |
| `frontend/src/services/transcription/modes/__tests__/NativeBrowser.test.ts` | Gate 1 / Gate 5 | State machine | Native Web Speech start/stop/restart/error/interim/final behavior follows the browser strategy contract. |
| `frontend/src/services/transcription/modes/__tests__/nativeBrowserStrategies.test.ts` | Gate 1 / Gate 5 | State machine / browser contract | Chrome/Edge/Safari/generic/unsupported strategies are configured and extracted predictably. |
| `frontend/src/services/transcription/modes/__tests__/CloudAssemblyAI.test.ts` | Gate 1 / Gate 3 | Message protocol / product rule | Cloud mode sends expected keyterms/audio frames and handles websocket/token lifecycle. |
| `frontend/src/services/transcription/modes/__tests__/PrivateWhisper.test.ts` | Gate 1 | State machine / STT contract | Private buffering, rejection, retry, and transcript emission protect first-use and tail behavior. |
| `frontend/src/services/transcription/engines/__tests__/PrivateSTT.test.ts` | Gate 1 | State machine / product rule | Private engine selection and v2/v4/fallback behavior are explicit and fail predictably. |
| `frontend/src/services/transcription/engines/__tests__/TransformersJSEngine.worker.test.ts` | Gate 1 | Message protocol | Private worker boundary responds or times out instead of hanging. |
| `frontend/src/services/transcription/engines/__tests__/transformers-js.worker.protocol.test.ts` | Gate 1 | Message protocol | Worker init/transcribe/error/destroy protocol is honored directly. |
| `frontend/src/services/transcription/__tests__/ModelManager.test.ts` | Gate 1 | State machine / cache decision table | Private model availability fails closed for missing, partial, unrelated, blocked, or corrupt storage. |
| `frontend/src/services/transcription/__tests__/TranscriptionPolicy.test.ts` | Gate 2 | Product rule | STT policy allows only the modes permitted by tier and runtime state. |
| `frontend/src/services/transcription/__tests__/TranscriptionService.race.test.ts` | Gate 2 | State machine | Recording races cannot overwrite the active transcription run. |
| `frontend/src/services/transcription/__tests__/TranscriptionService.zombie.test.ts` | Gate 2 | State machine | Stale engine callbacks cannot corrupt a later session. |
| `frontend/src/utils/__tests__/fillerWordUtils.test.ts` | Gate 1 / Gate 2 | Math / regex safety | Default and custom filler matching is countable, escaped, and safe. |
| `frontend/src/utils/__tests__/sessionAnalysis.test.ts` | Gate 1 | Math / product rule | WPM, filler totals, clarity, and guidance are derived from countable transcript/duration inputs. |
| `frontend/src/services/transcription/utils/__tests__/AudioProcessor.test.ts` | Gate 1 | Math / message protocol | PCM conversion, WAV shape, concatenation, buffering, downsampling, and worker timeout follow deterministic contracts. |
| `frontend/src/services/transcription/utils/__tests__/audio-processor.worker.test.ts` | Gate 1 | Math / message protocol | Worker-side audio conversion and downsampling match the same deterministic audio contracts. |
| `frontend/src/components/session/__tests__/LiveRecordingCard.test.tsx` | Gate 5 | Human journey | Private setup/listening/processing copy and state expectations prevent blank-wait confusion. |
| `frontend/src/components/session/__tests__/MetricExplanationCards.test.tsx` | Gate 1 / Gate 5 | Human journey / math explanation | Analytics explanations tell users why the number changed and what to try. |
| `frontend/src/components/session/__tests__/SpeakingTipsCard.component.test.tsx` | Gate 5 | Human journey | Speaking guidance remains actionable and understandable. |
| `frontend/src/components/session/__tests__/StatusNotificationBar.test.tsx` | Gate 5 | Human journey | Recoverable recording/STT states surface a clear next action. |
| `frontend/src/hooks/useSpeechRecognition/__tests__/integration.test.tsx` | Gate 2 / Gate 5 | State machine / human journey | Mic denial and speech-recognition integration errors become visible state rather than silent failure. |
| `tests/analytics/math-integrity.test.ts` | Gate 1 | Math | Known transcript/duration inputs produce hand-checkable WPM and filler values. |
| `tests/release/tester-instructions.test.ts` | Gate 5 | Human journey / product rule | Tester instructions match current product behavior and do not reference removed promo-code flows. |

Unit/component files not listed above are advisory by default. They still protect local behavior and refactor confidence, but they do not close an RC gate unless this ledger is updated with a contract source and counted claim.

## Gate Coverage Map

### Gate 1 - Product Truth

Objective: prove SpeakSharp behaves according to its product contract.

| Folded Under Gate 1 | Why It Belongs |
|---|---|
| `CI - Test Audit` workflow | Baseline correctness: unit, Edge, build, health, E2E, Lighthouse/report. |
| `tests/e2e/primary-journey.e2e.spec.ts` | Core tier/STT user journey under deterministic mocks. |
| `tests/e2e/analytics-truth.e2e.spec.ts` | Transcript -> analytics -> reload/export truth. |
| `tests/e2e/user-features.e2e.spec.ts` | Free/Pro feature matrix, AI Coach, PDF/export behavior. |
| `tests/e2e/user-filler-words.e2e.spec.ts` | Custom filler words affect analysis and persist. |
| `tests/analytics/math-integrity.test.ts` | Analytics formulas stay truthful. |
| `frontend/src/services/transcription/modes/__tests__/NativeBrowser.test.ts` | Native Web Speech state-machine contract: start/stop, restart debounce, duplicate `onend`, recoverable errors, interim/final emission. |
| `frontend/src/services/transcription/modes/__tests__/nativeBrowserStrategies.test.ts` | Browser strategy contract for Chrome/Edge/Safari/generic/unsupported and Web Speech result-slot extraction. |
| `frontend/src/services/transcription/engines/__tests__/TransformersJSEngine.worker.test.ts` | Private worker boundary contract: init response and timeout instead of infinite hang. |
| `frontend/src/services/transcription/engines/__tests__/transformers-js.worker.protocol.test.ts` | Direct Private worker protocol: E2E init, pre-init transcribe error, model-load failure error response, transcribe result, destroy acknowledgement. |
| `frontend/src/services/transcription/engines/__tests__/PrivateSTT.test.ts` | Private engine routing contract: default v2 path, explicit legacy/v4 overrides, failed v4 isolation, mock path, actual fallback engine reporting, and v4 q4 split availability copy/size. |
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
| `tests/live/cloud-token-gates.live.spec.ts` | Live Cloud token denials: Free/expired/over-quota. |
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
| `pro-stt-artifact-matrix.yml` | Gate 1/Gate 3 Pro STT artifact path | Counted release-time evidence. |
| `observability-api-smoke.yml` | Public launch observability/support evidence | Advisory for controlled tester release; counted for public launch readiness. |
| `benchmarks.yml` | STT/model/provider performance ceiling | Advisory; counted only when changing engine/model/performance SLA. |
| `stress-endurance.yml` | Durability/stability | Advisory unless stability is the current release risk. |
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
| `pro-stt-artifact-matrix.yml` | Manual | Pro STT artifact path. | Yes, release-time or STT changes. |
| `observability-api-smoke.yml` | Manual | Sentry/PostHog API readback. | Yes, release-time/advisory depending launch scope. |
| `benchmarks.yml` | Schedule/manual | STT ceiling benchmarks. | Advisory, required only for engine/model changes. |
| `stress-endurance.yml` | Schedule/manual | Backend stress/browser endurance. | Advisory unless investigating stability. |
| `setup-test-users.yml` | Manual | Test user provisioning. | Utility, not a correctness gate. |

## Script Inventory

Scripts are maintained only when they are invoked by package scripts, workflows, or documented release/operator procedures. Everything else must be retired or explicitly marked diagnostic.

| Bucket | Scripts | RC Meaning |
|---|---|---|
| Gate runners / CI orchestration | `test-audit.sh`, `run-ci.mjs`, `ci.config.js`, `aggregate-ci.mjs`, `aggregate-playwright.mjs`, `aggregate-vitest.mjs`, `merge-reports.mjs`, `report-ci-timing.mjs`, `run-metrics.sh`, `vitest-ci-reporter.mjs`, `playwright-telemetry-reporter.mjs`, `verify-artifacts.sh`, `verify-build.sh`, `verify-ci-stability.sh` | Maintained Gate 1 / CI evidence plumbing. |
| Gate 2 security / production hardening | `rc-secret-scan.mjs`, `rc-production-hardening.mjs`, `verify-secret-digest.mjs`, `check-eslint-disable.sh`, `check-test-anti-spy.mjs`, `test-integrity-audit.mjs`, `validate-env.mjs`, `preflight.sh`, `pnpm-only.mjs`, `preinstall.sh` | Maintained Gate 2 / safety plumbing. |
| Gate 3 / live environment utilities | `setup-test-users.mjs`, `provision-canary.mjs`, `trigger-canary.mjs`, `trigger-soak.mjs`, `live-observability-proof.mjs`, `stripe-price-audit.mjs` | Maintained live/deployed evidence utilities. |
| Build / local serving utilities | `build.config.js`, `build.config.d.ts`, `serve-e2e.mjs`, `start-server.js`, `generate-lhci-config.js`, `parse-lighthouse.mjs`, `process-lighthouse-report.js`, `print-metrics.mjs`, `write-software-quality-evidence.mjs`, `update-prd-metrics.mjs` compatibility wrapper, `validate-tailwind.mjs` | Maintained workflow/support utilities. |
| STT/model/audio benchmark utilities | `benchmark-assemblyai-ceiling.mts`, `benchmark-filler-ceiling.mts`, `benchmark-whisper-ceiling.mts`, `generate-filler-audio.sh`, `generate-fixtures.sh`, `generate-harvard-audio.mjs`, `download-whisper-model.sh`, `check-whisper-update.sh`, `manual-native-chrome-proof.mjs`, `tools/benchmark-highlighting.ts` | Advisory unless an STT model/provider/performance SLA changes; `manual-native-chrome-proof.mjs` produces Gate 1 evidence when run for RC. |
| Developer recovery / impact tooling | `detect-impact-automation.mjs`, `detect-impacted-tests.mjs`, `ci/impact-validator.mjs`, `ci-telemetry-utils.mjs`, `dev-init.sh`, `env-stabilizer.sh`, `git-pull-fix.sh`, `vm-recovery.sh`, `tools/inspect-db.ts`, `tools/postinstall-check.ts` | Utility only. Destructive recovery scripts require explicit approval and never count as release evidence. |

Retired during RC cleanup because they were unreferenced, broken, obsolete, or stale local diagnostics: `dump-dom.js`, `screenshot-homepage.js`, `run-screenshots.js`, `provision-visual-user.js`, `reset-and-verify.sh`, `update-model.sh`, `tools/high-fidelity-video-producer.tool.ts`, `tools/quick-video-recorder.tool.ts`, and local `debug_strategy.log`.

## What Counts For Release Confidence

### Highest Signal

| Bucket | Why It Counts |
|---|---|
| `tests/e2e/primary-journey.e2e.spec.ts` | Main mocked user journey by tier and STT mode. |
| `tests/e2e/user-facing-regressions.e2e.spec.ts` | Protects human-readable analytics, guidance, and UI expectations. |
| `tests/e2e/analytics-truth.e2e.spec.ts` | Ensures transcript events produce meaningful analytics and survive reload/export. |
| `tests/e2e/user-features.e2e.spec.ts` | Protects Free/Pro feature matrix and export behavior. |
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
| `transformers-js.worker.ts` previously had 0% meaningful contract coverage. | This is the Private latency architecture. | Worker message-protocol tests now cover E2E init, pre-init error, model-load failure error response, transcribe result, and destroy acknowledgement. |
| `ModelManager.ts` had very low coverage. | Model availability/download/cache choices can break Private first-use. | Initial decision-table tests now cover no cache, empty cache, unrelated cache, partial Whisper cache, and complete model cache. Remaining gap: download/status/error event behavior. |
| Native Browser still depends on real browser evidence. | Web Speech behavior cannot be fully mocked. | Keep unit tests for strategy/restart; require latest Chrome trace artifact for RC green. |
| Analytics UI has some 0% component coverage. | Scoring math is covered better than user interpretation surfaces. | Prioritize tests around exact displayed guidance, not decorative charts. |
| Software quality metrics aggregation is advisory evidence. | Raw Lighthouse/coverage artifacts remain valid; generated quality evidence is uploaded separately and no longer rewrites the PRD. | Treat raw CI artifacts as source of truth when generated summaries disagree. |

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
