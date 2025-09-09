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

## 2. Frontend Architecture

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

## 3. Backend Architecture

The backend is built entirely on the Supabase platform, leveraging its integrated services.

*   **Database:** A PostgreSQL database managed by Supabase. Schema is managed via migration files in `supabase/migrations`.
*   **Authentication:** Supabase Auth is used for user registration, login, and session management.
*   **Serverless Functions:** Deno-based Edge Functions are used for secure, server-side logic.
    *   `assemblyai-token`: Securely generates temporary tokens for the AssemblyAI transcription service.
    *   `stripe-checkout`: Handles the creation of Stripe checkout sessions.
    *   `stripe-webhook`: Listens for and processes webhooks from Stripe to update user subscription status.

## 4. User Roles and Tiers

The application defines several user tiers that control access to features and usage limits.

*   **Anonymous User:** A user who has not signed in. The flow for this user is now functional.
*   **Free User (Authenticated):** A user who has created an account but does not have an active Pro subscription.
*   **Pro User (Authenticated):** A user with an active, paid subscription via Stripe.
*   **Premium User:** A user with an active premium subscription. This tier provides access to on-device, privacy-first transcription.

## 5. Transcription Service (`src/services/transcription`)

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

## 6. CI/CD

The project includes a basic CI/CD pipeline defined in `.github/workflows/deploy.yml` for manual database deployments. This needs to be expanded to support multiple environments and automated deployments.

## 7. Known Issues

*   All major technical debt related to the test suite has been resolved. The remaining tech debt is tracked in the [Roadmap](./ROADMAP.md).

## 8. Testing Frameworks & Implementation

This section describes the tools and technical practices used for testing. For the product-level testing strategy and quality goals, see the [Software Quality Metrics in the PRD](./PRD.md#5-software-quality-metrics).

### Vite/Vitest Configuration

The stability of the unit and component test suite hinges on several key configurations in `vite.config.mjs`:

1.  **Static Configuration:** The configuration is exported as a single, static object rather than using a function with conditional logic. This was implemented to fix a critical bug where the test-specific configurations were not being reliably applied, causing the entire test suite to become unstable.
2.  **JSDOM Environment:** The `test.environment` is explicitly set to `'jsdom'`. This provides a simulated browser environment, making critical objects like `window` and `document` available. This is essential for testing React components that need to render to a DOM.
3.  **Strict Exclusion:** The `test.exclude` array is configured to explicitly ignore the `**/tests/**` directory. This is a critical separation of concerns, preventing the Vitest unit test runner from attempting to execute Playwright E2E tests, which use a different runner and syntax.

### Global Test Mocks (`src/test/setup.tsx`)

To create a stable and predictable test environment, several key dependencies and browser APIs are mocked globally in the test setup file:

*   **Native Node.js Modules:** Modules with native C++ bindings, like `sharp`, often fail to build or run in containerized CI/CD environments. To prevent this, `sharp` is globally mocked to return a simple, non-functional version of itself.
*   **Browser-Specific APIs:** The `jsdom` environment does not implement all browser APIs. Any components that rely on features like `SpeechRecognition`, `navigator.mediaDevices`, or `URL.createObjectURL` would fail. These APIs are mocked globally to ensure that the components can render and be tested without runtime errors.
*   **Third-Party Services:** Services like Supabase, Stripe, PostHog, and Sonner are globally mocked to prevent tests from making actual network calls. This makes tests faster, more reliable, and prevents them from depending on external state.

### Required Practices
1.  **Use the Unified Test Helper:** All component tests **must** use the `renderWithAllProviders` function from `src/test/test-utils.jsx` to prevent memory leaks and ensure access to necessary contexts.
2.  **Mock Strategically:** For complex hooks like `useSpeechRecognition`, mock the hook itself to test the component's response to different states.
3.  **Clean Up Mocks:** All test files that use `vi.mock` or `vi.spyOn` should include an `afterEach(() => { vi.restoreAllMocks(); });` block.

### E2E Test Architecture
The E2E test architecture is now stable and follows best practices.

- **Network Stubbing (`tests/sdkStubs.ts`):** Uses `page.route()` to intercept outgoing network requests to third-party services and Supabase. This is done after navigating to `about:blank` to prevent race conditions with the application's startup.
- **Real Authentication Flow:** The tests now interact with the application like a real user. They fill out the login form on the `/auth` page, and the `sdkStubs.ts` file provides mock responses to the authentication API calls. This ensures the entire authentication flow is tested.
- **Media Device Mocking (`tests/mockMedia.ts`):** Uses an init script to replace `navigator.mediaDevices.getUserMedia` with a function that returns a fake audio stream, bypassing browser permission prompts.
