**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18
**Last Updated:** 2026-05-10

# SpeakSharp Release Audit (Forensic Analysis)

## 🔴 RELEASE VERDICT: BLOCKED
**Confidence Score**: 98% (Evidence-based codebase verification)
**Audit v1.1 Integrated:** 2026-05-07

SpeakSharp exhibits a robust frontend and a sophisticated transcription orchestration layer. The P0 backend remediation work is deployed on `1ea2b099`: `deploy-supabase-migrations.yml` run `25620857952` passed, and post-deploy canary runs `25620877113` and `25621064004` passed. Live smoke now verifies Free Cloud-token denial, active promo-Pro Cloud-token issuance, negative-duration rejection, one-time promo redemption/reuse rejection, request-aware usage CORS, and DB/RPC Private session save/readback. The platform remains blocked for commercial launch until the local CI fixes are pushed and GitHub CI passes, browser-level Private transcript/cache is validated with the corrected real audio fixture, analytics persistence is proven across Native/Cloud/Private, and Stripe/Sentry/manual hardware checks are complete.

---

## ⚖️ Executive Summary: The "Go/No-Go" Gate

| Category | Status | Risk Level | Rationale |
| :--- | :--- | :--- | :--- |
| **Financial Security** | 🟡 **PARTIAL LIVE VALIDATION PASSED** | **CRITICAL** | Free Cloud-token denial and active promo-Pro token issuance are live-confirmed; over-limit and expired-promo denial remain pending. |
| **User Privacy** | 🟡 DB SAVE VERIFIED / BROWSER TRANSCRIPT PENDING | LOW | Private DB policy now allows Pro `engine='private'` save/readback. Browser Private trace now proves audio frames and model inference happen, but the model returned empty text on the short fixture; live probes now use a 122.514s speech fixture and emit audio RMS/peak for the next retest. |
| **Operational Stability** | 🟡 CAUTION | MEDIUM | Stabilization churn has created "Test-Aware" production debt. |
| **Product Integrity** | 🟡 **PARTIAL LIVE VALIDATION PASSED** | **HIGH** | Negative duration rejection and promo one-time/reuse behavior are live-confirmed; wrong-code throttling remains pending. |

---

## Audit v1.1 Corrections & Current Status

The original audit identified the correct launch blockers. Follow-up verification added these corrections and integrations:

| Finding | Release-Control Impact | Current Status |
| :--- | :--- | :--- |
| **Zero-Day Coaching Persistence** | Current release contract stores the transcript/analysis snapshot needed for WER, cached AI feedback, PDF regeneration, and session-over-session coaching. Private STT still keeps audio local; transcript storage should be revisited with redaction/encryption after MVP validation. | Integrated into PRD, Architecture, and Release Readiness. |
| **CI Metrics Workflow** | Local CI/SQM metrics print to console through the metrics script; local runs do not rewrite markdown coverage tables. Stale markdown coverage display is expected unless the metrics-writing workflow intentionally updates docs. | Integrated into PRD and Release Readiness. |
| **Cloud Boost Moat** | User-specific vocabulary sent to AssemblyAI via `keyterms_prompt` is a Pro Cloud accuracy differentiator when Cloud is explicitly selected. | Integrated into PRD and Feature Validation Matrix. |
| **PDF Export Branding** | Free/basic monthly PDF export counting is intentionally removed because generation is client-side and zero variable cost. All exported PDFs remain SpeakSharp-branded/watermarked, including Pro. | Integrated into PRD, readiness, and roadmap. |
| **Private STT Launch Policy** | Private STT remains the Pro default/recommended mode, but launch now prioritizes deterministic CPU/Transformers.js setup. WebGPU/WhisperTurbo is an accelerated path after support is verified, not a blocking first-use requirement. | Integrated into PRD, Architecture, Roadmap, Release Readiness, and manual validation. |

### Remediated Code Paths Awaiting Deployment Validation

| Gate | Current Verification | Status |
| :--- | :--- | :--- |
| **G1: Fail-Closed Usage** | Deployed `check-usage-limit` returns structured 401 for missing auth and `can_start:true` only for authenticated Free happy path. | RPC/DB-error fail-closed simulation still pending. |
| **G2: Usage-Aware Token** | Live Free user gets HTTP 403; live active promo-Pro user gets HTTP 200 token with `expires_in:600`. | Over-limit and expired-promo token denial still pending. |
| **G3: Negative Duration** | Live `update_user_usage(-100, 'native')` returned `{"error":"invalid_duration","success":false}`. | Passed for direct negative-duration RPC. |
| **G4: Promo Rate Limit** | Live one-time promo generation/redemption passed; reused promo code was rejected. GitHub `Live Release Matrix` run `25635969309` proved 9 wrong-code attempts returned `[400,400,400,400,400,400,400,400,429]`. | Passed for live wrong-code throttle. |
| **Q1: Pro Session Warning** | Pro users with finite daily remaining time receive the 5-minute warning; GitHub CI is green on `56ce972`. | Live/manual validation pending. |
| **Q2: Safe LLM Parsing** | Gemini suggestions use defensive parsing and safe fallback output; GitHub CI/deploy evidence is green on `56ce972`. | Live suggestion smoke pending. |

