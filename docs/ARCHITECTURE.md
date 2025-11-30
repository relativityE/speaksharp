**Owner:** [unassigned]
**Last Reviewed:** 2025-11-27

🔗 [Back to Outline](./OUTLINE.md)

# SpeakSharp System Architecture

**Version 3.5** | **Last Updated: 2025-11-30**

This document provides an overview of the technical architecture of the SpeakSharp application. For product requirements and project status, please refer to the [PRD.md](./PRD.md) and the [Roadmap](./ROADMAP.md) respectively.

## 1. Project Directory Structure

SpeakSharp follows a modular, domain-driven directory structure that clearly separates concerns:

```
frontend/
  ├── src/              # Application code
  │   ├── components/   # React components (UI library, features)
  │   ├── contexts/     # React Context providers (AuthContext)
  │   ├── hooks/        # Custom React hooks (business logic)
  │   ├── lib/          # Utilities (pdfGenerator, logger, storage)
  │   ├── pages/        # Route-level page components
  │   ├── services/     # External service integrations (transcription, analytics)
  │   ├── types/        # TypeScript type definitions
  │   └── utils/        # Helper functions (fillerWordUtils, etc)
  ├── tests/            # Frontend test infrastructure
  │   ├── unit/         # Unit tests (non-co-located)
  │   ├── integration/  # Integration tests (components with providers)
  │   ├── mocks/        # Test mocks (MSW handlers)
  │   ├── support/      # Test support utilities
  │   ├── test-utils/   # Shared test helpers (queryWrapper, queryMocks)
  │   └── __mocks__/    # Module mocks (sharp, transformers, whisper)
  ├── public/           # Static assets
  └── [configs]         # vite.config.mjs, vitest.config.mjs, tsconfig.json, etc

tests/                  # Project-level tests (cross-cutting)
  ├── e2e/              # End-to-end Playwright tests
  ├── soak/             # Performance/load tests (manual, not in CI)
  └── pom/              # Page Object Models (shared by E2E)

backend/                # Backend services
  └── supabase/         # Supabase functions, migrations, seed data

scripts/                # Build, test, and CI/CD automation scripts

docs/                   # Project documentation
  ├── ARCHITECTURE.md   # This file
  ├── PRD.md            # Product requirements
  ├── ROADMAP.md        # Development roadmap
  └── CHANGELOG.md      # Change history
```

**Design Rationale:**
- **Frontend isolation**: All frontend-specific code (source + tests) lives in `frontend/`
- **Test co-location**: Unit tests can live alongside code (`src/**/*.test.ts`) or in `tests/unit/`
- **E2E separation**: Cross-cutting E2E tests remain at project root since they test the full stack
- **Clean imports**: Vitest config uses `./tests/**` (no brittle `../` paths)

## 2. System Overview

This section contains a high-level block diagram of the SpeakSharp full-stack architecture.


```ascii
+----------------------------------------------------------------------------------------------------------------------+
|                                          SpeakSharp System Architecture                                              |
+----------------------------------------------------------------------------------------------------------------------+
|                                                                                                                    |
|    +---------------------------------+       +---------------------------------+       +-------------------------+  |
|    |      Frontend (Browser)         |       |      Backend (Supabase)         |       |   3rd Party Services    |  |
|    |      (React SPA / Vite)         |       +---------------------------------+       +-------------------------+  |
|    +---------------------------------+                   ^                                     ^         ^          |
|              |      ^                                    |                                     |         |          |
|              |      | HTTPS/WSS                          | Postgres/RPC                        |         |          |
|              v      |                                    v                                     |         |          |
|    +---------------------------------+       +---------------------------------+       +-------------------------+  |
|    |    User Interface (React)       |       |      Supabase Auth              |       |      AssemblyAI         |  |
|    |---------------------------------|       |---------------------------------|       | (Streaming STT API)     |  |
|    | - `frontend/src/pages`          |<----->| - User/Session Management       |<----->| (via WebSockets)        |  |
|    | - `frontend/src/components`     |       | - RLS for Data Security         |       +-------------------------+  |
|    | - `frontend/src/contexts`       |       +---------------------------------+                 ^                |
|    |   - `AuthContext`               |                   ^                                       |                |
|    | - `frontend/src/hooks` (Logic)  |                   v                                       |                |
|    |   - `usePracticeHistory`        |       +---------------------------------+       +-------------------------+  |
|    |   - `useAnalytics`              |       |    Supabase DB (Postgres)       |       |        Stripe           |  |
|    |   - `useSessionManager`         |       |---------------------------------|       |       (Payments)        |  |
|    |   - `useSpeechRecognition`      |       | - `users`, `sessions`           |<----->| (via webhooks)          |  |
|    |     - `useTranscriptState`      |       | - `transcripts`, `usage`        |       +-------------------------+  |
|    |     - `useFillerWords`          |       | - `ground_truth` in sessions    |                 ^                |
|    |     - `useTranscriptionService` |       +---------------------------------+                 |                |
|    | - `frontend/src/lib` (Utils)    |       +---------------------------------+                 |                |
|    |   - `pdfGenerator`              |<----->| - `users`, `sessions`           |<----->| (via webhooks)          |  |
|    +---------------------------------+       | - `transcripts`, `usage`        |       +-------------------------+  |
|              |         |                      +---------------------------------+                 ^                |
|              |         |                                  ^                                       |                |
|              |         |                      +---------------------------------+       +-------------------------+  |
|              |         +--------------------->|     PDF & Image Libs          |       | Sentry (Errors)         |  |
|              |                                |---------------------------------|       | PostHog (Analytics)     |  |
|              v                                | - jspdf, jspdf-autotable        |       +-------------------------+  |
|    +---------------------------------+       | - canvas (replaces sharp)       |                 ^                |
|    | TranscriptionService            |       +---------------------------------+                 |                |
|    |---------------------------------|                   ^                                       |                |
|    | - `CloudAI / LocalWhisper` (Pro)|       |-------------------+                                       |                |
|    | - `NativeBrowser` (Free)        |                 |                                       |                |
|    +---------------------------------+       +---------------------------------+                 |                |
|              |                                | Deno Edge Functions             |-----------------+                |
|              v                                |---------------------------------|                                |
|    +---------------------------------+       | - `assemblyai-token` (secure)   |                                |
|    |      Microphone (Audio Input)   |       | - `stripe-checkout`             |                                |
|    +---------------------------------+       | - `stripe-webhook`              |                                |
|                                                +---------------------------------+                                |
|                                                                                                                    |
+----------------------------------------------------------------------------------------------------------------------+
```

