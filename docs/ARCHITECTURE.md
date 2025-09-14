**Owner:** [unassigned]
**Last Reviewed:** 2025-09-08

🔗 [Back to Outline](./OUTLINE.md)

# SpeakSharp System Architecture

**Version 2.1** | **Last Updated: 2025-09-08**

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
|    +---------------------------------+       |---------------------------------|       |       (Payments)      |  |
|              |                                | - `users`, `sessions`           |<----->| (via webhooks)        |  |
|              v                                | - `transcripts`, `usage`        |       +-----------------------+  |
|    +---------------------------------+       +---------------------------------+                 ^              |
|    | TranscriptionService            |                   ^                                       |              |
|    |---------------------------------|                   |                                       |              |
|    | - `CloudAssemblyAI` (Pro)       |-------------------+                                       |              |
|    | - `NativeBrowser` (Free/Fallback) |                 |                                       |              |
|    | - `LocalWhisper` (Premium)      |                   |                                       |              |
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
    *   **Language:** TypeScript / JavaScript (JSX)
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
Our testing architecture adopts a unified, service-mocking approach powered by Mock Service Worker (MSW). This decision replaces fragile, module-level mocks with a consistent API simulation layer that works seamlessly across unit tests (Vitest) and end-to-end tests (Playwright).

Key principles of this strategy:

*   **Consistency** – MSW ensures both unit and E2E tests interact with the same mocked API surface, eliminating divergence between test layers.
*   **Reliability** – By simulating network requests instead of patching modules, tests are more stable, deterministic, and resistant to brittle race conditions.
*   **Scalability** – Centralized MSW handlers define all mock API behavior in one place, reducing duplication and simplifying maintenance as the system grows.
*   **Integration** – The test pipeline (run-tests.sh) orchestrates unit, coverage, and E2E runs, consuming the same mock environment for a true “single source of truth.”
*   **Production Parity** – MSW operates at the network boundary, which more closely mirrors real-world application behavior than in-process mocks.

### Vitest and MSW Setup

The testing architecture relies on a clean separation of concerns between the Vite build configuration and the Vitest test runner configuration.

*   **`vite.config.mjs`:** This file is used exclusively for building and serving the application. It contains no test-related configuration.
*   **`vitest.config.mjs`:** This file is dedicated to the test runner configuration. It defines the test environment (`happy-dom`), the setup files (`src/test-setup.js`), and the test reporters.
*   **`src/test-setup.js`:** This file performs the global setup for the test environment. It imports `@testing-library/jest-dom` to extend `vitest`'s `expect` with DOM-specific matchers.
*   **Mock Service Worker (MSW):** MSW is used to mock the API surface for both unit and E2E tests.
    *   **`src/test/mocks/handlers.ts`:** Defines the mock API handlers.
    *   **`src/test/mocks/server.ts`:** Sets up the MSW server for the Node.js environment (unit tests).
    *   **`src/test/mocks/browser.ts`:** Sets up the MSW worker for the browser environment (E2E tests).

This setup ensures a stable and predictable test environment and avoids the module resolution conflicts that can arise from mixing `vite` and `vitest` configurations.

### E2E Testing Framework

The End-to-End (E2E) test suite is built with **Playwright** and is located in the `tests/` directory. The tests are executed via the `pnpm test:e2e` command.

To address persistent stability issues within the sandboxed VM environment, the test suite uses a custom, robust server management strategy instead of Playwright's built-in `webServer` option. This provides greater control, visibility, and hang-prevention.

The architecture consists of three key files:

1.  **`tests/global-setup.ts`**: This script is executed once before the entire test suite runs. It is responsible for:
    *   **Port Availability Check**: It first checks if the server port (`5173`) is free to prevent conflicts.
    *   **Spawning the Dev Server**: It manually starts the Vite dev server (`pnpm run dev:test`) as a child process.
    *   **Live Logging**: It pipes the server's `stdout` and `stderr` directly to the console, providing real-time visibility into the startup process.
    *   **PID Tracking**: It saves the server process's PID to a `dev-server.pid` file.
    *   **Readiness Probe**: It actively polls the server's URL (`http://localhost:5173`) and includes a watchdog timer and a hard timeout to ensure tests only begin when the server is ready, preventing indefinite hangs.

2.  **`tests/global-teardown.ts`**: This script runs once after all tests have completed. It reads the PID from `dev-server.pid` and forcefully terminates the server process, ensuring a clean shutdown and preventing orphaned processes.

3.  **`playwright.config.ts`**: The main configuration file is set up to be ESM-safe and explicitly points to the custom setup and teardown scripts using `pathToFileURL`. Crucially, the `webServer` option is **omitted**, delegating all server management responsibilities to the global scripts.

This manual, robust approach was chosen specifically because the standard `webServer` was too opaque and brittle for the sandboxed VM, often leading to silent hangs and difficult-to-debug failures. This new architecture ensures a stable, reliable, and transparent E2E testing environment.

### Code Quality and Automation

To maintain a high standard of code quality and prevent common errors, the project utilizes an automated pre-commit workflow.

*   **TypeScript Configuration (`tsconfig.json`):** A strict `tsconfig.json` is now in place to enforce type safety across the entire codebase. It is configured to work with Vite's modern tooling, using `moduleResolution: "bundler"`, and allows for mixed JavaScript/TypeScript files with `allowJs: true`.
*   **Automated Checks (`lint-staged` and `husky`):** A `husky` pre-commit hook triggers `lint-staged` to run checks on all staged files. This configuration ensures that:
    *   **ESLint (`eslint --fix`):** Automatically fixes linting and style errors.
    *   **TypeScript Compiler (`tsc --noEmit`):** Performs a full type check to catch any TypeScript errors before they are committed.

This automated gatekeeping ensures that code entering the repository is clean, consistent, and type-safe.

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

The application defines several user tiers that control access to features and usage limits.

*   **Anonymous User:** A user who has not signed in. The flow for this user is now functional.
*   **Free User (Authenticated):** A user who has created an account but does not have an active Pro subscription.
*   **Pro User (Authenticated):** A user with an active, paid subscription via Stripe.
*   **Premium User:** A user with an active premium subscription. This tier provides access to on-device, privacy-first transcription.

## 6. Transcription Service (`src/services/transcription`)

The `TranscriptionService.js` provides a unified abstraction layer over multiple transcription providers.

*   **Modes:**
    *   **`CloudAssemblyAI`:** Uses the AssemblyAI v3 streaming API for high-accuracy cloud-based transcription. This is the primary mode for Pro users.
    *   **`NativeBrowser`:** Uses the browser's built-in `SpeechRecognition` API. This is the primary mode for Free users and a fallback for Pro users.
    *   **`LocalWhisper`:** An on-device, privacy-first transcription mode for Premium users, powered by `@xenova/transformers` running a Whisper model directly in the browser.
*   **Audio Processing:** `audioUtils.js` and `audio-processor.worklet.js` are responsible for capturing and resampling microphone input. A critical bug in the resampling logic that was degrading AI quality has been fixed.

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
