**Owner:** [unassigned]
**Last Reviewed:** 2025-09-08

🔗 [Back to Outline](./OUTLINE.md)

# SpeakSharp System Architecture

**Version 3.2** | **Last Updated: 2025-09-26**

This document provides an overview of the technical architecture of the SpeakSharp application. For product requirements and project status, please refer to the [PRD.md](./PRD.md) and the [Roadmap](./ROADMAP.md) respectively.

## 1. System Overview

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
|    | - `src/pages` (Routing)         |<----->| - User/Session Management       |<----->| (via WebSockets)        |  |
|    | - `src/components` (UI)         |       | - RLS for Data Security         |       +-------------------------+  |
|    | - `src/contexts` (State Mgmt)   |       +---------------------------------+                 ^                |
|    |   - `AuthContext`               |                   ^                                       |                |
|    |   - `SessionContext`            |                   |                                       |                |
|    | - `src/hooks` (Logic)           |                   v                                       |                |
|    |   - `useSessionManager`         |       +---------------------------------+       +-------------------------+  |
|    |   - `useSpeechRecognition`      |       |    Supabase DB (Postgres)       |       |        Stripe           |  |
|    |     - `useTranscriptState`      |       |---------------------------------|       |       (Payments)        |  |
|    |     - `useFillerWords`          |       | - `users`, `sessions`           |<----->| (via webhooks)          |  |
|    |     - `useTranscriptionService` |       | - `transcripts`, `usage`        |       +-------------------------+  |
|    |   - `useAnalytics`              |       | - `ground_truth` in sessions    |                 ^                |
|    | - `src/lib` (Utils)             |       +---------------------------------+                 |                |
|    |   - `pdfGenerator`              |<----->| - `users`, `sessions`           |<----->| (via webhooks)          |  |
|    +---------------------------------+       | - `transcripts`, `usage`        |       +-------------------------+  |
|              |         |                      +---------------------------------+                 ^                |
|              |         |                                  ^                                       |                |
|              |         |                      +---------------------------------+       +-------------------------+  |
|              |         +--------------------->|     PDF & Image Libs          |       | Sentry (Errors)         |  |
|              |                                |---------------------------------|       | PostHog (Analytics)     |  |
|              v                                | - jspdf, jspdf-autotable        |       +-------------------------+  |
|    +---------------------------------+       | - canvas (replaces jimp/sharp)  |                 ^                |
|    | TranscriptionService            |       +---------------------------------+                 |                |
|    |---------------------------------|                   ^                                       |                |
|    | - `CloudAssemblyAI / LocalWhisper` (Pro)       |-------------------+                                       |
|    | - `NativeBrowser` (Free/Fallback) |                 |                                       |                |
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
    *   **Styling:** Tailwind CSS with a CVA-based design system
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
    *   **E2E:** Playwright
    *   **API Mocking:** Mock Service Worker (MSW)
    *   **Image Processing (Test):** node-canvas (replaces Jimp/Sharp for stability)

## Testing Strategy

The project's testing strategy emphasizes E2E and integration tests to ensure reliable user flows. This is supported by a robust, deterministic E2E testing environment orchestrated by Playwright.

### Failure and Logging Strategy

To ensure a robust and debuggable CI process, the testing scripts adhere to two core principles: failing loud and comprehensive logging.

**Failing Loud:**
All CI shell scripts (`ci-run-all.sh`, `vm-recovery.sh`, etc.) begin with `set -e`. This command ensures that if any step in the script fails, the script will exit immediately with a non-zero status code. This prevents the pipeline from continuing in an inconsistent or partially failed state.

**Comprehensive Logging:**
A multi-layered logging strategy is in place to capture artifacts from every stage of the test run:

| Log/Artifact | Location | Purpose |
|---|---|---|
| **Master Log** | `logs/ci-run-all.log` | A complete, time-stamped log of all steps, warnings, and errors from the `ci-run-all.sh` orchestrator script. The first place to look for an overview of a test run. |
| **JSON Metrics** | `test-results/metrics.json` | The final, aggregated JSON file containing detailed pass/fail counts, duration, and coverage data. This file is the source of truth for the SQM section in `PRD.md`. |
| **Build Log** | `logs/run-build.log` | Captures the full output of the `pnpm build` command, used for debugging bundling or minification errors. |
| **Playwright Report** | `playwright-report/` | An interactive HTML report generated by Playwright, containing detailed E2E test results, screenshots of failures, and execution traces. |
| **Vite Server Log** | `vite.log` | Captures the `stdout` and `stderr` from the Vite dev server during the E2E test run. Essential for debugging application-level errors that occur during tests. |

