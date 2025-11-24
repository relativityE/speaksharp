**Owner:** [unassigned]
**Last Reviewed:** 2025-11-20

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

### Gating Check
- 🔴 **Do a Gap Analysis of current implementation against the Current Phase requirements.**

---
## Phase 2: User Validation & Polish
This phase is about confirming the core feature set works as expected and polishing the user experience before wider release.

### 🎯 Must-Have
- ✅ **Implement Speaking Pace Analysis:** Add real-time feedback on words per minute to the core analytics.
- ✅ **Implement Custom Vocabulary:** Allow Pro users to add custom words (jargon, names) to improve transcription accuracy.
- ✅ **Implement Vocal Variety / Pause Detection:** Add a new Pro-tier feature to analyze vocal variety or pause duration.
- ✅ **User-Friendly Error Handling:** Implement specific, user-facing error messages for common issues.
- ✅ **Clarity Score Visualization:** Detailed breakdown of speech clarity.
- ✅ **Goal Setting:** Weekly/Daily targets for practice consistency.
- 🔴 **Deploy & confirm live transcript UI works:** Ensure text appears within 2 seconds of speech in a live environment.
- ✅ **Remove all temporary console.logs:** Clean up the codebase for production.\
- ✅ **Restructure Codebase:** Reorganize the project structure for better maintainability before alpha soft launch.\
  - **Implemented Structure:**\
    - `frontend/`: React application code\
    - `backend/`: Supabase functions, migrations, seed data\
    - `scripts/`: Build, test, and maintenance scripts\
    - `docs/`: Documentation\
    - `tests/`: E2E and integration tests\
- 🔴 **Audit and Fix UX States:** Ensure all components correctly handle and display `isLoading`, `isError`, and empty states (e.g., Analytics Dashboard).\
- ✅ **Apply Supabase Migration:** Push `custom_vocabulary` migration to production to enable Pro features.\
- 🔴 **Implement Lighthouse CI:** Add a stage to the CI pipeline to run a Lighthouse audit against the production build.\
- ✅ **Hide "TBD" Placeholders:** Remove or hide "TBD" sections (e.g., testimonials) for the Alpha launch.\
- 🔴 **Harden Supabase Security:** Address critical security advisor warnings (OTP expiry, password protection, Postgres upgrade).\
- ✅ **Centralize Configuration:** Move hardcoded values to `src/config.ts`.\
- 🔴 **Fix E2E Test Gap (Live Transcript):** Refactor `TranscriptionService` and E2E tests to verify live transcript generation.\
- 🔴 **Implement WebSocket Reconnect Logic:** Add heartbeat and exponential backoff.

### 🚧 Should-Have (Tech Debt)
- 🟡 **Implement new SpeakSharp Design System:**
  - 🟡 3. Refactor UI Components & Test
  - 🔴 4. Final Verification & Test
- ✅ **Refactor `useSpeechRecognition` hook:** Improve maintainability and fix memory leaks.
- 🟡 **Add Robust UX States:** Some states exist, but are inconsistently applied.
- ✅ **Centralize configuration:** Move hardcoded values (e.g., session limits) to a config file.
- 🔴 **Improve Accessibility:** Use an ARIA live region for the transcript so screen readers can announce new lines.
- 🔴 **Add Deno unit tests for the token endpoint.**
- 🔴 **Add a soak test:** Create a test that runs for 1-minute with continuous audio to check for memory leaks or hangs.
- 🔴 **Add Real Testimonials:** Unhide and populate the `TestimonialsSection` on the landing page with genuine user feedback.

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


- **[RESOLVED] E2E Test Suite Not Running**
  - **Problem:** The test sharding logic in the old `test-audit.sh` was flawed, causing E2E tests to be skipped in CI.
  - **Solution:** The entire testing architecture has been overhauled with a new, robust, and parallelized `scripts/test-audit.sh` script. The new script correctly discovers, shards, and executes all E2E tests, and is accessed via the canonical `pnpm audit` command.

- [x] **Create E2E test for Analytics Empty State** (P2)
  - *Context:* Verify the "zero data" state for new users.
  - *Status:* ✅ Implemented `analytics-empty-state.e2e.spec.ts` and fixed mock data injection.
  - **Required Action:** Create a new E2E test that programmatically logs in a user, navigates to the `/analytics` page, and asserts that the correct "empty state" UI is displayed. This will ensure the new user experience is not broken by future changes.

- **P3 (Low): ESLint `no-unused-vars` Anomaly in `catch` Blocks**
  - **Problem:** The ESLint configuration does not correctly handle intentionally unused variables in `catch` blocks (e.g., `catch (_e)`). Neither prefixing the variable with an underscore nor using an `eslint-disable` comment successfully suppresses the `no-unused-vars` error.
  - **Required Action:** A deeper investigation into the `eslint.config.js` and `@typescript-eslint` plugin interaction is needed to find the correct configuration to allow unused `catch` block variables.

- **[RESOLVED] Poor Discoverability of `test-audit.sh` Commands**
  - **Problem:** The old test script had a cryptic, undocumented command-line interface.
  - **Solution:** The new testing architecture is accessed via a set of simple, well-documented `pnpm` scripts (`pnpm audit`, `pnpm audit:fast`, etc.), which are now the canonical standard. This has been documented in both `README.md` and `AGENTS.md`.

