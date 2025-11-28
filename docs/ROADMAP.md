**Owner:** [unassigned]
**Last Reviewed:** 2025-11-27

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
  - ⏸️ **BLOCKED** - Shorten OTP expiry to <1 hour (requires Supabase Pro account)
  - ⏸️ **BLOCKED** - Enable leaked password protection (requires Supabase Pro account)
  - ⏸️ **DEFERRED** - Upgrade Postgres version (not critical for alpha)

### ⚠️ Known Issues
- **P1 - Live Transcript E2E Test Intermittent Timeout (2025-11-27)**
  - **Problem:** `live-transcript.e2e.spec.ts` times out waiting for `e2e:speech-recognition-ready` event in some environments (CI/repeated runs)
  - **Error:** `page.evaluate: Test timeout of 120000ms exceeded` at `waitForE2EEvent` (line 114)
  - **Root Cause:** MockSpeechRecognition in `e2e-bridge.ts` may not be dispatching `e2e:speech-recognition-ready` event consistently across all execution contexts
  - **Impact:** Test passes locally but may fail in CI/CD pipeline
  - **Workaround:** Re-run tests; investigating event dispatch timing issue
  
- **P2 - Lighthouse Performance Score Below Target (2025-11-22)**
  - **Problem:** Lighthouse CI reports Performance score of ~0.62 and LCP of ~0.26, below target of 0.90
  - **Impact:** User experience may be suboptimal on slower connections/devices
  - **Next Steps:** Performance optimization work scheduled for future sprint

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
- ✅ **Audit and Fix UX States:** Standardized loading/error states across SessionPage, SignInPage, SignUpPage, WeeklyActivityChart, GoalsSection (2025-11-27)
- ✅ **Apply Supabase Migration:** `custom_vocabulary` migration applied to production
- ✅ **Implement Lighthouse CI:** Lighthouse stage added to CI pipeline with performance thresholds (2025-11-22)
- ✅ **Hide "TBD" Placeholders:** Remove or hide "TBD" sections (e.g., testimonials) for the Alpha launch.\
- ⏸️ **Harden Supabase Security:** BLOCKED - OTP/password features require Supabase Pro account (deferred to production launch)\
- ✅ **Centralize Configuration:** Move hardcoded values to `src/config.ts`.\
- ✅ **Fix E2E Test Gap (Live Transcript):** Complete end-to-end coverage implemented (2025-11-27)
- 🔴 **Implement WebSocket Reconnect Logic:** Add heartbeat and exponential backoff.

### 🚧 Should-Have (Tech Debt)
- **✅ COMPLETED - CVA-Based Design System Refinement (2025-11-28):**
  - **Completed:**
    - ✅ Audited all 20 UI components for consistent CVA variant usage
    - ✅ Fixed Badge typo, refactored Input to use CVA, replaced hardcoded Card shadow
    - ✅ Verified 8 stateful components properly use CVA, 12 utility components appropriately use static classes
    - ✅ **Documented design token usage guidelines in `docs/DESIGN_TOKENS.md`**
  - **Remaining Work:**
    - 🔴 Add lightweight custom component showcase (route + page)
- ✅ **Refactor `useSpeechRecognition` hook:** Improve maintainability and fix memory leaks.
- ✅ **Add Robust UX States:** Completed 2025-11-27 (SessionPage, SignInPage, SignUpPage, WeeklyActivityChart, GoalsSection)
- ✅ **Centralize configuration:** Move hardcoded values (e.g., session limits) to a config file.
- 🔴 **Harden E2E Architecture:** Complete event migration across all tests
- 🔴 **Increase Unit Test Coverage:** Target: 36% → 70%
- 🔴 **Improve Accessibility:** Use an ARIA live region for the transcript so screen readers can announce new lines.
- 🔴 **Add Deno unit tests for the token endpoint.**
- ✅ **Add a soak test:** 5-minute concurrent user test implemented (`tests/soak/soak-test.spec.ts`) with memory leak detection
- 🔴 **Add Real Testimonials:** Unhide and populate the `TestimonialsSection` on the landing page with genuine user feedback.
- 🔴 **Light Theme Implementation:** Add CSS or disable toggle

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