Core services and contexts (e.g., `TranscriptionService`, `AuthContext`) are tested implicitly through the hooks and components that use them. The individual modes of the `TranscriptionService` (e.g., `CloudAssemblyAI`) have dedicated unit tests. This approach prioritizes the testing of integrated functionality as it is experienced by the user.

### Test Environment Overview

The test configuration creates a controlled environment with the following flow:
1.  **Playwright Test Start:** The test runner (`pnpm playwright test`) first invokes `global-setup.ts`.
2.  **Vite Server Launch (`global-setup.ts`):**
    *   Spawns the Vite dev server in a detached process group (`--mode test --host`).
    *   Captures all `stdout` and `stderr` from the Vite process into a `vite.log` file for debugging.
    *   Parses the Vite logs to **dynamically detect the port** the server is running on, avoiding hardcoded port conflicts.
    *   Performs a **robust health check** by polling the detected URL until it returns a `200 OK` status, ensuring the application is fully ready before any tests begin.
3.  **E2E Test Execution:** Once the health check passes, Playwright proceeds to run the test suites (e.g., `basic.e2e.spec.ts`).
4.  **Teardown & Cleanup (`global-teardown.ts`):** After all tests complete, Playwright invokes `global-teardown.ts`.
    *   It safely kills the entire Vite process group, first with a graceful `SIGTERM` and then with a `SIGKILL` if necessary, preventing zombie processes.
    *   It cleans up the `.vite.pid` file.
    *   For debugging purposes, it prints the last 20 lines of `vite.log` to the console.

### Test Stability and Memory Management

Recent investigations revealed significant stability issues with both the unit and E2E test suites. The following architectural changes have been implemented to resolve them:

1.  **Consolidated Test Setup:**
    *   **Problem:** The codebase contained multiple, conflicting `global-setup.ts` files for Vitest and Playwright, leading to incorrect test environments and initialization failures.
    *   **Solution:** The setup files have been renamed for clarity (`unit-global-setup.ts`, `e2e-global-setup.ts`) and each test runner (`vitest.config.mjs`, `playwright.config.ts`) has been explicitly configured to use its own, correct setup file.

2.  **Unit Test Memory Leak Mitigation:**
    *   **Problem:** The Vitest suite suffered from a "JavaScript heap out of memory" error, caused by accumulating state and un-cleaned-up async operations in tests.
    *   **Solution:**
        *   The `vitest.config.mjs` has been configured to run tests in isolated forked processes (`pool: 'forks'`) and sequentially (`maxConcurrency: 1`) to prevent memory accumulation.
        *   Problematic tests (`LocalWhisper.test.ts`, `SessionSidebar.test.tsx`) have been refactored to use `vi.useFakeTimers()` and proper `afterEach` cleanup hooks to manage timers and unmount components correctly.

3.  **E2E Test Race Condition Mitigation:**
    *   **Problem:** E2E tests would hang due to a race condition where the test would attempt to interact with the application before the Mock Service Worker (MSW) was fully initialized.
    *   **Solution:** The test environment now exposes a `window.mswReady` promise that resolves only when MSW is active. A `beforeEach` hook in the E2E tests waits for this promise, guaranteeing the mock server is ready before any test interactions occur.

### Core Artifacts

| File | Purpose |
|---|---|
| `vite.config.mjs` | Main Vite dev server and build configuration. |
| `vitest.config.mjs` | Vitest configuration, including test-specific aliases for mocking. |
| `.env.test` | Environment variables for the test environment. |
| `tests/global-setup.ts` | Starts the Vite server and waits for it to be fully ready. |
| `tests/global-teardown.ts` | Safely stops the Vite server and provides diagnostic logs. |
| `playwright.config.ts` | Configures Playwright projects, including the smoke test, and hooks in the global setup/teardown scripts. |
| `vite.log` | Captures all output from the Vite server during a test run. |
| `.vite.pid` | Stores the Process ID of the running Vite server for teardown. |
| `tests/e2e/basic.e2e.spec.ts` | A baseline smoke test that validates the environment's stability. |

### Mocking Native Dependencies

Some features, like the on-device transcription powered by `LocalWhisper`, rely on libraries with native dependencies (e.g., `sharp` for image processing, `@xenova/transformers` for ML models). These native dependencies can be difficult to install and build in certain environments, especially in CI/CD pipelines or sandboxed test runners.

To solve this, we use a mocking strategy for the test environment:

1.  **Optional Dependency:** The native dependency (`sharp`) is listed as an `optionalDependency` in `package.json`. This prevents the package manager from failing the installation if the native build step fails.
2.  **Vitest Alias:** In `vitest.config.mjs`, we create aliases that redirect imports of `sharp` and `@xenova/transformers` to mock files.
3.  **Canvas-based Mock:** To improve stability, the mock for `sharp` (`src/test/mocks/sharp.ts`) now uses the `canvas` library, a pure JavaScript image processing tool with better stability in headless environments than `jimp`. The mock for `@xenova/transformers` provides a simplified, lightweight implementation for unit tests.
4.  **Dependency Inlining:** Because the `@xenova/transformers` import happens within a dependency, we must configure Vitest to process this dependency by adding it to `test.deps.inline`. This ensures the alias is applied correctly.

This approach allows us to use the high-performance native library in production while maintaining a stable and easy-to-manage test environment.

### Key Advantages of This Architecture

*   **Isolation:** The test server is isolated from any local development server.
*   **Deterministic:** Tests are only executed once the environment is confirmed to be ready, eliminating race conditions.
*   **Reliable Cleanup:** The teardown process ensures no zombie Vite processes are left running, even if tests crash or time out.
*   **CI-Friendly:** The architecture works identically on CI and locally, and it surfaces logs for easy debugging of failures.

### Lessons Learned: Debugging E2E Test Timeouts

During the development of the automated SQM reporting, we encountered a critical issue where the original monolithic test script would time out after ~7 minutes. This was a "silent failure" as the console output was lost, making it difficult to diagnose. The root cause was determined to be the CI environment's hard timeout limit, which was shorter than the time required for a full dependency install and test run.

Another key lesson was the importance of ensuring all necessary binaries are present. Early failures were caused by missing Playwright browser binaries.

**Solutions Implemented:**
- **Automated Browser Installation:** The `pnpm exec playwright install --with-deps` command is run as a dedicated step in `ci-run-all.sh` to ensure browsers are always installed. The `postinstall` script in `package.json` is used to initialize Mock Service Worker (`msw`), which is required for tests.
- **Architectural Refactoring:** To address the timeout, the testing process was re-architected into a multi-script workflow orchestrated by `ci-run-all.sh`, ensuring each step could complete within the timeout window.

### CI/CD Test Execution Workflow

The CI/CD pipeline has been re-architected to be a parallel, dependency-aware pipeline orchestrated by GitHub Actions. This new architecture replaces the previous monolithic script (`ci-run-all.sh`) and is defined in `.github/workflows/ci.yml`.

The new pipeline consists of three jobs:

1.  `fast-feedback`: Runs linting, type-checking, and core unit tests. This job provides quick feedback to the developer.
2.  `parallel-e2e`: Runs the E2E test suite, sharded across two runners. This job runs in parallel with the `visual-regression` job.
3.  `visual-regression`: Runs screenshot tests. This job runs in parallel with the `parallel-e2e` job.

This new architecture significantly reduces the pipeline execution time and provides a more robust and scalable solution for CI/CD.

### CI/CD Pipeline Diagram

```
+---------------------+
|   Push to main      |
+---------------------+
          |
          v
+---------------------+
|   fast-feedback     |
| (Lint, Type-check,  |
|  Core Unit Tests)   |
+---------------------+
          |
          v
+---------------------+      +---------------------+
|   parallel-e2e      |----->|  visual-regression  |
| (E2E Shards 1 & 2)  |      | (Screenshot Tests)  |
+---------------------+      +---------------------+
```

### Containerized Test Environment

The proposed containerized test environment is not currently viable due to a lack of Docker daemon access in the CI environment. This is a known limitation and will be addressed in a future iteration.

### Agent Execution Environment

A significant portion of this project's CI/CD pipeline and initial development is managed by an AI software engineering agent. Understanding the agent's execution environment is critical for interpreting its actions and debugging issues related to its operation.

The environment has the following key characteristics:

*   **7-Minute Execution Limit:** Every task or command initiated by the agent is subject to a hard 7-minute execution timeout. This is a platform-level constraint that cannot be configured. Long-running processes, such as full dependency installations or comprehensive test suites, are likely to fail if they are not broken down into smaller, granular steps. This was the root cause of the initial CI instability.

*   **Tool-Triggered Git Commits:** Every action the agent takes using one of its tools (e.g., `read_file`, `run_in_bash_session`, `replace_with_git_merge_diff`) is automatically wrapped in a `git commit`. This has a significant side effect: it triggers `pre-commit` hooks. If the git hooks are broken or misconfigured (e.g., pointing to a non-existent `node_modules` directory), *every single tool call will fail*. This can create a deadlock where the agent cannot run `pnpm install` to fix the hooks because the command to do so fails. The `ci-run-all.sh` script was specifically designed with hook-disabling mechanisms to overcome this challenge.

