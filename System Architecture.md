# System Architecture: SpeakSharp

## 1. Executive Summary

SpeakSharp is a **privacy-first, real-time speech analysis tool** designed as a modern, serverless SaaS web application. Its architecture is strategically aligned with the core product goal: to provide instant, on-device feedback that helps users improve their public speaking skills, while rigorously protecting their privacy.

The system is built for speed, both in user experience and development velocity. It leverages a **React (Vite)** frontend for a highly interactive UI and **Supabase** as an all-in-one backend for data, authentication, and user management. The speech recognition engine is designed with a **two-phase, hybrid approach**, starting with a cloud-based service for rapid development and transitioning to a fully on-device model to fulfill the privacy-first promise.

## 2. System Architecture & Technology Stack

The architecture is designed around a modern, client-heavy Jamstack approach. The frontend is a sophisticated single-page application that handles most of the business logic, including the transcription via a flexible `TranscriptionService` wrapper. This service can toggle between a cloud provider (AssemblyAI) and a local, in-browser engine (using **Transformers.js**), providing a seamless path from a rapid MVP to a privacy-focused production system.

### High-Level Overview
```text
+---------------------------------+      +---------------------------------+
|      React SPA (`src`)          |----->|      Development & Build        |
|    (in User's Browser)          |      |        (Vite, Vitest)           |
|                                 |      +---------------------------------+
|  +---------------------------+  |
|  |  TranscriptionService     |  |
|  | (Event-Driven via        |  |
|  |  onTranscriptUpdate)      |  |
|  |---------------------------|  |
|  | if (mode === 'local') {   |  |
|  |   Transformers.js (WASM)  |  |
|  | } else {                  |  |
|  |   AssemblyAI (via Token)  |  |
|  | }                         |  |
|  +---------------------------+  |
+---------------------------------+
             |
             | API Calls, Analytics, Error Reporting
             |
             v
+-------------------------------------------------------------------+
|                    Backend Services (Managed)                     |
|                                                                   |
| +------------+  +----------+  +----------+  +-----------+         |
| |  Supabase  |  |  Stripe  |  |  Sentry  |  |  PostHog  |         |
| | - DB/Auth  |  |          |  |          |  |           |         |
| |- Functions |  |          |  |          |  |           |         |
| +------------+  +----------+  +----------+  +-----------+         |
+-------------------------------------------------------------------+
```

### Detailed User Flow Diagram

This diagram offers a more detailed look at the application's architecture from a user flow perspective, showing the specific paths and API calls for all three user tiers.

```text
                          +---------------------------------------------+
                          |              User's Browser                 |
                          |                                             |
+-------------------------+---------------------------------------------+
|                         |                                             |
| +-----------------------v----------------+  +---------------------------------+ |
| |      React SPA (Vite, `src`)           |  |      TranscriptionService       | |
| |                                        |  |  (Provides onTranscriptUpdate)  | |
| |  - `SessionPage.jsx`                   |  |---------------------------------| |
| |  - `SessionSidebar.jsx`                |<--+ if (user.isPro) {             | |
| |  - `useSpeechRecognition.js`           |  |   CloudAssemblyAI (via Token)   | |
|    (Initializes service on-demand)     |  | } else {                        | |
| |  - `useSessionManager.js`              |  |   LocalWhisper (On-Device)    | |
| +----------------------------------------+  | }                               | |
|                                          |  +---------------------------------+ |
|                                          |                                    |
+------------------------------------------+------------------------------------+
                          |
+-------------------------+-------------------------+---------------------------+
|    ANONYMOUS USER       |        FREE USER        |         PRO USER          |
| (No Auth, Temp Storage) |  (Auth, Usage Limit)    |   (Auth, No Limit)        |
+-------------------------+-------------------------+---------------------------+
             |                         |                         |
+------------v-----------+ +-----------v-------------+ +-----------v-------------+
| Save Session (Temp)    | | Save Session (Metadata) | | Save Session (Metadata) |
| `sessionStorage.set()` | | `supabase.insert()`     | | `supabase.insert()`     |
+------------------------+ +-------------------------+ +-------------------------+
                                     |
                         +-----------v-------------+
                         | Update & Enforce Limit  |
                         | `supabase.rpc()`        |
                         +-------------------------+
                                                               |
                                                    (One-time Upgrade Process)
                                                               |
             +-------------------------------------------------v-----------------------------------------------+
             |                                                                                               |
             |  1. User clicks "Upgrade" -> `supabase.functions.invoke('stripe-checkout')`                     |
             |       |                                                                                       |
             |       +--> Creates Stripe Checkout Session, redirects User to Stripe                          |
             |                                                                                               |
             |  2. User completes payment on Stripe -> Stripe sends webhook event                             |
             |       |                                                                                       |
             |       +--> `supabase.functions.invoke('stripe-webhook')` is triggered                         |
             |            |                                                                                  |
             |            +--> Verifies event, updates `user_profiles.subscription_status` to 'pro'          |
             |                                                                                               |
             +-----------------------------------------------------------------------------------------------+
```

