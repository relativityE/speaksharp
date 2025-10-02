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
|    +---------------------------------+       | - canvas (replaces sharp)       |                 ^                |
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
    *   **E2E:** Playwright
    *   **API Mocking:** Mock Service Worker (MSW)
    *   **Image Processing (Test):** node-canvas (replaces Jimp/Sharp for stability)

## Testing and CI/CD

SpeakSharp employs a two-tiered testing strategy to balance development velocity with code quality, enforced by a comprehensive Continuous Integration (CI) pipeline using GitHub Actions.

### Local Audit vs. Comprehensive CI

1.  **Local Audit (`./test-audit.sh`):**
    *   **Purpose:** A quick verification script intended for developers to run before committing code. It provides rapid feedback on the most critical parts of the application.
    *   **Scope:**
        *   Runs static analysis (`pnpm typecheck`). Note: `pnpm lint` is currently commented out in the script.
        *   Performs a full production build (`pnpm build`).
        *   Executes the full unit test suite (`pnpm test:unit:full`).
        *   Runs only the E2E *smoke tests* (`pnpm test:e2e:smoke`).
    *   **Behavior:** This script is designed to be non-blocking. It will report E2E smoke test failures but will not exit with an error, allowing the process to complete and generate reports. This prevents slow or flaky E2E tests from blocking local development.

2.  **Comprehensive CI (GitHub Actions):**
    *   **Purpose:** The definitive source of truth for code quality. This workflow runs automatically on every push and pull request to the `main` branch.
    *   **Location:** The workflow is defined in `.github/workflows/ci.yml`.
    *   **Scope:** It executes a complete and strict set of checks:
        *   Dependency Installation
        *   Linting (`pnpm lint`)
        *   Type Checking (`pnpm typecheck`)
        *   Full Unit Test Suite (`pnpm test:unit:full`)
        *   **Full End-to-End (E2E) Test Suite (`pnpm test:e2e`)**
    *   **Behavior:** Unlike the local audit, the CI pipeline is strict. A failure in *any* step (including the full E2E suite) will cause the entire workflow to fail, preventing merges of broken code.

### CI/CD Pipeline

The project has two GitHub Actions workflows:

1.  **`ci.yml` (Continuous Integration):** This is the primary workflow for ensuring code quality.

    ```
    +----------------------------------+
    | Push or PR to main               |
    +----------------------------------+
                     |
                     v
    +----------------------------------+
    |       Job: build_and_test        |
    |----------------------------------|
    | 1. Checkout Code                 |
    | 2. Check Node.js Version         |
    | 3. Setup PNPM & Node.js          |
    | 4. Install Dependencies          |
    | 5. Run Lint                      |
    | 6. Run Typecheck                 |
    | 7. Run Unit Tests                |
    | 8. Run E2E Tests                 |
    +----------------------------------+
    ```

2.  **`deploy.yml` (Manual Deployment):**
    *   **Purpose:** A manually triggered workflow for deploying database changes to the Supabase backend.
    *   **Steps:** It installs the Supabase CLI, links the project, and pushes database migrations (`supabase db push`).

### E2E Test Environment

The end-to-end (E2E) test environment is managed by Playwright's built-in `webServer` configuration, providing a streamlined and reliable setup.

1.  **Automated Server Management:** The `playwright.config.ts` file uses the `webServer` option to automatically manage the Vite development server.
    *   **Command:** It runs the `pnpm dev:foreground` script (`vite --mode test`) to start the server.
    *   **Health Check:** Playwright waits for the server to be fully available at the specified URL (`http://localhost:5173`) before starting any tests.
    *   **Cleanup:** The server process is automatically terminated by Playwright when the tests are finished.
    *   **Logging:** All `stdout` and `stderr` from the Vite server are piped directly into the test runner's output, making it easy to debug server-side issues during test runs.

