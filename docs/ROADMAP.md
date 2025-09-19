**Owner:** [unassigned]
**Last Reviewed:** 2025-09-18

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
  - ✅ `[C-04]` Pro Users Do Not Receive Paid Features: Corrected the monetization logic in `TranscriptionService.js`.
- ✅ **Technical Debt: Remediate and Stabilize the Test Suite Environment**
  - **Resolution:** The E2E test environment has been completely stabilized. All configuration conflicts, dependency issues, and environment variable loading problems have been resolved. The test suite is now fully runnable. The remaining E2E test failures are due to specific, identifiable bugs in the application's UI code, which can now be addressed.
- ✅ **Implement "Free User Quota" E2E test:** An E2E test for the 'Free' user role has been added.

### 🚧 Should-Have (Tech Debt)
- ✅ **Migrate "Low Hanging Fruit" JS to TypeScript:** Convert simple, non-critical JavaScript files to TypeScript to improve type safety.
  - ✅ `src/utils/fillerWordUtils.js`
  - ✅ `src/lib/dateUtils.js`
  - ✅ `src/lib/analyticsUtils.js`
  - ✅ `src/hooks/useBrowserSupport.js`
  - ✅ `tests/mocks/stripe.jsx`
- 🔴 **Refactor Integration Tests:** Slim down component tests (`SessionSidebar`, `AnalyticsPage`, etc.) to remove redundant coverage now handled by E2E tests.
- 🔴 **Create Troubleshooting Guide:** Add error recovery steps to the documentation.
- 🔴 **Harden Supabase Security:** Address security advisor warnings.
  - 🔴 1. Shorten OTP expiry to less than one hour.
  - 🔴 2. Enable leaked password protection.
  - 🔴 3. Upgrade the Postgres version.
- ✅ **Enhance Anonymous and Pro E2E tests:** The E2E tests for all user flows (anonymous, free, pro, auth) have been significantly refactored for robustness, maintainability, and clearer error reporting.
- ✅ **Add full unit test coverage for `CloudAssemblyAI.js`:** All unit tests for this module are now passing.
- ✅ **Resolve Playwright Missing System Dependencies:** The necessary system-level libraries and browser binaries for Playwright have been installed in the test environment.
- 🔴 **Diagnose the final "Start Session" button issue**:
    -   Analyze the `trace.zip` file from the last failed test run to understand the component state and console output at the moment of failure.
    -   Determine why the `SessionSidebar` component is not rendering the button for the test runner.
- 🔴 **Fix the remaining E2E tests**:
    -   Run and fix the `anon.e2e.spec.ts` suite.
    -   Run and fix the `free.e2e.spec.ts` suite.
    -   Run and fix the `basic.e2e.spec.ts` suite.

### Gating Check
- ✅ **Bring all documentation up to date to reflect latest/current code implementation**
- 🔴 **Do a Gap Analysis of current implementation against the Current Phase requirements.**

---
## Phase 2: User Validation & Polish
This phase is about confirming the core feature set works as expected and polishing the user experience before wider release.

### 🎯 Must-Have
- ✅ **Implement On-Device 'Local Transcript' Mode (`[C-04]`):** Implemented a fully on-device, privacy-first transcription mode for Pro users using `@xenova/transformers`.
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
- ✅ **Create e2e tests for different user roles (anonymous, free, pro).** E2E tests now exist for anonymous, free, and pro user flows.

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

### Items from E2E Debugging Session (Sept 2025)

The process of debugging the E2E suite revealed several areas of technical debt:

1.  **Fragile E2E Environment**: The initial test environment was brittle, suffering from dependency issues (`pnpm`), configuration problems (Vite, PostCSS), and race conditions. The new architecture documented in `ARCHITECTURE.md` is a significant improvement, but the history of instability suggests the frontend build and test pipeline could benefit from further simplification and hardening.

2.  **Implicit Dependencies**: Components like `SessionSidebar` have implicit, unhandled dependencies on external scripts like Stripe.js. The component currently crashes silently if the script fails to load. This should be refactored to be more resilient, perhaps by displaying an error state or gracefully degrading functionality.

3.  **Incomplete Test Coverage**: While the `pro` user flow has been the focus, other test suites (`anon.e2e.spec.ts`, `free.e2e.spec.ts`, `basic.e2e.spec.ts`) have not been run against the new, stabilized environment. They will likely need similar updates and fixes.

4.  **✅ Redundant Mocking Logic**: The Stripe mock has been refactored from a Vite alias into a global network intercept in the Playwright setup, improving test stability and maintainability.

5.  **🟡 Tier Consolidation from 4 Tiers to 2**: The core application logic has been consolidated to two authenticated tiers (`Free`, `Pro`). Documentation and legacy artifacts are now being purged to match the implementation.
