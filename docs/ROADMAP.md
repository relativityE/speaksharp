**Owner:** [unassigned]
**Last Reviewed:** 2025-09-20

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
- ✅ **Stabilize and Optimize CI/Unit Tests**:
    -   **Status:** **Done.** The test environment has been fully stabilized.
    -   **Action Taken:** Resolved critical architectural flaws that caused persistent E2E test timeouts and memory leaks. The root cause was a combination of an `AuthProvider` loading state bug, a fragile test wrapper, and conflicting mock systems. The test environment is now stable, and a dedicated smoke test script (`run-e2e-smoke.sh`) has been integrated into the CI pipeline.
- **Task:** [CI] Re-architect CI/CD Pipeline
  - **Status:** ✅ Done
  - **Details:** The monolithic `ci-run-all.sh` script has been replaced with a parallel, multi-job GitHub Actions workflow. This resolves the 7-minute timeout issue and provides a more robust and scalable solution for CI/CD.
- **Task:** [CI] Fix Monolithic Test Script Timeout
  - **Status:** ✅ Done
  - **Details:** The `ci-run-all.sh` script has been replaced with a parallel, multi-job GitHub Actions workflow. This resolves the 7-minute timeout issue.

### Gating Check
- 🔴 **Do a Gap Analysis of current implementation against the Current Phase requirements.**

---
## Phase 2: User Validation & Polish
This phase is about confirming the core feature set works as expected and polishing the user experience before wider release.

### 🎯 Must-Have
- 🔴 **Implement Speaking Pace Analysis:** Add real-time feedback on words per minute to the core analytics.
- 🔴 **Implement Custom Vocabulary:** Allow Pro users to add custom words (jargon, names) to improve transcription accuracy.
- ✅ **Implement Speaker Identification:** Add the ability to distinguish between different speakers in the transcript.
- 🔴 **Implement Vocal Variety / Pause Detection:** Add a new Pro-tier feature to analyze vocal variety or pause duration.
- 🟡 **User-Friendly Error Handling:** Implement specific, user-facing error messages for common issues.
- 🔴 **Deploy & confirm live transcript UI works:** Ensure text appears within 2 seconds of speech in a live environment.
- 🔴 **Remove all temporary console.logs:** Clean up the codebase for production.

### 🚧 Should-Have (Tech Debt)
- ✅ **Implement STT Accuracy Comparison:**
    - **Problem:** The application does not provide a way for users to compare the accuracy of the different transcription engines.
    - **Task:** Implement a feature to track and display a rolling average of STT accuracy for each mode against a ground truth.
- ✅ **Implement Top 2 Filler Words Analysis:**
    - **Problem:** The analytics dashboard does not highlight the most frequently used filler words.
    - **Task:** Implement a feature to identify and display the top 2 filler words for the most recent 4 sessions.
- 🟡 **Implement new SpeakSharp Design System:**
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

This section is a prioritized list of technical debt items to be addressed.

- **P1 (High): Add Unit Test Coverage for Core Features**
  - **Problem:** A new mandate requires unit tests for all features. The following are missing coverage:
    - **Transcription Modes:** `LocalWhisper`, `NativeBrowser`.
    - **Session & Analytics:** `SessionContext`.

- **P2 (Medium): Complete Removal of Obsolete User Tiers**
  - **Status:** Completed.
  - **Action Taken:** A full audit for "anonymous" and "premium" references was conducted. All legacy code paths related to these user tiers have been removed, and the codebase now exclusively uses the "free" and "pro" user types.

- **P2 (Medium): Investigate ESLint `caughtErrorsIgnorePattern` Anomaly**
  - **Problem:** The ESLint configuration (`eslint.config.js`) has been updated to ignore unused variables prefixed with an underscore (`_`). While this works for standard variables and function arguments, it is not being respected for `catch` block errors (`caughtErrorsIgnorePattern`).
  - **Current Workaround:** The affected `catch` blocks in `tests/global-setup.ts` and `tests/global-teardown.ts` have been temporarily disabled with `// eslint-disable-next-line` comments to unblock the CI pipeline.
  - **Required Action:** A deeper investigation is needed to understand why the configuration is not being applied correctly for caught errors. This might involve upgrading ESLint plugins or further debugging the configuration interaction.

- **P3 (Medium): Incomplete TypeScript Migration**
  - **Problem:** Several test-related files and utilities are still JavaScript.
  - **Files to migrate:** `__mocks__/*.js`, `src/services/transcription/utils/audio-processor.worklet.js`.

- **P3 (Low): Harden Custom Test Wrapper (`verifyOnlyStepTracker.ts`)**
  - **Problem:** The custom test wrapper, while useful for debugging, can be fragile and was a contributing factor to test hangs. It has been replaced with a more resilient version, but for critical smoke tests, it is recommended to use the `plainTest` and `plainExpect` exports to bypass the wrappers entirely.
  - **Required Action:** The wrapper should be audited for further hardening, or a decision should be made to remove it in favor of standard Playwright logging features to improve long-term maintainability.

- **P4 (Low): Improve Unit Test Discoverability**
  - **Problem:** The lack of easily discoverable, co-located unit tests makes the codebase harder to maintain.

- **P1 (High): Refactor `useSpeechRecognition` Hook**
  - **Status:** ✅ **Done.**
  - **Action Taken:** The hook has been successfully refactored into smaller, more focused hooks (`useTranscriptionService`, `useFillerWords`, `useTranscriptState`). The underlying `useTranscriptionService` was further refactored to resolve a critical memory leak caused by improper instance management. The entire test suite is now passing, confirming the stability of the new implementation.