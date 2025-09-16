# Architecture

This document provides a high-level overview of the Speaksharp application's architecture, with a focus on the End-to-End (E2E) testing strategy.

## E2E Testing Architecture

The E2E test suite is built using **Playwright**. It is designed to simulate real user flows in a controlled environment. The architecture has several key components to ensure tests are reliable and isolated from external services.

### 1. Test Server Management

To run the tests, a Vite development server is started and managed automatically. This is handled by Playwright's global setup and teardown mechanism.

-   **`tests/global-setup.ts`**: This script is executed once before any tests run. Its responsibilities are:
    -   Loading environment variables from `.env.test`.
    -   Spawning the `vite` dev server as a detached child process.
    -   Injecting necessary environment variables (like `VITE_SUPABASE_URL`) into the Vite process.
    -   Performing a health check (`waitForVite`) to poll the Vite server until it returns a `200 OK` status, ensuring it is fully ready before tests begin. This prevents race conditions.
    -   Storing the server's process ID (PID) in a `.vite.pid` file.

-   **`tests/global-teardown.ts`**: This script runs once after all tests are complete. It reads the PID from the `.vite.pid` file and terminates the Vite server process, ensuring a clean shutdown.

### 2. Mocking Strategy

To isolate the tests from external network dependencies and ensure deterministic behavior, the suite employs a robust mocking strategy.

#### Supabase Mocking

-   **File**: `tests/e2e/sdkStubs.ts`
-   **Mechanism**: This file uses Playwright's `page.route()` method to intercept all network requests (`**/*`).
-   **Functionality**:
    -   It specifically intercepts calls to any `*.supabase.co` domain.
    -   **Dynamic User Creation**: It dynamically creates and caches mock users based on the email provided during the test's login step. This allows for flexible testing of different user types (e.g., `pro@example.com`, `free@example.com`).
    -   It provides mock responses for key Supabase endpoints, including `/auth/v1/token`, `/auth/v1/user`, and `/rest/v1/...` for profiles and sessions.
    -   It includes console logs (`[MOCKING]...`) to provide visibility into which requests are being successfully intercepted during a test run.

#### Stripe Mocking

-   **Problem**: The application's session page has a dependency on `@stripe/stripe-js` and `@stripe/react-stripe-js`. In the sandboxed test environment, the external Stripe.js script cannot be loaded, causing the React component tree to crash and preventing UI elements from rendering.
-   **Solution**: We use a **module-level mock** to replace the Stripe libraries during tests.
-   **Mechanism**:
    1.  **Mock File**: A mock implementation is located at `tests/mocks/stripe.js`. It exports fake versions of the necessary Stripe components and functions (e.g., `loadStripe`, `Elements`, `useStripe`) that satisfy the application's prop validation without making network calls.
    2.  **Vite Alias**: The `vite.config.mjs` file is configured to use a conditional alias. When `process.env.PLAYWRIGHT_TEST` is true, Vite is instructed to resolve any imports of `@stripe/stripe-js` or `@stripe/react-stripe-js` to the mock file at `tests/mocks/stripe.js`. This ensures the mock is only active during E2E tests and does not affect development or production builds.

### 3. Test Helpers

-   **File**: `tests/e2e/helpers.ts`
-   **Functionality**: This file contains reusable functions to simplify test writing, such as `loginUser`, `startSession`, and `stopSession`. It also includes a global `test.afterEach` hook that automatically captures the page's HTML content and a screenshot on test failure to aid in debugging.
