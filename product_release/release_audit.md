**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18
**Last Updated:** 2026-05-07

# SpeakSharp Release Audit (Forensic Analysis)

## 🔴 RELEASE VERDICT: BLOCKED
**Confidence Score**: 98% (Evidence-based codebase verification)
**Audit v1.1 Integrated:** 2026-05-07

SpeakSharp exhibits a robust frontend and a sophisticated transcription orchestration layer. However, the backend (Edge Functions and Database RPCs) contains **P0 Financial and Security Vulnerabilities** that make the platform unfit for a commercial launch in its current state.

---

## ⚖️ Executive Summary: The "Go/No-Go" Gate

| Category | Status | Risk Level | Rationale |
| :--- | :--- | :--- | :--- |
| **Financial Security** | 🔴 **BLOCKED** | **CRITICAL** | Quota fail-open and token-abuse vulnerabilities allow unlimited Cloud STT costs. |
| **User Privacy** | 🟢 READY | LOW | On-device transcription is functional and prioritized for Pro users. |
| **Operational Stability** | 🟡 CAUTION | MEDIUM | Stabilization churn has created "Test-Aware" production debt. |
| **Product Integrity** | 🔴 **BLOCKED** | **HIGH** | Negative duration exploitation and promo brute-force risks. |

---

## Audit v1.1 Corrections & Current Status

The original audit identified the correct launch blockers. Follow-up verification added these corrections and integrations:

| Finding | Release-Control Impact | Current Status |
| :--- | :--- | :--- |
| **Privacy-First Persistence** | Full transcript text is not stored in Supabase. Persisted session records contain metadata, counts, words, suggestions, engine/mode, and analysis artifacts; transcript text remains client-side for same-session report/PDF generation. | Integrated into PRD, Architecture, and Release Readiness. |
| **CI Metrics Workflow** | Local CI/SQM metrics print to console through the metrics script; local runs do not rewrite markdown coverage tables. Stale markdown coverage display is expected unless the metrics-writing workflow intentionally updates docs. | Integrated into PRD and Release Readiness. |
| **Cloud Boost Moat** | User-specific vocabulary sent to AssemblyAI via `keyterms_prompt` is a Pro Cloud accuracy differentiator when Cloud is explicitly selected. | Integrated into PRD and Feature Validation Matrix. |
| **PDF Export Branding** | Free/basic monthly PDF export counting is intentionally removed because generation is client-side and zero variable cost. All exported PDFs remain SpeakSharp-branded/watermarked, including Pro. | Integrated into PRD, readiness, and roadmap. |

### Remediated Code Paths Awaiting Deployment Validation

| Gate | Current Verification | Status |
| :--- | :--- | :--- |
| **G1: Fail-Closed Usage** | Code path returns `can_start: false` on RPC/internal uncertainty; Deno tests pass locally. | Fix applied; deploy validation pending. |
| **G2: Usage-Aware Token** | AssemblyAI token issuance now checks usage eligibility before minting a paid Cloud token. | Fix applied; deploy validation pending. |
| **G3: Negative Duration** | Forward migration rejects negative duration/increment writes and adds table constraints. | Fix applied; migration validation pending. |
| **G4: Promo Rate Limit** | Promo application has DB-backed failed-attempt throttling and fail-closed behavior on rate-limit uncertainty. | Fix applied; deploy validation pending. |
| **Q1: Pro Session Warning** | Pro users with finite daily remaining time receive the 5-minute warning. | Fix applied; validation pending. |
| **Q2: Safe LLM Parsing** | Gemini suggestions use defensive parsing and safe fallback output. | Fix applied; validation pending. |

### Newly Added Production Tasks

| Item | Severity | Required Action |
| :--- | :--- | :--- |
| `check-usage-limit` uses wildcard CORS instead of the shared request-aware helper. | P1 | Fix applied: switched to shared `corsHeaders(req)`; deploy header validation pending. |
| New non-negative constraints are `NOT VALID`. | P2 | Run one-time production data audit after migration apply. |
| Store creation warning logs unconditionally. | P2 | Fix applied: gated behind development mode. |
| Stripe webhook initializes secrets at module scope with non-null assertions. | P2/P1 if env missing | Fix applied: moved to lazy guarded handler initialization; deploy validation pending. |

---

## 🚨 P0 Release Blockers (Must Fix)

### 1. Quota Fail-Open Vulnerability (`check-usage-limit`)
- **Evidence**: `backend/supabase/functions/check-usage-limit/index.ts:133`
- **Vulnerability**: The function returns `can_start: true` in the catch-all error handler. During database latency or Supabase outages, all users (Free & Pro) bypass usage gates entirely.
- **Impact**: Unlimited free usage of expensive Cloud STT ($0.47/hr).
- **Remediation**: Transition to **Fail-Closed** logic. Return `can_start: false` and a `503 Service Unavailable` on error.

### 2. Cloud STT Token Abuse (`assemblyai-token`)
- **Evidence**: `backend/supabase/functions/assemblyai-token/index.ts`
- **Vulnerability**: The token generator verifies `subscription_status === 'pro'` but **does not verify usage seconds**. A Pro user who has exceeded their 50-hour monthly limit can still generate a valid token and record for hours.
- **Impact**: Direct financial loss. Power users can bypass the 50-hour cap indefinitely.
- **Remediation**: Invoke `check_usage_limit` RPC within the token generation function.

### 3. Negative Duration Exploitation (`update_user_usage` / `heartbeat_session` RPCs)
- **Evidence**: `backend/supabase/migrations/20260309000000_phase2_integration.sql:57` and `backend/supabase/migrations/20260309000000_phase2_integration.sql:313`
- **Vulnerability**: The latest usage RPC path accepts duration/increment parameters and adds them to usage counters without an explicit non-negative guard. `create_session_and_update_usage` has some session-data guard behavior, but `update_user_usage` and `heartbeat_session` remain direct abuse paths if callable with negative increments.
- **Impact**: Permanent bypass of daily/monthly quotas.
- **Remediation**: Add explicit non-negative guards to all usage mutation RPCs and back them with adversarial tests.

### 4. Promo Code Brute-Force (`apply-promo`)
- **Evidence**: `backend/supabase/functions/apply-promo/index.ts`
- **Vulnerability**: Promo codes are predictable 7-digit integers. The Edge Function lacks rate limiting or brute-force protection. A script can guess valid codes in minutes.
- **Impact**: Unauthorized Pro tier access.
- **Remediation**: Implement a DB-backed attempt counter per IP/User and add exponential backoff.

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
- **Finding**: WPM calculation uses `Date.now()` against a persistent `chunks` array that is not cleared in `startRecording`.
- **Bug**: A new session started within 15 seconds of a previous session will include the previous session's speed in its initial "Rolling WPM".

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
