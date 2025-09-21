**Owner:** [unassigned]
**Last Reviewed:** 2025-09-08

🔗 [Back to Outline](./OUTLINE.md)

# SpeakSharp System Architecture

**Version 3.1** | **Last Updated: 2025-09-19**

This document provides an overview of the technical architecture of the SpeakSharp application. For product requirements and project status, please refer to the [PRD.md](./PRD.md) and the [Roadmap](./ROADMAP.md) respectively.

## 1. System Overview

This section contains a high-level block diagram of the SpeakSharp full-stack architecture.

```ascii
+------------------------------------------------------------------------------------------------------------------+
|                                        SpeakSharp System Architecture                                            |
+------------------------------------------------------------------------------------------------------------------+
|                                                                                                                  |
|    +---------------------------------+       +---------------------------------+       +-----------------------+  |
|    |      Frontend (Browser)         |       |      Backend (Supabase)         |       |   3rd Party Services  |  |
|    |      (React SPA / Vite)         |       +---------------------------------+       +-----------------------+  |
|    +---------------------------------+                   ^                                     ^         ^        |
|              |      ^                                    |                                     |         |        |
|              |      | HTTPS/WSS                          | Postgres/RPC                        |         |        |
|              v      |                                    v                                     |         |        |
|    +---------------------------------+       +---------------------------------+       +-----------------------+  |
|    |    User Interface (React)       |       |      Supabase Auth              |       |      AssemblyAI       |  |
|    |---------------------------------|       |---------------------------------|       | (Streaming STT API)   |  |
|    | - `src/pages` (Routing)         |<----->| - User/Session Management       |<----->| (via WebSockets)      |  |
|    | - `src/components` (UI)         |       | - RLS for Data Security         |       +-----------------------+  |
|    | - `src/contexts` (State Mgmt)   |       +---------------------------------+                 ^              |
|    |   - `AuthContext`               |                   ^                                       |              |
|    |   - `SessionContext`            |                   |                                       |              |
|    | - `src/hooks` (Logic)           |                   v                                       |              |
|    |   - `useSessionManager`         |       +---------------------------------+       +-----------------------+  |
|    |   - `useSpeechRecognition`      |       |    Supabase DB (Postgres)       |       |        Stripe         |  |
|    | - `src/lib` (Utils)             |       |---------------------------------|       |       (Payments)      |  |
|    |   - `pdfGenerator`              |<----->| - `users`, `sessions`           |<----->| (via webhooks)        |  |
|    +---------------------------------+       | - `transcripts`, `usage`        |       +-----------------------+  |
|              |         |                      +---------------------------------+                 ^              |
|              |         |                                  ^                                       |              |
|              |         |                      +---------------------------------+                 |              |
|              |         +--------------------->|     PDF & Image Libs          |                 |              |
|              |                                |---------------------------------|                 |              |
|              v                                | - jspdf, jspdf-autotable        |                 |              |
|    +---------------------------------+       | - jimp (replaces sharp)         |                 |              |
|    | TranscriptionService            |       +---------------------------------+                 |              |
|    |---------------------------------|                   ^                                       |              |
|    | - `CloudAssemblyAI / LocalWhisper` (Pro)       |-------------------+                                       |
|    | - `NativeBrowser` (Free/Fallback) |                 |                                       |              |
|    +---------------------------------+       +---------------------------------+                 |              |
|              |                                | Deno Edge Functions             |-----------------+              |
|              v                                |---------------------------------|                                |
|    +---------------------------------+       | - `assemblyai-token` (secure)   |                                |
|    |      Microphone (Audio Input)   |       | - `stripe-checkout`             |                                |
|    +---------------------------------+       | - `stripe-webhook`              |                                |
|                                                +---------------------------------+                                |
|                                                                                                                  |
+------------------------------------------------------------------------------------------------------------------+
```

## 2. Technology Stack

SpeakSharp is built on a modern, serverless technology stack designed for real-time applications.

*   **Frontend:**
    *   **Framework:** React (v18) with Vite
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
*   **Testing:**
    *   **Unit/Integration:** Vitest
    *   **E2E:** Playwright

## Testing Strategy

The project's testing strategy emphasizes E2E and integration tests to ensure reliable user flows. This is supported by a robust, deterministic E2E testing environment orchestrated by Playwright.

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

### Core Artifacts

| File | Purpose |
|---|---|
| `vite.config.mjs` | Vite dev server configuration, including test-specific aliases. |
| `.env.test` | Environment variables for the test environment. |
| `tests/global-setup.ts` | Starts the Vite server and waits for it to be fully ready. |
| `tests/global-teardown.ts` | Safely stops the Vite server and provides diagnostic logs. |
| `playwright.config.ts` | Configures Playwright projects, including the smoke test, and hooks in the global setup/teardown scripts. |
| `vite.log` | Captures all output from the Vite server during a test run. |
| `.vite.pid` | Stores the Process ID of the running Vite server for teardown. |
| `tests/e2e/basic.e2e.spec.ts` | A baseline smoke test that validates the environment's stability. |

