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
- 🟡 **Stabilize and Optimize CI E2E Tests**:
    -   **Status:** The test scripting environment has been completely refactored and stabilized with a new granular, orchestrated pipeline (`ci-run-all.sh`).
    -   **Next Action:** The full E2E suite still exceeds the CI environment's timeout. Individual tests must be timed to identify a fast, reliable smoke test to include in the pipeline.
- 🔴 **Add Unit Tests for Complex Analytics:**
    - **Problem:** The `analyticsUtils.ts` file has complex logic for trend analysis that is not fully covered by unit tests.
    - **Task:** Write comprehensive unit tests for `calculateFillerWordTrends` and `calculateOverallStats`, including edge cases and complex scenarios.

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
- 🔴 **User-Friendly Error Handling:** Implement specific, user-facing error messages for common issues.
- 🔴 **Deploy & confirm live transcript UI works:** Ensure text appears within 2 seconds of speech in a live environment.
- 🔴 **Remove all temporary console.logs:** Clean up the codebase for production.

### 🚧 Should-Have (Tech Debt)
- 🔴 **Implement STT Accuracy Comparison:**
    - **Problem:** The application does not provide a way for users to compare the accuracy of the different transcription engines.
    - **Task:** Implement a feature to track and display a rolling average of STT accuracy for each mode.
- 🔴 **Implement Top 2 Filler Words Analysis:**
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
    - **Transcription Modes:** `CloudAssemblyAI`, `LocalWhisper`, `NativeBrowser`.
    - **Session & Analytics:** `SessionContext`, `analyticsUtils` (for trend analysis).

- **P2 (Medium): Investigate ESLint `caughtErrorsIgnorePattern` Anomaly**
  - **Problem:** The ESLint configuration (`eslint.config.js`) has been updated to ignore unused variables prefixed with an underscore (`_`). While this works for standard variables and function arguments, it is not being respected for `catch` block errors (`caughtErrorsIgnorePattern`).
  - **Current Workaround:** The affected `catch` blocks in `tests/global-setup.ts` and `tests/global-teardown.ts` have been temporarily disabled with `// eslint-disable-next-line` comments to unblock the CI pipeline.
  - **Required Action:** A deeper investigation is needed to understand why the configuration is not being applied correctly for caught errors. This might involve upgrading ESLint plugins or further debugging the configuration interaction.

- **P3 (Medium): Incomplete TypeScript Migration**
  - **Problem:** Several test-related files and utilities are still JavaScript.
  - **Files to migrate:** `__mocks__/*.js`, `src/services/transcription/utils/audio-processor.worklet.js`.

- **P4 (Low): Improve Unit Test Discoverability**
  - **Problem:** The lack of easily discoverable, co-located unit tests makes the codebase harder to maintain.