*   **Available Tools:** The agent operates with a limited set of tools, including but not limited to:
    *   `ls`: List files.
    *   `read_file`: Read file content.
    *   `run_in_bash_session`: Execute shell commands.
    *   `create_file_with_block`, `overwrite_file_with_block`, `replace_with_git_merge_diff`: File manipulation tools.
    *   `set_plan`, `plan_step_complete`: Plan management.
    *   `message_user`, `request_user_input`: User interaction.
    *   `request_code_review`, `submit`: Code submission.

## 3. Frontend Architecture

The frontend is a single-page application (SPA) built with React and Vite.

*   **Component Model:** The UI is built from a combination of page-level components (`src/pages`), feature-specific components (`src/components/session`, `src/components/landing`), and a reusable UI library (`src/components/ui`).
*   **Design System:** The UI components in `src/components/ui` are built using `class-variance-authority` (CVA) for a flexible, type-safe, and maintainable design system. Design tokens are managed in `tailwind.config.ts`.
*   **State Management:** Global state is managed via a combination of React Context and custom hooks.
    *   **`AuthContext`:** The primary source for authentication state. It provides the Supabase `session` object, the `user` object, and the user's `profile` data.
    *   **`SessionContext`:** Manages the collection of a user's practice sessions (`sessionHistory`).
    *   **`useSessionManager`:** A custom hook that encapsulates the logic for saving, deleting, and exporting sessions. The anonymous user flow is now stable.
    *   **`useAnalytics`:** A custom hook that fetches and processes analytics data from the Supabase database.
*   **Routing:** Client-side routing is handled by `react-router-dom`, with protected routes implemented to secure sensitive user pages.
*   **Logging:** The application uses `pino` for structured logging.
*   **PDF Generation:** Session reports can be exported as PDF documents using the `jspdf` and `jspdf-autotable` libraries. The `pdfGenerator.ts` utility encapsulates the logic for creating these reports.
*   **Analytics Components:** The frontend includes several components for displaying analytics, such as `FillerWordTable`, `FillerWordTrend`, `SessionComparison`, `TopFillerWords`, and `AccuracyComparison`.
*   **AI-Powered Suggestions:** The `AISuggestions` component provides users with feedback on their speech.
*   **Image Processing:** The application uses `canvas` in the test environment for image processing tasks (replacing `Jimp` for stability), such as resizing user-uploaded images. The `processImage.ts` utility provides a convenient wrapper for this functionality.

### 3.1. Key Components

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

## 5. User Roles and Tiers

The application's user tiers have been consolidated into the following structure:

*   **Free User (Authenticated):** A user who has created an account but does not have an active Pro subscription. This is the entry-level tier for all users.
*   **Pro User (Authenticated):** A user with an active, paid subscription via Stripe. This tier includes all features, such as unlimited practice time, cloud-based AI transcription, and privacy-preserving on-device transcription.

## 6. Transcription Service (`src/services/transcription`)

The `TranscriptionService.ts` provides a unified abstraction layer over multiple transcription providers.

*   **Modes:**
    *   **`CloudAssemblyAI`:** Uses the AssemblyAI v3 streaming API for high-accuracy cloud-based transcription. This is one of the modes available to Pro users.
    *   **`NativeBrowser`:** Uses the browser's built-in `SpeechRecognition` API. This is the primary mode for Free users and a fallback for Pro users.
    *   **`LocalWhisper`:** An on-device, privacy-first transcription mode for Pro users, powered by `@xenova/transformers` running a Whisper model directly in the browser.
*   **Audio Processing:** `audioUtils.ts`, `audioUtils.impl.ts`, and `audio-processor.worklet.js` are responsible for capturing and resampling microphone input. A critical bug in the resampling logic that was degrading AI quality has been fixed.

### On-Device STT Implementation Details