### Current Test Evidence (2026-05-09)

| Gate | Result | Release Meaning |
| :--- | :--- | :--- |
| `pnpm test:unit` | ✅ Passed locally on 2026-05-10: `108` files, `649 passed | 1 todo`. | Local unit coverage is green after the custom-words lint fix. |
| `pnpm test:e2e` | ✅ Passed: `40 passed`, `0 failed`, `0 flaky`. | Local mocked orchestration is green. |
| GitHub `CI - Test Audit` | 🔴 Latest `10582935` run `25631918280` failed. | Only `unit` failed: ESLint `no-control-regex` in `useUserFillerWords.ts`; E2E shards were skipped. Local lint/type/unit are green after the fix, but required GitHub CI is not green until rerun passes. |
| Production canary | ✅ Passed post-deploy on `1ea2b099` run `25620877113`, and on `208be4ac` run `25621064004`. | Deployed Native smoke is green after migration/function deploy. |
| Supabase migration + function deploy | ✅ Passed on `1ea2b099`, run `25620857952`. | Required migrations/functions were deployed together. |
| Vercel frontend | ✅ Serving `1ea2b099`. | Bundle reports `VITE_VERCEL_GIT_COMMIT_SHA=1ea2b099ae5115174a1f792e25a334128330b950`. |
| Targeted local regression set | ✅ Passed: `38/38`. | Promo dialog, status bar, STT orchestration, Cloud mode, pause detector, analytics dashboard, and PDF export are green at focused unit/component level. |
| Edge entitlement/token tests | ✅ Passed: `2` files, `15` steps. | Expired promo-only downgrade, paid Pro stale-promo protection, over-quota Cloud denial, and fail-closed usage/token behavior are covered locally. |
| Local promo E2E gate | ✅ Passed: `8/8`. | Rebuilt local artifact plus promo-admin journey and infra probe passed. |
| STT Ceiling Benchmarks | 🔴 Failed on run `25611403312`. | No valid new WER produced. CPU benchmark failed at auth/readiness (`nav-sign-out-button` missing); Native fake-audio produced only one meaningful word, so WER would be meaningless. |
| Supabase migration deploy | ✅ Manual runs `25576997106` and `25573238473` passed on 2026-05-08. | Deploy workflow evidence is green; live DB behavior still needs smoke checks. |
| Live promo entitlement | 🟡 Core entitlement green; browser artifact path blocked by fixture. | Promo `1193119` granted Pro and failed reuse as expected; promo `4132867` granted Pro through the Edge Function. DB/RPC Private save/readback works. Full browser transcript path is blocked until the live audio fixture is corrected. |
| Promo expired component regression | 🟡 Local fixes / deploy + live smoke pending. | The visible-browser expired-promo trap has local coverage. Local backend fixes now deny stale expired-promo Pro access on Cloud token and DB session/heartbeat paths; deploy/live smoke is still pending. |
| Pause/Cloud audio-frame regression | 🟡 Local fix / live analytics proof pending. | Live review found pause metrics could remain flat because Native/Cloud did not centrally pump mic frames into analytics, and Cloud's streaming `processAudio()` path was not called. Local fix pumps mic frames to analytics for non-Private modes and forwards Cloud frames to the streaming engine; targeted regression coverage and typecheck pass. |
| Live audio fixture | 🟡 Local fix applied / browser proof pending. | Invalid `tests/fixtures/10sec.wav` HTML fixture was removed; live configs now inject `tests/fixtures/harvard_benchmark_16k.wav`, a real 16 kHz PCM WAV. Browser Private transcript/WER validation still must be run. |

This evidence lowers the current risk from "unfixed code/workflows" to "live-validation pending." It does not make the product launch-ready by itself.

### Newly Added Production Tasks

| Item | Severity | Required Action |
| :--- | :--- | :--- |
| `check-usage-limit` uses wildcard CORS instead of the shared request-aware helper. | P1 | Fixed and live-validated: production OPTIONS echoes `https://speaksharp-public.vercel.app`. |
| `apply-promo` still uses wildcard CORS. | P2/P1 hardening | Local fix applied: `apply-promo` now uses shared request-aware CORS and structured internal errors. `deno check` and `pnpm test:edge` pass; deploy/header validation pending. |
| New non-negative constraints are `NOT VALID`. | P2 | Run one-time production data audit after migration apply. |
| Store creation warning logs unconditionally. | P2 | Fix applied: gated behind development mode. |
| Stripe webhook initializes secrets at module scope with non-null assertions. | P2/P1 if env missing | Fix applied: moved to lazy guarded handler initialization; deploy workflow is green, live webhook/env validation pending. |

---

## 🚨 P0 Release Blockers (Fix Applied; Must Validate)

