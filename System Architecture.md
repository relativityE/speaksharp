# SpeakSharp System Architecture

**Version 1.0** | **Last Updated: August 31, 2025**

This document provides an overview of the technical architecture of the SpeakSharp application. For product requirements and project status, please refer to the [PRD.md](./PRD.md) and the [Project Board](./PROJECT_BOARD.md) respectively.

## 1. Technology Stack

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
*   **State Management:** Application state is managed primarily through React's built-in hooks (`useState`, `useContext`, `useReducer`). For cross-cutting concerns, custom hooks (`src/hooks`) are used (e.g., `useSessionManager`, `useSpeechRecognition`).
*   **Routing:** Client-side routing is handled by `react-router-dom`.
*   **Logging:** The application uses `pino` for structured logging to improve debuggability and provide more consistent log output. For development, `pino-pretty` is used to format logs in a human-readable way. A shared logger instance is configured in `src/lib/logger.js` and is used throughout the frontend application to replace standard `console.log` statements.

## 3. Backend Architecture

The backend is built entirely on the Supabase platform, leveraging its integrated services.

*   **Database:** A PostgreSQL database managed by Supabase. The schema is defined and managed through migration files located in `supabase/migrations`. The schema includes tables for users, sessions, transcripts, and usage tracking.
*   **Authentication:** Supabase Auth is used for user registration, login, and session management. It supports both email/password and OAuth providers.
*   **Serverless Functions:** Deno-based Edge Functions are used for secure, server-side logic.
    *   `assemblyai-token`: Securely generates temporary tokens for the AssemblyAI transcription service.
    *   `stripe-checkout`: Handles the creation of Stripe checkout sessions.
    *   `stripe-webhook`: Listens for and processes webhooks from Stripe to update user subscription status.
    *   `get-ai-suggestions`: (Future) Intended to provide AI-powered suggestions based on transcript analysis.

## 4. Transcription Service (`src/services/transcription`)

The `TranscriptionService.js` provides a unified abstraction layer over multiple transcription providers. This allows the application to seamlessly switch between modes.

*   **Modes:**
    *   **`CloudAssemblyAI`:** Uses the AssemblyAI v3 streaming API for high-accuracy cloud-based transcription. It communicates with the AssemblyAI service via WebSockets.
    *   **`NativeBrowser`:** Uses the browser's built-in `SpeechRecognition` API for on-device transcription. This is a privacy-focused fallback.
*   **Audio Processing:** The `audioUtils.js` and `audio-processor.worklet.js` are responsible for capturing microphone input, resampling it to the required 16kHz sample rate, and streaming it to the active transcription provider.

## 5. CI/CD

The project includes a basic CI/CD pipeline defined in `.github/workflows/deploy.yml`.

*   **Current Implementation:** The workflow is triggered manually (`workflow_dispatch`) and handles the deployment of Supabase database migrations to a single environment.
*   **Future Work:** The pipeline needs to be expanded to support multiple environments (e.g., `staging`, `production`) and automated deployments based on branch pushes.

## 6. Lessons Learned from Testing

A deep-dive debugging session into the Vitest and Playwright test suites revealed several key insights into the testing environment and application architecture.

1.  **Environment Configuration is Paramount:** The most significant blocker to running tests was a missing `.env` file. The application correctly falls back to a "Configuration Needed" page, but this means any test expecting the full UI will fail. The first step in any test debugging should be to validate the environment.

2.  **`networkidle` is Unreliable for Verification:** Playwright tests waiting for `networkidle` would consistently time out. This was caused by third-party analytics and error-tracking scripts entering aggressive retry loops due to placeholder API keys. A more robust strategy is to wait for `domcontentloaded` and then for specific elements to be visible.

3.  **Vitest Caching is Aggressive:** The test runner's cache can be very persistent, causing it to execute stale versions of test files even when the code on disk has changed. The `--no-cache` flag was not always sufficient. A more effective solution was a "runtime cache-busting" technique, where a component is dynamically imported with a unique query string (`?t=...`) to force a fresh load.

4.  **Mocking Strategy is Key:**
    -   Tests for simple hooks can be effectively mocked using `vi.spyOn` to control global browser APIs.
    -   For more complex components, a robust pattern is to use a mock factory (`createMock...`) that returns a fresh, detailed mock object in a `beforeEach` block.
    -   Using fake timers (`vi.useFakeTimers`) with code that performs real async operations (like `fetch`) will cause tests to hang and should be avoided.

5.  **Isolate Complex Failures:** For tests that hang (like `useSpeechRecognition.test.jsx`), a good diagnostic step is to `.skip` all individual test cases. If the suite still hangs, it proves the issue is in the module-level setup (e.g., `vi.mock` factory functions), not the test logic itself.
