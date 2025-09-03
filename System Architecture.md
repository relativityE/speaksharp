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

## 6. Testing Strategy

This section outlines the official strategy for testing, debugging, and verification. It consolidates learnings from previous debugging sessions and establishes best practices for the project.

### 6.1. Core Issue: Test Environment Memory Leak

The test suite has historically suffered from a catastrophic memory leak that causes `vitest` to crash with "JavaScript heap out of memory" errors.

*   **Root Cause:** The Supabase `onAuthStateChange` listener within `src/contexts/AuthContext.jsx` creates a persistent subscription that is not properly garbage-collected by the `happy-dom` test runner.
*   **Solution:**
    1.  **Prop-Gated `AuthProvider`:** The `AuthProvider` in `src/contexts/AuthContext.tsx` now accepts an `enableSubscription` prop, allowing tests to explicitly disable the leaky listener.
    2.  **`renderWithProviders` Test Helper:** A dedicated test helper at `src/test/renderWithProviders.jsx` automatically renders components with the subscription disabled.
    3.  **Test-Light Supabase Client:** The client at `src/lib/supabaseClient.js` is configured to disable session persistence and auto-refreshing in test environments.
*   **Action:** All new and existing tests for components that consume `AuthContext` must use the `renderWithProviders` helper to prevent the memory leak.

### 6.2. Strategy for Complex Hooks (e.g., `useSpeechRecognition`)

Complex hooks involving real-time browser APIs (e.g., `navigator.mediaDevices`, `WebSocket`) and asynchronous state are not suitable for unit testing in the `happy-dom` environment due to simulation limitations.

The established best practice is as follows:

1.  **Extract Pure Logic:** Any pure, stateless business logic (e.g., filler word counting, data transformation) must be extracted into standalone utility functions in `src/utils` and have 100% unit test coverage.
2.  **Mock the Hook, Test the Component:** Components using a complex hook must be tested by mocking the *hook itself*. This allows for testing the component's rendering and behavior in various states (e.g., loading, error) without running the hook's internal logic.
3.  **Validate via E2E Tests:** The full functionality of the complex hook must be validated through End-to-End (E2E) tests using a real browser environment like Playwright. This is the only reliable method for testing features dependent on real hardware and network interactions.
4.  **Skip Unit Tests for the Hook:** The unit test file for the complex hook itself should contain a single, skipped test with a comment directing developers to the relevant E2E and component integration tests. This prevents the test suite from hanging while documenting the testing strategy.

### 6.3. General Best Practices & Troubleshooting

*   **Environment First:** The most common cause of test failure is a missing or misconfigured `.env` file. The app will render a "Configuration Needed" page, causing tests to fail. Always validate your environment first.
*   **Avoid `networkidle` in E2E Tests:** Third-party analytics and error-tracking scripts can enter aggressive retry loops, preventing the network from ever being truly "idle". In Playwright, prefer `wait_until="domcontentloaded"` and then wait for specific elements to become visible.
*   **Isolate Hanging Tests:** If a test file hangs, use `.skip` on all individual test cases. If it still hangs, the issue is in the module-level setup (e.g., `vi.mock` factory functions), not the test logic.
*   **Mocking:**
    *   Use `vi.spyOn` for simple global API mocks.
    *   Use mock factories (`createMock...`) in a `beforeEach` block for complex components.
    *   Never use fake timers (`vi.useFakeTimers`) with real async operations like `fetch`, as it will cause tests to hang.