## 2. Technology Stack

SpeakSharp is built on a modern, serverless technology stack designed for real-time applications.

*   **Frontend:**
    *   **Framework:** React (v18) with Vite (`^7.1.7`)
    *   **Language:** TypeScript (TSX)
    *   **Styling:** Tailwind CSS with a standard PostCSS setup (migrated from `@tailwindcss/vite` for improved `arm64` compatibility) and a CVA-based design system.
    *   **State Management:** React Context and custom hooks
*   **Backend (BaaS):**
    *   **Platform:** Supabase
    *   **Database:** Supabase Postgres
    *   **Authentication:** Supabase Auth
    *   **Serverless Functions:** Deno Edge Functions (for AssemblyAI token generation, Stripe integration, etc.)
*   **Third-Party Services:**
    *   **Cloud Transcription:** AssemblyAI (v3 Streaming API)
    *   **Payments:** Stripe
    *   **Error Reporting:** Sentry
    *   **Product Analytics:** PostHog
*   **Testing:**
    *   **Unit/Integration:** Vitest (`^2.1.9`)
    *   **DOM Environment:** happy-dom (`^18.0.1`)
    *   **End-to-End Testing Architecture (The "Three Pillars"):**
    To ensure stability and speed, our E2E tests rely on three distinct layers of abstraction:

    1.  **Network Layer (MSW):**
        *   **Role:** Intercepts all network requests (`fetch`, `XHR`) leaving the browser.
        *   **File:** `frontend/src/mocks/handlers.ts`
        *   **Responsibility:** Returns mock JSON responses for Supabase Auth and Database queries. Ensures tests run without a real backend.

    2.  **Runtime Layer (E2E Bridge):**
        *   **Role:** Injects mock implementations of *browser APIs* that don't exist or behave differently in a headless environment.
        *   **File:** `frontend/src/lib/e2e-bridge.ts`
        *   **Responsibility:**
            *   Mocks `SpeechRecognition` (browser API) to prevent crashes.
            *   Injects initial session state (`window.__E2E_MOCK_SESSION__`) for instant login.
            *   Dispatches custom events (`e2e:app-ready`) for synchronization.

    3.  **Orchestration Layer (Helpers):**
        *   **Role:** The "Consumer" that Playwright tests actually call.
        *   **File:** `tests/e2e/helpers.ts`
        *   **Responsibility:**
            *   `programmaticLogin()`: Tells the Bridge to inject a session, then waits for MSW to be ready.
            *   `mockLiveTranscript()`: Tells the Bridge to simulate speech events.
            *   `waitForE2EEvent()`: Listens for bridge events to avoid flaky `setTimeout`.

*   **Single Source of Truth (`pnpm test:all`):** A single command, `pnpm test:all`, is the user-facing entry point for all validation. It runs an underlying orchestration script (`test-audit.sh`) that executes all checks (lint, type-check, tests) in a parallelized, multi-stage process both locally and in CI, guaranteeing consistency and speed.
    *   **Image Processing (Test):** node-canvas (replaces Jimp/Sharp for stability)

## Testing and CI/CD

SpeakSharp employs a unified and resilient testing strategy designed for speed and reliability. The entire process is orchestrated by a single script, `test-audit.sh`, which ensures that the local development experience perfectly mirrors the Continuous Integration (CI) pipeline.

### The Canonical Audit Script (`test-audit.sh`)

This script is the **single source of truth** for all code validation. It is accessed via simple `pnpm` commands (e.g., `pnpm audit`) and is optimized for a 7-minute CI timeout by using aggressive parallelization.
*   **Stage-Based Execution:** The script is designed to be called with different stages (`prepare`, `test`, `report`) that map directly to the jobs in the CI pipeline. This allows for a sophisticated, multi-stage workflow.
*   **Local-First Mode:** When run without arguments (as with `pnpm test:all`), it executes a `local` stage that runs all checks sequentially, providing a comprehensive local validation experience.

### CI/CD Pipeline

The CI pipeline, defined in `.github/workflows/ci.yml`, is a multi-stage, parallelized workflow designed for fast feedback and efficient use of resources.

```ascii
+----------------------------------+
|      Push or PR to main          |
+----------------------------------+
                 |
                 v
+----------------------------------+
|           Job: prepare           |
|----------------------------------|
|  1. Checkout & Setup             |
|  2. Run `./test-audit.sh prepare`|
|     - Preflight                  |
|     - Quality Checks (Parallel)  |
|     - Build                      |
|  3. Upload Artifacts (Build)     |
+----------------------------------+
                 |
                 v
+----------------------------------+
|       Job: test (Matrix)         |
|----------------------------------|
|  Runs in N parallel jobs         |
|  (e.g., 4 shards)                |
|----------------------------------|
|  For each shard (0 to N-1):      |
|  1. Checkout & Setup             |
|  2. Download Artifacts           |
|  3. Run `./test-audit.sh test N` |
|     (Runs one E2E shard)         |
+----------------------------------+
                 |
                 v
+----------------------------------+
|           Job: report            |
|----------------------------------|
|  Runs only if all test jobs pass |
|----------------------------------|
|  1. Download All Artifacts       |
|  2. Run `./test-audit.sh report`  |
|     (Generates SQM report)       |
|  3. Commit docs/PRD.md           |
+----------------------------------+
```

### Test Runner vs CI: Key Differences

Both the local test runner and CI use the same `test-audit.sh` script, ensuring perfect alignment between local and remote environments. However, they differ in execution strategy:

