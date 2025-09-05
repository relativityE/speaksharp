**Owner:** [Unassigned]
**Last Reviewed:** 2025-09-05

🔗 [Back to Outline](./OUTLINE.md)

# SpeakSharp System Architecture

**Version 1.1** | **Last Updated: 2025-09-05**

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
|    | - `NativeBrowser` (Cloud Fallback)|                 |                                       |              |
|    | - `LocalWhisper` (Premium, On-Device)|              |                                       |              |
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

*   **Component Model:** The UI is built from a combination of page-level components (`src/pages`), feature-specific components (`src/components/session`, `src/components/landing`), and a reusable UI library (`src/components/ui`). The analytics dashboard features a `FillerWordTable` component for displaying per-session filler word statistics for the 5 most recent sessions. This table includes color-coded severity indicators and tooltips with trend data.
*   **Design System:** The UI components in `src/components/ui` are built using `class-variance-authority` (CVA) for a flexible, type-safe, and maintainable design system. Design tokens are managed in `tailwind.config.ts`.
*   **State Management:** Global state is managed via a combination of React Context and custom hooks, ensuring a clear separation of concerns.
    *   **`AuthContext`:** This is the primary source for authentication state. It provides the Supabase `session` object, the `user` object, and the user's `profile` data (fetched from the `profiles` table). Components that need to know the current user's status, role, or identity consume this context.
    *   **`SessionContext`:** This context manages the collection of a user's practice sessions (`sessionHistory`). It is responsible for fetching the history and providing a function (`addSession`) to update the history in the application state after a new session is saved. This context is consumed by the `AnalyticsPage`.
    *   **`useSessionManager`:** This custom hook encapsulates the logic for saving, deleting, and exporting sessions. It interacts with the `lib/storage.js` module to perform the actual database operations and is used by components like `SessionPage`. After a successful save, it returns the new session object to the calling component, which is then responsible for adding it to the `SessionContext`.
*   **Routing:** Client-side routing is handled by `react-router-dom`.
*   **Logging:** The application uses `pino` for structured logging to improve debuggability and provide more consistent log output. For development, `pino-pretty` is used to format logs in a human-readable way. A shared logger instance is configured in `src/lib/logger.js` and is used throughout the frontend application to replace standard `console.log` statements.

### Memory Leak Prevention
Given the real-time nature of the application, proactive memory management is critical. Components involving continuous data streams (e.g., `useSpeechRecognition`, `TranscriptionService`) must be carefully audited for memory leaks. This includes:
*   **Proper Cleanup:** Ensuring all `useEffect` hooks have proper cleanup functions to unsubscribe from events and clear intervals.
*   **Memory Profiling:** Regularly using tools like the Chrome DevTools Performance and Memory tabs during extended testing sessions (soak tests) to identify and fix potential leaks before they impact users.

## 3. Backend Architecture

The backend is built entirely on the Supabase platform, leveraging its integrated services.

*   **Database:** A PostgreSQL database managed by Supabase. The schema is defined and managed through migration files located in `supabase/migrations`. The schema includes tables for users, sessions, transcripts, and usage tracking.
*   **Authentication:** Supabase Auth is used for user registration, login, and session management. It supports both email/password and OAuth providers.
*   **Serverless Functions:** Deno-based Edge Functions are used for secure, server-side logic.
    *   `assemblyai-token`: Securely generates temporary tokens for the AssemblyAI transcription service.
    *   `stripe-checkout`: Handles the creation of Stripe checkout sessions.
    *   `stripe-webhook`: Listens for and processes webhooks from Stripe to update user subscription status.
    *   `get-ai-suggestions`: (Future) Intended to provide AI-powered suggestions based on transcript analysis.

## 4. User Roles and Tiers

