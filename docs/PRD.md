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
                           | - On-device (local) transcription   |
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
*   **GTM:** Adopt a phased GTM approach.
    *   **Phase 1 (Validation):** Start with organic channels (Reddit, SEO content, public speaking forums) and community engagement (Toastmasters partnerships) to validate product-market fit and gather testimonials. Create a "How it Works" video demo for the landing page to increase conversion.
    *   **Phase 2 (Growth):** Gradually increase paid advertising spend on proven metrics from Phase 1.
    *   A real-time revenue tracking dashboard (e.g., PostHog, ChartMogul) will be implemented to monitor KPIs.
*   **Financials:** Freemium model with a Pro tier subscription. Financial models will account for multiple conversion rate scenarios (2%, 3.5%, and 5%) to ensure sufficient runway. See internal documents for detailed projections.

---

## 3. Known Issues & Risks

This section tracks high-level product risks and constraints. For a detailed technical debt and task breakdown, see the [Roadmap](./ROADMAP.md).

*   **[ACTIVE] E2E Test Suite Failing:** The entire E2E test suite is currently failing due to a fundamental rendering issue in the test environment. The application fails to render any content, causing all tests to time out. This is the primary blocker for all development and must be resolved before any other work can proceed.

---

## 4. Development Roadmap
The project's development status is tracked in the [**Roadmap**](./ROADMAP.md). This board provides a two-dimensional view of our project tasks, combining Phased Milestones with MoSCoW Prioritization.

---

## 5. Software Quality Metrics

This document provides a snapshot of the current state of the test suite. It is automatically updated by the `run-tests.sh` script.

**Last Updated:** `(not yet run)`

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

---

## 8. Strategic Review & Analysis

This section provides high-level insights into the SpeakSharp project from multiple senior perspectives.

### 💰 CFO Perspective (Financials & GTM)

**Doing Well:**

*   [PRD.md](./PRD.md) captures LTV, CAC, and conversion assumptions.
*   Aggressive GTM strategy (SEO, Product Hunt, Ads).

**Risks:**

*   Free → Paid conversion assumption of 5% is optimistic (industry avg. 2–3%).
*   Current MVP still has technical debt (see [ROADMAP.md](./ROADMAP.md)), delaying monetization readiness.

**Recommendations:**

*   Extend Phase 1 until Stripe & QA are 100% hardened.
*   Model financial scenarios at 2%, 3.5%, and 5% conversion.
*   Set up **real-time financial tracking** (PostHog + ChartMogul or similar).
*   Adopt a **phased GTM approach**: organic channels first, then scale paid ads.

### 🚀 CEO Perspective (Product & Market)

**Doing Well:**

*   Clear niche: *privacy-first, real-time speech analysis* (filler words, speaking pace).
*   Strong freemium model with clear upgrade path.

**Gaps / Market Risks:**

*   Limited feature set at MVP (filler words only). Competitors offer richer analytics.
*   No social proof (testimonials, coach endorsements, beta case studies).

**Recommendations:**

*   Prioritize “speaking pace” analysis in Phase 2 ([ROADMAP.md](./ROADMAP.md#phase-2-user-validation--polish)).
*   Add at least one more Pro-only feature for stronger differentiation (e.g., vocal variety, pause detection).
*   Build trust: beta testimonials, Toastmasters/speech coach partnerships.
*   Produce a “How it Works” demo video for the landing page.
*   Actively engage with online communities (Reddit, forums) to build brand awareness.

### 💰 Updated Pricing Tiers & Recommendations

*   **Anonymous User:**
    *   **Recommendation:** Ensure the 2-minute anonymous session provides a truly compelling "aha!" moment. Focus on highlighting the immediate value of real-time feedback and the pain point it solves. The CTA to sign up should be prominent and frictionless.
*   **Free User (Authenticated):**
    *   **Recommendation:** The 10 minutes/month and 20-minute session limits are good for encouraging upgrades. Ensure the UpgradePromptDialog is well-designed, clearly communicates the benefits of upgrading, and appears at the moment of highest user engagement.
*   **Pro User (Authenticated):**
    *   **Recommendation:** This is the core paid offering. The value proposition of "unlimited practice", "Cloud AI transcription", "on-device transcription", "detailed analytics", and "download session data" should be clearly communicated.
