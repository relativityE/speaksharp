# Full-Spectrum & Architectural Analysis Report

This report provides an exhaustive analysis of the SpeakSharp codebase, covering foundational dependencies, CI/CD, frontend architecture, testing strategy, and documentation. The findings are presented in the mandatory format requested.

---

## Phase 1: Foundational Analysis (Configuration, CI/CD, and Dependencies)

### Finding 1.1: Dependency Health and Security

*   **📁 File:** `package.json`
*   **📍 Lines:** N/A (Project-wide dependency analysis)
*   **📝 Evidence:** Output from `pnpm audit`
    ```
    ┌─────────────────────┬────────────────────────────────────────────────────────┐
    │ low                 │ tmp allows arbitrary temporary file / directory write  │
    │                     │ via symbolic link `dir` parameter                      │
    ├─────────────────────┼────────────────────────────────────────────────────────┤
    │ Package             │ tmp                                                    │
    ├─────────────────────┼────────────────────────────────────────────────────────┤
    │ Vulnerable versions │ <=0.2.3                                                │
    ├─────────────────────┼────────────────────────────────────────────────────────┤
    │ Patched versions    │ >=0.2.4                                                │
    ├─────────────────────┼────────────────────────────────────────────────────────┤
    │ Paths               │ .>@lhci/cli>inquirer>external-editor>tmp               │
    │                     │                                                        │
    │                     │ .>@lhci/cli>tmp                                        │
    ├─────────────────────┼────────────────────────────────────────────────────────┤
    │ More info           │ https://github.com/advisories/GHSA-52f5-9888-hmc6      │
    └─────────────────────┴────────────────────────────────────────────────────────┘
    ```
*   **🔀 Options:**
    1.  **Fast Fix:** Run `pnpm up tmp` to attempt an automatic upgrade of the vulnerable sub-dependency. This is fast but may not resolve the issue if the parent dependency (`@lhci/cli`) has a strict version requirement.
    2.  **Robust Fix:** Use `pnpm override` in `package.json` to force the resolution of `tmp` to a patched version (e.g., `>=0.2.4`). This guarantees the vulnerability is patched but requires careful testing to ensure no breaking changes are introduced in `@lhci/cli`.
*   **🎯 Confidence:** High (95%) because the `pnpm audit` command provides direct, actionable evidence of the vulnerability and its dependency path.

### Finding 1.2: CI/CD and Local Environment Discrepancy

*   **📁 File:** `scripts/test-audit.sh`
*   **📍 Lines:** 76
*   **📝 Evidence:**
    ```bash
    run_e2e_health_check() {
        echo "✅ [4/6] Running Smoke Test (Comprehensive Health Check)..."
        pnpm exec playwright test tests/e2e/smoke.e2e.spec.ts --project=chromium || {
            echo "❌ Smoke Test failed." >&2
            exit 1
        }
        echo "✅ [4/6] Smoke Test Passed."
    }
    ```
    **Discrepancy:** The `AGENTS.md` file states that `test-audit.sh` calls a `pnpm test:e2e:health` script, which is missing from `package.json`. The script *actually* directly invokes `playwright test`. This is a critical documentation drift that could confuse developers.
*   **🔀 Options:**
    1.  **Align Script to Docs:** Add a `test:e2e:health` script to `package.json` that runs the `playwright test` command, and update `test-audit.sh` to call it. This makes the documentation correct but adds a layer of indirection.
    2.  **Align Docs to Script (Recommended):** Update `AGENTS.md` to reflect the actual command being run. This is simpler, more direct, and removes the "magic" of an unneeded `pnpm` script.
*   **🎯 Confidence:** High (99%) because the evidence is a direct contradiction between the documented workflow and the script's implementation.

---

## Phase 2: Frontend Architecture and Application Logic

### Finding 2.1: Redundant Data Fetching in Analytics Components

*   **📁 File:** `frontend/src/pages/AnalyticsPage.tsx` and `frontend/src/components/AnalyticsDashboard.tsx`
*   **📍 Lines:** `AnalyticsPage.tsx:40`, `AnalyticsDashboard.tsx:142`
*   **📝 Evidence:**
    *   `AnalyticsPage.tsx` calls `useUserProfile()` to fetch the user's profile.
    *   `AnalyticsDashboard.tsx` calls `useAnalytics()`, which in turn calls `usePracticeHistory()` to fetch session data.
    **Violation:** This violates the container/presentational pattern. The `AnalyticsPage` (container) should be solely responsible for fetching *all* necessary data and passing it down as props to the `AnalyticsDashboard` (presentational).
*   **🔀 Options:**
    1.  **Lift State Up:** Move the `useAnalytics` call from the dashboard into the `AnalyticsPage`. The page would then fetch both profile and session data and pass them down as props. This is the architecturally correct solution.
    2.  **Consolidate Hooks:** Create a new hook, e.g., `useAnalyticsPageData`, that internally calls both `useUserProfile` and `useAnalytics` and returns a single object with all the required data. This is a good alternative that encapsulates the data-fetching logic for the page.
*   **🎯 Confidence:** High (90%) because this is a clear violation of a well-established React design pattern that is leading to inefficient data management.

### Finding 2.2: Fragile E2E Synchronization Mechanism

