> **Status:** Archived historical source — superseded
> **Not authoritative for:** current product policy or GO/HOLD gates.
> **Current authority:** [`RELEASE_PROCESS.md`](./RELEASE_PROCESS.md) and [`QUALITY.md`](./QUALITY.md).

# Release Candidate Gates

> Gate definitions, not release status.
> Current ship posture, blockers, and latest run IDs live only in `RELEASE_STATUS.md`.

**Purpose:** define the maintained regression gates that must be run before a controlled human tester release.

This is a controlled tester release process, not an enterprise certification audit. A gate is green only when it has a named test, workflow, artifact, or manual checklist with recorded evidence.

## Evidence Rules

RC gates are contract gates, not coverage gates. A counted test must prove an independent requirement, not preserve the current implementation.

### Contract-First Test Rule

Before a test is added to an RC-counted path, the contract source must be clear:

| Contract Source | Examples |
|---|---|
| Mathematical definition | RMS, WPM, filler counts, duration arithmetic, analytics formulas |
| State machine contract | STT restart/stop/error transitions, session lifecycle, entitlement transitions |
| Message protocol | Worker request/response, engine interface results, Edge Function response shape |
| Security/product rule | Tier access, quota fail-closed, token denial, CORS, webhook idempotency |
| Human journey requirement | Fresh signup, recording, transcript, analytics, history/detail, recoverable errors |

If a test's expected value was copied from the current implementation output rather than one of these contract sources, it is suspect and must not be used as RC evidence until reviewed.

### Artifact Freshness Rule

An artifact is stale if any file in the dependency surface of that gate item changed after the artifact was captured. A stale artifact does not count as green. The gate item must be rerun or intentionally downgraded with matching product copy and release notes.

Examples:

| Gate Item | Artifact Becomes Stale When These Change |
|---|---|
| Native Chrome mic proof | Native browser strategy, `NativeBrowser.ts`, STT constants, recording UI/copy, browser-support fallback logic |
| Private STT proof | `PrivateWhisper.ts`, Private engines/workers, `ModelManager.ts`, audio utilities, STT constants, transcript UI/copy |
| STT corpus accuracy proof | `PrivateWhisper.ts`, `TransformersJSEngine.ts`, `transformers-js.worker.ts`, `NativeBrowser.ts`, `nativeBrowserStrategies.ts`, `CloudAssemblyAI.ts`, `audioUtils.impl.ts`, `AudioProcessor.ts`, `sttConstants.ts`, `wer.ts`, STT browser harness scripts/config, or any file under `tests/fixtures/stt-isomorphic/` |
| Analytics truth/usefulness | Analytics/session-analysis utilities, filler-word logic, dashboard/detail UI, persistence hooks |
| Cloud token / Pro cloud-entitled path | `assemblyai-token`, entitlement/tier logic, usage/quota checks, Supabase deploy, Cloud client code |
| UX smoke | Onboarding/session UI, mode selector copy, tester instructions, error-state UI |

### Private saved-transcript fidelity (Gate 1 STT — added 2026-06-29, #891/#892)

Real-mic engine-liveness + metadata are NOT sufficient: they passed 3/3 while the **default Private path dropped the opening clause** (shared capture-path bug; observed clearest on v2). Any change to `PrivateWhisper.ts`, Private engines/workers, audio utilities, `sttConstants.ts`, or transcript capture/trim logic makes this gate stale. On the **persisted** transcript (saved DB row / History detail — NOT the live draft or in-memory buffer), require:

