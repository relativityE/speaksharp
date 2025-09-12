**Owner:** [unassigned]
**Last Reviewed:** 2025-09-08

🔗 [Back to Outline](./OUTLINE.md)

# SpeakSharp Roadmap
*(For executive-level commentary on prioritization, see [REVIEW.md](./REVIEW.md)).*

This board provides a two-dimensional view of our project tasks, combining Phased Milestones (timeline) with MoSCoW Prioritization.

Status Key: ✅ Done | 🟡 In Progress | 🔴 Not Started
---
## Phase 1: Stabilize & Harden the MVP
This phase focuses on fixing critical bugs, addressing code health, and ensuring the existing features are reliable and robust. (Timeline: Extended by 1-2 weeks to ensure all Must-Haves are 100% complete before GTM).

### 🎯 Must-Have
- ✅ **Fix Critical Application Bugs (BLOCKING ALL PROGRESS):**
  - ✅ `[C-01]` Lack of Protected Routes: Implemented protected routes for all sensitive user pages.
  - ✅ `[C-02]` Flawed Auth Provider: Refactored `AuthContext.tsx` to remove anti-patterns and stabilize authentication logic.
  - ✅ `[C-03]` Anonymous User Flow is Broken: Fixed the session persistence logic for anonymous users.
  - ✅ `[C-04]` Premium Users Do Not Receive Paid Features: Corrected the monetization logic in `TranscriptionService.js`.
- 🟡 **Technical Debt: Remediate and Stabilize the Test Suite**
  - **Resolution:** Multiple underlying bugs causing server crashes (Tailwind CSS) and test hangs (network stubbing deadlocks) have been identified and fixed. The E2E test files have been significantly refactored for robustness. However, the suite remains non-functional due to a persistent environmental issue causing tests to hang.
- ✅ **Implement "Free User Quota" E2E test:** An E2E test for the 'Free' user role has been added.

### 🚧 Should-Have (Tech Debt)
- 🟡 **Migrate "Low Hanging Fruit" JS to TypeScript:** Convert simple, non-critical JavaScript files to TypeScript to improve type safety.
  - ✅ `src/utils/fillerWordUtils.js`
  - 🔴 `src/lib/dateUtils.js`
  - 🔴 `src/lib/analyticsUtils.js`
  - 🔴 `src/hooks/useBrowserSupport.js`
- 🔴 **Refactor Integration Tests:** Slim down component tests (`SessionSidebar`, `AnalyticsPage`, etc.) to remove redundant coverage now handled by E2E tests.
- 🔴 **Create Troubleshooting Guide:** Add error recovery steps to the documentation.
- 🔴 **Harden Supabase Security:** Address security advisor warnings.
  - 🔴 1. Shorten OTP expiry to less than one hour.
  - 🔴 2. Enable leaked password protection.
  - 🔴 3. Upgrade the Postgres version.
- ✅ **Enhance Anonymous and Pro E2E tests:** The E2E tests for all user flows (anonymous, free, pro, auth) have been significantly refactored for robustness, maintainability, and clearer error reporting.
- ✅ **Add full unit test coverage for `CloudAssemblyAI.js`:** All unit tests for this module are now passing.
- ✅ **Resolve Playwright Missing System Dependencies:** The necessary system-level libraries and browser binaries for Playwright have been installed in the test environment.

### Gating Check
- ✅ **Bring all documentation up to date to reflect latest/current code implementation**
- 🔴 **Do a Gap Analysis of current implementation against the Current Phase requirements.**

---
## Phase 2: User Validation & Polish
This phase is about confirming the core feature set works as expected and polishing the user experience before wider release.

### 🎯 Must-Have
- ✅ **Implement On-Device 'Local Transcript' Mode (`[C-04]`):** Implemented a fully on-device, privacy-first transcription mode for Premium users using `@xenova/transformers`.
  - ✅ 1. Research & Select Model
  - ✅ 2. Create LocalWhisper Provider
  - ✅ 3. Integrate Model & Audio Processing
  - 🔴 4. Add UI Selector
  - ✅ 5. E2E Testing & Hardening