- **✅ COMPLETED (2025-11-21) - P1 (Critical): Refactor On-Device STT for True Streaming**
  - **Status:** LocalWhisper now uses 1s processing loop (not 5s batching) and async processing to prevent UI freezing
  - **Implementation:** `LocalWhisper.ts` line 138 - `setInterval(() => this.processAudio(), 1000)`
  - **Note:** Full Web Worker migration deferred - current async implementation sufficient for alpha

- **✅ COMPLETED (2025-11-27) - P2 (High): Complete Live Transcript E2E Test**
  - **Status:** ✅ Test now passing with full end-to-end coverage
  - **Problem:** `live-transcript.e2e.spec.ts` test was hanging after SessionPage navigation due to incorrect button disabled logic and missing audio API mocks in headless environment
  - **Solution Implemented:**
    - Fixed button disabled logic from `!isReady && !isListening` to `isListening && !isReady` in `SessionPage.tsx`
    - Added microphone permissions and fake device launch args (`--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`) to `playwright.config.ts`
    - Implemented comprehensive audio API mocks: `getUserMedia`, `AudioContext`, `AudioWorkletNode` via `page.addInitScript`
    - Leveraged existing `e2e-bridge.ts` MockSpeechRecognition infrastructure with `dispatchMockTranscript()` for transcript simulation
    - Added `waitForE2EEvent('e2e:speech-recognition-ready')` for deterministic synchronization
  - **Test Coverage:** Login → Session start → READY status → Mock transcript display (passing in 1.8s)
  - **Verification:** ✅ Full E2E flow working, CI pipeline unblocked

- **✅ COMPLETED (2025-11-26) - P2 (High): Refactor Analytics Page to Eliminate Prop Drilling (Finding 3.2)**
  - **Status:** COMPLETED
  - **Problem:** The main analytics page (`AnalyticsPage.tsx`) suffered from prop drilling and inefficient data fetching. It fetched the entire session history even when only one session was needed and passed numerous props down through the component tree.
  - **Solution Implemented:**
    - Refactored `useAnalytics` hook to consume `usePracticeHistory` (React Query) as single source of truth
    - Centralized all derived statistics calculation in `analyticsUtils.ts`
    - Removed prop drilling from `AnalyticsPage` and `AnalyticsDashboard` components
    - Added support for session filtering via `useParams` for single-session views
    - Updated all component tests (`AnalyticsDashboard.test.tsx`, `TopFillerWords.test.tsx`, `AccuracyComparison.test.tsx`) to match refactored hook signature
  - **Verification:** ✅ All 135 unit tests passing, ✅ All 2 E2E tests passing
  - **Commit:** `17be58c`


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

- **P2 (Medium): Review and Improve Test Quality and Effectiveness**
  - **Problem:** Several tests in the suite were brittle or of low value, providing a false sense of security.
  - **Example:** The `live-transcript.e2e.spec.ts` and `smoke.e2e.spec.ts` tests were previously coupled to the UI's responsive layout, making them fail on minor CSS changes.
  - **Required Action:** This effort is in progress. The aforementioned tests have been refactored to use robust, functional `data-testid` selectors, making them resilient to layout changes. A comprehensive audit of the remaining unit and E2E test suites is still needed to identify other low-value tests.

### System Architecture Improvements (Post-Restructure Nov 2024)

These items were identified in a comprehensive system analysis and remain relevant after the codebase restructuring.

- **✅ COMPLETED - P1 (Critical): E2E Tests Run Against Production Build**
  - **Status:** COMPLETED (2025-11-24)
  - **Problem:** `playwright.config.ts` was using `pnpm run dev` which launches the Vite dev server with HMR, not a production-like build.
  - **Solution Implemented:**
    - Added `preview:test` script: `vite preview --mode test --port 4173`
    - Updated `playwright.config.ts` webServer command to `pnpm preview:test`
    - Updated PORT constant from 5173 to 4173
    - Added build artifact check in `scripts/test-audit.sh`
    - Fixed `.env.test` VITE_PORT from 5173 to 4173
  - **Verification:** E2E tests passing in ~5 seconds per shard, preview server starts correctly
  - **Commit:** `8f6ffb1`, `fa956ca`

