**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18
**Last Updated:** 2026-05-06

# SpeakSharp Release Audit (Forensic Analysis)

## 🔴 RELEASE VERDICT: BLOCKED
**Confidence Score**: 98% (Evidence-based codebase verification)

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

### 3. Negative Duration Exploitation (`update_user_usage` RPC)
- **Evidence**: `20260224000000_usage_tier_refactor.sql:35`
- **Vulnerability**: The RPC `create_session_and_update_usage` accepts a `p_duration` parameter and adds it to `usage_seconds`. It lacks a non-negative constraint. A malicious user can send a negative duration to "refund" their daily usage.
- **Impact**: Permanent bypass of daily/monthly quotas.
- **Remediation**: Add `CHECK (p_duration >= 0)` constraint to the RPC parameter or logic.

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
- **Coverage Transparency**: `PRD.md` summary table reports **0% coverage** despite having ~600 tests. This creates a perception of project abandonment or failure for external auditors.

---

## 🏁 Final Go/No-Go Recommendations

1. **NO-GO**: Do not launch until **P0 Blockers 1, 2, and 3** are resolved. These are financial liabilities.
2. **POLISH**: Resolve **P1 Defect 1** (Pro Warning) before accepting first paid users to avoid negative reviews.
3. **HARDEN**: Implement **Fail-Closed** logic across all Edge Functions.
4. **SYNC**: Update `PRD.md` summary tables to reflect the actual test coverage (~55%) to restore auditor trust.

**Audit Status**: 🔴 **BLOCKED**
**Remediation Effort**: ~8-12 Engineering Hours.