### Mocking Native Dependencies

Some features, like the on-device transcription powered by `LocalWhisper`, rely on libraries with native dependencies (e.g., `sharp` for image processing). These native dependencies can be difficult to install and build in certain environments, especially in CI/CD pipelines or sandboxed test runners.

To solve this, we use a mocking strategy for the test environment:

1.  **Optional Dependency:** The native dependency (`sharp`) is listed as an `optionalDependency` in `package.json`. This prevents the package manager from failing the installation if the native build step fails.
2.  **Vitest Alias:** In `vitest.config.mjs`, we create an alias that redirects all imports of `sharp` to a mock file.
3.  **Jimp-based Mock:** The mock file (`src/test/mocks/sharp.ts`) uses the `jimp` library, a pure JavaScript image processing tool, to provide a functional equivalent of the `sharp` API for our tests.
4.  **Dependency Inlining:** Because the `sharp` import happens within a dependency (`@xenova/transformers`), we must configure Vitest to process this dependency by adding it to `test.deps.inline`. This ensures the alias is applied correctly.

This approach allows us to use the high-performance native library in production while maintaining a stable and easy-to-manage test environment.

### Key Advantages of This Architecture

*   **Isolation:** The test server is isolated from any local development server.
*   **Deterministic:** Tests are only executed once the environment is confirmed to be ready, eliminating race conditions.
*   **Reliable Cleanup:** The teardown process ensures no zombie Vite processes are left running, even if tests crash or time out.
*   **CI-Friendly:** The architecture works identically on CI and locally, and it surfaces logs for easy debugging of failures.

### Lessons Learned: Debugging E2E Test Timeouts

During the development of the automated SQM reporting, we encountered a critical issue where the `./run-tests.sh` script would time out after ~7 minutes. This was a "silent failure" as the console output was lost, making it difficult to diagnose.

**Root Causes:**
1.  **Missing Browser Binaries:** The primary cause was that the Playwright browser binaries were not being installed automatically in the CI environment. The test runner was failing instantly with an `Executable doesn't exist` error, but this was hidden by the test runner's retry logic and the overall script timeout.
2.  **Error Surfacing:** The `run-tests.sh` script did not explicitly surface fatal errors from the Playwright JSON report, contributing to the "silent" nature of the failure.

**Solutions Implemented:**
1.  **Automated Browser Installation:** The `pnpm exec playwright install --with-deps` command was added to the `postinstall` script in `package.json`. This ensures that the necessary browsers are always installed after a `pnpm install`.
2.  **Enhanced Error Reporting:** The `run_e2e_tests` function in `run-tests.sh` was enhanced to parse the Playwright JSON report on failure and print any fatal errors to the console, making diagnosis of such issues immediate.

### Environment Recovery

In the event of test environment instability (e.g., hanging processes, incorrect tool execution), agents should run the `vm-recovery.sh` script located in the root directory. This script is designed to reset and stabilize the development environment.

**Usage:**
```bash
./vm-recovery.sh
```

## 3. Frontend Architecture

The frontend is a single-page application (SPA) built with React and Vite.

*   **Component Model:** The UI is built from a combination of page-level components (`src/pages`), feature-specific components (`src/components/session`, `src/components/landing`), and a reusable UI library (`src/components/ui`).
*   **Design System:** The UI components in `src/components/ui` are built using `class-variance-authority` (CVA) for a flexible, type-safe, and maintainable design system. Design tokens are managed in `tailwind.config.ts`.
*   **State Management:** Global state is managed via a combination of React Context and custom hooks.
    *   **`AuthContext`:** The primary source for authentication state. It provides the Supabase `session` object, the `user` object, and the user's `profile` data.
    *   **`SessionContext`:** Manages the collection of a user's practice sessions (`sessionHistory`).
    *   **`useSessionManager`:** A custom hook that encapsulates the logic for saving, deleting, and exporting sessions. The anonymous user flow is now stable.
*   **Routing:** Client-side routing is handled by `react-router-dom`, with protected routes implemented to secure sensitive user pages.
*   **Logging:** The application uses `pino` for structured logging.
*   **PDF Generation:** Session reports can be exported as PDF documents using the `jspdf` and `jspdf-autotable` libraries. The `pdfGenerator.ts` utility encapsulates the logic for creating these reports.
*   **Analytics Components:** The frontend includes several components for displaying analytics, such as `FillerWordTable`, `FillerWordTrend`, and `SessionComparison`.
*   **AI-Powered Suggestions:** The `AISuggestions` component provides users with feedback on their speech.
*   **Image Processing:** The application uses `Jimp` for image processing tasks, such as resizing user-uploaded images. The `processImage.ts` utility provides a convenient wrapper for this functionality.

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

## 7. CI/CD

The project includes a basic CI/CD pipeline defined in `.github/workflows/deploy.yml` for manual database deployments. This needs to be expanded to support multiple environments and automated deployments.

---

## 8. Technical Debt & Known Limitations

This section is intentionally left blank. All major known issues with the test environment have been resolved.
