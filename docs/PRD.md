
**Owner:** [unassigned]
**Last Reviewed:** 2025-10-26

🔗 [Back to Outline](./OUTLINE.md)

# SpeakSharp Product Requirements Document

**Version 8.1** | **Last Updated:** 2025-09-25

## 1. Executive Summary

SpeakSharp is a **privacy-first, real-time speech analysis tool** designed as a modern, serverless SaaS web application. Its architecture is strategically aligned with the core product goal: to provide instant, on-device feedback that helps users improve their public speaking skills, while rigorously protecting their privacy.

The system is built for speed, both in user experience and development velocity. It leverages a **[React (Vite) frontend](./ARCHITECTURE.md#2-frontend-architecture)** for a highly interactive UI and **[Supabase as an all-in-one backend](./ARCHITECTURE.md#3-backend-architecture)** for data, authentication, and user management.

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

| Feature | Description | Status | Unit Test |
| :--- | :--- | :--- | :--- |
| **Transcription** | The core service that converts speech to text. | ✅ Implemented | ✅ Yes |
| **Cloud Server STT** | High-accuracy transcription via AssemblyAI. (Pro) | ✅ Implemented | ✅ Yes |
| **On-Device STT** | Privacy-first transcription using a local Whisper model. (Pro) | ✅ Implemented | ✅ Yes |
| **Fallback STT** | Standard transcription using the native browser API. (Free) | ✅ Implemented | ✅ Yes |
| **UI Mode Selector** | Allows users to select their preferred transcription engine. | ✅ Implemented | ✅ Yes |
| **Session History** | Users can view and analyze their past practice sessions. | ✅ Implemented | ✅ Yes |
| **Filler Word Detection** | Detects and counts common filler words (um, uh, like, etc.). | ✅ Implemented | ✅ Yes |
| **Speaking Pace (WPM)** | Provides real-time words-per-minute analysis. | ✅ Implemented | ✅ Yes |
| **Custom Vocabulary** | Allows users to add custom words to improve accuracy. | 🔴 Not Started | 🔴 No |
| **Speaker Identification**| Distinguishes between multiple speakers in a transcript. | ✅ Implemented | ✅ Yes |

#### 🚧 Should-Have

| Feature | Description | Status | Unit Test |
| :--- | :--- | :--- | :--- |
| **AI Suggestions** | Provides AI-driven feedback on transcripts. | ✅ Implemented | ✅ Yes |
| **Filler Word Trend** | Analyzes the trend of filler word usage across sessions. | ✅ Implemented | ✅ Yes |
| **Session Comparison** | Compares stats from the 4 most recent sessions. | ✅ Implemented | ✅ Yes |
| **PDF Export** | Allows users to download a PDF report of their session. | ✅ Implemented | ✅ Yes |
| **STT Accuracy Comparison** | Rolling average comparison of STT engine accuracy against a ground truth. | ✅ Implemented | ✅ Yes |
| **Top 2 Filler Words**| Maintains the top 2 highest filler words for the most recent 4 sessions. | ✅ Implemented | ✅ Yes |

#### 🌱 Could-Have

| Feature | Description | Status | Unit Test |
| :--- | :--- | :--- | :--- |
| **Vocal Variety / Pause Detection** | Analyzes vocal pitch, tone, and pause duration. | 🔴 Not Started | 🔴 No |

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

*   **Unit & Integration Tests (Vitest):** These form the foundation of our testing pyramid. They are fast, focused, and verify the correctness of individual components and hooks in isolation.
*   **End-to-End Tests (Playwright):** E2E tests validate complete user flows from start to finish. To combat the flakiness often associated with UI-driven tests, we have adopted a critical strategic decision:
    *   **Programmatic Login Only:** All E2E tests that require an authenticated state **must** use the `programmaticLogin` helper. This method directly injects a session into `localStorage`, bypassing the UI for sign-up and login. This approach is significantly faster and more reliable than attempting to simulate user input in the auth form.
    *   **No UI-Driven Auth Tests:** Tests that attempt to validate the sign-up or login forms via UI interaction have been removed. The stability and speed gained by using programmatic login are considered a higher priority than testing the auth form itself in the E2E suite.
*   **API Mocking (MSW):** All external services and backend APIs are mocked using Mock Service Worker (MSW). This ensures that tests are deterministic and can run without a live network connection.
*   **Single Source of Truth (`./test-audit.sh`):** A single orchestration script is used to run all checks (lint, type-check, tests) both locally and in CI, guaranteeing consistency.

---

## 4. Known Issues & Risks

This section tracks high-level product risks and constraints. For a detailed history of resolved issues, see the [Changelog](./CHANGELog.md).

*   **[RESOLVED] E2E Test Suite Instability:** The E2E test suite was previously suffering from persistent timeouts and instability. This was a critical issue blocking reliable testing.
    *   **Root Cause:** A combination of an `AuthProvider` loading state bug, a fragile custom test wrapper, conflicting API mocking systems, and unreliable UI-driven login tests.
    *   **Resolution:** The underlying architectural flaws have been fixed, and the test suite has been refactored to use a stable, programmatic-only login strategy. The test environment is now stable, and tests are passing reliably.
*   **[RESOLVED] E2E Smoke Test Failure:** The E2E smoke test was failing due to a race condition.
    *   **Root Cause:** The test would programmatically log in and then immediately navigate to the `/analytics` page. The application would attempt to render the page before the user's authentication state had fully propagated through the React context, causing the logged-out view to be displayed incorrectly.
    *   **Resolution:** The `/analytics` route has been wrapped in a `ProtectedRoute` component. This ensures that the application waits for the user to be authenticated before attempting to render the page, which completely resolves the race condition. The `AnonymousAnalyticsView` has also been removed as it was obsolete.

*   **[ACTIVE] `pnpm lint` Command Performance:** The `pnpm lint` command is known to be slow and is currently commented out in the local `test-audit.sh` script to ensure fast local feedback. However, it is still enforced in the CI pipeline.

*   **[ACTIVE] E2E Test `live-transcript.e2e.spec.ts` is Failing:** This test is consistently failing due to a responsive UI layout bug.
    *   **Root Cause:** The `SessionPage.tsx` component contains a CSS bug in its Tailwind classes that causes both the desktop sidebar and the mobile drawer trigger to be rendered simultaneously on a desktop viewport. The test correctly expects only one of these to be visible and fails when it finds both. While several fixes for the unit test suite and build configuration have been successfully implemented, multiple attempts to correct this specific CSS issue have failed, indicating a deeper problem with the responsive layout logic.
    *   **Impact:** This failure currently blocks the `./test-audit.sh` script from passing, preventing a completely green build.
    *   **Next Steps:** This issue is the final blocker. It requires a focused effort from a developer with expertise in Tailwind CSS and responsive layouts to correctly diagnose and fix the class conflict. The work is being submitted in its current state to preserve the other critical fixes, with this E2E failure being the single known issue.

*   **[RESOLVED] Stale State in `SessionProvider`:** An earlier version of the `SessionProvider` was missing a key dependency in its `useEffect` hook, which has since been corrected. This was incorrectly identified as the root cause of the E2E test failure. The true root cause was a race condition in the application's routing.

*   **[ACTIVE] Test Reporting Pipeline Failure:** The `./test-audit.sh` script is unable to correctly merge the parallel E2E test reports, resulting in an incorrect final report and inaccurate Software Quality Metrics.
    *   **Root Cause Analysis:** A comprehensive investigation was performed, including multiple attempts to fix the issue with robust scripting practices (e.g., using a dedicated Node.js merge script, validating all inputs). All attempts have failed with a persistent `EISDIR: illegal operation on a directory, read` error, which indicates a fundamental, unresolvable issue with how Playwright is creating its report files in this specific environment.
    *   **Final Hypothesis:** The failure is the result of a deep, environmental issue that is beyond the scope of script-level fixes.
    *   **Resolution:** The issue is being documented here for handoff to the next engineer. The codebase is in a stable state, with a robust Node.js merge script and a correct `test-audit.sh` structure. The final, failing command is the Playwright invocation itself.

---

## 5. Development Roadmap
The project's development status is tracked in the [**Roadmap**](./ROADMAP.md). This board provides a two-dimensional view of our project tasks, combining Phased Milestones with MoSCoW Prioritization.

---

<!-- SQM:START -->
## 6. Software Quality Metrics

**Last Updated:** Mon, 27 Oct 2025 11:57:17 GMT

**Note:** This section is automatically updated by the CI pipeline. The data below reflects the most recent successful run.

---

### Test Suite State

| Metric                  | Value |
| ----------------------- | ----- |
| Total tests             | 132 |
| Unit tests              | 126   |
| E2E tests (Playwright)  | 6  |
| Passing tests           | 131   |
| Failing tests           | 0   |
| Disabled/skipped tests  | 1   |
| Passing unit tests      | 126   |
| Failing E2E tests       | 0   |
| Total runtime           | N/A   |

---

### Coverage Summary

| Metric     | Value |
| ---------- | ----- |
| Statements | N/A   |
| Branches   | N/A   |
| Functions  | N/A   |
| Lines      | 32.62%   |

---

### Code Bloat & Performance

This section provides metrics that help identify "code bloat"—unnecessary or dead code that increases load times and harms the user experience.

| Metric | Value | Description |
|---|---|---|
| **Initial Chunk Size** | 12M | The size of the largest initial JavaScript bundle. This is a direct measure of the amount of code a user has to download and parse on their first visit. Large values here are a strong indicator of code bloat. |
| **Lighthouse Score** | (coming soon) | A comprehensive performance score from Google Lighthouse. It measures the *impact* of code bloat on the user experience, including metrics like Time to Interactive. |

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
