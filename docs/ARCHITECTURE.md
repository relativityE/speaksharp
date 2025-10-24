**Owner:** [unassigned]
**Last Reviewed:** 2025-10-23

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

SpeakSharp employs a unified and resilient testing strategy to ensure that the local development experience perfectly mirrors the Continuous Integration (CI) pipeline, eliminating "it works on my machine" issues. The process is designed for speed, reliability, and deterministic execution.

### The Local Audit Script: The Single Source of Truth

The `./test-audit.sh` script is the cornerstone of our quality assurance process. It is the **single source of truth** for all code validation, designed to be run both locally by developers and remotely by the CI pipeline.

*   **Purpose:** To orchestrate a comprehensive suite of checks that validate the application's quality, from static analysis to sharded end-to-end tests.
*   **Staged Execution:** The script is modular and accepts commands (`prepare`, `test <shard-index>`, `report`, `all`) to support a multi-stage CI process.
*   **Key Features:**
    *   **Static Analysis & Build:** Runs linting, type checking, and a production build.
    *   **Unit Tests:** Executes the full unit test suite and generates a coverage report.
    *   **E2E Test Timing & Sharding:** Times each E2E test individually and then partitions the suite into balanced shards (≤7 minutes each) based on those runtimes.
    *   **Sharded E2E Execution:** Runs the E2E tests shard by shard, forcing serial execution within each shard (`--workers=1`) to prevent resource contention and ensure stability. It generates a separate JSON report for each shard.
    *   **Report Aggregation:** Merges the individual E2E shard reports into a single, final JSON report that can be consumed by other metric scripts.
    *   **Documentation Update:** Automatically runs the necessary scripts (`./run-metrics.sh`, `./update-sqm-doc.sh`) to update the Software Quality Metrics in `docs/PRD.md`.
*   **Behavior:** The script is designed to be strict (`set -euo pipefail`) and will exit with an error if any critical step fails, preventing the pipeline from proceeding with incomplete or failed results.

### CI/CD Pipeline: Parallel Execution

The project's CI pipeline, defined in `.github/workflows/ci.yml`, leverages the sharded execution of the `test-audit.sh` script to run E2E tests in parallel, significantly reducing feedback time.

```ascii
+----------------------------------+
|      Push or PR to main          |
+----------------------------------+
                 |
                 v
+----------------------------------+
|      Job: prepare                |
|----------------------------------|
| 1. Checkout & Install            |
| 2. Run ./test-audit.sh prepare   |
|    (Lint, Build, Unit, Shard)    |
| 3. Upload test-support/          |
+----------------------------------+
                 |
                 v
+----------------------------------+       +----------------------------------+
|       Job: test (Shard 0)        |------>|       Job: test (Shard 1)        | ...
|----------------------------------|       |----------------------------------|
| 1. Download Artifacts            |       | 1. Download Artifacts            |
| 2. Run ./test-audit.sh test 0    |       | 2. Run ./test-audit.sh test 1    |
+----------------------------------+       +----------------------------------+
                 |                                  |
                 +----------------------------------+
                                  |
                                  v
+----------------------------------+
|         Job: report              |
|----------------------------------|
| 1. Download Artifacts            |
| 2. Run ./test-audit.sh report    |
|    (Merge reports, update docs)  |
| 3. Commit docs/PRD.md            |
+----------------------------------+
```
This multi-stage, parallel approach ensures that local validation (`./test-audit.sh all`) and CI execution are perfectly aligned while maximizing speed and resource utilization.

### E2E Test Environment & Core Patterns

The E2E test environment is designed for stability and isolation, ensuring tests run reliably both locally and in CI. The key to this stability is a set of core patterns for handling asynchronous operations like API mocking and authentication.

1.  **Vite "Test" Mode:**
    *   **Problem:** The Supabase client was configured to persist user sessions to `localStorage` by default. This is desirable for human users but disastrous for E2E tests, as it causes sessions to leak between tests and conflicts with programmatic login helpers.
    *   **Solution:** The application now uses Vite's "test" mode (`vite --mode test`), which is activated by the `webServer` command in `playwright.config.ts`. The application's source code in `src/lib/supabaseClient.ts` detects this mode and explicitly disables session persistence (`persistSession: false`). This is the most critical piece of the E2E architecture, as it ensures perfect test isolation.

2.  **Sequential MSW Initialization:**
    *   **Problem:** E2E tests would fail with race conditions because the React application could mount and trigger network requests *before* the Mock Service Worker (MSW) was ready to intercept them.
    *   **Solution:** The application's bootstrap logic in `src/main.tsx` has been made sequential for the test environment. It now reliably detects test mode by checking for a `?test=true` URL parameter. It then `await`s the asynchronous `msw.worker.start()` promise to complete **before** it calls `renderApp()`. This guarantees that the entire mock API layer is active before any React component mounts, eliminating the race condition.

3.  **Programmatic Login with `sessionStorage`:**
    *   **Problem:** E2E tests require a fast, stable way to authenticate.
    *   **Solution:** The `programmaticLogin` helper injects a mock user session directly into `sessionStorage`. Because the Supabase client has session persistence disabled (see point 1), it will read this session on page load but will not attempt to write to `localStorage`, avoiding any conflicts. `sessionStorage` is used because it is automatically cleared between tests, providing perfect isolation.

4.  **Source-Code-Level Guard for Incompatible Libraries:**
    *   **Problem:** The on-device transcription feature uses the `onnxruntime-web` library, which relies on WebAssembly. This library is fundamentally incompatible with the Playwright test environment and causes a silent, catastrophic browser crash.
    *   **Solution:** A test-aware guard has been implemented directly in the application's source code.
        *   **Flag Injection:** The `healthCheck` helper in `tests/e2e/shared.ts` uses `page.addInitScript()` to inject a global `window.TEST_MODE = true;` flag before any application code runs.
        *   **Conditional Import:** The `TranscriptionService.ts` checks for the presence of `window.TEST_MODE`. If the flag is true, it completely skips the dynamic import of the `LocalWhisper` module that would have loaded the crashing library. Instead, it gracefully falls back to the safe, native browser transcription engine.

These patterns work together to create a robust testing foundation, eliminating the primary sources of flakiness and making the E2E suite a reliable indicator of application quality.

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

*This section is for tracking active, unresolved issues. As issues are resolved, they should be moved to the [Changelog](./CHANGELOG.md).*

*   **Unreliable Client-Side Navigation in Playwright:** There is a deep-seated, unresolved issue where client-side navigation within the Playwright test environment is unreliable.
    *   **Symptom:** Tests that require navigation between pages (e.g., from `/session` to `/analytics`) often fail because the navigation does not complete. The test continues to execute on the old page, leading to `TimeoutError` when waiting for elements that only exist on the destination page.
    *   **Investigation:** This issue persists even when using direct `page.goto("/path")` calls, which are the recommended workaround for `react-router-dom` `<Link>` component issues. Standard Playwright synchronization mechanisms like `waitForURL` and `waitForSelector` have also proven ineffective in consistently resolving this.
    *   **Impact:** This is a high-priority issue that blocks the entire E2E smoke test from passing. A permanent solution is required and is being tracked as a P1 technical debt item in the [Roadmap](./ROADMAP.md).
