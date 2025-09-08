**Owner:** [unassigned]
**Last Reviewed:** 2025-09-08

🔗 [Back to Outline](./OUTLINE.md)

# SpeakSharp Product Requirements Document

**Version 7.1** | **Last Updated: 2025-09-08**

## 1. Executive Summary

SpeakSharp is a **privacy-first, real-time speech analysis tool** designed as a modern, serverless SaaS web application. Its architecture is strategically aligned with the core product goal: to provide instant, on-device feedback that helps users improve their public speaking skills, while rigorously protecting their privacy.

The system is built for speed, both in user experience and development velocity. It leverages a **[React (Vite) frontend](./ARCHITECTURE.md#2-frontend-architecture)** for a highly interactive UI and **[Supabase as an all-in-one backend](./ARCHITECTURE.md#3-backend-architecture)** for data, authentication, and user management.

## 2. Vision & Positioning
* **Vision:** To be the leading real-time speech coach for professionals, helping them communicate with confidence and clarity.
* **Positioning:** SpeakSharp is a real-time speech analysis tool. A key differentiator on the roadmap is a **privacy-first, on-device transcription mode** that will provide instant feedback without sending sensitive conversations to the cloud.

### User Roles & Flows
This section contains ASCII art diagrams illustrating the journey for each user role.
*(For leadership analysis of conversion assumptions and role monetization, see [REVIEW.md – CFO & CEO perspectives](./REVIEW.md)).*

```ascii
                               +---------------------+
                               |   Landing Page      |
                               +---------------------+
                                         |
                                         |
                       +-----------------v-----------------+
                       |        [Anonymous User]           |
                       | - Practice session (2 min limit)  |
                       | - View single session analytics   |
                       | - Prompted to Sign Up to continue |
                       +-----------------v-----------------+
                                         |
                               +-------------------+
                               | Sign Up / Login   |
                               +-------------------+
                                         |
                       +-----------------v-----------------+
                       |      [Authentication Gate]        |
                       +-----------------v-----------------+
                                         |
                          +-----------------------------+
                          | [Free User]                 |
                          | - View Session History      |
                          | - Capped practice time/month|
                          | - 20 min session duration   |
                          | - Native Browser (Cloud)    |
                          +-----------------------------+
                                         |
                                         v
                          +-----------------------------+
                          | Usage Limit Reached?        |
                          +-----------------------------+
                                |          |
                              [No]       [Yes]
                                |          |
                                v          v
                      (Practice)    +---------------------+
                                    | UpgradePromptDialog |
                                    +---------------------+
                                              |
                                              v
                           +-------------------------------------+
                           | [Pro User]                          |
                           | (Via Stripe)                        |
                           | - Unlimited Time                    |
                           | - Cloud AI (Native fallback)        |
                           +-------------------------------------+
                                              |
                                              v
                           +-------------------------------------+
                           | [Premium User]                      |
                           | (Via Stripe)                        |
                           | - All Pro features                  |
                           | - On-device (local) transcription (FUTURE) |
                           | - Detailed Analytics                |
                           | - Download session data             |
                           | - Download session transcript (FUTURE) |
                           +-------------------------------------+
```

### Feature Set (MoSCoW)
(See [ROADMAP.md](./ROADMAP.md) for current status)
*   **Must-Have:** Real-time transcription, filler word detection, session history.
*   **Should-Have:** On-device transcription mode, advanced analytics.
*   **Could-Have:** Team features, custom vocabulary.
*   **Won't-Have (at this time):** Mobile application.

### Differentiation
*   **vs. Otter.ai:** Privacy-first (on-device option is a key roadmap item), focused on improvement, not just transcription.
*   **vs. Poised:** More affordable, simpler to use, no installation required.

### Go-to-Market & Financials
*(For leadership analysis of conversion assumptions and GTM strategy, see [REVIEW.md – CFO & CEO perspectives](./REVIEW.md)).*
*   **GTM:** Adopt a phased GTM approach.
    *   **Phase 1 (Validation):** Start with organic channels (Reddit, SEO content, public speaking forums) and community engagement (Toastmasters partnerships) to validate product-market fit and gather testimonials. Create a "How it Works" video demo for the landing page to increase conversion.
    *   **Phase 2 (Growth):** Gradually increase paid advertising spend on proven metrics from Phase 1.
    *   A real-time revenue tracking dashboard (e.g., PostHog, ChartMogul) will be implemented to monitor KPIs.
*   **Financials:** Freemium model with a Pro tier subscription. Financial models will account for multiple conversion rate scenarios (2%, 3.5%, and 5%) to ensure sufficient runway. See internal documents for detailed projections.

---

## 3. Known Issues & Risks

This section tracks high-level product risks and constraints. For a detailed technical debt and task breakdown, see the [Roadmap](./ROADMAP.md).

*   **[RISK] Critical Application Bugs:** All previously known critical bugs (`[C-01]` through `[C-04]`) have been **resolved**. The core application is now considered stable.
*   **[RISK] E2E Test Suite Instability:** The E2E test suite is currently the primary source of project risk. It is unstable and does not accurately test the application's real-world behavior. A full refactor of the test suite is the highest priority technical task.
*   **[RISK] Unimplemented Features:** Core features described in this document, such as on-device transcription for Premium users, are not yet implemented.

---

## 4. Development Roadmap
The project's development status is tracked in the [**Roadmap**](./ROADMAP.md). This board provides a two-dimensional view of our project tasks, combining Phased Milestones with MoSCoW Prioritization.

---

## 5. Software Quality Metrics

This section defines the product's quality goals. For technical details on the testing frameworks in use, see the [Testing Strategy in the Architecture doc](./ARCHITECTURE.md#7-testing-strategy).

### Testing Strategy
The product's testing strategy is to use a combination of E2E, component, and unit tests to ensure a high level of quality and confidence. The primary goal is to have **one high-value "golden path" E2E test for each user role** (Anonymous, Free, Pro) that validates the core business flow.

### E2E Coverage Status

| E2E Golden Path | Status | Notes |
| :--- | :--- | :--- |
| **Anonymous User** | 🟡 **Needs Refactor** | The user flow is now functional, but the test is brittle and needs to be refactored. |
| **Free User** | 🟡 **Needs Refactor** | The user flow is now functional, but the test is brittle and needs to be refactored. |
| **Pro User** | 🟡 **Needs Refactor** | The user flow is now functional, but the test is brittle and needs to be refactored. |
| **Premium User** | ⚪️ N/A | Feature not yet implemented. |

### Latest Test Suite Run
*   **Result:** 🔴 **Unstable**
*   **Date:** 2025-09-08
*   **Notes:** The test suite is currently unreliable due to a flawed testing strategy that bypasses the real authentication flow. The reported coverage numbers are not meaningful. A full refactor of the test suite is required.

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