| Aspect              | Local Test Runner (`pnpm test:all`)                                            | CI (GitHub Actions)                                                 |
|---------------------|---------------------------------------------------------------------------------|---------------------------------------------------------------------|
| **Execution**       | `./test-audit.sh local` - single process                                       | Split into stages: `prepare`, `test` (sharded), `report`           |
| **E2E Tests**       | Runs all 13 tests serially                                                     | **Sharded across 4 workers** using Playwright native `--shard` flag |
| **Parallelization** | Quality checks (lint/typecheck/test) run in parallel via `concurrently`        | Each CI job runs independently in isolated environments             |
| **Purpose**         | Pre-commit verification and local validation                                   | Gatekeeper for merging to main branch                               |
| **Speed**           | ~2-3 minutes (serial E2E execution)                                            | ~1-2 minutes (parallel sharding reduces E2E time)                   |
| **Error Handling**  | Exits immediately on first failure with `exit 1`                               | Individual job failures prevent downstream jobs from running        |

**Key Architectural Benefit:** The shared `test-audit.sh` script eliminates "works on my machine" issues by guaranteeing that the exact same validation logic runs both locally and in CI.

### Application Environments (Production, Development, and Test)

Understanding the environment separation is crucial for both development and testing. Based on my analysis of the project's configuration and documentation, here is a breakdown of the three key environments and how the dev server relates to them.

The Three Core Environments
Think of the environments as three different contexts in which the application runs, each with its own purpose, configuration, and data.

1. Production Environment (production)
Purpose: This is the live, public-facing version of your application that real users interact with. It's optimized for performance, stability, and security.
Key Characteristics:
Optimized Code: The code is minified, bundled, and tree-shaken to be as small and fast as possible.
Real Data: It connects to the production Supabase database and live third-party services like Stripe and AssemblyAI using production API keys.
Security: Debugging features are disabled, and security is paramount.
How it's Launched: The production environment isn't "launched" with a dev server. Instead, a static build of the frontend is created using pnpm build. This build is then deployed to and served by a hosting provider (like Vercel or Netlify). The backend is the live Supabase instance.
2. Local Development Environment (development)
Purpose: This is your primary day-to-day workspace for building and debugging new features on your own machine.
Key Characteristics:
Hot Module Replacement (HMR): Code changes appear instantly in the browser without a full page reload, maximizing developer productivity.
Developer-Friendly Tooling: Includes source maps for easier debugging and verbose error messages in the console.
Flexible Data: It typically connects to a development or local Supabase instance, but can be configured (via .env.local files) to connect to production if needed (though this is generally discouraged). Developer-specific flags like VITE_DEV_USER can be enabled here.
How it's Launched: This environment is launched using the pnpm dev command. This command runs vite, which starts the Vite development server. By default, Vite runs in development mode, which enables all the features mentioned above.
3. Test Environment (test)
Purpose: This is a specialized, automated environment designed exclusively for running tests (especially End-to-End tests with Playwright). Its goal is to create a consistent, isolated, and controllable simulation of the application.
Key Characteristics:
Mocked Backend: It does not connect to a real Supabase database. Instead, it uses Mock Service Worker (MSW) to intercept all API calls and provide predictable, fake data. This ensures tests are fast and reliable.
Compile-Time Modifications: This is the most critical distinction. When the server is launched in test mode, a special build-time flag, import.meta.env.VITE_TEST_MODE, is set to true. The application's source code uses this flag to conditionally exclude certain heavy WASM-based libraries (used for on-device transcription) that are known to crash the Playwright test runner.
Headless Operation: This environment is designed to be run by an automated tool (Playwright), not a human.
How it's Launched: The test environment's dev server is not launched by you directly with pnpm dev. Instead, it is launched automatically by the test runner (Playwright) when you run a command like pnpm test:e2e. The Playwright configuration file (playwright.config.ts) is configured to start the Vite server using a specific command: vite --mode test. This --mode test flag is what tells Vite to apply the special test configuration.

### E2E Testing Infrastructure

**Mock Service Worker (MSW)** intercepts all network requests to Supabase, providing deterministic test data. **E2E Bridge** (`frontend/src/lib/e2e-bridge.ts`) extends MSW with additional E2E-specific mocking and event-driven synchronization:

- **Mock SpeechRecognition API**: Polyfills browser `SpeechRecognition` and `webkitSpeechRecognition` with `MockSpeechRecognition` class
- **dispatchMockTranscript()**: Helper function callable from Playwright tests via `page.evaluate()` to simulate transcription events
- **Event-Driven Synchronization (2025-11-27)**: Custom DOM events replace fragile polling/timeouts for robust test coordination:
  - `dispatchE2EEvent(eventName, detail)`: Helper to dispatch custom events from app to tests
  - `e2e:msw-ready`: Signals MSW initialization complete
  - `e2e:app-ready`: Signals React app fully mounted
  - `e2e:speech-recognition-ready`: Signals MockSpeechRecognition instance active
  - `waitForE2EEvent(page, eventName)`: Test helper to await specific events
- **Initialization**: Automatically loaded when `IS_TEST_ENVIRONMENT` is true in `main.tsx`

**Status**: Event infrastructure complete. Live transcript test requires SessionPage E2E debugging (documented in ROADMAP.md).