- **Opening anchor** present near the start, after **EVERY onset class — including the immediate-start case** (hit Record → wait for the green "Ready — speak now" pill → speak immediately), not just soft/quiet/delayed/loud. The deployed mic-ready gate (#902/#904) is proven only on a delayed take → **the immediate-start re-gate is the one OPEN pre-beta validation**;
- **Coverage threshold** across expected phrases (not one-keyword-anywhere);
- **No ≥5-word verbatim loop** flagged but the saved transcript is **NOT mutated** (#903 made the saved-path collapse FLAG-ONLY at both sites — `detectRepetitionRisk` records metadata, never deletes);
- **History/detail matches** the saved transcript end-to-end (mic → buffer → decode → DB) AND the **finalize state shows the dimmed draft + honest progress** (#905/#906), never the wrong rolling text as final;
- **Long leading silence** does not produce a hallucinated prefix;
- **Real-mic proof** after any Private capture/buffer/trim change — fake-device tests do not substitute;
- **stop-to-final latency** — **accepted RC limitation (owner, 2026-07-14): a full 5-min single Private v2 recording finalizes in ≈90s** of post-stop processing, surfaced as honest visible "Finalizing…" progress. The earlier `<30s` requirement is **withdrawn/obsolete**; do not gate on it. Faster finalization (streaming / segmentation / multithread) is a post-limitation improvement lane, not a blocker. This is NOT a blocking gate for controlled beta.

For a **v4-targeted** session also confirm `engine_version=private_v4`, runtime/backend/assignment metadata, and no visible/saved phrase loop.

**Private v4 status for this release: ACTIVATION OFF.** Default Private is `private_v2:whisper-base.en`; the PostHog `private_stt_v4_*` flags default off and `VITE_PRIVATE_STT_V4_DISABLED='true'` is the build-time hard kill. The automated **`.github/workflows/private-model-smoke.yml`** ("Private v4 model-pipeline smoke") is a **dependency + deterministic-inference REGRESSION GUARD for the DORMANT v4 stack** (`@huggingface/transformers`) — it fetches the pinned base_q4 model, runs deterministic inference, and asserts token overlap. It is **repaired and green**, but it is **NOT a release proof**, NOT coverage of production Private v2 (`@xenova/transformers`), and does NOT prove browser/WebGPU/mic UX. It is non-blocking (manual dispatch + weekly schedule only) and does not activate v4.

### Ship Signal Rule

RC gate status is the ship/no-ship signal. Quality score, coverage, Lighthouse, benchmarks, backend stress, and browser endurance results are advisory unless explicitly named as a blocking gate item. A high quality score cannot override a red or stale RC gate item.

### Same-SHA Release Candidate Rule

Any commit considered a release candidate must pass full CI, production canary, and Service-Level Evidence on the same commit SHA before it can be called release-ready. CI optimizations may reduce wasted runs while iterating, but they do not lower the final release bar. A Vercel canary must test the deployed production URL because users receive Vercel's deployed artifact, not CI's internal build artifact.

**Canary cadence — daily active-trial ≠ complete release qualification (#1294).** The production canary runs on two automated cadences: a **daily active-trial** lane proving the complete Pro product path, and a **weekly Stripe test-mode/test-clock billing qualification** (checkout → webhook → renewal → payment failure → cancellation → continuation) that never charges a live card. A green **daily active-trial** result proves the product path only; it must **not** be consumed as complete release qualification. Release-readiness requires **both** a green daily active-trial result **and** a current (most-recent-weekly, not stale) green billing qualification. Neither cadence may be reported as the other, and neither may cancel the other. The strict production paid verifier (real Stripe-backed entitlement) is reserved for a separately authorized live commercial-readiness proof and is **not** the scheduled no-charge qualification.

### Raw Artifact Source Rule

When generated summaries disagree with raw CI/browser artifacts, the raw artifact wins. Coverage JSON, Playwright reports, Vitest output, Lighthouse JSON, workflow logs, stress/endurance JSON, and browser trace files are the source of truth until the aggregator is fixed and rerun on the same commit.

### Pro Test Account Rule

Gate 3 Cloud/Pro evidence requires a known-good Pro cloud-entitled account. The account must be provisioned by the maintained Test User Admin workflow or an equivalent documented operator procedure, and the current credential secret owner/update path must be recorded before an RC run. A stale, trial-only, expired, or visually Pro-but-not-cloud-entitled account does not count as Cloud evidence.

## Gate Summary

The everyday CI workflow remains `.github/workflows/ci.yml` and is intentionally not the full release certification suite. RC gates are release-time controls:

- Run the automated RC command suite with `pnpm run audit` or the manually dispatched `Release Candidate Gates` workflow.
- Run an individual gate at any time with `pnpm rc:gate:1:product`, `pnpm rc:gate:2:sast`, `pnpm rc:gate:3:dast`, `pnpm rc:gate:4:sca`, or `pnpm rc:gate:5:ux`.
- Gate 1 includes external workflow and manual evidence that is recorded in the release matrix, not all launched by `pnpm run audit`.
- Do not add these full RC gates to the push/PR main CI path unless a gate graduates into everyday correctness.

Glossary:

- **SAST** = Static Application Security Testing. Code-level checks that do not require a running browser session, such as lint/typecheck, secret scanning, production hardening checks, entitlement/quota unit tests, and Edge Function tests.
- **DAST** = Dynamic Application Security Testing. Running-app checks that exercise real browser/app behavior, including local mocked Playwright flows and live deployed flows against Supabase, Stripe, Cloud token gates, persistence, and STT switching.
- **SCA** = Software Composition Analysis. Dependency and runtime supply-chain review, currently focused on critical dependency advisories via `pnpm audit --audit-level critical` plus runtime warning review.

| RC Gate | Name | Blocks Tester Release? | Maintained Regression Evidence |
|---|---|---:|---|
| Gate 1 | Product truth gate | Yes | `pnpm rc:gate:1:product`, `CI - Test Audit`, `Live Release Matrix` (entitlement/sample suites), `Pro STT Artifact Matrix`, deploy/canary workflows, Native Chrome mic proof |
| Gate 2 | SAST / code review | Yes if P0 found | `pnpm rc:gate:2:sast`, `pnpm quality`, `pnpm test:edge`, entitlement/token/quota unit tests, env/test-mode tests, frontend secret scan, production E2E/test-branch hardening check |
| Gate 3 | DAST / running app review | Yes if P0 found | `pnpm rc:gate:3:dast`, live Playwright tests against production URLs and Supabase Edge Functions |
| Gate 4 | SCA / dependency review | Yes only for critical exploitable risk | `pnpm audit --audit-level critical` plus GitHub Actions/runtime warning review |
| Gate 5 | UX smoke | Yes if onboarding/core flow is unusable | Canary, primary/user-feature/error-state E2E, Native browser-dependent manual wording check |

## Gate 1 - Product Truth

Required maintained tests and workflows:

| Risk | Regression Test / Workflow | Required Evidence |
|---|---|---|
| Legacy trial timestamp or stale profile grants Pro | `.github/workflows/live-release-matrix.yml` with entitlement/sample suites, `frontend/src/constants/__tests__/subscriptionTiers.test.ts`, `frontend/src/hooks/__tests__/useSessionLifecycle.test.tsx` | Effective tier stays `free`, legacy trial timestamps do not grant Pro, and STT mode defaults to Browser unless the server reports sample/paid entitlement |
| Free access sanity | `tests/e2e/user-features.e2e.spec.ts` plus sample entitlement proof | Baseline users retain Browser/Free-safe path, get at most one bounded Private sample, and do not retain Cloud entitlement |
| Pro Cloud artifact path | `.github/workflows/pro-stt-artifact-matrix.yml`, `tests/live/pro-stt-artifact-matrix.live.spec.ts` | Cloud selected, token issued to Pro, transcript visible, stop/save, history/detail, AI feedback, PDF transcript text |
| Pro Private artifact/cache path | `.github/workflows/live-release-matrix.yml` with `suite=private-cache`, `tests/live/private-cache.live.spec.ts` | Private starts, caches, saves, and remains usable on second start |
| Account-wide active recording mutex | `tests/live/account-wide-recording-mutex.live.spec.ts`, included in `pnpm rc:dast:live` | Same account in two isolated browser contexts cannot record concurrently; the second context remains non-recording and sees clear active-session / another-device copy |
| Native Chrome mic | `scripts/manual-native-chrome-proof.mjs` | Real Chrome `getUserMedia`, live transcript, stop/save, history, analytics, Chrome/Edge `continuous=true`, no duplicate transcript loop |
| STT corpus accuracy - deterministic | Harvard WAV/truth fixtures through fake-device browser harness | Code-correctness evidence for chunking, buffering, RMS gates, worker messages, WER scoring, and transcript output against known audio. Native Web Speech may count here only after a probe proves Chrome transcribes the intended fake-audio fixture. |
| STT corpus accuracy - real mic | `pnpm rc:stt:corpus` with Harvard WAV/truth fixtures played with `afplay` through real mic | Product-readiness evidence for the full user audio path. This is the release-time STT evidence for Native Chrome and also validates Private/Cloud under realistic input conditions. |
| Filler value corpus | `conv_01.wav`, `conv_02.wav`, and fixture truth lists | Expected filler counts are explicit and must match transcript-derived analytics; Harvard WER alone does not prove filler detection. |
| CI/deploy/canary | `.github/workflows/ci.yml`, `.github/workflows/deploy-supabase-migrations.yml`, production canary workflow | Latest release commit has green CI, deploy, and canary |
| Session save/history/analytics retrieval | `tests/e2e/analytics-truth.e2e.spec.ts`, `tests/e2e/user-features.e2e.spec.ts`, `tests/live/pro-stt-artifact-matrix.live.spec.ts` | Saved transcript appears in history/detail, analytics values survive reload/export, Cloud PDF includes transcript text |
| Custom filler words save/retrieval | `tests/live/user-filler-words-persistence.live.spec.ts`, `tests/e2e/user-filler-words.e2e.spec.ts`, `frontend/src/utils/__tests__/fillerWordUtils.test.ts` | Custom words persist, reload, and affect analysis without regex/query breakage |

### STT Corpus Gate Policy

STT release evidence has two complementary layers:

| Layer | Mic Path | Purpose | RC Role |
|---|---|---|---|
| Code correctness | Chrome fake media device with checked-in WAV fixtures | Deterministically catches regressions in app-controlled STT code: audio buffering, gates, worker protocol, WER scoring, transcript handling, and filler analytics. | RC-counted for engines proven to receive the intended fixture audio. |
| Product readiness | Real mic with `afplay` and controlled physical setup | Proves the actual user path: mic permission, `AudioContext`, hardware/browser audio processing, Native Web Speech provider behavior, transcript, save/history, and analytics. | RC-counted release-time evidence for Native, Private, and Cloud. |

A green fake-device run does not substitute for a real-mic pass. A real-mic failure does not by itself identify an app-code bug; it identifies the browser/hardware/provider layer that a user will experience and must be triaged before release.

Sub-gates:

| Sub-Gate | Corpus | Pass Evidence |
|---|---|---|
| STT-A Accuracy | Ten canonical Harvard sentence WAV/truth fixtures | Per-engine WER table, transcript, first-text timing, console/page/network errors, and artifact path. Thresholds are set only after a calibration run, then treated as release floors until stale. |
| STT-B Browser Journey | One or two representative fixtures per engine | Record -> transcript -> stop/save -> history/detail -> analytics completes without fatal console/page/network errors. |
| STT-C Filler Value | `conv_01.wav`, `conv_02.wav`, and explicit filler truth lists | Transcript-derived analytics show the expected filler counts and actionable guidance. |

Native Chrome is launch-critical for onboarding. It must have real-mic artifact evidence with recognizable transcript, no repetition loop, no unrecovered `onerror`, and a completed save/history/analytics journey. Fake-device Native evidence is diagnostic only until Chrome Web Speech is proven to transcribe the selected fake WAV content.

Native regression note, 2026-05-25: commit `fc0ffc39` changed Native Web Speech from `continuous=true` to `continuous=false` after final-result dedup was already present. A/B artifacts showed `continuous=false` produced zero `onresult` events, four VAD truncation drops, and no saved transcript, while `continuous=true` produced interim/final results and completed save/history/analytics. Chrome/Edge Native must not be changed back to `continuous=false` without a fresh real-mic A/B proving transcript, save/history/analytics, and no duplicate loop.

Required Native duplicate-loop coverage:

| Scenario | Required Evidence |
|---|---|
| Continuous session, no restart | Say `the quick brown fox` twice in one recognition session; transcript contains the phrase exactly twice, not four times. |
| Repeat across restart | Say `the quick brown fox`, allow or force recognition `onend` and restart, say it again; transcript contains the phrase exactly twice across the result-index reset boundary. |

Real-mic corpus command:

```bash
BASE_URL=http://127.0.0.1:4173 STT_MODES=native,private,cloud STT_FIXTURES=h1_1,h1_2 pnpm rc:stt:corpus
```

The command writes a JSON artifact under `/private/tmp` unless `STT_CORPUS_OUT` is set. For a full STT-A calibration run, set `STT_FIXTURES=h1_1,h1_2,h1_3,h1_4,h1_5,h1_6,h1_7,h1_8,h1_9,h1_10`.

## Gate 2 - SAST / Code Review

Required maintained tests:

| OWASP-Aligned Risk | Regression Test | Expected Assertion |
|---|---|---|
| Broken access control: Free user Cloud token | `backend/supabase/functions/assemblyai-token/index.test.ts` | Non-Pro request returns 403 and AssemblyAI provider is not called |
| Broken access control: Private sample Cloud token | `backend/supabase/functions/assemblyai-token/index.test.ts`, `tests/live/cloud-token-gates.live.spec.ts` | Private sample / Free users return 403 before provider token mint |
| Insecure design: quota fail-open | `backend/supabase/functions/assemblyai-token/index.test.ts`, `backend/supabase/functions/check-usage-limit/index.test.ts` | Usage verification failure denies start/token and does not mint Cloud STT provider token |
| Auth/session failure | `backend/supabase/functions/check-usage-limit/index.test.ts`, `backend/supabase/functions/assemblyai-token/index.test.ts` | Missing/invalid auth returns structured denial |
| Test/E2E mode leakage | `frontend/src/config/__tests__/env.test.ts`, CI production build validation | Test-only branches are gated by test mode and not production assumptions |
| Test-aware production branch activation | `scripts/rc-production-hardening.mjs` through `pnpm rc:gate:2:sast` | `ENV.isE2E` is compile-time disabled in production builds and sensitive test branches remain guarded |
| Secrets server-side only | `scripts/validate-env.mjs`, `frontend/src/main.tsx`, Edge Function tests | Provider secret keys are not required as frontend `VITE_*` values; frontend uses DSN/project public keys only |
| Stripe open redirect/origin spoofing | `tests/live/stripe-security.canary.spec.ts` | Client-supplied origin does not control checkout return origin |
| Stripe webhook replay/idempotency | `backend/supabase/functions/stripe-webhook/adversarial.test.ts` | Duplicate webhook event is skipped by the atomic RPC path |
| Custom words injection / regex abuse | `frontend/src/utils/__tests__/fillerWordUtils.test.ts` | Malformed custom words cannot crash analysis or create unsafe regex behavior |
| CORS misconfiguration | `backend/supabase/functions/_shared/cors.test.ts` | Trusted origins are echoed and untrusted origins are not |
| Refresh/concurrency during recording | `frontend/src/services/transcription/__tests__/TranscriptionService.race.test.ts`, `frontend/src/services/transcription/__tests__/TranscriptionService.zombie.test.ts`, `frontend/src/hooks/__tests__/useSessionLifecycle.test.tsx` | Stale recording callbacks cannot overwrite the active run or corrupt lifecycle state |
| Denied mic permission | `frontend/src/hooks/useSpeechRecognition/__tests__/integration.test.tsx`, `frontend/src/services/transcription/modes/__tests__/NativeBrowser.test.ts`, `product_release/MANUAL_HARDWARE_VALIDATION.md` | Permission denial becomes a user-visible error path and is also checked manually before release |

Gate command set:

```bash
pnpm quality
pnpm rc:sast:secrets
node scripts/rc-production-hardening.mjs
pnpm test:edge
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false \
  frontend/src/config/__tests__/env.test.ts \
  frontend/src/constants/__tests__/subscriptionTiers.test.ts \
  frontend/src/hooks/__tests__/useSessionLifecycle.test.tsx \
  frontend/src/services/transcription/__tests__/TranscriptionPolicy.test.ts \
  frontend/src/services/transcription/__tests__/TranscriptionService.race.test.ts \
  frontend/src/services/transcription/__tests__/TranscriptionService.zombie.test.ts \
  frontend/src/utils/__tests__/fillerWordUtils.test.ts \
  frontend/src/hooks/useSpeechRecognition/__tests__/integration.test.tsx
```

## Gate 3 - DAST / Running App

Required maintained live workflows:

| Running-App Risk | Workflow / Test | Required Evidence |
|---|---|---|
| Legacy trial downgrade trap | Entitlement/sample smoke | Legacy trial timestamps do not grant Pro; effective tier is `free`, stored status is `free`, mode is Browser unless sample/paid entitlement is present |
| Invalid auth | `tests/live/cloud-token-gates.live.spec.ts`, `backend/supabase/functions/assemblyai-token/index.test.ts` | Missing/invalid auth returns 401 and no token issued |
| Cloud token denied for Free/sample/over-quota | `tests/live/cloud-token-gates.live.spec.ts` | Free and Private-sample users return 403, over-quota returns 429, no token issued |
| Exact-origin CORS (deployed, fail-closed) | `tests/live/cors-exact-origin.live.spec.ts` (in `pnpm rc:dast:live`) | Against the DEPLOYED edge functions: the approved origin is echoed exactly; hostile lookalikes/wrong-protocol/unapproved-port/localhost-lookalike get 403 with NO `Access-Control-Allow-Origin`. **Non-skipping / fail-closed** — no capability probe, no config-based skip; missing `SUPABASE_URL` throws (never silently passes). No checkout/charge/token/v4 activation occurs. |
| Private sample reuse | sample entitlement live/unit proof | A second unpaid Private session is denied after the one sample is claimed/completed |
| Cloud Pro artifact path | `Pro STT Artifact Matrix` with `mode=cloud` | Transcript -> save -> history/detail -> AI -> PDF text |
| Stripe checkout/webhook readiness | `tests/live/stripe-checkout-readiness.live.spec.ts`, `tests/live/stripe-webhook-readiness.live.spec.ts` | Test-mode checkout/webhook path completes without production-charge assumptions |
| Stripe webhook replay | `backend/supabase/functions/stripe-webhook/adversarial.test.ts` | Duplicate event skips mutation through idempotent RPC result |
| Custom filler words live persistence | `tests/live/user-filler-words-persistence.live.spec.ts` | Filler words save, reload, and are retrievable for the same user |
| Account-wide active recording mutex | `tests/live/account-wide-recording-mutex.live.spec.ts` | Same signed-in account cannot start concurrent recordings from two isolated browser contexts/profiles |
| Denied mic permission | `product_release/MANUAL_HARDWARE_VALIDATION.md`, `frontend/src/hooks/useSpeechRecognition/__tests__/integration.test.tsx` | Browser-denied mic path is documented and produces a visible error |
| Refresh during recording | `tests/e2e/analytics-truth.e2e.spec.ts`, lifecycle unit tests in Gate 2 | Saved analytics/history survive reload; stale recording callbacks are unit-guarded |
| Canary user path | Production canary workflow | Production URL can be exercised with provisioned user |

Gate command set:

```bash
pnpm rc:dast:local
pnpm rc:dast:live
```

## Gate 4 - SCA / Dependency Review

Required maintained checks:

```bash
pnpm audit --audit-level critical
```

Release rule:

- Critical runtime exploit with an available safe fix blocks tester release.
- Non-critical advisories and GitHub Actions runtime deprecation warnings are P2 unless they break CI or expose secrets.
- Do not churn dependency majors during the final release window unless the issue is a real P0/P1.

## Gate 5 - UX Smoke

Required maintained checks:

| UX Risk | Regression Test / Review | Required Evidence |
|---|---|---|
| User does not know what to click first | Canary + primary journey smoke | Session entry and recording CTA are reachable |
| STT mode is unclear | `tests/e2e/user-features.e2e.spec.ts`, Native manual checklist | Private/Cloud/Native selection is visible and current mode is inspectable |
| Legacy trial copy traps user | legacy-entitlement smoke / product-copy sweep | Legacy trial timestamps never show current-user trial entitlement copy; users land in the Browser-safe path with the Private sample or paid Early Access copy |
| Native support expectations | Tester instructions and manual Native proof | Native is explicitly Chrome/browser-dependent and included only with Chrome proof. If Edge has no passing proof, UI/tester copy must say Chrome recommended instead of implying Edge parity. |
| Errors are actionable | `tests/e2e/error-states.e2e.spec.ts` | User sees recoverable state, not only internal diagnostics |
| Private first-use setup | `tests/e2e/user-features.e2e.spec.ts`, `tests/live/private-cache.live.spec.ts` | Private setup/cache path is understandable enough to start and rerun without stale cache failure |
| Private-first mode selector (responsive/opaque/single-surface) | `tests/e2e/mode-selector-private-first.e2e.spec.ts` | Selector order Private (Recommended) → Browser (Quick preview) → Cloud (Pro) across 320/375/390/1280px; the mode description is ONE controlled flyout (never 3 overlapping bubbles), geometrically disjoint from menu/Live Coaching and in-viewport; the open menu is fully opaque at every animation frame; the touch "About" help and the dropdown are mutually exclusive (never both open); no horizontal overflow. |
| Post-save one-surface + persistent Analytics cue | `tests/e2e/post-save-consolidation.e2e.spec.ts` | Settled post-save Session page has ONE saved-state surface (single status bar "Session saved · …"), exactly one Analytics action (→ `/analytics`) with a bounded pulse → PERSISTENT green cue (reduced-motion: straight to persistent), a quiet Private CTA only for eligible Native, and NO separate "Next: Analytics" toast / no duplicated pill message; validated 320/375/390/1280px; AA contrast on the rendered cue. |

Manual Native/Safari/browser wording check:

- **Owner:** release runner for the current RC.
- **Artifact:** screenshot or browser trace attached to the RC evidence bundle.
- **Pass:** Native mode copy is visible before or during selection, identifies Native as browser-dependent, and offers Private as the fallback path when the browser does not support reliable Web Speech.
- **Fail:** unsupported or weak browsers silently fail, or the user only sees internal diagnostics without a clear next action.

Automated UX smoke is green when `pnpm rc:gate:5:ux` passes. Subjective copy polish can continue as P2, but it should not reopen release-critical code unless the smoke finds an unusable onboarding/core-flow issue.

**UX review screenshots are NOT product/STT evidence.** The mode-selector and post-save specs write PNGs (`test-results/mode-selector/*`, `test-results/post-save-consolidation/*`) that `.github/workflows/ci.yml` uploads as `ux-review-screenshots-shard-*` with **`retention-days: 1`** (mirrored by `review-evidence.yml`). These are short-lived visual aids for PR/layout review only — they are ephemeral and must never be cited as STT accuracy, transcript-fidelity, or product-truth evidence. The pass/fail signal is the spec assertions themselves, not the images.

## Observability API Readback Requirements

The workflow exists at `.github/workflows/observability-api-smoke.yml` and the proof script exists at `scripts/live-observability-proof.mjs`.

Required GitHub repository secrets:

| Secret | Purpose |
|---|---|
| `SENTRY_DSN` | Sends frontend synthetic smoke event directly to Sentry ingest |
| `SENTRY_AUTH_TOKEN` | Reads the synthetic frontend/edge event back from Sentry API |
| `SENTRY_ORG` | Sentry API organization slug |
| `SENTRY_PROJECT` | Sentry API project slug |
| `POSTHOG_PROJECT_API_KEY` | Captures synthetic PostHog launch event |
| `POSTHOG_PERSONAL_API_KEY` | Queries PostHog events through API |
| `POSTHOG_PROJECT_ID` | PostHog project ID for query endpoint |
| `POSTHOG_API_HOST` | Optional; defaults to `https://us.posthog.com` |
| `POSTHOG_INGEST_HOST` | Optional; defaults to `POSTHOG_API_HOST` when set, otherwise `https://us.posthog.com` |
| `OBSERVABILITY_SMOKE_SECRET` | Authenticates the deployed Edge observability smoke function |

Required Supabase Edge Function secrets:

| Secret | Purpose |
|---|---|
| `SENTRY_DSN` | Lets `observability-smoke` send the Edge synthetic event |
| `OBSERVABILITY_SMOKE_SECRET` | Must match the GitHub repository secret of the same name |

Required permissions:

- Sentry token must read project events for the configured org/project.
- PostHog personal token must run project queries.
- The Supabase function `observability-smoke` must be deployed and configured.

Green evidence:

```text
LIVE_OBSERVABILITY_API_EVIDENCE {
  frontendSentry.apiConfirmed: true,
  edgeSentry.apiConfirmed: true,
  posthog.apiConfirmed: true
}
```

Current run IDs and pass/fail status for this gate live only in `RELEASE_STATUS.md` (the status SSOT).
This document defines the stable gate; it does not record changing run IDs.

## Evidence Freshness Contract

Each release gate is green only when the definition of green is backed by a named artifact that a reviewer can inspect without relying on operator memory. The active artifact is always the latest complete passing run. If a newer run fails any required criterion, the parent gate returns to red until a later complete run passes every criterion. Every artifact update must record `Last updated by: [initials] [date] [artifact path]`.

## Named STT Gate Artifacts

The STT binary gates fold into their parent RC gates with these named artifacts (current run/status posture lives in `RELEASE_STATUS.md`; these stable requirements live here).

| Gate | Required Current Artifact |
|---|---|
| Fresh Trial Private sample recording — Transcript/Save/History Path | `/private/tmp/speaksharp-private-human-[timestamp].json`; must include `SESSION_LIFECYCLE_WARMUP`, model setup/download state, chunk RMS/duration rows, first partial timestamp/text, console events, save result, and history/detail proof. |
| Native Browser Chrome human-mic proof | `/private/tmp/speaksharp-native-[timestamp].json`; must include event order from `onspeechstart -> first onresult`, selected transcript on stop, save/history/detail proof, analytics proof, and no unintended 4-word sequence appearing more than once. |
| Cloud Pro proof | `/private/tmp/cloud-artifact-[timestamp].log`; must show AssemblyAI token HTTP 200, transcript/save/history/detail proof, AI suggestions, PDF export, and Pro entitlement context. |
| Custom word analytics proof | Browser/session artifact showing words such as `like = 1` or `basically = 1` after adding the custom word through the UI, then saving and opening detail/analytics. |
| PDF export proof | Saved-session PDF artifact whose transcript, duration, WPM, filler/custom word counts, and session metadata match the saved detail view within ±15%. |
| Session Status UX | Screenshot/video or browser trace showing one clear status/progress surface (`StatusNotificationBar`), Private setup/download/ready states, and no duplicate or internal FSM/debug status obstructing the user flow. |
