**Owner:** [unassigned]
**Last Reviewed:** 2025-09-19

🔗 [Back to Outline](./OUTLINE.md)

# SpeakSharp Roadmap
*(For executive-level commentary on prioritization, see [REVIEW.md](./REVIEW.md)).*

This document outlines the forward-looking development plan for SpeakSharp. Completed tasks are moved to the [Changelog](./CHANGELOG.md).

Status Key: 🟡 In Progress | 🔴 Not Started
---
## Phase 1: Stabilize & Harden the MVP
This phase focuses on fixing critical bugs, addressing code health, and ensuring the existing features are reliable and robust.

### 🚧 Should-Have (Tech Debt)
- 🔴 **Refactor Integration Tests:** Slim down component tests (`SessionSidebar`, `AnalyticsPage`, etc.) to remove redundant coverage now handled by E2E tests.
- 🔴 **Create Troubleshooting Guide:** Add error recovery steps to the documentation.
- 🔴 **Harden Supabase Security:** Address security advisor warnings.
  - 🔴 1. Shorten OTP expiry to less than one hour.
  - 🔴 2. Enable leaked password protection.
  - 🔴 3. Upgrade the Postgres version.
- 🔴 **Diagnose the final "Start Session" button issue**:
    -   Analyze the `trace.zip` file from the last failed test run to understand the component state and console output at the moment of failure.
    -   Determine why the `SessionSidebar` component is not rendering the button for the test runner.
- 🔴 **Fix the remaining E2E tests**:
    -   Run and fix the `anon.e2e.spec.ts` suite.
    -   Run and fix the `free.e2e.spec.ts` suite.
    -   Run and fix the `basic.e2e.spec.ts` suite.

### Gating Check
- 🔴 **Do a Gap Analysis of current implementation against the Current Phase requirements.**

---
## Phase 2: User Validation & Polish
This phase is about confirming the core feature set works as expected and polishing the user experience before wider release.

### 🎯 Must-Have
- 🔴 **Implement Speaking Pace Analysis:** Add real-time feedback on words per minute to the core analytics.
- 🔴 **Implement Custom Vocabulary:** Allow Pro users to add custom words (jargon, names) to improve transcription accuracy.
- 🔴 **Implement Speaker Identification:** Add the ability to distinguish between different speakers in the transcript.
- 🔴 **Implement Vocal Variety / Pause Detection:** Add a new Pro-tier feature to analyze vocal variety or pause duration.
- 🔴 **Add UI Selector for On-Device Mode:** Add a UI element to allow Pro users to select their preferred transcription mode.
- 🔴 **User-Friendly Error Handling:** Implement specific, user-facing error messages for common issues.
- 🔴 **Deploy & confirm live transcript UI works:** Ensure text appears within 2 seconds of speech in a live environment.
- 🔴 **Remove all temporary console.logs:** Clean up the codebase for production.

### 🚧 Should-Have (Tech Debt)
- 🟡 **Implement new SpeakSharp Design System:** (See [Architecture: Design System](./ARCHITECTURE.md#2-frontend-architecture))
  - 🟡 3. Refactor UI Components & Test
  - 🔴 4. Final Verification & Test
- 🟡 **Add Robust UX States:** Some states exist, but are inconsistently applied.
- 🔴 **Improve Accessibility:** Use an ARIA live region for the transcript so screen readers can announce new lines.
- 🔴 **Add Deno unit tests for the token endpoint.**
- 🔴 **Add a soak test:** Create a test that runs for 1-minute with continuous audio to check for memory leaks or hangs.

### Gating Check
- 🔴 **Do a Gap Analysis of current implementation against the Current Phase requirements.**

---
## Phase 3: Extensibility & Future-Proofing
This phase focuses on long-term architecture, scalability, and preparing for future feature development.

### 🎯 Must-Have
- 🔴 **Implement WebSocket reconnect logic:** Add heartbeat and exponential backoff for a more resilient connection.

### 🌱 Could-Have (Future Enhancements)
- 🔴 **Implement Stripe "Pro Mode" Flag:** For feature gating and usage-based billing.
- 🔴 **Automate On-Device Model Updates:** Create a script (e.g., GitHub Action) to automatically check for and download new versions of the locally-hosted Whisper model to prevent it from becoming stale.
- 🔴 **Add Platform Integrations (e.g., Zoom, Google Meet):** Allow SpeakSharp to connect to and analyze audio from third-party meeting platforms.
- 🟡 **Set up Multi-Env CI/CD:** A basic implementation for DB migrations exists, but needs expansion.

### Gating Check
- 🔴 **Do a Gap Analysis of current implementation against the Current Phase requirements.**

---
## Technical Debt

### 🎯 Must-Have (Test Coverage)
- 🔴 **Add Unit Test Coverage for Core Features**: A new mandate requires unit tests for all features. The following implemented features are missing coverage:
    - **Transcription Modes:** `CloudAssemblyAI`, `LocalWhisper`, `NativeBrowser`.
    - **Session & Analytics:** `SessionContext`, `analyticsUtils` (for trend analysis).

### Items from Code Audit (Sept 2025)

A recent code audit identified the following areas of technical debt:

1.  **🟡 Incomplete TypeScript Migration**: While the core application services have been migrated to TypeScript, several test-related files and utilities remain as JavaScript.
    *   **Files to migrate:** `__mocks__/*.js`, `src/services/transcription/utils/audio-processor.worklet.js`.

2.  **🟡 Improve Unit Test Discoverability**: The current testing strategy relies heavily on E2E and integration tests. While effective, the lack of easily discoverable, co-located unit tests for services like `AuthContext` and `TranscriptionService` makes the codebase harder to maintain. Unit tests for individual modes exist but should be better integrated.

3.  **🔴 Automate Software Quality Metrics Generation**
    **Problem:** The current process for generating software quality metrics is manual and uses placeholder data, which does not reflect the true state of the codebase.

    **Proposed Solution:** The `./run-tests.sh` script should be enhanced to dynamically generate these metrics. This involves:
    1.  Configuring the test runners (Vitest and Playwright) to output their results in a machine-readable JSON format.
    2.  Using a tool like `jq` to parse these JSON reports and extract key metrics (test counts, pass/fail rates, code coverage).
    3.  Automatically updating the "Software Quality Metrics" section in `docs/PRD.md` with this data.

    **Next Steps:** A developer needs to pick up this task and implement the described changes in the `./run-tests.sh` script.

4.  **🔴 `sharp` Module Installation Failure in Sandboxed Environment**
    **Problem:** The `sharp` module, a critical dependency for image processing, fails to install correctly in the sandboxed test environment. This blocks the unit tests for `TranscriptionService.test.ts` and prevents the full test suite from running.
    **Analysis:** The issue appears to be related to the installation of `sharp`'s native binaries. Standard installation methods have failed. The migration from JS to TS has been considered as a potential factor, but the root cause is likely environmental.
    **Next Steps:** The `sharp` module will be replaced with `jimp`, a pure JavaScript image processing library. This will eliminate the native dependency and the installation issues. A developer needs to pick up this task and implement the change. In the meantime, the tests that depend on `sharp` will be temporarily disabled to unblock other development work.