## 6. Test Approach

Our project employs a robust and stable testing strategy centered on **Vitest**, a modern test runner that integrates seamlessly with Vite.

### Unit & Integration Testing: **Vitest + happy-dom**

This is the primary testing stack for the application. It provides a fast and reliable way to test components and logic.

*   **Vite**: Acts as the core build and test orchestration engine.
*   **Vitest**: The designated **test runner**. `pnpm test` is configured to execute all `*.test.jsx` files located in `src/__tests__`.
*   **happy-dom**: A lightweight, simulated browser environment for tests that need to interact with a DOM.
*   **Mocking**: The test environment is configured with advanced mocking to handle complex dependencies like `@xenova/transformers` and prevent memory leaks. The key to solving the memory issue was to control the module import order in the test file (`useSpeechRecognition.test.jsx`):
    1.  **Mocks are established first:** `vi.mock()` is called at the top level of the test file, before any imports. This tells Vitest to replace the real modules with our mocks.
    2.  **The hook is imported dynamically:** The `useSpeechRecognition` hook is imported using a top-level `await import(...)` *after* the mocks are defined.
    3.  **Result:** When the hook is imported, it receives the mocked versions of its dependencies instead of the real ones. This prevents the large machine learning models from being loaded into memory during the test run and keeps the memory footprint low.

### End-to-End Testing: **Playwright**