Summary: How the Dev Server Relates to Environments
Environment	How Dev Server is Started	Vite Mode	Key Feature
Production	Not applicable (uses a static build from pnpm build)	production	Optimized for users
Local	Manually, with pnpm dev	development	Optimized for developers (HMR)
Test	Automatically, by Playwright during tests	test	Optimized for automation (Mocking, Code Exclusion)
In short, the command you use to launch the dev server (pnpm dev vs. the test runner's internal command) is what determines which environment-specific configuration is applied, resulting in three very different application behaviors tailored to the task at hand.


You should NOT have to pass .env.test on the command line.

The system is designed to handle this automatically, and forcing it with a command like dotenv -e .env.test is a symptom that the underlying configuration is wrong (which it was, and which we have now fixed).

Here is the correct, intended workflow based on the project's architecture with Vite:

For Local Development (your workflow):

You run pnpm dev.
This starts vite in its default development mode.
Vite automatically looks for and loads environment variables from .env.development.local, .env.development, and falls back to .env.local. Your use of .env.local is perfectly standard here.
For the Test Environment (the automated workflow):

The E2E tests are run (e.g., via ./test-audit.sh).
The test runner, Playwright, is configured in playwright.config.ts to launch the web server.
Crucially, that configuration tells Playwright to use the command vite --mode test.
This --mode test flag is the key. It instructs Vite to automatically look for and load environment variables ONLY from .env.test (and .env.test.local).
So, the framework itself ensures the correct .env file is used based on the mode it's running in. The fix I implemented to the package.json was essential to restore this intended behavior, ensuring pnpm dev uses development mode and leaves the test mode to be used exclusively by the testing framework.


### Smoke Test: Comprehensive Health Check

Our E2E testing strategy includes a **smoke test** (`tests/e2e/smoke.e2e.spec.ts`) that serves as the canonical health check for the application. This test verifies all critical user journeys in a single, comprehensive pass:

**Smoke Test Coverage:**
1. **Boot Check:** Verifies the app boots and renders DOM
2. **Unauthenticated Homepage:** Confirms public landing page loads correctly (Sign In button visible)
3. **Authentication:** Tests programmatic login flow using MSW network mocking
4. **Session Page (Authenticated):** Verifies practice session UI loads and start/stop button is functional
5. **Analytics Page (Authenticated):** Confirms analytics dashboard renders with data visualization
6. **Logout:** Tests sign-out flow and return to unauthenticated state

**Purpose:** This smoke test is run as part of `pnpm test:health-check` and provides a fast, reliable signal that core features (homepage, auth, session, analytics) are working after every commit.

**Visual Documentation:** A separate test (`tests/e2e/capture-states.e2e.spec.ts`) handles screenshot generation for visual documentation. This decoupled architecture ensures that purely visual changes (e.g., CSS refactors) do not break the critical functional health check.


### Unit & Integration Testing for React Query

Testing components that use React Query requires a specific setup to ensure tests are isolated and deterministic. Our project uses a combination of two key utilities to achieve this.

*   **`createQueryWrapper` (`tests/test-utils/queryWrapper.tsx`):** This is a higher-order function that provides a fresh, isolated `QueryClient` for each test. This is the most critical piece of the puzzle, as it prevents the React Query cache from bleeding between tests, which would otherwise lead to unpredictable and flaky results. It is used to wrap the component under test in React Testing Library's `render` function.

*   **`makeQuerySuccess` (`tests/test-utils/queryMocks.ts`):** This is a factory function that creates a standardized, successful mock result object for a React Query hook. When testing a component that uses a custom hook like `usePracticeHistory`, this utility makes it easy to create a properly typed success object (`status: 'success'`, `isLoading: false`, etc.) to provide as the mock return value.

Together, these utilities form the canonical pattern for testing any component that relies on React Query, ensuring that our unit and integration tests are fast, reliable, and easy to maintain.

### E2E Test Environment & Core Patterns

The E2E test environment is designed for stability and isolation. Several key architectural patterns have been implemented to address sources of test flakiness and instability.

1.  **Build-Time Conditional for Incompatible Libraries:**
    *   **Problem:** Certain heavy WASM-based speech recognition libraries (used for on-device transcription) are fundamentally incompatible with the Playwright/Node.js test environment and cause untraceable browser crashes.
    *   **Architecture:** The build process now uses a dedicated Vite build mode (`--mode test`). This sets a build-time variable, `import.meta.env.VITE_TEST_MODE`. The application's source code uses this variable to create a compile-time conditional (`if (import.meta.env.VITE_TEST_MODE)`) that completely removes the problematic `import()` statements from the test build. This is a robust solution that prevents the incompatible code from ever being loaded.

2.  **Explicit E2E Hooks for Authentication:**
    *   **Problem:** Programmatically injecting a session into the Supabase client from a test script does not automatically trigger the necessary state updates within the application's React `AuthProvider` context.
    *   **Architecture:** A custom event system was created to bridge this gap. The `programmaticLogin` test helper dispatches a custom browser event (`__E2E_SESSION_INJECTED__`) after setting the session. The `AuthProvider` now contains a `useEffect` hook that listens for this specific event and manually updates its internal state, forcing a UI re-render. This ensures the application reliably reflects the authenticated state during tests.

2.  **Network-Level API Mocking (MSW):**
    *   **Problem:** E2E tests need to mock Supabase API requests without coupling to implementation details of the client library.
    *   **Architecture:** The test suite uses Mock Service Worker (MSW) for network-level interception. MSW is initialized in `frontend/src/lib/e2e-bridge.ts` when `IS_TEST_ENVIRONMENT` is true. Mock handlers are defined in `frontend/src/mocks/handlers.ts` and cover all Supabase endpoints:
        - `/auth/v1/user` - User authentication state
        - `/auth/v1/token` - Token refresh
        - `/rest/v1/user_profiles` - User profile data
        - `/rest/v1/sessions` - Practice session history
    *   **Benefits:** Network-level mocking is more robust than client-level mocking, as it works regardless of how the Supabase client is implemented internally. It also allows tests to verify the correct API requests are being made.
    *   **Migration Note:** This replaced the legacy `window.supabase` mock injection pattern (commit `bb26de7`, November 2025).


7.  **Deterministic Test Handshake for Authentication:**
    *   **Problem:** The core of the E2E test suite's instability was a race condition between the test runner injecting an authentication session and the React application's `AuthProvider` recognizing and rendering the UI for that state.
    *   **Architecture:** A deterministic, event-driven handshake was implemented to eliminate this race condition. This is the canonical pattern for ensuring the application is fully authenticated and rendered before any test assertions are made.

    ```ascii
    +---------------------------------+
    |        Playwright Test          |
    |  (e.g., health-check.spec.ts)   |
    +--------------- | ---------------+
                    |
    (1) Calls programmaticLogin(page)
                    |
    +--------------- V ---------------+
    |   programmaticLogin() Helper    |
    |     (tests/e2e/helpers.ts)      |
    +--------------- | ---------------+
                    |
    (2) Injects mock Supabase client via addInitScript()
    (3) Navigates to application URL ('/')
    (4) Injects mock session via page.evaluate()
                    |
    +--------------- V ---------------+
    |      React AuthProvider         |
    |   (src/contexts/AuthProvider)   |
    +--------------- | ---------------+
                    |
    (5) Receives 'SIGNED_IN' event from mock client.
    (6) Fetches user profile from mock client.
    (7) After profile is set, dispatches custom
        DOM event: 'e2e-profile-loaded'
                    |
    +--------------- V ---------------+
    |   programmaticLogin() Helper    |
    |      (Still in control)         |
    +--------------- | ---------------+
                    |
    (8) Is waiting for the 'e2e-profile-loaded' event.
    (9) After event, waits for a stable UI element
        (e.g., [data-testid="nav-sign-out-button"])
        to become visible.
                    |
    (10) Returns control to the test.
                    |
    +--------------- V ---------------+
    |        Playwright Test          |
    |         (Resumes)               |
    +---------------------------------+
    ```
    *   **Key Insight:** This architecture is deterministic and eliminates race conditions. The test does not proceed until it receives a definitive signal (`e2e-profile-loaded`) directly from the application, confirming that the `AuthProvider` has fully initialized, the user profile has been fetched, and the UI is ready. This creates a stable and reliable foundation for all authenticated E2E tests.

1.  **Sequential MSW Initialization:**
    *   **Problem:** E2E tests would fail with race conditions because the React application could mount and trigger network requests *before* the Mock Service Worker (MSW) was ready to intercept them.
    *   **Solution:** The application's bootstrap logic in `src/main.tsx` has been made sequential for the test environment. It now strictly `await`s the asynchronous `msw.worker.start()` promise to complete **before** it calls `renderApp()`. This guarantees that the entire mock API layer is active before any React component mounts, eliminating the race condition. A `window.mswReady = true` flag is set after MSW is ready to signal this state to tests.

2.  **Programmatic Login for Authentication (E2E):**
    *   **Problem:** E2E tests require a fast, stable way to authenticate. The login process was flaky due to a race condition between the `AuthProvider`'s asynchronous state updates and the test's assertions against the DOM.
    *   **Solution:** The `programmaticLogin` helper has been hardened. After injecting the mock session, it no longer waits for an unreliable internal flag (`window.__E2E_PROFILE_LOADED__`). Instead, it directly waits for the user-visible result of a successful login: the appearance of the "Sign Out" button in the navigation bar. This ensures the test only proceeds after React's render cycle is fully complete and the DOM is in a consistent, authenticated state.

### Soak Testing

Soak tests validate application behavior under sustained, concurrent load to identify resource contention, memory leaks, and API quota issues before production deployment.

#### Architecture

The soak test infrastructure consists of three main components:

1. **`MetricsCollector`** (`tests/soak/metrics-collector.ts`)
   - Tracks response times, memory usage, success/error counts
   - Calculates statistical metrics (min, max, avg, median, p95, p99)
   - Generates JSON reports and human-readable summaries

2. **`UserSimulator`** (`tests/soak/user-simulator.ts`)
   - Simulates realistic user journeys: login → session → analytics
   - Configurable session duration and transcription mode
   - Optimized for free tier constraints (Native Browser mode by default)

3. **`soak-test.spec.ts`** (`tests/soak/soak-test.spec.ts`)
   - Orchestrates concurrent user scenarios
   - Runs 2 users for 5 minutes each (configurable)
   - Saves metrics to `test-results/soak/`

#### Configuration

Soak tests have a dedicated Playwright project configuration in `playwright.config.ts`:

```typescript
{
  name: 'soak',
  testDir: './tests/soak',
  timeout: 10 * 60 * 1000, // 10 minutes
  retries: 0, // No retries for soak tests
  use: {
    launchOptions: {
      args: ['--enable-precise-memory-info'], // For Chrome memory tracking
    },
  },
}
```

Run soak tests with:
```bash
pnpm test:soak
```

#### Authentication Strategy

**Real User Authentication**
Soak tests use real user credentials to authenticate against the running development server. This ensures the entire authentication flow (including Supabase interactions) is validated under load.

- **Test Users:** Pre-created users in the Supabase project (e.g., `test@test.com`, `soak-test-0@example.com`).
- **Credentials:** Stored securely in the test configuration or environment variables.
- **Permissions:** Headless browser is configured with microphone permissions and fake media streams to bypass hardware prompts.

3.  **Third-Party Service Stubbing:**
    *   To prevent external services like Sentry and PostHog from causing noise or failures in E2E tests, the `stubThirdParties(page)` helper is used. It intercepts and aborts any requests to these services' domains, ensuring tests are isolated and deterministic.

4.  **Standardized Page Object Model (POM):**
    *   **Problem:** The E2E test suite had an inconsistent and duplicated structure for Page Object Models, leading to confusion and maintenance overhead.
    *   **Solution:** The POMs have been centralized into a single, canonical location: `tests/pom/`.
    *   **Barrel Exports:** A barrel file (`tests/pom/index.ts`) is used to export all POMs from this central location. This provides a single, clean import path for all test files (e.g., `import { SessionPage } from '../pom';`), which improves maintainability and prevents module resolution issues in the test runner.

5.  **Source-Code-Level Guard for Incompatible Libraries:**
    *   **Problem:** The on-device transcription feature uses heavy WASM-based speech recognition libraries which rely on WebAssembly. These libraries are fundamentally incompatible with the Playwright test environment and cause a silent, catastrophic browser crash that is untraceable with standard debugging tools.
    *   **Solution:** A test-aware guard has been implemented directly in the application's source code.
        *   **Flag Injection:** The `programmaticLogin` helper in `tests/e2e/helpers.ts` uses `page.addInitScript()` to inject a global `window.TEST_MODE = true;` flag before any application code runs.
        *   **Conditional Import:** The `TranscriptionService.ts` checks for the presence of `window.TEST_MODE`. If the flag is true, it completely skips the dynamic import of the `LocalWhisper` module that would have loaded the crashing library. Instead, it gracefully falls back to the safe, native browser transcription engine.
    *   **Benefit:** This source-code-level solution is more robust than network-level blocking (`page.route`), which can be unreliable with modern bundlers. It directly prevents the incompatible code from ever being loaded in the test environment.

6.  **Stateful Mocking with `localStorage`:**
    *   **Problem:** The Playwright `addInitScript` function re-runs on every page navigation (`page.goto()`). If a mock client stores its state (e.g., the current user session) in a simple variable, that state is wiped on every navigation, causing tests to fail.
    *   **Architecture:** The mock Supabase client has been architected to be stateful by using `localStorage`. On initialization, it reads the session from `localStorage`. When the test performs a programmatic login, the mock writes the session to `localStorage`. This accurately simulates the behavior of the real Supabase client, ensuring that the authenticated state persists reliably across page navigations within a test.

These patterns work together to create a robust testing foundation, eliminating the primary sources of flakiness and making the E2E suite a reliable indicator of application quality.

### Visual State Capture for Documentation

To aid in documentation and provide a quick visual reference of the application's key states, a dedicated E2E test file is used for capturing screenshots.

-   **File:** `tests/e2e/capture-states.e2e.spec.ts`
-   **Purpose:** This test is not for functional verification but for generating consistent, high-quality screenshots of the application's primary UI states (e.g., unauthenticated homepage, authenticated homepage, analytics page).
-   **Output:** The screenshots are saved to the `/screenshots` directory in the project root, which is explicitly ignored by `.gitignore`.
-   **Usage:** To regenerate the screenshots, run the test directly:
    ```bash
    pnpm exec playwright test tests/e2e/capture-states.e2e.spec.ts
    ```
This provides a simple, repeatable process for updating visual documentation as the application evolves.

### Known Architectural Limitations

- **`audio-processor.worklet.js` Migration:** This file is intentionally left as JavaScript and excluded from the TypeScript migration. It is a Web Audio Worklet, a specialized script that runs in a high-performance audio thread. Migrating it to TypeScript is a high-risk task that requires a custom build process and deep expertise in the Web Audio API. A failed migration would not cause a crash but could silently corrupt audio data, dramatically reducing AI transcription accuracy. The risk of silently breaking the application's core feature outweighs the benefit of type safety for this isolated file.

### E2E Test Architecture: Fixtures and Programmatic Login

To ensure E2E tests are fast, reliable, and deterministic, the test suite uses a sophisticated fixture-based architecture for handling authentication and mock data.

*   **Separation of Concerns:** The test helpers follow a strict separation of concerns:
    *   `tests/e2e/fixtures/mockData.ts`: This file is the single source of truth for all mock data (users, profiles, sessions, etc.). It exports typed constants, making data management clean and maintainable.
    *   `tests/e2e/helpers.ts`: This file contains the logic for test setup, primarily the `programmaticLogin` function. It is responsible for injecting mocks and data into the browser context.

*   **`programmaticLogin` Workflow:** This is the canonical function for authenticating a user in an E2E test. It executes the following sequence:
    1.  **Wait for MSW Ready:** Before proceeding, the helper waits for the `window.mswReady` flag to ensure Mock Service Worker is active and ready to intercept API requests.
    2.  **Inject Mock Session:** Uses `page.evaluate()` to inject a mock session object into `localStorage` under the Supabase auth key. This session contains a structurally valid (but cryptographically fake) JWT token.
    3.  **Navigate to Application:** Navigates to the target page (e.g., `/analytics`).
    4.  **Wait for Authentication:** Waits for a stable, user-visible indicator that the application has processed the session and rendered the authenticated state (e.g., the "Sign Out" button).
    5.  **MSW Intercepts Requests:** As the application's `AuthProvider` initializes and queries the Supabase API for user profile data, MSW intercepts these requests and returns mock data defined in `frontend/src/mocks/handlers.ts`.

6.  **Stateful Mocking with MSW and `localStorage`:**
    *   **Problem:** Tests need to mock backend state (user profiles, sessions) in a way that persists across page navigations and React re-renders.
    *   **Architecture:** The combination of MSW and `localStorage` provides stateful mocking:
        - **MSW Handlers:** Return consistent mock data for API requests (e.g., user profile, session history).
        - **localStorage:** Stores the Supabase auth session, which persists across `page.goto()` calls, accurately simulating real browser behavior.
    *   **Benefit:** This architecture eliminates race conditions and ensures tests are deterministic, as the mock state is established before the application boots and remains stable throughout the test.
2.  **Vitest Alias:** In `vitest.config.mjs`, we create aliases that redirect imports of `sharp` and `@xenova/transformers` to mock files.
3.  **Canvas-based Mock:** To improve stability, the mock for `sharp` (`tests/support/mocks/sharp.ts`) now uses the `canvas` library, a pure JavaScript image processing tool with better stability in headless environments. The mock for `@xenova/transformers` provides a simplified, lightweight implementation for unit tests.
4.  **Dependency Inlining:** Because the `@xenova/transformers` import happens within a dependency, we must configure Vitest to process this dependency by adding it to `test.deps.inline`. This ensures the alias is applied correctly.

This approach allows us to use the high-performance native library in production while maintaining a stable and easy-to-manage test environment.

## 3. Frontend Architecture

The frontend is a single-page application (SPA) built with React and Vite.

*   **Component Model:** The UI is built from a combination of page-level components (`frontend/src/pages`), feature-specific components (`frontend/src/components/session`, `frontend/src/components/landing`), and a reusable UI library (`frontend/src/components/ui`).
*   **Design System:** The UI components in `frontend/src/components/ui` are built using `class-variance-authority` (CVA) for a flexible, type-safe, and maintainable design system. Design tokens are managed in `frontend/tailwind.config.ts`.
    *   **Tokens:**
        *   **Colors:** Semantic HSL scale (`primary`, `secondary`, `accent`, `destructive`, `muted`, `card`).
        *   **Gradients:** `bg-gradient-primary`, `bg-gradient-hero`, etc.
        *   **Shadows:** `shadow-elegant` (floating), `shadow-card` (standard), `shadow-focus` (ring).
    *   **Patterns:** Complex components use `cva` to define variants (e.g., `buttonVariants` with `default`, `outline`, `ghost` styles).
    *   **Best Practices:** Avoid hardcoded values; use tokens. Ensure accessibility (contrast/focus) via base styles.
*   **State Management:** See Section 3.1 below.
*   **Routing:** Client-side routing is handled by `react-router-dom`, with protected routes implemented to secure sensitive user pages.
*   **Logging:** The application uses `pino` for structured logging.
*   **PDF Generation:** Session reports can be exported as PDF documents using the `jspdf` and `jspdf-autotable` libraries. The `pdfGenerator.ts` utility encapsulates the logic for creating these reports.
*   **Analytics Components:** The frontend includes several components for displaying analytics, such as `FillerWordTable`, `FillerWordTrend`, `SessionComparison`, `TopFillerWords`, and `AccuracyComparison`.
*   **AI-Powered Suggestions:** The `AISuggestions` component provides users with feedback on their speech.
*   **Image Processing:** The application uses `canvas` in the test environment for image processing tasks (replacing `Jimp` for stability), such as resizing user-uploaded images. The `processImage.ts` utility provides a convenient wrapper for this functionality.

### 3.1. State Management and Data Fetching

The application employs a hybrid state management strategy that clearly separates **global UI state** from **server state**.

*   **Global State (`AuthContext`):** The `AuthContext` is the single source of truth for global, cross-cutting concerns, primarily user identity and session state. It provides the Supabase `session` object and the `user` object to all components that need it. This is the only global context in the application. Profile data is explicitly decoupled and fetched via the `useUserProfile` hook.

*   **Server State & Data Fetching (`@tanstack/react-query`):** All application data that is fetched from the backend (e.g., a user's practice history) is managed by `@tanstack/react-query` (React Query). This library handles all the complexities of data fetching, caching, re-fetching, and error handling.
    *   **Decoupled Architecture:** This approach decouples data fetching from global state. Previously, the application used a second global context (`SessionContext`) to hold practice history, which was a brittle anti-pattern. The new architecture eliminates this, ensuring that components fetch the data they need, when they need it.
    *   **Custom Hooks:** The data-fetching logic is encapsulated in custom hooks:
        - **`usePracticeHistory`:** The canonical data-fetching hook. Fetches the user's complete session history from Supabase and is conditionally enabled (only runs when authenticated).
        - **`useAnalytics` (Refactored 2025-11-26):** Consumes `usePracticeHistory` as its data source and centrally calculates all derived analytics statistics. This eliminates prop drilling and provides a single source of truth for analytics data. Key features:
            - Automatically filters sessions based on URL params (for single-session views)
            - Centralizes statistics calculation using `analyticsUtils.ts`
            - Returns `sessionHistory`, `overallStats`, `fillerWordTrends`, `topFillerWords`, `accuracyData`, `loading`, and `error`
            - Components like `AnalyticsDashboard`, `TopFillerWords`, and `AccuracyComparison` consume this hook directly (commit `17be58c`)
    *   **Cache Invalidation:** When a user completes a new practice session, the application uses React Query's `queryClient.invalidateQueries` function to intelligently mark the `sessionHistory` data as stale. This automatically triggers a re-fetch, ensuring the UI is always up-to-date without manual state management.

This decoupled architecture is highly scalable and maintainable, as new data requirements can be met by creating new, isolated custom hooks without polluting the global state.

### 3.2. Key Components

- **`SessionSidebar.tsx`**: This component serves as the main control panel for a user's practice session. It contains the start/stop controls, a digital timer, and the transcription mode selector.
  - **Mode Selector**: A segmented button group allows users to choose their desired transcription mode before starting a session. The options are:
    - **Cloud AI**: Utilizes the high-accuracy AssemblyAI cloud service.
    - **On-Device**: Uses a local Whisper model for privacy-focused transcription.
    - **Native**: Falls back to the browser's built-in speech recognition engine.
  - **Access Control**: Access to the "Cloud AI" and "On-Device" modes is restricted. These modes are enabled for users with a "pro" subscription status or for developers when the `VITE_DEV_USER` environment variable is set to `true`. Free users are restricted to the "Native" mode.

### Homepage Routing Logic
The application's homepage (`/`) has special routing logic to handle different user states. This logic is located directly within the `HomePage.tsx` component.
- **Production (`import.meta.env.DEV` is false):** Authenticated users who navigate to the homepage are automatically redirected to the main application interface (`/session`). This ensures they land on a functional page after logging in.
- **Development (`import.meta.env.DEV` is true):** The redirect is disabled. This allows developers to access and work on the public-facing homepage components even while being authenticated.

### Memory Leak Prevention
Given the real-time nature of the application, proactive memory management is critical. Components involving continuous data streams (e.g., `useSpeechRecognition`, `TranscriptionService`) must be carefully audited for memory leaks. This includes ensuring all `useEffect` hooks have proper cleanup functions.

## 4. Backend Architecture

The backend is built entirely on the Supabase platform, leveraging its integrated services.

*   **Database:** A PostgreSQL database managed by Supabase. Schema is managed via migration files in `supabase/migrations`.
*   **Authentication:** Supabase Auth is used for user registration, login, and session management.
*   **Serverless Functions:** Deno-based Edge Functions are used for secure, server-side logic.
    *   `assemblyai-token`: Securely generates temporary tokens for the AssemblyAI transcription service.
    *   `stripe-checkout`: Handles the creation of Stripe checkout sessions.
    *   `stripe-webhook`: Listens for and processes webhooks from Stripe to update user subscription status.

## 5. Feature Architecture

### 5.1 Custom Vocabulary
*   **Purpose:** Allows Pro users to add domain-specific terms to improve transcription accuracy.
*   **Data Model:** `custom_vocabulary` table in Supabase (linked to `users`).
*   **Logic:** `useCustomVocabulary` hook manages CRUD operations via React Query.
*   **Integration:** The `TranscriptionService` fetches the vocabulary and passes it to the AssemblyAI API via the `boost_param` and `word_boost` parameters during session initialization.

### 5.2 Vocal Variety & Pause Detection
*   **Purpose:** Analyzes speaking dynamics to provide feedback on pacing and pauses.
*   **Logic:**
    *   `PauseDetector` class: Analyzes audio frames for silence gaps > 500ms (configurable).
    *   `useVocalAnalysis` hook: Integrates the detector with the real-time audio stream.
*   **Configuration:** Thresholds are centralized in `frontend/src/config.ts`.
*   **Centralized Configuration:** Key application constants (session limits, audio settings, vocabulary limits) are consolidated in `frontend/src/config.ts` to ensure consistency and maintainability across the codebase.

## 6. User Roles and Tiers

The application's user tiers have been consolidated into the following structure:

*   **Free User (Authenticated):** A user who has created an account but does not have an active Pro subscription. This is the entry-level tier for all users.
*   **Pro User (Authenticated):** A user with an active, paid subscription via Stripe. This tier includes all features, such as unlimited practice time, cloud-based AI transcription, and privacy-preserving on-device transcription.

## 6. Transcription Service (`frontend/src/services/transcription`)

The `TranscriptionService.ts` provides a unified abstraction layer over multiple transcription providers.

*   **Modes:**
    *   **`CloudAssemblyAI`:** Uses the AssemblyAI v3 streaming API for high-accuracy cloud-based transcription. This is one of the modes available to Pro users.
    *   **`NativeBrowser`:** Uses the browser's built-in `SpeechRecognition` API. This is the primary mode for Free users and a fallback for Pro users.
    *   **`LocalWhisper`:** An on-device, privacy-first transcription mode for Pro users, powered by `@xenova/transformers` running a Whisper model directly in the browser.
*   **Audio Processing:** `audioUtils.ts`, `audioUtils.impl.ts`, and `audio-processor.worklet.js` are responsible for capturing and resampling microphone input. A critical bug in the resampling logic that was degrading AI quality has been fixed.

### On-Device STT Implementation Details
 
 The `LocalWhisper` provider uses the [`whisper-turbo`](https://github.com/xenova/whisper-turbo) library to run the `whisper-tiny.en` model directly in the user's browser using WebAssembly.
 
 *   **How it Works:**
     1.  **Dynamic Loading:** The `LocalWhisper` module is dynamically imported via `import()` only when the user explicitly selects "On-Device" mode. This prevents the heavy WebAssembly (WASM) dependencies from loading during the initial application render, significantly improving startup performance.
     2.  **Model Loading:** The application downloads the quantized `whisper-tiny` model (~40MB). Progress is reported to the UI via a toast notification. On an average broadband connection, this takes 5-10 seconds.
     3.  **Caching:** Once downloaded, the model files are automatically cached in the browser's `CacheStorage` (specifically in the `transformers-cache` namespace). Subsequent loads are nearly instant as they are served directly from this local cache.
     4.  **True Streaming Architecture (Refactored 2025-11-26):** LocalWhisper now uses continuous 1-second audio buffering instead of the legacy 5-second batch processing. This provides near-real-time transcript updates:
         - Audio is continuously recorded into a circular buffer
         - Every 1 second, the buffer is processed by Whisper
         - A concurrency lock (`isProcessing`) ensures only one inference runs at a time
         - Interim results are displayed immediately, creating a responsive "live" experience
         - This architecture matches the responsiveness of cloud-based streaming (commit `76fae94`)
     5.  **Inference Engine:** The library runs the model on a WebAssembly (WASM) version of the ONNX Runtime, utilizing WebGPU if available for hardware acceleration, or falling back to WASM/CPU.
     6.  **Privacy:** All audio processing and transcription occurs entirely on the user's machine. No audio data is ever sent to a third-party server.
 
 *   **Comparison to Cloud AI:**
     *   **Privacy:** On-device is 100% private. Cloud AI requires sending audio data to AssemblyAI's servers.
     *   **Accuracy:** Cloud AI is significantly more accurate as it uses a much larger model (`whisper-large-v3` equivalent). The on-device `whisper-tiny` model is less accurate but still highly effective for its size.
     *   **Performance:** On-device has a one-time initial download cost. After caching, it is very fast. Cloud AI has a constant network latency for streaming audio and receiving transcripts.
     *   **Cost:** On-device has no per-use cost. Cloud AI has a direct cost per minute of transcribed audio.
     *   **Availability:** On-device mode is highly available and works offline after the initial model download.

### Speaker Identification

Speaker identification (or diarization) is handled by the AssemblyAI API. When the `speaker_labels` parameter is set to `true` in the transcription request, the API will return a `speaker` property for each utterance in the transcript. This allows the frontend to display who said what.

### STT Accuracy Comparison
The STT accuracy comparison feature calculates the Word Error Rate (WER) of each transcription engine against a "ground truth" transcript. The ground truth is a manually transcribed version of the audio that is stored in the `practice_sessions` table. The WER is then used to calculate an accuracy percentage, which is displayed in the analytics dashboard. This provides users with a clear understanding of how each STT engine performs.

## 7. Configuration Management

### Port Configuration
All build and preview ports are centralized in `scripts/build.config.js`:
- **DEV Port:** 5173 (Vite dev server)
- **PREVIEW Port:** 4173 (Production preview server)

This configuration is consumed by:
- `frontend/vite.config.mjs` - Server and preview port settings
- `scripts/test-audit.sh` - Dynamic port reading for Lighthouse CI
- `scripts/generate-lhci-config.js` - Lighthouse configuration generation

**Benefits:**
- Single source of truth for port numbers
- No hardcoded "magic numbers" in codebase
- Easy to change ports across entire project

### Lighthouse CI Integration
Performance quality gates are enforced via Lighthouse CI:

**Configuration Generation** (`scripts/generate-lhci-config.js`):
- Dynamically creates `lighthouserc.json` with current port configuration
- Sets performance thresholds: Performance ≥0.90, Accessibility ≥0.90, SEO ≥0.90
- Best Practices set to ≥0.75 (warn level) due to unavoidable Stripe cookies

**Score Parsing** (`scripts/process-lighthouse-report.js`):
- Replaces brittle `jq` with robust Node.js JSON parsing
- Finds latest Lighthouse report in `.lighthouseci/` directory
- Displays formatted score table

**CI Workflow:**
1. Build production bundle (`pnpm build:test`)
2. Generate Lighthouse config with current ports
3. Start preview server on configured port
4. Run `lhci autorun` with generated config
5. Parse and display scores
6. Fail CI if thresholds not met (fail-fast enabled)

**Current Scores (2025-11-28):**
- Performance: 95%
- Accessibility: 95%
- **SEO: 100%**
- Best Practices: 78% (limited by Stripe third-party cookies)

