**Owner:** [unassigned]
**Last Reviewed:** 2025-09-08

🔗 [Back to Outline](./OUTLINE.md)

# SpeakSharp Product Requirements Document

**Version 8.1** | **Last Updated: 2025-09-25**

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

## 3. Known Issues & Risks

This section tracks high-level product risks and constraints. For a detailed history of resolved issues, see the [Changelog](./CHANGELOG.md). For a detailed technical debt and task breakdown, see the [Roadmap](./ROADMAP.md).

*   **[FIXED] CI Environment Instability:** The CI/CD pipeline has been re-architected to run in parallel, which has resolved the 7-minute timeout issues. The new pipeline is defined in `.github/workflows/ci.yml`.

*   **[ACTIVE] E2E Test Suite Instability:** The Playwright E2E test suite is currently unstable and consistently fails with a timeout error. The root cause appears to be an unrecoverable issue within the test environment that prevents the installation of necessary browser dependencies. As a result, the `./test-audit.sh` script cannot run to completion. All feature verification must currently rely on unit tests and manual checks.

*   **[ACTIVE] `pnpm lint` Command Timeout:** The `pnpm lint` command is known to be slow and may time out in some environments. This is a known issue that is being tracked.

---

## 4. Development Roadmap
The project's development status is tracked in the [**Roadmap**](./ROADMAP.md). This board provides a two-dimensional view of our project tasks, combining Phased Milestones with MoSCoW Prioritization.

---

## 5. Software Quality Metrics

**Last Updated:** `(not yet run)`

**Note:** This section is intended to be updated automatically by the CI pipeline. However, due to environmental constraints preventing the full test and metrics suite from running, the data below is not available. This is a known issue tracked in the project [Roadmap](./ROADMAP.md).

---

### Test Suite State

| Metric                  | Value |
| ----------------------- | ----- |
| Total tests             | N/A   |
| Unit tests              | N/A   |
| E2E tests (Playwright)  | N/A   |
| Passing tests           | N/A   |
| Failing tests           | N/A   |
| Disabled/skipped tests  | N/A   |
| Unit tests passing      | N/A   |
| E2E tests failing       | N/A   |
| Total runtime           | N/A   |

---

### Coverage Summary

| Metric     | Value |
| ---------- | ----- |
| Statements | N/A   |
| Branches   | N/A   |
| Functions  | N/A   |
| Lines      | N/A   |

---

### Code Bloat Metrics

| Metric                  | Value |
| ----------------------- | ----- |
| Total `src/` directory size | N/A   |

---

## 6. Metrics and Success Criteria

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

## 7. Future Enhancements / Opportunities

### Feature Proposal: Rolling Accuracy Comparison of STT Engines (Native, Cloud, On-device)
**Goal:** Improve transparency and user trust.

We can strengthen user confidence by adding a feature that compares accuracy across Native Browser, Cloud AI, and On-device modes. Instead of one-off tests, the system would track results from actual usage over time and compute a rolling accuracy percentage. This avoids storing large datasets while still giving users a clear view of performance differences.

### [COMPLETED] Feature: Dynamic Software Quality Metrics Reporting

**Goal:** To provide an accurate, at-a-glance overview of the project's health directly within the documentation.

**Problem:** The current Software Quality Metrics section in this document is not updated automatically and relies on placeholder data.

**Solution Implemented:** A robust, parallel CI/CD pipeline has been implemented in `.github/workflows/ci.yml`. This workflow runs all necessary checks, including linting, type-checking, unit tests, and E2E tests, in a distributed and efficient manner. The results of these checks can be used to automatically update the Software Quality Metrics section of this document.

---

## 8. Strategic Review & Analysis

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
    *   **Recommendation:** This remains the core paid offering. The value proposition should be clear: "unlimited practice," "Cloud AI transcription," and the key differentiator of "on-device transcription" for enhanced privacy. The fallback to Native Browser is a good technical resilience feature.
## Software Quality Metrics (Last Updated: Sun Sep 28 00:21:32 UTC 2025)

### Test Suite State

| Test Type | Passed | Failed | Skipped | Total |
|-----------|--------|--------|---------|-------|
| Unit Tests| 111 | 0 | 0 | 111 |
| E2E Tests | 0 | 0 | 0 | N/A |

### Coverage Summary

| Metric | Value |
|--------|-------|
| Lines  | 25.35% |

### Code Bloat Metrics

| Metric      | Value     |
|-------------|-----------|
| Bundle Size | 6.2M |

*Metrics updated automatically by the CI pipeline.*
