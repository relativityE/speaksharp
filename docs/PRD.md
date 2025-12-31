
**Owner:** [unassigned]
**Last Reviewed:** 2025-12-18

🔗 [Back to Outline](./OUTLINE.md)

# SpeakSharp Product Requirements Document

**Version 8.4** | **Last Updated:** 2025-12-18

## 1. Executive Summary

SpeakSharp is a **privacy-first, real-time speech analysis tool** designed as a modern, serverless SaaS web application. Its architecture is strategically aligned with the core product goal: to provide instant, on-device feedback that helps users improve their public speaking skills, while rigorously protecting their privacy.

The system is built for speed, both in user experience and development velocity. It leverages a **[React (Vite) frontend](./ARCHITECTURE.md#3-frontend-architecture)** for a highly interactive UI and **[Supabase as an all-in-one backend](./ARCHITECTURE.md#4-backend-architecture)** for data, authentication, and user management.

## 2. Vision & Positioning
* **Vision:** To be the leading real-time speech coach for professionals, helping them communicate with confidence and clarity.
* **Positioning:** SpeakSharp is a real-time speech analysis tool. A key differentiator on the roadmap is a **privacy-first, on-device transcription mode** that will provide instant feedback without sending sensitive conversations to the cloud.

### User Roles & Flows
This section contains ASCII art diagrams illustrating the journey for each user role.

```ascii
+-----------------------------------------------------------------+
|                         [New User]                                |
|                  Arrives at Landing Page                          |
+-----------------------------------------------------------------+
                           |
                           v
+-----------------------------------------------------------------+
|                  Prompted to Sign Up / Login                      |
+-----------------------------------------------------------------+
                           |
                           v
+-----------------------------------------------------------------+
|                  [Authenticated User]                             |
+-----------------------------------------------------------------+
                           |
  +------------------------+------------------------+
  |                                                 |
  v                                                 v
+--------------------------+                      +--------------------------+
| [Free User]              |                      | [Pro User]               |
| - 30 min/month           |                      | - Unlimited Time         |
| - 20 min session duration|                      | - Cloud AI (AssemblyAI)  |
| - Native Browser STT     |                      | - On-device STT (Local)  |
| - View Session History   |                      |                          |
+--------------------------+                      +--------------------------+
           |
           v
+--------------------------+
| Usage Limit Reached?     |
+--------------------------+
     |           |
   [No]        [Yes]
     |           |
     v           v
(Practice)  +----------------------+
            | UpgradePromptDialog  |
            +----------------------+
                     |
                     v
            +----------------------+
            |    Go to Pro Plan    |
            +----------------------+
```

### Canonical Feature List & Unit Test Status

This section provides a granular breakdown of user-facing features, grouped by priority, and tracks their unit test coverage status per the new engineering mandate.

#### 🎯 Must-Have

| Feature | Phase | Description | Status | Unit Test |
| :--- | :--- | :--- | :--- | :--- |
| **Transcription** | 1 | The core service that converts speech to text. | ✅ Implemented | ✅ Yes |
| **Cloud Server STT** | 1 | High-accuracy transcription via AssemblyAI. (Pro) | ✅ Implemented | ✅ Yes |
| **On-Device STT** | 1 | Privacy-first transcription using `whisper-turbo` (local Whisper model). (Pro) | ✅ Implemented | ✅ Yes |
| **Fallback STT** | 1 | Standard transcription using the native browser API. (Free) | ✅ Implemented | ✅ Yes |
| **UI Mode Selector** | 1 | Allows users to select their preferred transcription engine. | ✅ Implemented | ✅ Yes |
| **Session History** | 1 | Users can view and analyze their past practice sessions. | ✅ Implemented | ✅ Yes |
| **Filler Word Detection** | 1 | Detects and counts common filler words (um, uh, like, etc.). | ✅ Implemented | ✅ Yes |
| **Speaking Pace (WPM)** | 2 | Provides real-time words-per-minute analysis. | ✅ Implemented | ✅ Yes |
| **Clarity Score** | 2 | Score based on filler word usage. | ✅ Implemented | ✅ Yes |
| **Goal Setting** | 2 | Weekly/Daily targets for practice consistency. | ✅ Implemented | ❌ No (E2E Only) |
| **User-Friendly Error Handling** | 2 | Specific, user-facing error messages. | ✅ Implemented | ✅ Yes |
| **Custom Vocabulary** | 2 | Allows users to add custom words to improve accuracy. Free: 10 words max. Pro: 100 words max. | ✅ Implemented | ✅ Yes |
| **Vocal Variety / Pause Detection** | 2 | Analyzes pause duration and frequency. | ✅ Implemented | ✅ Yes |
| **Session Hardening** | 3 | Prevents saving empty or 0-second sessions to preserve usage and data quality. | ✅ Implemented | ✅ Yes |
| **Speaker Identification**| 4 | Distinguishes between multiple speakers in a transcript. | 📅 Planned | ❌ No |
| **Screen Reader Accessibility** | 2 | Live transcript uses ARIA live regions so screen readers announce new text automatically. | ✅ Implemented | ✅ Yes |
| **Usage Limit Pre-Check** | 2 | Checks remaining usage BEFORE session starts. Shows upgrade prompt if exceeded. | ✅ Implemented | ✅ Yes |

#### 🚧 Should-Have

| Feature | Phase | Description | Status | Unit Test |
| :--- | :--- | :--- | :--- | :--- |
| **AI Suggestions** | 1 | Provides AI-driven feedback on transcripts. | ✅ Implemented | ✅ Yes |
| **Filler Word Trend** | 1 | Analyzes the trend of filler word usage across sessions. | ✅ Implemented | ✅ Yes |
| **Session Comparison** | 1 | Compares stats from the 4 most recent sessions. | ✅ Implemented | ❌ No (E2E Only) |
| **PDF Export** | 1 | Allows users to download a PDF report of their session (FileSaver.js). | ✅ Implemented | ✅ Yes |
| **STT Accuracy Comparison** | 1 | Rolling average comparison of STT engine accuracy against a ground truth. | ✅ Implemented | ✅ Yes |
| **Top 2 Filler Words**| 1 | Maintains the top 2 highest filler words for the most recent 4 sessions. | ✅ Implemented | ✅ Yes |
| **Weekly Activity Chart** | 2 | Visual chart showing practice frequency over the past week. | ✅ Implemented | ❌ No (E2E Only) |
| **Premium Loading States** | 2.5 | Skeleton loading UI for premium user experience. | ✅ Implemented | ✅ Yes |
| **On-Device Model Caching** | 3 | Service Worker caches Whisper model for faster subsequent loads (<5s). | ✅ Implemented | ✅ Yes |
| **Gamification (Streaks)** | 2 | Tracks daily practice streaks with local storage + toast positive reinforcement. | ✅ Implemented | ❌ No (E2E Only) |
| **Design System Showcase** | 2 | `/design` route to visualize and test UI components in isolation. | ✅ Implemented | ✅ Yes |



### Differentiation
*   **vs. Otter.ai:** Privacy-first (on-device option is a key roadmap item), focused on improvement, not just transcription.
*   **vs. Poised:** More affordable, simpler to use, no installation required.

### Go-to-Market & Financials
*   **GTM Strategy:** Execute a phased GTM strategy. Start with organic channels to validate product-market fit before scaling up paid advertising.
    *   **Phase 1 (Validation):** Focus on organic channels like SEO, content marketing, and public speaking forums. Engage with communities like Toastmasters to gather feedback and testimonials. A "How it Works" video will be created for the landing page to improve conversion.
    *   **Phase 2 (Growth):** Based on the data and validated product-market fit from Phase 1, gradually scale paid advertising campaigns.
*   **Community Engagement:** Actively participate in relevant online communities (like Reddit) to build a following and attract early adopters. This helps in building a brand and getting early feedback.
*   **KPIs and Tracking:** Implement real-time tracking of key metrics (conversion rate, CAC, LTV) to make data-driven decisions. A dashboard (e.g., PostHog, ChartMogul) will be used for this.
*   **Financials:** The business model is Freemium with a Pro tier subscription. Financial models will be based on a conservative conversion rate of 2% to ensure sufficient runway. Detailed projections are in internal documents.

---

## 3. Testing Strategy

The project's testing strategy prioritizes stability, reliability, and a tight alignment between the local development environment and the CI/CD pipeline.

*   **Unit & Integration Tests (Vitest):** These form the foundation of our testing pyramid. They are fast, focused, and verify the correctness of individual components and hooks in isolation. **Target: ≥75% line coverage with integrity-preserving validation (avoiding implementation coupling).**
*   **End-to-End Tests (Playwright):** E2E tests validate complete user flows from start to finish. To combat the flakiness often associated with UI-driven tests, we have adopted a critical strategic decision:
    *   **Programmatic Login Only:** All E2E tests that require an authenticated state **must** use the `programmaticLogin` helper. This method directly injects a session into `localStorage`, bypassing the UI for sign-up and login. This approach is significantly faster and more reliable than attempting to simulate user input in the auth form.
    *   **Canonical Health Check:** The `pnpm test:health-check` command is the primary quality gate for daily development. It focuses exclusively on the canonical `core-journey.e2e.spec.ts`, verifying the full data flow (Home -> Session -> Analytics) without the overhead of the full unit test suite.
    *   **No UI-Driven Auth Tests:** Tests that attempt to validate the sign-up or login forms via UI interaction have been removed. The stability and speed gained by using programmatic login are considered a higher priority than testing the auth form itself in the E2E suite.
    *   **Canary Deployment Tests:** A subset of E2E tests (marked `@canary`) are designed to hit real staging endpoints periodically to detect API contract drift and production-specific failures that mocks might hide.
*   **API Mocking (MSW & Playwright Routes):** External services and backend APIs are mocked for deterministic testing. However, mocks are audited against real production response shapes to prevent "Green Illusion" (tests passing while production is broken).
*   **Adversarial Audit Mandate:** All new tests must pass an adversarial review—ensuring they validate design intent (e.g., tier gating, SLOs, resilience) and would fail if production code deviates from intended behavior, even if the structural implementation remains similar.
*   **Single Source of Truth (`pnpm test:all`):** A single command, `pnpm test:all`, is the user-facing entry point for all validation. It runs an underlying orchestration script (`test-audit.sh`) that executes all checks (lint, type-check, tests) in a parallelized, multi-stage process both locally and in CI, guaranteeing consistency and speed.

---

## 4. Known Issues & Risks

This section tracks high-level product risks and constraints. For a detailed guide on troubleshooting E2E infrastructure, see [tests/TROUBLESHOOTING.md](../tests/TROUBLESHOOTING.md).

- **Incomplete Theming:** The application is configured to support both light and dark themes, but only a dark theme is currently implemented. Users will not be able to switch to a light theme, which can be an accessibility issue and ignores user preference.
- **✅ RESOLVED - Infrastructure - Contract Drift (2025-12-19):** Grounded the `sessions` table by adding missing columns (`transcript`, `engine`, `clarity_score`, `wpm`) and implemented the atomic `create_session_and_update_usage` RPC. Purged `avatar_url` and `full_name` phantoms. **Status:** ✅ Fixed.
- **✅ RESOLVED - Accessibility (aria-live, 2025-12-11):** Added `aria-live="polite"`, `aria-label`, and `role="log"` to the live transcript container (`SessionPage.tsx:266-272`). Screen readers now announce new transcript text as it appears. **Status:** ✅ Fixed.
- **Unit Test Coverage:** Current coverage is 57.03% with 89 unit tests across 52 test files (as of 2025-12-23). Continued coverage expansion is tracked in the technical debt backlog.
- **✅ RESOLVED - UX - Layout Shift (CLS, 2025-12-06):** The `SessionPage` transcript container now uses fixed `h-[250px]` to prevent layout instability. **Status:** ✅ Fixed.
- **✅ RESOLVED - UX - Accessibility (Contrast, 2025-12-07):** Hero text contrast improved with drop-shadow and backdrop-blur for WCAG AA compliance. **Status:** ✅ Fixed.
- **UX - Mobile Experience:** The controls on `SessionPage` are difficult to access on small screens as they scroll away with the content ("thumb stretch" issue). A sticky footer is required.
- **🟡 IN PROGRESS - Testimonials:** `TestimonialsSection` component exists but contains "TBD for now" placeholder content and is commented out in `MainPage.tsx` and `Index.tsx`. Needs real user testimonials before enabling.
- **Test Quality (Partially Addressed 2025-12-10):** A comprehensive audit of the test suite is ongoing. Test ID centralization completed (eliminated magic strings). Refactored brittle `.first()` selectors. Remaining: identify low-value tests.
- **✅ RESOLVED - Session Comparison & Progress Tracking (2025-12-06):** Implemented full feature with side-by-side comparison, trend charts, and progress indicators. Users can select 2 sessions to compare, view WPM/Clarity/Fillers trends over time, and see improvement/regression indicators. **Status:** ✅ Implemented. **Files:** `ProgressIndicator.tsx`, `TrendChart.tsx`, `SessionComparisonDialog.tsx`, `AnalyticsDashboard.tsx`
- **✅ RESOLVED - Goal Setting Implementation (2025-12-07):** Supabase sync implemented, and GoalsSection now calculates actual progress from `useAnalytics` hook (weekly session count and average clarity score). **Files:** `GoalsSection.tsx`, `useGoals.ts`. **Status:** ✅ Complete.
- **✅ RESOLVED - Goal Setting E2E Test Failure (2025-12-05):** The `goal-setting.e2e.spec.ts` test failure caused by stale build artifacts has been fixed. **Status:** ✅ Fixed.
- **✅ RESOLVED - Analytics Empty State E2E Test (2025-12-06):** Test is now passing. The `__E2E_EMPTY_SESSIONS__` flag works correctly with MSW handlers. **Status:** ✅ Fixed.
- **✅ RESOLVED - Navigation E2E Test Failure (2025-12-02):** The `navigation.e2e.spec.ts` test failure due to overlapping headers has been fixed. **Status:** ✅ Fixed.
- **✅ RESOLVED - Analytics E2E Test Failures (2025-12-07):** All 12 failing analytics tests fixed. Root causes: (1) AuthProvider race condition - Supabase `onAuthStateChange` cleared mock session, (2) `page.goto()` caused protected route loading issues. Solutions: AuthProvider now ignores empty sessions in test mode; added `navigateToRoute()` helper for client-side navigation. **Status:** ✅ Fixed.
- **✅ RESOLVED - Metrics E2E Test Timing Issue (2025-12-06):** Fixed by removing duplicate MockSpeechRecognition from `programmaticLogin()`. Test now passing (WPM: 120, Clarity: 87%, Fillers: 6). **Status:** ✅ Fixed.
- **✅ RESOLVED - Local STT E2E Tests (2025-12-06):** Fixed 3 test failures in `local-stt-caching.e2e.spec.ts`: (1) Progress percentage bug (8534% → 0-100%), (2) Button text mismatch, (3) Toast notification strict mode violation. **Status:** ✅ Fixed and pushed.
- **✅ RESOLVED - Local STT Download Progress Tests (2025-12-06):** Three tests previously skipped due to Pro subscription requirement are now passing with Pro test account. **Tests:** (1) Download progress indicator, (2) Cache loading performance, (3) Toast notification. **Status:** ✅ Fixed.
- **✅ RESOLVED - Goal Setting Tests (2025-12-07):** Goal Setting feature fully implemented with Supabase sync and UI complete. **Status:** ✅ All tests passing.
- **✅ RESOLVED - Session Comparison Tests (2025-12-06):** Feature fully implemented with E2E tests passing. **Components:** `ProgressIndicator.tsx`, `TrendChart.tsx`, `SessionComparisonDialog.tsx`. **Features:** Side-by-side comparison with progress indicators (↑/↓), WPM and Clarity trend charts. **Status:** ✅ Complete.
- **✅ RESOLVED - Custom Vocabulary E2E Test (2025-12-08):** Previously flagged React Query cache issue is now resolved. MSW handlers working correctly, test is active and passing. **Status:** ✅ Fixed.
- **✅ RESOLVED - PDF Export E2E Test (2025-12-08):** Test was passing but not actually testing due to sessions not loading. Fixed by waiting for `session-history-item` before checking buttons, and using click verification (jsPDF blob doesn't trigger Playwright download event). Now verifies 5 download buttons for 5 mock sessions. **Status:** ✅ Fixed.
- **✅ RESOLVED - Analytics Invalid Session ID E2E Test Failure (2025-12-05):** The `analytics-details.e2e.spec.ts` test failure has been resolved by fixing race conditions in loading state assertions. **Status:** ✅ Fixed.
- **✅ RESOLVED - AuthProvider Race Condition (Finding 2.1, 2025-12-22):** The `AuthProvider` profile loading logic was structurally refactored to use standard React effect synchronization, splitting session and profile state management. This replaced the previous "ignore empty session" patch with a robust architectural fix while preserving retry logic for cold starts. **Status:** ✅ Fixed.
- **✅ RESOLVED - CI Sharded E2E Metrics (2025-12-10):** The `ci:local` command was incorrectly reporting only 8 E2E tests instead of 35 due to Playwright blob reports being overwritten per shard. **Fix:** Implemented `PLAYWRIGHT_BLOB_OUTPUT_DIR` per shard with JSONL extraction for accurate aggregation in `test-audit.sh`. Now correctly reports 35 E2E tests. **Status:** ✅ Fixed.
- **✅ STABILIZED - Soak Test "Empty Body" (2025-12-15):** Soak test failed due to hydration race conditions. **Mitigation:** Implemented `browser.newContext()` isolation and strict `expect().toBeVisible()` state guards. **Status:** Stabilized (Guardrail enforced), though shared process risk remains.
- **✅ RESOLVED - Stripe Configuration Error (2025-12-15):** The `stripe-checkout` Edge Function was failing with generic 400 errors in CI. **Fix:** Added diagnostic logging and "Negative Verification" to test (`stripe-checkout.spec.ts`) to prove configuration state safely without exposing secrets. **Status:** ✅ Fixed.
- **✅ RESOLVED - Infrastructure - Analytics UI Regression (2025-12-31):** Fixed the `net::ERR_NAME_NOT_RESOLVED` error by restoring MSW initialization in the E2E bridge and consolidated redundant upgrade prompts. **Status:** ✅ Fixed.
- **ℹ️ INFO - Soak Test Environment (2025-12-19):** Optimized the `soak-test` workflow to support **10 concurrent users** (7 Free, 3 Pro) by default. Implemented automated registry synchronization via `setup-test-users.yml`, which uses a shared `SOAK_TEST_PASSWORD` secret (programmatically rotated via `GH_PAT`). Full execution requires the CI/Staging environment with real Supabase secrets.

### Gap Analysis: Alpha Launch Blockers (AI Detective v5 - 2025-12-09)

| Issue | Details | Impact | Priority |
|-------|---------|--------|----------|
| ~~Rate Limiting~~ | ~~AssemblyAI token endpoint no rate limiting~~ | ~~Cost overruns, abuse risk~~ | ✅ **RESOLVED 2025-12-09** - Added client-side `rateLimiter.ts` (5 calls/min, 5s interval) |
| ~~Usage Limit UX (Incomplete)~~ | ~~Frontend doesn't prevent session start if usage exceeded~~ | ~~Frustrating UX when session fails to save~~ | ✅ **RESOLVED 2025-12-11** - Added `check-usage-limit` Edge Function with `useUsageLimit` hook. Shows toast with Upgrade button pre-session |
| ~~Error Reporting~~ | ~~No Sentry for Web Audio/Worker errors~~ | ~~Production debugging impossible~~ | ✅ **RESOLVED 2025-12-09** - Added `Sentry.captureException` to TranscriptionService |
| ~~Documentation Drift~~ | ~~ARCHITECTURE.md needs update~~ | ~~Maintainability risk~~ | ✅ **RESOLVED 2025-12-09** - Added Section 3.2 documenting hook decomposition, clean ASCII diagram |
| ~~E2E Error States Coverage~~ | ~~Missing tests for: mic denied, usage exceeded, network failure during save~~ | ~~Resilience gap~~ | ✅ **RESOLVED 2025-12-09** - Added `error-states.e2e.spec.ts` with 4 tests (session stability, network errors) |
| ~~Alpha Bypass Mechanism~~ | ~~No way for alpha testers to upgrade without Stripe~~ | ~~Blocked alpha launch~~ | ✅ **RESOLVED 2025-12-31** - Implemented `apply-promo` Edge Function and periodic secret-driven code validation in `AuthPage.tsx`. See [User Guide](./USER_GUIDE.md) |

---

## 5. Development Roadmap
The project's development status is tracked in the [**Roadmap**](./ROADMAP.md). This board provides a two-dimensional view of our project tasks, combining Phased Milestones with MoSCoW Prioritization.

---

<!-- SQM:START -->
## 6. Software Quality Metrics

**Last Updated:** Wed, 31 Dec 2025 10:06:04 GMT

**Note:** This section is automatically updated by the CI pipeline. The data below reflects the most recent successful run.

**Metric Definitions:**
- **Total Source Size:** Sum of all code in src, backend, tests, docs, and scripts.
- **Total Project Size:** Total disk footprint including node_modules and assets.
- **Initial Chunk Size:** The size of the largest initial JavaScript bundle.
- **Code Bloat Index:** Ratio of Initial Chunk Size to Total Source Size (lower is better).

---

### Test Suite State

| Metric                  | Value |
| ----------------------- | ----- |
| Total tests             | 489 (432 unit + 57 E2E) |
| Unit tests              | 432   |
| E2E tests (Playwright)  | 57  |
| Passing tests           | 489 (432 unit + 57 E2E)   |
| Failing tests           | 0   |
| Disabled/skipped tests  | 0 (E2E only)   |
| Passing unit tests      | 432/432 (100.0%)   |
| Passing E2E tests       | 57/57 (100.0%)   |
| Total runtime           | See CI logs   |

---

### Coverage Summary

| Metric     | Value |
| ---------- | ----- |
| Statements | 57.51%   |
| Branches   | 78.55%   |
| Functions  | 73.8%   |
| Lines      | 57.51%   |

---

### Code Bloat & Performance

| Metric              | Value |
| ------------------- | ----- |
| Total Source Size   | 3.4M   |
| Total Project Size  | 1.4G   |
| Initial Chunk Size  | 884K   |
| Code Bloat Index    | 25.23%   |
| Lighthouse Scores   | P: 100, A: 94, BP: 100, SEO: 91 |

---
<!-- SQM:END -->

## 7. Metrics and Success Criteria

### Service Level Indicators (SLIs) & Objectives (SLOs)

**SLIs (what we measure):**

- 🕑 **Time to first transcript chunk (latency)** — ms between mic start and first transcript event.
- ⚡ **End-to-end transcription latency (speed)** — avg delay between spoken word and displayed text.
- 📉 **WebSocket error rate** — % of sessions terminated by non-1000 close codes.
- 🔄 **Reconnect success rate** — % of reconnect attempts that resume within 2s.
- 🔐 **Token issuance error rate** — % of failed requests to /assemblyai-token.
- 💰 **Cost guardrail** — $/minute STT usage per active user session.

**SLOs (targets):**

- <2s to first transcript chunk (p95).
- <500ms streaming transcription delay (p90).
- <1% WebSocket error rate.
- >95% reconnect success rate within 2s.
- <0.5% token issuance failures.
- <$0.05/min STT cost at MVP scale.

---

## 8. Future Enhancements / Opportunities

### Feature Proposal: Rolling Accuracy Comparison of STT Engines (Native, Cloud, On-device)
**Goal:** Improve transparency and user trust.

We can strengthen user confidence by adding a feature that compares accuracy across Native Browser, Cloud AI, and On-device modes. Instead of one-off tests, the system would track results from actual usage over time and compute a rolling accuracy percentage. This avoids storing large datasets while still giving users a clear view of performance differences.

### [COMPLETED] Feature: Dynamic Software Quality Metrics Reporting

**Goal:** To provide an accurate, at-a-glance overview of the project's health directly within the documentation.

**Problem:** The current Software Quality Metrics section in this document is not updated automatically and relies on placeholder data.

**Solution Implemented:** A robust, parallel CI/CD pipeline has been implemented in `.github/workflows/ci.yml`. This workflow runs all necessary checks, including linting, type-checking, unit tests, and E2E tests, in a distributed and efficient manner. The results of these checks can be used to automatically update the Software Quality Metrics section of this document.

---

## 9. Strategic Review & Analysis

This section provides high-level insights into the SpeakSharp project from multiple senior perspectives.

### 💰 CFO Perspective (Financials & Business Model)

**Pricing:**
*   The Pro tier is priced at **$7.99/month**. This price point is set to be competitive and justifiable with the current feature set. More advanced analytics features could justify a higher price in the future.

**Conversion Rate:**
*   The previous 5% conversion assumption was optimistic. Financial models will now use a specific conversion rate of **2%**.
*   To improve conversion, the product strategy will focus on:
    *   **Optimizing the "Aha!" Moment:** The Free tier must quickly demonstrate the product's value.
    *   **Creating a Compelling Upgrade Path:** The Pro tier must offer a significant upgrade.
    *   **Effective Upgrade Prompts:** The `UpgradePromptDialog` should be triggered at moments of high user engagement.

**Operating Costs:**
*   The serverless architecture (Supabase, Deno Edge Functions) is expected to keep monthly operating costs low.
*   The primary variable cost is the AssemblyAI API usage for Pro users. The SLO of `<$0.05/min STT cost at MVP scale` is a key target to monitor.

**Estimated Monthly Operating Costs:**
*   This section outlines the estimated monthly costs for running SpeakSharp, based on the current tech stack. These costs are broken down into fixed and variable components.

*   **Fixed Costs:**
    *   **Supabase Pro Plan:** **$25/month**. This provides the core backend infrastructure, including the database, authentication, and serverless functions.

*   **Variable Costs (per Pro user per month):**
    *   **Stripe:** **~ (2.9% + $0.30) + 0.7% per transaction**. For a $7.99/month subscription, this is approximately **$0.59 per user**. This covers payment processing and subscription management.
    *   **AssemblyAI:** **$0.15/hour** of streaming speech-to-text. This cost is directly tied to the usage of the Pro features.

**Financial Projections:**
*   Breakeven and profitability projections will be modeled using a 2% conversion rate. This provides a realistic view for making decisions on spending and investment.
*   An advertising budget will be determined based on these projections and the results of organic marketing. It is crucial to establish a clear Customer Acquisition Cost (CAC) before scaling paid ads.

**Key Financial Metrics (CAC & LTV):**
*   **Customer Acquisition Cost (CAC):** This will be closely monitored once paid advertising begins. The goal is to keep CAC significantly lower than LTV.
*   **Lifetime Value (LTV):**
    *   **Assumption:** The LTV calculation is based on an assumed average user retention of **6 months**.
    *   **Estimated LTV:** Based on the Pro price of $7.99/month and Stripe fees, the estimated LTV is approximately **$44**. (`(7.99 - 0.59) * 6`). This is a simplified calculation and will be refined as more data becomes available.

**Breakeven Analysis & Profitability Timeline:**
*   This analysis is based on the following conservative assumptions:
    *   **User Acquisition:** 10 new Pro users per month.
    *   **AssemblyAI Usage:** 2 hours per Pro user per month.

*   **Breakeven Calculation:**
    *   **Revenue per Pro user:** $7.99/month.
    *   **Variable Costs per Pro user:**
        *   Stripe: ~$0.59/month
        *   AssemblyAI: 2 hours * $0.15/hour = $0.30/month
        *   **Total Variable Cost:** $0.89/month
    *   **Net Revenue per Pro user:** $7.99 - $0.89 = $7.10/month.
    *   **Fixed Costs:** $25/month (Supabase).
    *   **Breakeven Point:** $25 / $7.10 = **~4 Pro users**.

*   **Profitability Timeline:**
    *   With an acquisition rate of 10 new Pro users per month, the company is projected to be profitable in the **first month**.
    *   **Month 1:** (10 users * $7.10) - $25 = **$46.00 profit**.
    *   **Month 2:** (20 users * $7.10) - $25 = **$117.00 profit**.
    *   **Month 3:** (30 users * $7.10) - $25 = **$188.00 profit**.
    *   *Note: This timeline assumes no user churn for the initial months, which aligns with the 6-month LTV assumption.*

### 🚀 CEO Perspective (Marketing & User Acquisition)

**Marketing Approach:**
*   The phased GTM strategy (organic first, then paid) is a sound approach for a startup with a limited budget, allowing for validation before scaling.

**Advertising Strategy:**
*   The advertising strategy will follow the phased GTM approach.
*   **Phase 1 (Organic):** Focus on organic channels as described below.
*   **Phase 2 (Paid):** Once a stable conversion rate of at least 2% is achieved, a limited and targeted paid advertising campaign will be launched.
    *   **Initial Platform:** Reddit ads, targeting the subreddッツ listed below.
    *   **Expansion Platforms:** Based on the success of the Reddit ads, expansion to Facebook or Google Ads will be considered. The focus will remain on targeted and limited campaigns to control CAC.

**User Acquisition Channels:**
*   **Reddit:** This is a key channel for reaching niche communities.
    *   **Target Subreddits:** `r/publicspeaking`, `r/toastmasters`, `r/communication`, `r/presentations`, `r/entrepreneur`, `r/startups`.
    *   **Approach:**
        1.  **Be a Community Member:** Participate genuinely before promoting.
        2.  **Seek Feedback:** Frame posts as seeking feedback on a new tool.
        3.  **Offer Value:** Provide free Pro access to early adopters for feedback.
        4.  **Share the Journey:** Document and share the building process.
*   **Other Channels:**
    *   **Toastmasters:** Partner with local clubs and offer discounts.
    *   **Public Speaking Forums:** A great source for early adopters.
    *   **Content Marketing:** Create blog posts and videos to drive organic traffic.
    *   **Product Hunt:** Launch on Product Hunt to generate initial buzz.

**Product Strategy & Roadmap:**

**Gaps / Market Risks:**

*   Limited feature set at MVP (filler words only). Competitors offer richer analytics.
*   No social proof (testimonials, coach endorsements, beta case studies).

**Recommendations:**

*   Prioritize “speaking pace” analysis in Phase 2 ([ROADMAP.md](./ROADMAP.md#phase-2-user-validation--polish)).
*   Build trust: beta testimonials, Toastmasters/speech coach partnerships.
*   Produce a “How it Works” demo video for the landing page.
*   Actively engage with online communities (Reddit, forums) to build brand awareness.

### 💰 Updated Pricing Tiers & Recommendations

*   **Free User (Authenticated):**
    *   **Recommendation:** The 30 minutes/month and 20-minute session limits are good for encouraging upgrades. Ensure the `UpgradePromptDialog` is well-designed, clearly communicates the benefits of upgrading, and appears at the moment of highest user engagement.
*   **Pro User (Authenticated):**
    *   **Price: $7.99/month.**
    *   **Recommendation:** This remains the core paid offering. The value proposition should be clear: "unlimited practice," "Cloud AI transcription," and the key differentiator of "on-device transcription" for enhanced privacy. The fallback to Native Browser is a a good technical resilience feature.

---

## 8. Deployment (Alpha Release)

This section provides a complete step-by-step guide to deploy SpeakSharp to Vercel for alpha testing with new users.

### Pre-Deployment Checklist

Before deploying, verify:

| Item | Command | Expected Result |
|------|---------|-----------------|
| Whisper model files | `ls -lh frontend/public/models/` | `tiny-q8g16.bin` (~30MB), `tokenizer.json` (~2MB) |
| Full test suite | `pnpm test:all` | All 484+ tests passing |
| Production build | `pnpm build` | Builds successfully |
| Database migrations | Check Supabase Dashboard → SQL Editor | 14 migrations applied |

### Step 1: Vercel Project Setup

1. **Create Vercel Project:**
   - Go to [vercel.com](https://vercel.com) → "New Project"
   - Import from GitHub: `your-org/speaksharp`
   - Framework Preset: **Vite** (auto-detected)

2. **Configure Build Settings (auto-populated from vercel.json):**
   - Build Command: `pnpm build`
   - Output Directory: `frontend/dist`
   - Install Command: `pnpm install --frozen-lockfile`

### Step 2: Vercel Environment Variables

Go to **Project Settings → Environment Variables** and add:

| Variable | Value | Environments |
|----------|-------|--------------|
| `VITE_SUPABASE_URL` | `https://yxlapjuovrsvjswkwnrk.supabase.co` | Production, Preview, Development |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key (starts with `sb_publishable_`) | Production, Preview, Development |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Your Stripe publishable key (starts with `pk_live_` or `pk_test_`) | Production, Preview, Development |
| `VITE_SENTRY_DSN` | Your Sentry DSN (optional) | Production, Preview |

> **Finding Your Keys:**
> - **Supabase:** Dashboard → Project Settings → API → `anon` public key
> - **Stripe:** Dashboard → Developers → API keys → Publishable key

### Step 3: Supabase Edge Functions Secrets

Go to **Supabase Dashboard → Edge Functions → Secrets** and add:

| Secret | Description | How to Get |
|--------|-------------|------------|
| `SITE_URL` | Your Vercel production URL (e.g., `https://speaksharp.vercel.app`) | Vercel Dashboard after first deploy |
| `STRIPE_SECRET_KEY` | Stripe secret key (starts with `sk_live_` or `sk_test_`) | Stripe Dashboard → Developers → API keys |
| `STRIPE_PRO_PRICE_ID` | Price ID for Pro subscription (e.g., `price_1Sdiu075Lp2WYe28gYDhJokR`) | Stripe Dashboard → Products → Pro plan → Price ID |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (starts with `whsec_`) | Created in Step 5 |
| `ASSEMBLYAI_API_KEY` | AssemblyAI API key for Cloud STT | [AssemblyAI Dashboard](https://www.assemblyai.com/app) → API Keys |
| `ALLOWED_ORIGIN` | Vercel production URL for CORS (e.g., `https://speaksharp.vercel.app`) | Same as SITE_URL |

### Step 4: Supabase Authentication Configuration

Go to **Supabase Dashboard → Authentication → URL Configuration**:

1. **Site URL:** `https://speaksharp.vercel.app` (your Vercel URL)
2. **Redirect URLs:** Add:
   - `https://speaksharp.vercel.app/*`
   - `https://speaksharp-*.vercel.app/*` (for PR previews)

### Step 5: Stripe Webhook Configuration

Go to **Stripe Dashboard → Developers → Webhooks**:

1. **Add Endpoint:**
   - URL: `https://yxlapjuovrsvjswkwnrk.supabase.co/functions/v1/stripe-webhook`
   - Events to send:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_failed`

2. **Copy Signing Secret:**
   - After creating, click "Reveal" on signing secret
   - Copy the `whsec_...` value
   - Add as `STRIPE_WEBHOOK_SECRET` in Supabase (Step 3)

### Step 6: Deploy to Vercel

```bash
# Option A: Via CLI
npm i -g vercel
vercel link
vercel              # Preview deploy
vercel --prod       # Production deploy

# Option B: Via Dashboard
# Push to main branch - auto-deploys to production
# Push to any other branch - auto-deploys to preview
```

### Step 7: Verify Deployment

After deployment, verify the complete user journey:

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Visit `https://your-app.vercel.app` | Landing page loads |
| 2 | Click "Get Started" → Sign Up | Signup form with Free/Pro options |
| 3 | Create account (Free) | Redirects to `/session` |
| 4 | Start a session | Native Browser STT works |
| 5 | Check Analytics | Session appears in history |
| 6 | Upgrade to Pro | Redirects to Stripe checkout |
| 7 | Complete payment | Pro features unlocked |
| 8 | Test Cloud STT | AssemblyAI transcription works |
| 9 | Test On-Device STT | Whisper model downloads and works |

### Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Build fails | Missing env vars | Verify all `VITE_*` vars are set in Vercel |
| Auth redirect fails | Wrong redirect URL | Add Vercel URL to Supabase redirect URLs |
| Stripe checkout fails | Missing `SITE_URL` | Set `SITE_URL` in Supabase secrets |
| Webhook not working | Wrong URL or secret | Verify webhook URL and `STRIPE_WEBHOOK_SECRET` |
| Cloud STT fails | Missing API key | Set `ASSEMBLYAI_API_KEY` in Supabase secrets |
| CORS errors | Missing `ALLOWED_ORIGIN` | Set `ALLOWED_ORIGIN` to Vercel URL in Supabase |

### Alpha Release URL Strategy

| Environment | URL | Purpose |
|-------------|-----|---------|
| Preview | `speaksharp-*.vercel.app` | PR previews |
| Alpha/Staging | `alpha.speaksharp.app` | Soft launch, beta testers |
| Production | `speaksharp.app` | Public release |

**Custom domain setup:**
1. Vercel Dashboard → Project → Domains
2. Add `alpha.speaksharp.app`
3. Add CNAME record in DNS: `alpha → cname.vercel-dns.com`
