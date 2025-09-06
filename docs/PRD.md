**Owner:** [Unassigned]
**Last Reviewed:** 2025-09-05

🔗 [Back to Outline](./OUTLINE.md)

# SpeakSharp Product Requirements Document

**Version 6.28** | **Last Updated: 2025-09-05**

## 1. Executive Summary

SpeakSharp is a **privacy-first, real-time speech analysis tool** designed as a modern, serverless SaaS web application. Its architecture is strategically aligned with the core product goal: to provide instant, on-device feedback that helps users improve their public speaking skills, while rigorously protecting their privacy.

The system is built for speed, both in user experience and development velocity. It leverages a **[React (Vite) frontend](./ARCHITECTURE.md#2-frontend-architecture)** for a highly interactive UI and **[Supabase as an all-in-one backend](./ARCHITECTURE.md#3-backend-architecture)** for data, authentication, and user management.

## 2. Vision & Positioning
* **Vision:** To be the leading real-time speech coach for professionals, helping them communicate with confidence and clarity.
* **Positioning:** SpeakSharp is the only privacy-first, [on-device speech analysis tool](./ARCHITECTURE.md#5-transcription-service) that provides instant feedback without sending sensitive conversations to the cloud.

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
                           | - On-device (local) transcription   |
                           | - Detailed Analytics                |
                           | - Download session data             |
                           +-------------------------------------+
```

### Feature Set (MoSCoW)
(See [ROADMAP.md](./ROADMAP.md) for current status)
*   **Must-Have:** Real-time transcription, filler word detection, session history.
*   **Should-Have:** On-device transcription mode, advanced analytics.
*   **Could-Have:** Team features, custom vocabulary.
*   **Won't-Have (at this time):** Mobile application.

### Differentiation
*   **vs. Otter.ai:** Privacy-first (on-device option), focused on improvement, not just transcription.
*   **vs. Poised:** More affordable, simpler to use, no installation required.

### Go-to-Market & Financials
*(For leadership analysis of conversion assumptions and GTM strategy, see [REVIEW.md – CFO & CEO perspectives](./REVIEW.md)).*
*   **GTM:** Adopt a phased GTM approach.
    *   **Phase 1 (Validation):** Start with organic channels (Reddit, SEO content, public speaking forums) and community engagement (Toastmasters partnerships) to validate product-market fit and gather testimonials. Create a "How it Works" video demo for the landing page to increase conversion.
    *   **Phase 2 (Growth):** Gradually increase paid advertising spend based on proven metrics from Phase 1.
    *   A real-time revenue tracking dashboard (e.g., PostHog, ChartMogul) will be implemented to monitor KPIs.
*   **Financials:** Freemium model with a Pro tier subscription. Financial models will account for multiple conversion rate scenarios (2%, 3.5%, and 5%) to ensure sufficient runway. See internal documents for detailed projections.

## 2. Recent Updates (v6.26)
*August 31, 2025*
- **Comprehensive Test Suite Expansion**: Implemented a full suite of new and refactored tests to enhance code quality and stability. This includes new tests for `AuthPage`, `useBrowserSupport`, and `useSpeechRecognition`, as well as significant enhancements to existing tests for `AnalyticsPage`, `SessionPage`, and `MainPage`.
- **Hardened Test Environment**: Implemented a robust test environment with shims for external services (`Stripe`, `PostHog`, etc.) and network interception via Playwright to ensure deterministic E2E tests.
- **Code Cleanup**: Deleted obsolete test files to streamline the codebase.

## 2.1. Recent Updates (v6.27)
*September 3, 2025*
- **Critical Bug Fix**: Fixed a data flow issue where session data was not being correctly saved and passed to the analytics page.
- **Analytics UI Update**: Replaced the "Top Filler Words" bar chart with a more detailed table view and removed unnecessary UI panels from the dashboard.
- **Performance Tuning**: Improved the perceived responsiveness of the live transcript by reducing the debounce timer for filler word highlighting.

---

## 3. Known Issues
*(For leadership analysis of technical debt, see [REVIEW.md – Senior Engineer perspective](./REVIEW.md)).*
- **Critical Bugs & Environment Instability:**
    - **Unstable Unit/Integration Test Suite:** The `vitest` suite (`pnpm test:unit`) currently suffers from a memory leak and should not be run as part of the main CI pipeline.
    - **Unstable E2E Test Suite:** The Playwright suite (`pnpm test:e2e`) hangs when run in parallel (the default setting). This is likely due to resource contention in the test environment. **Workaround:** The suite has been configured to run tests sequentially (`workers: 1`), which stabilizes the run but increases execution time.
    - **`rounded-pill` error:** A persistent, uncaught error related to `rounded-pill` suggests potential build, cache, or configuration issues.
    - **`toast` function non-operational:** The `toast` notification does not work in local mode, hindering user feedback.
    - **Cloud AssemblyAI API 401 Error:** The Supabase Edge Function for the AssemblyAI API returns a 401 Unauthorized error, blocking cloud transcription.
- **On-Device Transcription Needs Polish:** The `LocalWhisper` provider in `TranscriptionService` may require further UI/UX polishing.

### Technical Debt
*   **Test Suite Bloat:** Our test suite contains redundant integration tests that should be refactored or removed in favor of the high-value E2E tests. Key candidates for removal/refactor are `FullSessionSave.test.jsx`, `SessionDataFlow.test.jsx`, `SessionSidebar.test.jsx`, and `AnalyticsPage.test.jsx`.
*   **Incomplete E2E Tests:** Our existing E2E tests for Anonymous and Pro users should be enhanced to cover the full "golden path" for each role. The "Free User" monetization flow is a critical missing test.

---

## 4. Development Roadmap
The project's development status is tracked in the [**Roadmap**](./ROADMAP.md). This board provides a two-dimensional view of our project tasks, combining Phased Milestones (timeline) with MoSCoW Prioritization.

---

## 5. Software Quality Metrics

This section tracks key software quality metrics for the project. For our testing principles, see the [Testing Strategy in the Architecture doc](./ARCHITECTURE.md#7-testing-strategy).

### E2E Coverage Status

| E2E Golden Path | Status | Notes |
| :--- | :--- | :--- |
| **Anonymous User** | 🟡 Needs Enhancement | Existing test should be updated to assert on time limits and sign-up prompts. |
| **Free User** | ❌ **CRITICAL GAP** | No E2E test exists for the monetization funnel. |
| **Pro User** | 🟡 Needs Enhancement | Existing test should be updated to verify sessions can exceed the free time limit. |
| **Premium User** | ⚪️ N/A | Feature not yet implemented. |

### Latest Test Suite Run
*   **Result:** ✅ Success & Stable
*   **Date:** 2025-09-05
*   **Total Tests:** 83
*   **Passed/Failed:** 83 / 0
*   **Coverage:** 8.85% (Lines)

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