- **✅ COMPLETED - P1 (High): Build-Time Environment Variable Validation**
  - **Status:** COMPLETED (2025-11-24)
  - **Problem:** Required environment variables were checked at runtime, causing E2E test timeouts.
  - **Solution Implemented:**
    - Created `env.required` file listing all required variables
    - Created `scripts/validate-env.mjs` validation script
    - Added `prebuild` and `prebuild:test` hooks to `package.json`
    - Integrated validation into `scripts/test-audit.sh` and CI workflow
    - Updated README.md with env vars documentation
    - Created `.env.example` template
  - **Verification:** Build fails immediately with clear error if env vars missing
  - **Commit:** Multiple commits in Phase 1

- **✅ COMPLETED - P3 (Medium): Use Vite's loadEnv for Environment Variables**
  - **Status:** COMPLETED (2025-11-24)
  - **Problem:** `vite.config.mjs` used `process.env` directly, causing "works on my machine" issues.
  - **Solution Implemented:**
    - Imported and used Vite's `loadEnv(mode, path.resolve(__dirname, '..'), '')`
    - Fixed loadEnv path to correctly load from project root (not `frontend/`)
    - Added env var spreading to `define` block to expose vars to `import.meta.env`
  - **Verification:** Build succeeds, env vars correctly loaded and exposed
  - **Commit:** `dcd96c3`, `fa956ca`
  - **MoSCoW:** Should Have

- **✅ COMPLETED - P3 (Low): Simplify and Document package.json Scripts (2025-11-28)**
  - **Status:** COMPLETED
  - **Solution Implemented:**
    - Removed duplicate script: `test:unit` (identical to `test`)
    - Removed low-level `test:e2e:health`, now called directly in `test-audit.sh`
    - Established `test:health-check` as the ONE canonical health check (comprehensive smoke test)
    - Added JSDoc-style comments to all scripts
    - Created "Scripts Reference" decision tree in README.md
  - **Verification:** All scripts tested, lint passing, health-check verified
  - **Commit:** `21c1407` (and follow-up fixes)
  - **MoSCoW:** Should Have
  
- **✅ COMPLETED - P3 (Medium): Design System Consistency**
  - **Status:** COMPLETED (2025-11-28)
  - **Problem:** Inconsistent use of design tokens and CVA patterns across UI components.
  - **Solution Implemented:**
    - Fixed `Badge` component typo (`text-primary-fg` → `text-primary-foreground`).
    - Refactored `Input` component to use `cva` with variant (default, ghost) and size (sm, default, lg) props.
    - Replaced hardcoded shadow in `Card` component with `shadow-card` token.
    - Audited all 20 UI components: 8 properly use CVA, 12 utility components appropriately use static classes.
  - **Verification:** All components now use design tokens correctly, CVA pattern consistent across stateful components.
  - **Commit:** `f8980c5`
  - **MoSCoW:** Should Have
  - **Problem:** The `package.json` scripts section contains multiple overlapping test commands creating ambiguity about which to use when:
    - Multiple test entry points: `test`, `test:unit`, `test:all`, `test:health-check`, `check-in-validation`
    - Multiple E2E commands: `test:e2e:ui`, `test:e2e:debug`, `test:e2e:health`, `test:health-check`
    - Unclear when to use `test:all` vs `check-in-validation` vs direct `test`
  - **Impact:** Developer confusion, inconsistent usage, harder onboarding.
  - **Current State:** 
    ```json
    "test": "cd frontend && vitest --coverage",
    "test:unit": "cd frontend && vitest --coverage",  // Duplicate!
    "test:all": "./scripts/test-audit.sh local",
    "test:health-check": "playwright test ...",       // E2E subset
    "check-in-validation": "./scripts/test-audit.sh ci-simulate",
    "test:e2e:health": "playwright test ...",         // Duplicate!
    ```
  - **Note:** ✅ Redundant `tsc &&` build step already removed during restructuring
  - **Required Action:**
    - **Consolidate duplicates:**
      - Remove `test:unit` (identical to `test`)
      - Remove `test:e2e:health` (identical to `test:health-check`)
    - **Add JSDoc-style comments** explaining each script's purpose
    - **Create "Scripts Reference" section** in README.md with decision tree:
      - "Want to run full CI simulation?" → `pnpm run check-in-validation`
      - "Want quick feedback?" → `pnpm test` for unit, `pnpm run test:health-check` for E2E
      - "Debugging E2E?" → `pnpm run test:e2e:ui` or `test:e2e:debug`
    - **Document in AGENTS.md** which scripts are canonical for CI vs local dev
  - **Estimated Time:** 1.5 hours
  - **MoSCoW:** Should Have

