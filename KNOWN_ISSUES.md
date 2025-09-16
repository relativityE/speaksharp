# Known Issues & Tech Debt

This document outlines the current known issues, technical debt, and a clear to-do list for the next steps in development, as of 2025-09-15.

## 🔴 Known Issues

### 1. E2E Test Failure: "Start Session" Button Not Found

Despite a massive effort to stabilize the End-to-End (E2E) test environment, a single test case remains stubbornly failing.

-   **Test File**: `tests/e2e/pro.e2e.spec.ts`
-   **Test Case**: `start and stop session for pro`
-   **Behavior**: After a successful login and redirect to the main session page, the test times out because it cannot find the `Start Session` button.
-   **Current Status**: This is the primary blocker for a fully green E2E test suite. All underlying environment, routing, and mocking issues are believed to be resolved. The failure points to a subtle bug in the application's component rendering logic that only manifests under the specific conditions of the Playwright test environment. A trace file (`trace.zip`) has been generated to allow for deep debugging of this specific issue.

## 🛠️ Technical Debt

The process of debugging the E2E suite revealed several areas of technical debt:

1.  **Fragile E2E Environment**: The initial test environment was brittle, suffering from dependency issues (`pnpm`), configuration problems (Vite, PostCSS), and race conditions. The new architecture documented in `ARCHITECTURE.md` is a significant improvement, but the history of instability suggests the frontend build and test pipeline could benefit from further simplification and hardening.

2.  **Implicit Dependencies**: Components like `SessionSidebar` have implicit, unhandled dependencies on external scripts like Stripe.js. The component currently crashes silently if the script fails to load. This should be refactored to be more resilient, perhaps by displaying an error state or gracefully degrading functionality.

3.  **Incomplete Test Coverage**: While the `pro` user flow has been the focus, other test suites (`anon.e2e.spec.ts`, `free.e2e.spec.ts`, `basic.e2e.spec.ts`) have not been run against the new, stabilized environment. They will likely need similar updates and fixes.

## ✅ TODO List

-   [ ] **Diagnose the final "Start Session" button issue**:
    -   Analyze the `trace.zip` file from the last failed test run to understand the component state and console output at the moment of failure.
    -   Determine why the `SessionSidebar` component is not rendering the button for the test runner.

-   [ ] **Fix the remaining E2E tests**:
    -   Run the `anon.e2e.spec.ts` suite. Debug and fix any failures.
    -   Run the `free.e2e.spec.ts` suite. Debug and fix any failures.
    -   Run the `basic.e2e.spec.ts` suite. Debug and fix any failures.

-   [ ] **Refactor `SessionSidebar.jsx`**:
    -   Make the component more resilient to the failure of external scripts like Stripe. It should not crash the render if a script fails to load.

-   [ ] **Improve Mocking Strategy**:
    -   Consider creating a global `beforeEach` hook in the Playwright setup to apply mocks (like the Stripe mock) to all test files automatically, reducing code duplication.
