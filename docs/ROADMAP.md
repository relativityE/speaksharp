**Owner:** Jules
**Last Reviewed:** 2025-09-06

🔗 [Back to Outline](./OUTLINE.md)

# SpeakSharp Roadmap
*(For executive-level commentary on prioritization, see [REVIEW.md](./REVIEW.md)).*

This board provides a two-dimensional view of our project tasks, combining Phased Milestones (timeline) with MoSCoW Prioritization.

Status Key: ✅ Done | 🟡 In Progress | 🔴 Not Started
---
## Phase 1: Stabilize & Harden the MVP
This phase focuses on fixing critical bugs, addressing code health, and ensuring the existing features are reliable and robust. (Timeline: Extended by 1-2 weeks to ensure all Must-Haves are 100% complete before GTM).

### 🎯 Must-Have
- 🔴 **Fix Critical Application Bugs (BLOCKING ALL PROGRESS):**
  - 🔴 `[C-01]` Lack of Protected Routes: Implement protected routes for all sensitive user pages.
  - 🔴 `[C-02]` Flawed Auth Provider: Refactor `AuthContext.tsx` to remove anti-patterns and stabilize authentication logic.
  - 🔴 `[C-03]` Anonymous User Flow is Broken: Fix the session persistence logic for anonymous users.
  - 🔴 `[C-04]` Premium Users Do Not Receive Paid Features: Correct the monetization logic in `TranscriptionService.js`.
- 🔴 **Technical Debt: Remediate and Stabilize the Test Suite**
  - **Problem Diagnosis:** A deep-dive analysis has concluded that the test suite's instability is not caused by application bugs, but by systemic issues within the test framework itself. The suite is slow, hangs, and is unreliable due to pervasive state leaks, memory leaks, and a brittle, overly complex mocking strategy. The current test configuration (`vite.config.mjs`) contains numerous workarounds (e.g., forced serial execution, process-per-file execution, manual garbage collection) that treat the symptoms but not the root cause.
  - **Strategic Remediation Plan:** The following phased approach is required to pay down this technical debt and create a stable, reliable, and efficient test suite.
    - **Phase 1: Stabilization & Exposure:** Make the existing problems visible.
      - *Tasks:* Remove console error suppression to reveal all underlying warnings. Introduce automated leak detection for timers and network connections in the test setup to explicitly fail tests that do not clean up after themselves.
    - **Phase 2: Refactoring for Testability:** Decouple components from their dependencies.
      - *Tasks:* Refactor core components to use Dependency Injection. Replace fragile, global mocks with lightweight, test-specific mocks that are provided at the point of testing.
    - **Phase 3: Performance Optimization:** Remove the performance-killing workarounds.
      - *Tasks:* Remove manual garbage collection calls. Re-enable parallel test execution in the Vite configuration.
    - **Phase 4: E2E Strategy Refinement:** Improve the reliability and focus of the E2E suite.
      - *Tasks:* Audit and prune the E2E suite to focus only on critical user flows. Replace brittle selectors with `data-testid` attributes.
- 🔴 **Implement "Free User Quota" E2E test:** Close the critical gap in monetization flow testing. This is also blocked by the critical bugs.

### 🚧 Should-Have (Tech Debt)
- 🔴 **Refactor Integration Tests:** Slim down component tests (`SessionSidebar`, `AnalyticsPage`, etc.) to remove redundant coverage now handled by E2E tests.
- 🔴 **Create Troubleshooting Guide:** Add error recovery steps to the documentation.
- 🔴 **Enhance Anonymous and Pro E2E tests:** Update existing E2E tests to cover the full "golden path" for each role. (Blocked by critical bugs).
- 🔴 **Add full unit test coverage for `CloudAssemblyAI.js`:** Target ≥80% coverage for core logic.

### Gating Check
- 🟡 **Bring all documentation up to date to reflect latest/current code implementation**
- 🔴 **Do a Gap Analysis of current implementation against the Current Phase requirements.**

---
## Phase 2: User Validation & Polish
This phase is about confirming the core feature set works as expected and polishing the user experience before wider release.

### 🎯 Must-Have
- 🔴 **Implement On-Device 'Local Transcript' Mode:** Implement a fully on-device, privacy-first transcription mode for Premium users.
  - 🔴 1. Research & Select Model
  - 🔴 2. Create LocalWhisper Provider
  - 🔴 3. Integrate Model & Audio Processing
  - 🔴 4. Add UI Selector
  - 🔴 5. E2E Testing & Hardening
- 🔴 **Implement Speaking Pace Analysis:** Add real-time feedback on words per minute to the core analytics.
- 🔴 **Implement Vocal Variety / Pause Detection:** Add a new Pro-tier feature to analyze vocal variety or pause duration.
- 🟡 **Explicit Mode Indication in UI:** UI elements exist, but are not always accurate due to `[C-04]`.
- 🔴 **User-Friendly Error Handling:** Implement specific, user-facing error messages for common issues.
- 🔴 **Deploy & confirm live transcript UI works:** Ensure text appears within 2 seconds of speech in a live environment.
- 🔴 **Remove all temporary console.logs:** Clean up the codebase for production.
- 🟡 **Implement Universal Navigation:** A sidebar exists, but is not fully functional or accessible from all pages as intended.
- 🟡 **Implement Analytics Page UI Components:** Components exist but are fed by broken data flows (`[C-03]`).

### 🚧 Should-Have (Tech Debt)
- 🟡 **Implement new SpeakSharp Design System:** (See [Architecture: Design System](./ARCHITECTURE.md#2-frontend-architecture))
  - ✅ 1. Configure Core Theme & Test
  - ✅ 2. Create Component Plugins & Test
  - 🟡 3. Refactor UI Components & Test
  - 🔴 4. Final Verification & Test
- 🟡 **Add Robust UX States:** Some states exist, but are inconsistently applied.
- 🔴 **Improve Accessibility:** Use an ARIA live region for the transcript so screen readers can announce new lines.
- 🔴 **Add Deno unit tests for the token endpoint.**
- 🔴 **Add a soak test:** Create a test that runs for 1-minute with continuous audio to check for memory leaks or hangs.
- 🔴 **Create e2e tests for different user roles (anonymous, free, pro).** (Blocked by critical bugs).

### Gating Check
- 🔴 **Bring all documentation up to date to reflect latest/current code implementation**
- 🔴 **Do a Gap Analysis of current implementation against the Current Phase requirements.**

---
## Phase 3: Extensibility & Future-Proofing
This phase focuses on long-term architecture, scalability, and preparing for future feature development.

### 🎯 Must-Have
- 🔴 **Implement WebSocket reconnect logic:** Add heartbeat and exponential backoff for a more resilient connection.
- ✅ **Implement new CVA-based Design System:** The foundation is established.
- ✅ **Reintroduce TranscriptionService abstraction:** The service exists and provides an abstraction layer.

### 🌱 Could-Have (Future Enhancements)
- 🔴 **Add a Jitter Buffer & Audio Resampling Guard:** To gracefully handle unstable microphone inputs.
- 🔴 **Implement Stripe "Pro Mode" Flag:** For feature gating and usage-based billing.
- 🟡 **Set up Multi-Env CI/CD:** A basic implementation for DB migrations exists, but needs expansion.

### Gating Check
- 🔴 **Bring all documentation up to date to reflect latest/current code implementation**
- 🔴 **Do a Gap Analysis of current implementation against the Current Phase requirements.**