- **P4 (Low): Refactor Supabase Mock to Provider Pattern**
  - **Problem:** `src/lib/supabaseClient.ts` uses global `window.supabase` object for test mocking. Lacks type safety, relies on mutable global state, could cause auth flakiness.
  - **Current State:** `if ((window as any).supabase) { ... }`
  - **Required Action:**
    - Create `SupabaseProvider` context
    - Create `MockSupabaseProvider` for tests
    - Refactor all `getSupabaseClient()` calls to use context hook
  - **Estimated Time:** 4-6 hours
  - **MoSCoW:** Could Have

- **P4 (Low): Replace programmaticLogin with MSW Network Mocking**
  - **Problem:** `tests/e2e/helpers.ts` programmaticLogin is complex and fragile, using client-side injection via `addInitScript`. Works but architecturally weak.
  - **Impact:** Test maintenance burden, potential for subtle auth bugs.
  - **Required Action:**
    - Set up Mock Service Worker (MSW)
    - Create handlers for Supabase auth endpoints
    - Replace `programmaticLogin` with network-level mocking
  - **Estimated Time:** 5-8 hours
  - **MoSCoW:** Could Have

- **✅ COMPLETED - P3 (Medium): Use Native Playwright Sharding**
  - **Status:** COMPLETED (2025-11-25)
  - **Problem:** `scripts/test-audit.sh` manually implemented test sharding. Playwright has built-in `--shard` support which is simpler and more reliable.
  - **Solution Implemented:**
    - Refactored CI workflow `.github/workflows/ci.yml` to use fixed matrix `[1, 2, 3, 4]` instead of dynamic shard calculation
    - Updated CI to call Playwright with native `--shard` flag: `playwright test --shard=1/4`
    - Removed `run_e2e_sharding()` function from `test-audit.sh` (no longer generates `e2e-shards.json`)
    - Simplified `run_e2e_tests_shard()` to directly use native sharding
    - Updated `ci-simulate` to use fixed 4-shard loop
    - Removed `test-support` artifact dependency from CI
  - **Impact:** Simpler, more maintainable CI configuration. Removed ~50 lines of custom sharding logic.
  - **Verification:** Local test with `./scripts/test-audit.sh test 1` passed (4 tests in shard 1/4)
  - **Commit:** Part of Nov 25 architectural cleanup sprint


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
  - **Phase 1 (Completed 2025-11-28):**
    - ✅ Established baseline (~0.62)
    - ✅ Optimized Hero image (LCP element) with explicit dimensions and priority
    - ✅ Split whisper-turbo into separate ml-vendor chunk
    - ✅ Verified lazy loading for heavy routes (Analytics, Session)
  - **Phase 2 (Remaining):**
    - 🔴 Audit and optimize font loading (preload critical fonts, font-display: swap)
    - 🔴 Identify and defer/async render-blocking resources
    - 🔴 Add Lighthouse score tracking to CI metrics (`scripts/run-metrics.sh`)
    - 🔴 Achieve target score > 0.90

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