*   **📁 File:** `frontend/src/contexts/AuthProvider.tsx`
*   **📍 Lines:** 52-56
*   **📝 Evidence:**
    ```typescript
    if (import.meta.env.MODE === 'test' || import.meta.env.VITE_TEST_MODE === 'true') {
      console.log(`[E2E DIAGNOSTIC] Profile found for ${data.id}, dispatching event.`);
      document.dispatchEvent(new CustomEvent('e2e-profile-loaded', { detail: data }));
    }
    ```
    **Analysis:** The application uses a custom browser event (`e2e-profile-loaded`) to signal to E2E tests that the user profile has been loaded. This is a custom-built, fragile synchronization method that creates a tight coupling between the application code and the test suite.
*   **🔀 Options:**
    1.  **Robust Wait Strategy (Recommended):** Remove the custom event entirely. The E2E tests should instead wait for a user-visible element that *proves* the profile has loaded (e.g., the appearance of the "Sign Out" button or the user's name in the navigation). This is a more robust, black-box testing approach.
    2.  **Formalize the Bridge:** If a bridge is necessary, create a more formal `window.e2eBridge` object with well-defined methods (`signalProfileLoaded()`, `waitForProfile()`) instead of using raw DOM events. This would at least make the contract between the app and the tests more explicit.
*   **🎯 Confidence:** High (95%) because custom event-based synchronization for tests is a known anti-pattern that leads to flaky and hard-to-maintain test suites.

---

## Phase 3: Testing Strategy and Mocking Architecture

### Finding 3.1: "Ice Cream Cone" Testing Anti-Pattern

*   **📁 File:** Project-wide
*   **📍 Lines:** N/A
*   **📝 Evidence:** The project has a comprehensive suite of E2E tests (`tests/e2e/`) but only a handful of unit tests (e.g., `frontend/src/hooks/__tests__/useAnalytics.test.ts`). The `PRD.md` itself reports ~36% line coverage. This is a classic "ice cream cone" anti-pattern, where the testing strategy is top-heavy with slow, brittle E2E tests and lacks a solid foundation of fast, reliable unit tests.
*   **🔀 Options:**
    1.  **Mandate Unit Tests for New Code:** Enforce a policy that all new features and bug fixes must be accompanied by unit tests. This is the most practical way to start building the unit test foundation.
    2.  **Implement Coverage Thresholds:** Configure Vitest to fail the test run if a certain coverage threshold (e.g., 70%) is not met. This is a more aggressive approach that would force the team to address the existing lack of coverage.
*   **🎯 Confidence:** High (99%) because the file structure and test reports provide direct evidence of a severe imbalance in the testing strategy.

### Finding 3.2: Flawed MSW Handler for Session History

*   **📁 File:** `frontend/src/mocks/handlers.ts`
*   **📍 Lines:** 39-55
*   **📝 Evidence:**
    ```typescript
      http.get('*/rest/v1/sessions', () => {
        console.log('[MSW DEBUG] Intercepted: GET /rest/v1/sessions');
        const mockSessionHistory = [
          {
            id: 'session-1',
            user_id: 'test-user-12_3', // Typo in user_id
            created_at: new Date().toISOString(),
            duration: 300,
            // Missing many required fields from the PracticeSession type
          },
        ];
        return HttpResponse.json(mockSessionHistory);
      }),
    ```
    **Analysis:** The MSW handler for the `/rest/v1/sessions` endpoint is returning a mock `PracticeSession` object that is incomplete and contains a typo in the `user_id`. The `usePracticeHistory` hook receives this malformed data, which causes the `useAnalytics` hook to fail its calculations, resulting in the `AnalyticsDashboard` rendering its empty state and the smoke test failing.
*   **🔀 Options:**
    1.  **Fix the Mock Data:** The immediate fix is to correct the `user_id` and add all the missing required fields to the mock session object in `handlers.ts` so that it conforms to the `PracticeSession` type.
    2.  **Centralize Mock Data Generation (Recommended):** Create a factory function (e.g., `createMockSession()`) in a shared test utility file. This function would generate a complete, valid `PracticeSession` object with default values. The MSW handler and any unit tests could then use this factory to ensure they are always working with valid, consistent mock data.
*   **🎯 Confidence:** High (99%) because this is the definitive root cause of the observed smoke test failure, confirmed by tracing the entire data flow from the component to the mock API handler.

---

## Phase 4: Documentation Reconciliation

### Finding 4.1: Severe Documentation Drift

*   **📁 File:** `docs/ARCHITECTURE.md`, `docs/PRD.md`, `docs/ROADMAP.md`
*   **📍 Lines:** N/A (Multiple inconsistencies)
*   **📝 Evidence:**
    *   `ARCHITECTURE.md` describes a non-existent `frontend/tests/unit/` directory and a deprecated `window.supabase` mocking strategy.
    *   `PRD.md` falsely claims 100% unit test coverage for all features.
    *   `ROADMAP.md` incorrectly marks several technical debt items as "COMPLETED".
*   **🔀 Options:**
    1.  **Surgical Updates:** Go through each document and surgically update the incorrect sections to align with the current state of the codebase. This is a time-consuming but necessary process.
    2.  **"Documentation Blitz" Initiative:** Treat the documentation debt as a formal project. Create a dedicated task to overhaul all documentation, assign an owner, and block any new feature work until the documentation is brought up to date. This is a more strategic approach to ensure the problem is solved thoroughly.
*   **🎯 Confidence:** High (99%) because the contradictions between the documentation and the actual codebase are direct and numerous. The documentation, in its current state, is unreliable and actively misleading.