- **P3 (Medium): Implement Lighthouse Score for Performance Metrics**
  - **Problem:** The "Code Bloat & Performance" section of the Software Quality Metrics report in `docs/PRD.md` includes a placeholder for a Lighthouse score, but the score is not being generated.
  - **Required Action:** A new stage should be added to the `scripts/test-audit.sh` pipeline to run a Lighthouse audit against the production build. This will require starting a web server, executing the `lighthouse` command, and parsing the JSON output to extract the performance score. The `scripts/run-metrics.sh` and `scripts/update-prd-metrics.mjs` scripts will then need to be updated to incorporate this new data point.

- **P3 (Low): Harden Custom Test Wrapper (`verifyOnlyStepTracker.ts`)**
  - **Problem:** The custom test wrapper, while useful for debugging, can be fragile and was a contributing factor to test hangs. It has been replaced with a more resilient version, but for critical smoke tests, it is recommended to use the `plainTest` and `plainExpect` exports to bypass the wrappers entirely.
  - **Required Action:** The wrapper should be audited for further hardening, or a decision should be made to remove it in favor of standard Playwright logging features to improve long-term maintainability.

- **P4 (Low): Improve Unit Test Discoverability**
  - **Problem:** The lack of easily discoverable, co-located unit tests makes the codebase harder to maintain.

- **P2 (Medium): Inability to E2E Test Live Transcript Generation**
  - **Problem:** The `live-transcript.e2e.spec.ts` test is superficial. It only verifies that the UI enters a "recording" state, but does not verify that a transcript is actually generated and displayed. Attempts to mock the browser's `SpeechRecognition` API via `page.evaluate` and network interception via `page.route` have both failed, indicating a deep architectural issue or test environment limitation that prevents effective mocking of the `TranscriptionService`.
  - **Required Action:** A deeper investigation is required to find a viable strategy for E2E testing the live transcript generation. This may involve significant refactoring of the `TranscriptionService` to make it more amenable to testing, or exploring alternative mocking libraries or techniques. Until then, this core feature lacks meaningful E2E test coverage.

- **P2 (Medium): Review and Improve Test Quality and Effectiveness**
  - **Problem:** Several tests in the suite were brittle or of low value, providing a false sense of security.
  - **Example:** The `live-transcript.e2e.spec.ts` and `smoke.e2e.spec.ts` tests were previously coupled to the UI's responsive layout, making them fail on minor CSS changes.
  - **Required Action:** This effort is in progress. The aforementioned tests have been refactored to use robust, functional `data-testid` selectors, making them resilient to layout changes. A comprehensive audit of the remaining unit and E2E test suites is still needed to identify other low-value tests.\
\
- **P3 (Low): Implement ARIA Live Region for Transcript**\
  - **Problem:** Screen readers do not announce new transcript text.\
  - **Required Action:** Add `aria-live="polite"` to the transcript container.\
\
- **P3 (Low): ESLint `no-unused-vars` in Catch Blocks**\
  - **Problem:** Cannot suppress unused variables in catch blocks.\
  - **Required Action:** Fix ESLint config.\
\
- **P3 (Medium): Implement Deno Unit Tests for Token Endpoint**
  - **Problem:** The `assemblyai-token` function lacks unit tests.
  - **Required Action:** Implement tests to ensure auth reliability.

- **P2 (Medium): Optimize Lighthouse Performance Score**
  - **Problem:** Initial Lighthouse CI integration reveals a Performance score of ~0.62 and LCP of ~0.26, well below the target of 0.90.
  - **Target Metrics:**
    - Performance Score: > 0.90
    - Largest Contentful Paint (LCP): < 2.5s (Score > 0.90)
    - First Contentful Paint (FCP): < 1.8s (Score > 0.90)
    - Cumulative Layout Shift (CLS): < 0.1
  - **Required Action:** Investigate render-blocking resources, optimize image loading, and implement code splitting to improve core web vitals.

---
### Resolved Technical Debt

- **[RESOLVED] Architectural Flaw: Decoupled Session State from Auth Context**
  - **Problem:** The application's state management was architecturally flawed. The `SessionProvider` (managing practice history) was tightly coupled to the `AuthProvider` (managing user identity), creating a brittle, hard-to-maintain global state.
  - **Solution:** The `SessionProvider` was removed entirely and replaced with a modern, decoupled data-fetching architecture using `@tanstack/react-query`. A new `usePracticeHistory` hook now fetches practice history on-demand, completely separating the concern of application data from global authentication state. This makes the architecture more scalable, maintainable, and aligned with industry best practices.

- **[RESOLVED] E2E Smoke Test and Live Transcript Test Failures**
  - **Problem:** The smoke test and live transcript test were failing due to brittle assertions that were tightly coupled to the responsive UI layout. The test would check for the visibility of specific containers (like a desktop sidebar) which were not always present, causing the test to fail unnecessarily.
  - **Solution:** Both tests were refactored to follow a more robust, functional testing strategy. The brittle assertions were replaced with checks for a core functional element (`session-start-stop-button`) that exists in all responsive layouts. This decouples the tests from the presentation layer and ensures they are validating the feature's availability, not the specific UI implementation.

- **[RESOLVED] E2E Smoke Test Failure**
  - **Problem:** The E2E smoke test was failing because the mock Supabase client did not persist its session state across page navigations, causing the user to appear logged out and tests to fail.
  - **Solution:** The mock client was refactored to use `localStorage` for session persistence, accurately simulating the behavior of the real Supabase client. This ensures the authenticated state remains stable throughout the test's user journey.