2.  **Mock Service Worker (MSW) Integration:**
    *   **Problem:** E2E tests would hang due to a race condition where the test would attempt to interact with the application before the Mock Service Worker (MSW) was fully initialized.
    *   **Solution:** The test environment now exposes a `window.mswReady` promise that resolves only when MSW is active. A `beforeEach` hook in the E2E tests waits for this promise, guaranteeing the mock server is ready before any test interactions occur.

This modern approach eliminates the need for manual server management scripts (e.g., `global-setup.ts`, `global-teardown.ts`), resulting in a simpler, more robust, and easier-to-maintain testing environment.

### Mocking Native Dependencies

Some features, like the on-device transcription powered by `LocalWhisper`, rely on libraries with native dependencies (e.g., `sharp` for image processing, `@xenova/transformers` for ML models). These native dependencies can be difficult to install and build in certain environments, especially in CI/CD pipelines or sandboxed test runners.

To solve this, we use a mocking strategy for the test environment:

1.  **Optional Dependency:** The native dependency (`sharp`) is listed as an `optionalDependency` in `package.json`. This prevents the package manager from failing the installation if the native build step fails.
2.  **Vitest Alias:** In `vitest.config.mjs`, we create aliases that redirect imports of `sharp` and `@xenova/transformers` to mock files.
3.  **Canvas-based Mock:** To improve stability, the mock for `sharp` (`src/test/mocks/sharp.ts`) now uses the `canvas` library, a pure JavaScript image processing tool with better stability in headless environments. The mock for `@xenova/transformers` provides a simplified, lightweight implementation for unit tests.
4.  **Dependency Inlining:** Because the `@xenova/transformers` import happens within a dependency, we must configure Vitest to process this dependency by adding it to `test.deps.inline`. This ensures the alias is applied correctly.

This approach allows us to use the high-performance native library in production while maintaining a stable and easy-to-manage test environment.

## 3. Frontend Architecture

The frontend is a single-page application (SPA) built with React and Vite.

*   **Component Model:** The UI is built from a combination of page-level components (`src/pages`), feature-specific components (`src/components/session`, `src/components/landing`), and a reusable UI library (`src/components/ui`).
*   **Design System:** The UI components in `src/components/ui` are built using `class-variance-authority` (CVA) for a flexible, type-safe, and maintainable design system. Design tokens are managed in `tailwind.config.ts`.
*   **State Management:** Global state is managed via a combination of React Context and custom hooks.
    *   **`AuthContext`:** The primary source for authentication state. It provides the Supabase `session` object, the `user` object, and the user's `profile` data.
    *   **`SessionContext`:** Manages the collection of a user's practice sessions (`sessionHistory`).
    *   **`useSessionManager`:** A custom hook that encapsulates the logic for saving, deleting, and exporting sessions.
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

## 7. Known Issues

*   **E2E Test Environment Instability:** The E2E test suite was suffering from persistent timeouts. The root causes were identified as a combination of:
    1.  An unreliable `AuthProvider` loading state that would prevent the application from rendering in the test environment.
    2.  A fragile custom test wrapper (`verifyOnlyStepTracker.ts`) that could hang indefinitely.
    3.  A polluted test environment with zombie processes and stale browser sessions.
    *   **Resolution:** The `AuthProvider` has been fixed to initialize its loading state correctly in test mode. The test wrapper has been replaced with a resilient version that includes timeouts. The test suite has been updated to ensure a clean state (`localStorage` clearing) before runs.

## 8. Technical Debt

*   **Custom Test Wrapper (`verifyOnlyStepTracker.ts`):** The custom test wrapper, while useful for debugging, adds a layer of complexity and was a contributing factor to test hangs. It has been replaced with a more resilient version, but for critical smoke tests, it is recommended to use the `plainTest` and `plainExpect` exports from this file to bypass the wrappers entirely, ensuring maximum stability.
*   **Redundant Mocking Systems:** The codebase previously contained two conflicting mocking systems (MSW and Playwright's `page.route`). This has been resolved by consolidating all API mocking into MSW, but the pattern should be monitored to prevent re-introduction.