For features that rely heavily on browser-native APIs (like the `TranscriptionService`'s audio processing), we use **Playwright**. These tests run in a real browser environment, providing a higher level of confidence for critical user flows.

### Summary of Tools

| Tool          | Role                               | When It's Used                                      |
| :------------ | :--------------------------------- | :-------------------------------------------------- |
| **Vite**      | Core build & test engine.          | Used by `pnpm run dev` and `pnpm test`.             |
| **Vitest**    | Main test runner.                  | `pnpm test`                                         |
| **happy-dom** | Simulated browser for Vitest.      | The environment for all Vitest tests.               |
| **Playwright**| Secondary, end-to-end test runner. | For high-level smoke tests (`npx playwright test`). |

This hybrid approach provides a fast, reliable, and comprehensive testing strategy for the project.
```


### Technology Stack Breakdown

```text
┌──────────────────┬────────────────────────────┬──────────────────────────────────────────────────────────────────────┬────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Technology       │ Purpose                    │ Implementation Location(s) & Notes                                   │ Keys & Usage                                                                                     │
├──────────────────┼────────────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│ React            │ Frontend UI Library        │ The core of the application. Used to build all components & pages.   │ N/A                                                                                              │
│                  │                            │ • `src/`: Entire frontend application source.                      │                                                                                                │
│                  │                            │ • `react-router-dom`: Handles all client-side routing.             │                                                                                                │
├──────────────────┼────────────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Vite             │ Build Tool & Dev Server    │ Provides a fast dev experience and bundles the app for production.   │ N/A                                                                                              │
│                  │                            │ • `vite.config.mjs`: Main configuration file for Vite and Vitest.  │                                                                                                │
├──────────────────┼────────────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Supabase         │ Backend-as-a-Service       │ Provides DB, auth, & APIs, reducing backend work for the MVP.        │ • `VITE_SUPABASE_URL`: Public URL for the project.                                               │
│                  │                            │ • `src/lib/supabaseClient.js`: Client initialization.              │ • `VITE_SUPABASE_ANON_KEY`: Public key for client-side access.                                   │
│                  │                            │ • `supabase/functions`: Location of serverless edge functions.       │ • `SUPABASE_SERVICE_ROLE_KEY`: Secret key for admin access in functions.                         │
├──────────────────┼────────────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Transcription    │ Core Feature               │ A swappable service for speech-to-text. Uses an event-driven         │ • `ASSEMBLYAI_API_KEY`: Secret key for server-side token generation.                             │
│ Service          │                            │ approach via an `onTranscriptUpdate` callback to provide real-time   │   (Set in Supabase project secrets)                                                          │
│                  │                            │ results to the UI without polling.                                   │                                                                                                │
│                  │                            │ • `src/services/transcription`: Wrapper for STT providers.         │                                                                                                │
│                  │                            │ • `modes/LocalWhisper.js`: On-device via **Transformers.js**.        │                                                                                                │
│                  │                            │ • `modes/CloudAssemblyAI.js`: Premium cloud-based mode.              │                                                                                                │
├──────────────────┼────────────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Styling          │ CSS & Component Toolkit    │ Used for all styling, enabling rapid UI development.                 │ N/A                                                                                              │
│                  │                            │ • `Tailwind CSS`: Utility-first CSS framework.                     │                                                                                                │
│                  │                            │ • `shadcn/ui`: Re-usable components built on Radix UI.               │                                                                                                │
├──────────────────┼────────────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Analytics        │ Usage & Perf. Monitoring   │ Captures errors, analytics, and performance data.                    │                                                                                                │
│                  │                            │ • `Sentry`: Captures runtime errors.                               │ • `VITE_SENTRY_DSN`                                                                            │
│                  │                            │ • `PostHog`: Tracks user behavior and product analytics.           │ • `VITE_POSTHOG_KEY`                                                                           │
│                  │                            │ • `Recharts`: Renders charts for the analytics dashboard.            │                                                                                                │
├──────────────────┼────────────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Stripe           │ Payments                   │ Handles all subscription payments for the "Pro" tier.                │ • `VITE_STRIPE_PUBLISHABLE_KEY`: Public key for Stripe.js on the client.                         │
│                  │                            │ • `supabase/functions/stripe-checkout`: Creates checkout sessions.   │ • `STRIPE_SECRET_KEY`: Secret key for server-side API calls in functions.                        │
│                  │                            │ • `supabase/functions/stripe-webhook`: Handles payment events.       │ • `STRIPE_WEBHOOK_SECRET`: Secret to verify webhooks are from Stripe.                            │
└──────────────────┴────────────────────────────┴──────────────────────────────────────────────────────────────────────┴────────────────────────────────────────────────────────────────────────────────────────────────┘

## 3. Alignment with PRD Goals

The entire system architecture is a direct reflection of the goals outlined in the **SpeakSharp PRD**.

*   **Goal: "Privacy-First, Real-Time Analysis"**:
    *   **Architecture**: The `TranscriptionService` wrapper is the cornerstone of the privacy strategy. It allows for a fast MVP using a cloud service (AssemblyAI) while providing a clear path to a fully on-device solution (**Transformers.js**) for the production release. This two-phase approach balances speed with the long-term privacy promise.

*   **Goal: "Rapid MVP Launch" (3-Week Target)**:
    *   **Architecture**: The technology choices are optimized for development speed to meet the aggressive **3-week MVP timeline** defined in the PRD.
        *   **React + Vite + shadcn/ui**: Allows for rapid development of a modern, interactive frontend.
        *   **Supabase**: Provides a complete backend out-of-the-box, saving weeks of development time on building auth, user management, and a database API from scratch.
        *   **AssemblyAI Integration**: Using a managed cloud service for transcription in Phase 1 allows the team to focus on core application features rather than on building and managing a local STT engine.

*   **Goal: "Scalable Freemium Model"**:
    *   **Architecture**: The client-heavy architecture for free users is infinitely scalable at near-zero cost. The system is already designed to integrate with a serverless function for a "High-accuracy cloud transcription" feature for Pro users, demonstrating a clear and cost-effective path to scaling premium features. The database schema includes fields for `subscription_status` and `usage_seconds`, directly enabling the tiered pricing model.

In summary, the architecture is not just a technical blueprint; it is a well-considered plan to efficiently build, launch, and scale the exact product envisioned in the PRD.

## 5. User Flows & API Usage

This section details the step-by-step execution flow for both free and paid users, clarifying which APIs are used and what data is stored.

### Free User Flow

The free tier is designed to build a habit around practice and reinforce our privacy-first value proposition.

1.  **Authentication**: A user with a `subscription_status` of `'free'` logs in.
2.  **Speech Recognition (Local-Only)**: When the user starts a session, the `useSpeechRecognition.js` hook is activated. For Free users, this **defaults to and is locked to the local on-device mode** using **Transformers.js**. This ensures the core promise of privacy is met for all free users.
3.  **Session Completion**: The user manually stops the session.
4.  **Data Persistence (Metadata Only)**: The `useSessionManager.js` and `lib/storage.js` modules collaborate to save the session.
    *   **API Hit**: An `insert` call is made to the Supabase `sessions` table.
    *   **Data Stored**: Only session metadata is persisted (e.g., `duration`, `total_words`, `filler_words` JSON). The full transcript is discarded and **not** sent to the database, reinforcing privacy.
5.  **Usage Tracking & Enforcement**: After a successful save, an RPC (Remote Procedure Call) is made to a Supabase function.
    *   **API Hit**: `supabase.rpc('update_user_usage', ...)` is called.
    *   **Action**: This secure backend function checks if the user is over their monthly limit. If they are not, it adds the `session_duration_seconds` to their total. If they are over the limit, it returns `false`, and the frontend displays a notification. This prevents any further usage until the next month or an upgrade.

**Key Files & Components**: `SessionPage.jsx`, `SessionSidebar.jsx`, `useSpeechRecognition.js`, `useSessionManager.js`, `lib/storage.js`, `lib/supabaseClient.js`, `services/transcription/TranscriptionService.js`.

### Paid (Pro) User Flow

The Pro tier removes limitations and adds premium features, including higher-accuracy transcription.

1.  **Authentication**: A user with a `subscription_status` of `'pro'` or `'premium'` logs in.
2.  **Unrestricted Usage**: Pro-specific features, like unlimited custom words and full analytics history, are enabled in the UI.
3.  **Speech Recognition (User's Choice)**: Pro users have the choice between the standard `local` mode and the premium `cloud` mode (using AssemblyAI) for higher accuracy.
4.  **Session Completion & Persistence**: This is identical to the free user flow. Session metadata (not the transcript) is saved to the `sessions` table. The `update_user_usage` RPC function is **not** called, as it is unnecessary for Pro users.

**Key Files & Components**: The same as the free flow, with conditional logic in `SessionSidebar.jsx` unlocking the Pro features.

### Upgrade Flow (Free to Pro)

This flow involves coordination between the React app, Supabase Edge Functions, and the Stripe API.

1.  **Initiate Checkout**: The user clicks the "Upgrade" button in the `SessionSidebar.jsx` component.
    *   **API Hit**: `supabase.functions.invoke('stripe-checkout')` is called.
2.  **Stripe Function**: This Supabase Edge Function (running on Deno) uses a secret key to securely communicate with the Stripe API, creating a new Checkout Session. It returns the session ID to the client.
3.  **Redirect to Stripe**: The frontend uses the received session ID to redirect the user to Stripe's hosted payment page.
4.  **Stripe Webhook**: After a successful payment, Stripe sends a `checkout.session.completed` event to a predefined webhook endpoint.
    *   **API Hit**: The `stripe-webhook` Supabase Edge Function is triggered.
5.  **Confirm Subscription**: This second function verifies the webhook's signature to ensure it's a legitimate request from Stripe. It then uses a Supabase service role key to update the user's record in the `user_profiles` table, setting their `subscription_status` to `'pro'`.