### 1. Quota Fail-Open Vulnerability (`check-usage-limit`)
- **Evidence**: `backend/supabase/functions/check-usage-limit/index.ts:133`
- **Original Vulnerability**: The function returned `can_start: true` in the catch-all error handler. During database latency or Supabase outages, all users (Free & Pro) could bypass usage gates entirely.
- **Impact**: Unlimited free usage of expensive Cloud STT ($0.47/hr).
- **Current Status**: Fix applied locally and Edge Function deploy workflow is green; live fail-closed smoke still required.

### 2. Cloud STT Token Abuse (`assemblyai-token`)
- **Evidence**: `backend/supabase/functions/assemblyai-token/index.ts`
- **Original Vulnerability**: The token generator verified `subscription_status === 'pro'` but did not verify usage seconds. A Pro user who exceeded their monthly limit could still generate a valid token and record for hours.
- **Impact**: Direct financial loss. Power users can bypass the 50-hour cap indefinitely.
- **Current Status**: Fix applied locally; live successful-token and over-limit denial smoke still required.

### 3. Negative Duration Exploitation (`update_user_usage` / `heartbeat_session` RPCs)
- **Evidence**: `backend/supabase/migrations/20260309000000_phase2_integration.sql:57` and `backend/supabase/migrations/20260309000000_phase2_integration.sql:313`
- **Original Vulnerability**: The usage RPC path accepted duration/increment parameters and added them to usage counters without an explicit non-negative guard. `create_session_and_update_usage` had some session-data guard behavior, but `update_user_usage` and `heartbeat_session` remained direct abuse paths if callable with negative increments.
- **Impact**: Permanent bypass of daily/monthly quotas.
- **Current Status**: Forward migration and write-path guards are present; migration apply and negative-increment smoke still required.

### 4. Promo Code Brute-Force (`apply-promo`)
- **Evidence**: `backend/supabase/functions/apply-promo/index.ts`
- **Original Vulnerability**: Promo codes are predictable 7-digit integers and the Edge Function lacked rate limiting or brute-force protection. A script could guess valid codes in minutes.
- **Impact**: Unauthorized Pro tier access.
- **Current Status**: DB-backed throttling and one-time redemption protections are present; live throttling/reuse smoke must remain part of tester-readiness validation.

---

## ⚠️ P1 Critical Defects (Prioritize Before Growth)

### 1. Pro-Tier Warning Exclusion
- **Evidence**: `useSessionLifecycle.ts:226`
- **Defect**: Pro users are explicitly excluded from the 5-minute usage warning.
- **Impact**: High churn risk. Pro users record 2-hour sessions and find their data unsaved/blocked at the very end without any prior notice.
- **Remediation**: Enable the warning for Pro users based on the `v_daily_limit_pro` constant.

### 2. Blind AI Suggestion Parsing
- **Evidence**: `get-ai-suggestions/index.ts:134-136`
- **Defect**: Blindly parses JSON from Gemini Flash without a schema guard or try-catch.
- **Impact**: 500 errors on the Analytics page if the LLM output is malformed.
- **Remediation**: Use `Zod` or a safe-parse wrapper with a "Retry Analysis" UI fallback.

---

## 🏗️ Architectural Debt & Documentation Drift

### 1. "Test-Aware" Production Debt
- **Evidence**: `ProfileGuard.tsx:57` and `SpeechRuntimeController.ts:169`
- **Finding**: Production code contains explicit branches for `ENV.isTest` and `isE2EMockMode`.
- **Violation**: Violates `ARCHITECTURE.md` Pattern 31 (Environment-Agnostic Service Layer).
- **Risk**: Logic intended only for tests may trigger in production, leading to "Synthetic Guest" users accessing Pro features.

### 2. Rolling WPM Pollution
- **Evidence**: `useSessionMetrics.ts:51`
- **Finding**: WPM calculation uses `Date.now()` against a persistent `chunks` array that was not cleared in `startRecording`.
- **Bug**: A new session started within 15 seconds of a previous session could include the previous session's speed in its initial "Rolling WPM".
- **Current Status**: Local fix resets transcript/chunks/filler/pause state after the recording lock is acquired and before engine init. Live analytics validation remains pending.

### 3. Contradictory Feature Claims
- **PRD vs. Code**: `PRD.md` claims "User Filler Words" is implemented and tested. However, `PRD.md:291` marks it as "REJECTED/REVERTED" tech debt.
- **Coverage Transparency**: Legacy PRD coverage displays may show stale values because local SQM/CI metrics print to console rather than rewriting markdown files.

---

## 🏁 Final Go/No-Go Recommendations

1. **NO-GO**: Do not launch until **all P0 blockers (1-4)** are resolved. These are financial, integrity, and unauthorized-access liabilities.
2. **POLISH**: Resolve **P1 Defect 1** (Pro Warning) before accepting first paid users to avoid negative reviews.
3. **HARDEN**: Implement **Fail-Closed** logic across all Edge Functions.
4. **SYNC**: Keep product_release status tables aligned with console-based SQM/CI evidence and avoid treating stale local markdown coverage as runtime truth.

**Audit Status**: 🔴 **BLOCKED**
**Remediation Effort**: ~8-12 Engineering Hours.