The `LocalWhisper` provider uses the [`@xenova/transformers.js`](https://github.com/xenova/transformers.js) library to run the `Xenova/whisper-tiny.en` model directly in the user's browser.

*   **How it Works (Hybrid Model Loading):**
    1.  **Primary Source (Hugging Face Hub):** The application first attempts to download the `Xenova/whisper-tiny.en` model directly from the Hugging Face Hub. This ensures users get the latest compatible version of the model without requiring an application update.
    2.  **Fallback Source (Local):** If the download from the Hub fails (due to network issues, a service outage, or restrictive firewalls), the system automatically falls back to loading a known-good version of the model hosted locally within the application at `/public/models/`. This hybrid approach maximizes availability and resilience.
    3.  **Caching:** Once loaded from either source, the model is cached in the browser's `CacheStorage`, making subsequent loads nearly instant.
    4.  **Inference Engine:** The library runs the model on a WebAssembly (WASM) version of the ONNX Runtime. This allows for near-native performance for model inference directly in the browser.
    5.  **Privacy:** All audio processing and transcription occurs entirely on the user's machine. No audio data is ever sent to a third-party server.

*   **Comparison to Cloud AI:**
    *   **Privacy:** On-device is 100% private. Cloud AI requires sending audio data to AssemblyAI's servers.
    *   **Accuracy:** Cloud AI is significantly more accurate as it uses a much larger model (`whisper-large-v3` equivalent). The on-device `whisper-tiny.en` model is less accurate but still highly effective for its size.
    *   **Performance:** On-device has a one-time initial download cost. After caching, it is very fast. Cloud AI has a constant network latency for streaming audio and receiving transcripts.
    *   **Cost:** On-device has no per-use cost. Cloud AI has a direct cost per minute of transcribed audio.
    *   **Availability:** On-device mode is highly available. It works offline after the initial model download (from either the Hub or the local fallback). A failure of the Hugging Face Hub will not prevent the feature from working, as the local fallback will be used.

### Speaker Identification

Speaker identification (or diarization) is handled by the AssemblyAI API. When the `speaker_labels` parameter is set to `true` in the transcription request, the API will return a `speaker` property for each utterance in the transcript. This allows the frontend to display who said what.

### STT Accuracy Comparison

The STT accuracy comparison feature calculates the Word Error Rate (WER) of each transcription engine against a "ground truth" transcript. The ground truth is a manually transcribed version of the audio that is stored in the `practice_sessions` table. The WER is then used to calculate an accuracy percentage, which is displayed in the analytics dashboard. This provides users with a clear understanding of how each STT engine performs.

## 7. CI/CD

The project includes a basic CI/CD pipeline defined in `.github/workflows/deploy.yml` for manual database deployments. This needs to be expanded to support multiple environments and automated deployments.

---

## 8. Technical Debt & Known Limitations

**E2E Test Suite Timeout:** The full E2E test suite (`pnpm playwright test`) takes longer to run than the maximum timeout (~7 minutes) allowed by the current CI sandbox environment. This is not a flaw in the tests themselves, but a limitation of the environment's resources.
- **Current Workaround:** As part of the CI pipeline, we will identify one or two fast and reliable E2E tests to run as a "smoke test" to provide some level of E2E coverage without exceeding the timeout. The full suite should be run manually in a less constrained environment before major releases.
- **Long-Term Solution:** Migrate to a CI provider or plan that allows for longer timeout configurations.

### Hardened E2E Test Configuration

To address persistent environment instability and non-deterministic test outcomes, the E2E testing configuration has been significantly hardened. The following principles and configurations are now in place to ensure a stable and debuggable testing process.

**Core Problems Addressed:**
1.  **Silent Server Failures:** The Vite test server would sometimes fail to start correctly (e.g., due to an unset `VITE_PORT` environment variable), but Playwright would still attempt to run tests, leading to long, uninformative timeouts as it waited for a server that would never become available.
2.  **Lack of Diagnostics:** It was difficult to determine whether a test failure was caused by an issue in the test itself, a server-side error during the test run, or a problem with the Playwright test runner's connection to the server.

**Solutions Implemented:**

1.  **Robust `package.json` Scripts:**
    *   The `dev:test` script has been updated to `vite --mode test --port ${VITE_PORT:-5173}`. The `${VITE_PORT:-5173}` syntax ensures that if the `VITE_PORT` environment variable is not set, it will default to `5173`, preventing the server from failing to start due to a missing port.
    *   The `test:e2e` and `test:screenshots` scripts have been updated to include `DEBUG=pw:server` by default. This provides verbose logging from Playwright's server component, offering clear insight into the test lifecycle.

2.  **Hardened `playwright.config.ts`:**
    *   The `webServer` configuration now includes `stdout: 'pipe'` and `stderr: 'pipe'`. This captures all log output from the Vite server process and pipes it directly into the Playwright test runner's output. This makes it immediately obvious if the server encounters an error during startup or while tests are running.
    *   The configuration explicitly loads environment variables from `.env.test` using `dotenv`, ensuring a consistent environment for both the test runner and the server process it spawns.

These changes create a more resilient and transparent testing environment, making it easier to diagnose and resolve issues quickly.