- 🔴 **Implement Speaking Pace Analysis:** Add real-time feedback on words per minute to the core analytics.
- 🔴 **Implement Vocal Variety / Pause Detection:** Add a new Pro-tier feature to analyze vocal variety or pause duration.
- ✅ **Explicit Mode Indication in UI:** UI elements are now accurate.
- 🔴 **User-Friendly Error Handling:** Implement specific, user-facing error messages for common issues.
- 🔴 **Deploy & confirm live transcript UI works:** Ensure text appears within 2 seconds of speech in a live environment.
- 🔴 **Remove all temporary console.logs:** Clean up the codebase for production.
- ✅ **Implement Universal Navigation:** The sidebar is now fully functional and accessible from all pages.
- ✅ **Implement Analytics Page UI Components:** Components are now fed by correct data flows.
- ✅ **Automate Code Quality Checks:** Implemented `lint-staged` and a `husky` pre-commit hook to automatically run `eslint` and `tsc` on staged files.

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
- ✅ **Create e2e tests for different user roles (anonymous, free, pro).** E2E tests now exist for anonymous, free, pro, and premium user flows.

### Gating Check
- ✅ **Bring all documentation up to date to reflect latest/current code implementation**
- 🔴 **Do a Gap Analysis of current implementation against the Current Phase requirements.**

---
## Phase 3: Extensibility & Future-Proofing
This phase focuses on long-term architecture, scalability, and preparing for future feature development.

### 🎯 Must-Have
- 🔴 **Implement WebSocket reconnect logic:** Add heartbeat and exponential backoff for a more resilient connection.
- ✅ **Implement new CVA-based Design System:** The foundation is established.
- ✅ **Reintroduce TranscriptionService abstraction:** The service exists and provides an abstraction layer.

### 🌱 Could-Have (Future Enhancements)
- ✅ **Add a Jitter Buffer & Audio Resampling Guard:** A critical resampling bug has been fixed, improving stability.
- 🔴 **Implement Stripe "Pro Mode" Flag:** For feature gating and usage-based billing.
- 🔴 **Automate On-Device Model Updates:** Create a script (e.g., GitHub Action) to automatically check for and download new versions of the locally-hosted Whisper model to prevent it from becoming stale.
- 🟡 **Set up Multi-Env CI/CD:** A basic implementation for DB migrations exists, but needs expansion.

### Gating Check
- ✅ **Bring all documentation up to a-date to reflect latest/current code implementation**
- 🔴 **Do a Gap Analysis of current implementation against the Current Phase requirements.**

---
## Technical Debt

### Debugging E2E Test Failures

**Last Updated:** 2025-09-12

**Symptom:**
E2E tests hang indefinitely without producing logs, even with `DEBUG=pw:api,vite:*` enabled. The test process never completes and eventually times out.

**Root Cause Analysis:**
The investigation concluded that this is not a Playwright issue but a silent crash in the Vite development server. The crash is caused by an error in the Tailwind CSS compilation, specifically when processing custom CSS classes defined with CSS variables (e.g., `bg-background`).

The sequence of events is as follows:
1.  Playwright starts the test and navigates to the application URL (`page.goto()`).
2.  The Vite dev server receives the request and attempts to build the application.
3.  During the build, the `@tailwindcss/vite` plugin encounters an unknown utility class in `src/index.css` and throws an error.
4.  This error causes the Vite server to crash silently, without sending a response back to the browser.
5.  Playwright's `page.goto()` waits indefinitely for a response that never comes, resulting in a deadlock-like hang.

**Effective Debugging Strategy:**
Because the server crashes silently, running tests with `concurrently` hides the root cause. The most effective way to debug this is to run the Vite server and the Playwright tests as separate, concurrent processes.

1.  **Start the dev server with verbose logging** in one terminal (or in the background, redirecting output to a log file):
    ```bash
    DEBUG=vite:* pnpm run dev:test > vite.log 2>&1 &
    ```
2.  **Run the Playwright test** in a second terminal:
    ```bash
    pnpm exec playwright test tests/<your-test-file>.spec.ts
    ```
3.  **Inspect the server log (`vite.log`)** for crash information. The log will contain the stack trace of the Tailwind CSS error.

**Global Test Hardening (Watchdog):**
To prevent tests from hanging silently in the future, a global watchdog has been implemented in `tests/global-setup.ts`. This setup file monkey-patches Playwright's `page.goto()`, `page.waitForURL()`, and `page.waitForLoadState()` methods.

Key features of the watchdog:
*   **Fast Fail:** It enforces a 15-second timeout on these navigation methods. If the page fails to load, the test fails immediately instead of hanging.
*   **Artifact Capture:** On timeout, it automatically captures a screenshot and the page's HTML, saving them to `test-results/e2e-artifacts/`. This provides immediate visual evidence of the page's state at the time of the hang.
*   **Global Application:** The watchdog is applied to all tests automatically via the `globalSetup` option in `playwright.config.ts`.