The application defines several user tiers that control access to features and usage limits. For a visual representation of the user journeys, see the [User Role Flows diagram in the PRD](./PRD.md#user-roles-&-flows). The user's tier is determined by their authentication state and their subscription status in Stripe, managed via Supabase.

*   **Anonymous User:**
    *   **Definition:** A user who has not signed in.
    *   **Flow:** Accesses the main landing page, can start a single practice session with a short, fixed duration (e.g., 2 minutes), and can view the analytics for that session. They are prompted to sign in to save history and unlock more features.
    *   **Transcription Mode:** Restricted to `NativeBrowser` only.

*   **Free User (Authenticated):**
    *   **Definition:** A user who has created an account and is logged in but does not have an active Pro subscription.
    *   **Flow:** Can view their session history. They have a limited amount of free practice time per month. When this limit is exhausted, they are prompted by the `UpgradePromptDialog` to upgrade to a Pro plan. Their session duration is also limited (e.g., 30 minutes).

*   **Pro User (Authenticated):**
    *   **Definition:** A user with an active, paid subscription via Stripe.
    *   **Flow:** Has unlimited practice time and no session duration limits. They have access to all current features and will have access to future premium features like on-device transcription.

*   **Premium User:**
    *   **Definition:** A user with an active premium subscription.
    *   **Flow:** Has all features of the Pro tier, plus exclusive access to:
        *   On-device (local) transcription via Transformers.js and Whisper WASM.
        *   Detailed analytics dashboards.
        *   The ability to download session data.

## 5. Transcription Service (`src/services/transcription`)
*(For leadership concerns on scalability and provider strategy, see [REVIEW.md – Engineering perspective](./REVIEW.md)).*

The `TranscriptionService.js` provides a unified abstraction layer over multiple transcription providers. This allows the application to seamlessly switch between modes.

*   **Modes:**
    *   **`CloudAssemblyAI`:** Uses the AssemblyAI v3 streaming API for high-accuracy cloud-based transcription. This is the primary mode for Pro users.
    *   **`NativeBrowser`:** Uses the browser's built-in `SpeechRecognition` API. This is a cloud-based service with average STT accuracy. It is the primary mode for Free users and serves as a fallback for Pro users if `CloudAssemblyAI` is unavailable.
    *   **`LocalWhisper` (Future):** A planned on-device, privacy-first transcription mode for Premium users, using Transformers.js and a Whisper WASM model.
*   **Audio Processing:** The `audioUtils.js` and `audio-processor.worklet.js` are responsible for capturing microphone input, resampling it to the required 16kHz sample rate, and streaming it to the active transcription provider.

## 6. CI/CD

The project includes a basic CI/CD pipeline defined in `.github/workflows/deploy.yml`.

*   **Current Implementation:** The workflow is triggered manually (`workflow_dispatch`) and handles the deployment of Supabase database migrations to a single environment.
*   **Future Work:** The pipeline needs to be expanded to support multiple environments (e.g., `staging`, `production`) and automated deployments based on branch pushes. See the [Roadmap](./ROADMAP.md) for current status.

## 7. Testing Strategy

Our testing strategy balances speed, cost, and confidence by adhering to the testing pyramid and focusing on business value. For the current status of our test coverage and gaps, see the [Software Quality Metrics in the PRD](./PRD.md#5-software-quality-metrics).

### Guiding Principles
*   **The "One Good E2E Test per Role" Model:** We aim for one single, high-value E2E "golden path" test for each user role (Anonymous, Free, Pro). These tests are expensive and should focus on validating the core business flow, not UI details.
*   **Fast, Isolated Component Tests:** We use `Vitest` and `React Testing Library` for fast integration tests of our React components. These tests should verify UI logic and state changes in isolation.
*   **Pure Logic Unit Tests:** Business logic that can be extracted into pure functions (e.g., in `src/utils` or `src/lib`) must be tested with simple, fast unit tests.

### Required Practices
1.  **Use the Unified Test Helper:** All component tests **must** use the `renderWithAllProviders` function from `src/test/test-utils.jsx`. This is a critical requirement to prevent memory leaks from Supabase listeners and to ensure components have access to all required contexts (Auth, Session, Router, etc.).
2.  **Mock Strategically:**
    *   For complex hooks like `useSpeechRecognition`, mock the hook itself to test the component's response to different states (loading, error, etc.). The hook's full functionality will be validated by the E2E test.
    *   Avoid global mocks of libraries like `react-router-dom`. Use the `route` option in the test helper to simulate different URLs and route states.
3.  **Clean Up Mocks:** All test files that use `vi.mock` or `vi.spyOn` should include an `afterEach(() => { vi.restoreAllMocks(); });` block to prevent test pollution.
