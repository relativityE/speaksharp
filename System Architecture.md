# System Architecture: SpeakSharp

## 1. Executive Summary

SpeakSharp is a **privacy-first, real-time speech analysis tool** designed as a modern, serverless SaaS web application. Its architecture is strategically aligned with the core product goal: to provide instant, on-device feedback that helps users improve their public speaking skills, while rigorously protecting their privacy.

The system is built for speed, both in user experience and development velocity. It leverages a **React (Vite)** frontend for a highly interactive UI and **Supabase** as an all-in-one backend for data, authentication, and user management. The speech recognition engine is designed with a **two-phase, hybrid approach**, starting with a cloud-based service for rapid development and transitioning to a fully on-device model to fulfill the privacy-first promise.

## 2. System Architecture & Technology Stack

The architecture is designed around a modern, client-heavy Jamstack approach. The frontend is a sophisticated single-page application that handles most of the business logic, including the transcription via a flexible `TranscriptionService` wrapper. This service can toggle between a cloud provider (AssemblyAI) and a local, in-browser engine (Whisper.cpp), providing a seamless path from a rapid MVP to a privacy-focused production system.

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
|  |   Whisper.cpp (WASM)      |  |
|  | } else if (mode === 'cloud') { |  |
|  |   AssemblyAI (via Token)  |  |
|  | } else { // native fallback |  |
|  |   NativeBrowserSpeechRecognition |  |
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

This diagram offers a more detailed look at the application's architecture from a user flow perspective, showing the specific paths and API calls for different user tiers.

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
| |  - `SessionSidebar.jsx`                |<--+ if (mode === 'local') {         | |
| |  - `useSpeechRecognition.js`           |  |   LocalWhisper (On-Device)    | |
| |    (Provides callback)                 |  | } else if (mode === 'cloud') {  | |
| |  - `useSessionManager.js`              |  |   CloudAssemblyAI (via Supabase token fn) | |
| +----------------------------------------+  | } else { // native fallback   | |
|                                          |  |   NativeBrowser               | |
|                                          |  | }                               | |
|                                          |  +---------------------------------+ |
|                                          |                                    |
+------------------------------------------+------------------------------------+
                          |
+-------------------------+---------------------------------------------+
|       FREE USER         |                PRO USER                     |
| (Usage Limit Enforced)  |         (No Usage Limit, Pro Features)      |
+-------------------------+---------------------------------------------+
             |                                       |
             |                                       |
+------------v--------------------------+ +-----------v---------------------------+
| Save Session (Metadata Only)          | | Save Session (Metadata Only)          |
| `supabase.from('sessions').insert()`  | | `supabase.from('sessions').insert()`  |
+---------------------------------------+ +---------------------------------------+
             |                                       |
+------------v--------------------------+ +-----------v---------------------------+
| Update & Enforce Usage Limit          | | (No Usage Update Call)                |
| `supabase.rpc('update_user_usage')`   | |                                       |
+---------------------------------------+ +---------------------------------------+
                                                     |
                                          (One-time Upgrade Process)
                                                     |
             +---------------------------------------v---------------------------------------+
             |                                                                               |
             |  1. `supabase.functions.invoke('stripe-checkout')`                            |
             |       |                                                                       |
             |       +--> Creates Stripe Checkout Session, redirects User to Stripe          |
             |                                                                               |
             |  2. User completes payment on Stripe                                          |
             |       |                                                                       |
             |       +--> Stripe sends webhook event                                         |
             |                                                                               |
             |  3. `supabase.functions.invoke('stripe-webhook')`                             |
             |       |                                                                       |
             |       +--> Verifies event, updates `user_profiles.subscription_status` to 'pro'|
             |                                                                               |
             +-------------------------------------------------------------------------------+
```


### Technology Stack Breakdown

```text
┌──────────────────┬────────────────────────────┬──────────────────────────────────────────────────────────────────────┬────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Technology       │ Purpose                    │ Implementation Location(s) & Notes                                   │ Keys & Usage                                                                                     │
├──────────────────┼────────────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│ React            │ Frontend UI Library        │ The core of the application. Used to build all components & pages.   │ N/A                                                                                              │
│                  │                            │ • `src/`: Entire frontend application source.                      │                                                                                                │
├──────────────────┼────────────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Vite             │ Build Tool & Dev Server    │ Provides a fast dev experience and bundles the app for production.   │ N/A                                                                                              │
│                  │                            │ • `vite.config.js`: Main configuration file.                       │                                                                                                │
├──────────────────┼────────────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Supabase         │ Backend-as-a-Service       │ Provides DB, auth, & APIs, reducing backend work for the MVP.        │ • `VITE_SUPABASE_URL`: Public URL for the project.                                               │
│                  │                            │ • `src/lib/supabaseClient.js`: Client initialization.              │ • `VITE_SUPABASE_ANON_KEY`: Public key for client-side access.                                   │
│                  │                            │ • `supabase/functions`: Location of serverless edge functions.       │ • `SUPABASE_SERVICE_ROLE_KEY`: Secret key for admin access in functions.                         │
├──────────────────┼────────────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Transcription    │ Core Feature               │ A swappable service for speech-to-text. Uses an event-driven         │ • `ASSEMBLYAI_API_KEY`: Secret key for server-side token generation.                             │
│ Service          │                            │ approach via an `onTranscriptUpdate` callback to provide real-time   │   (Set in Supabase project secrets)                                                          │
│                  │                            │ results to the UI without polling.                                   │                                                                                                │
│                  │                            │ • `src/services/transcription`: Wrapper for STT providers.         │                                                                                                │
│                  │                            │ • `modes/LocalWhisper.js`: On-device (planned).                    │                                                                                                │
│                  │                            │ • `modes/CloudAssemblyAI.js`: Cloud-based, uses temporary tokens for │                                                                                                │
│                  │                            │   secure, browser-based authentication via a Supabase function.      │                                                                                                │
│                  │                            │ • `modes/NativeBrowser.js`: Fallback using the browser's native API. │                                                                                                │
├──────────────────┼────────────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Tailwind CSS     │ Utility-First CSS          │ Used for all styling, enabling rapid UI development.                 │ N/A                                                                                              │
│                  │                            │ • `tailwind.config.cjs`: Configures the theme and font sizes.      │                                                                                                │
│                  │                            │ • `src/index.css`: Defines global styles and HSL color variables.  │                                                                                                │
├──────────────────┼────────────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Sentry           │ Error Monitoring           │ Captures runtime errors and performance data to ensure a stable MVP. │ • `VITE_SENTRY_DSN`: Public key for sending error data to Sentry.                                │
│                  │                            │ • `src/main.jsx`: Sentry is initialized and wraps the App.         │                                                                                                │
├──────────────────┼────────────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│ PostHog          │ Product Analytics          │ Tracks user behavior & funnels to support "Primary Success Metrics". │ • `VITE_POSTHOG_KEY`: Public key for sending event data to PostHog.                                │
│                  │                            │ • `src/lib/posthog.js`: PostHog is initialized.                    │ • `VITE_POSTHOG_HOST`: The URL of the PostHog instance.                                            │
├──────────────────┼────────────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Stripe           │ Payments                   │ Handles all subscription payments for the "Pro" tier.                │ • `VITE_STRIPE_PUBLISHABLE_KEY`: Public key for Stripe.js on the client.                         │
│                  │                            │ • `supabase/functions/stripe-checkout`: Creates checkout sessions.   │ • `STRIPE_SECRET_KEY`: Secret key for server-side API calls in functions.                        │
│                  │                            │ • `supabase/functions/stripe-webhook`: Handles payment events.       │ • `STRIPE_WEBHOOK_SECRET`: Secret to verify webhooks are from Stripe.                            │
└──────────────────┴────────────────────────────┴──────────────────────────────────────────────────────────────────────┴────────────────────────────────────────────────────────────────────────────────────────────────┘

## 3. The Test Environment and Suite

The testing strategy is designed for rapid feedback and reliability, directly supporting the goal of launching a stable MVP quickly.

*   **Framework**: The project uses **Vitest**, a modern test runner built on top of Vite. This choice is strategic: it shares the same configuration as the development server, making it exceptionally fast and simple to maintain. This speed is critical for a fast-paced MVP development cycle.
*   **Test Organization**: Tests are co-located with the code they validate (e.g., `src/__tests__`, `src/components/__tests__`), making them easy to find and run. They focus on testing individual components and hooks.
*   **Mocking (`src/test/setup.js`)**: For the Vitest suite, a key part of the strategy is the robust mocking of browser-only APIs like `MediaRecorder` and dependencies of the `TranscriptionService`. This allows the core application logic to be tested quickly in a simulated `jsdom` environment.
*   **Playwright for Real Browser Testing**: For features that are inherently difficult to mock or require a true browser environment (like the `TranscriptionService`'s audio processing), the project uses **Playwright**. This secondary test suite runs in a real browser, providing a higher level of confidence for critical, browser-dependent features. This hybrid approach balances the speed of JSDOM with the accuracy of a real browser.
*   **Rationale vs. Alternatives**:
    *   **vs. Jest**: Vitest is faster and requires less configuration in a Vite project.
    *   **vs. Cypress/Playwright for everything**: While Playwright is used, relying on it for all tests would be too slow for rapid development. The hybrid approach provides the best of both worlds.

## 4. Alignment with PRD Goals

The entire system architecture is a direct reflection of the goals outlined in the **SpeakSharp PRD**.

*   **Goal: "Privacy-First, Real-Time Analysis"**:
    *   **Architecture**: The `TranscriptionService` wrapper is the cornerstone of the privacy strategy. It allows for a fast MVP using a cloud service (AssemblyAI) while providing a clear, low-effort path to a fully on-device solution (Whisper.cpp) for the production release. This two-phase approach balances speed with the long-term privacy promise.

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

The free tier is designed to be flexible, allowing users to choose between privacy-focused local processing and higher-accuracy cloud processing.

1.  **Authentication**: A user with a `subscription_status` of `'free'` logs in.
2.  **Speech Recognition (User's Choice)**: When the user starts a session, the `useSpeechRecognition.js` hook is activated, which in turn uses the `TranscriptionService`. The user can toggle between 'local' and 'cloud' modes. If both of these modes fail to initialize, the service will automatically fall back to using the browser's native SpeechRecognition API, and the user will be notified.
3.  **Session Completion**: The user manually stops the session.
4.  **Data Persistence (Metadata Only)**: The `useSessionManager.js` and `lib/storage.js` modules collaborate to save the session.
    *   **API Hit**: An `insert` call is made to the Supabase `sessions` table.
    *   **Data Stored**: Only session metadata is persisted (e.g., `duration`, `total_words`, `filler_words` JSON). The full transcript is discarded and **not** sent to the database, reinforcing privacy.
5.  **Usage Tracking & Enforcement**: After a successful save, an RPC (Remote Procedure Call) is made to a Supabase function.
    *   **API Hit**: `supabase.rpc('update_user_usage', ...)` is called.
    *   **Action**: This secure backend function checks if the user is over their monthly limit. If they are not, it adds the `session_duration_seconds` to their total. If they are over the limit, it returns `false`, and the frontend displays a notification. This prevents any further usage until the next month or an upgrade.

**Key Files & Components**: `SessionPage.jsx`, `SessionSidebar.jsx`, `useSpeechRecognition.js`, `useSessionManager.js`, `lib/storage.js`, `lib/supabaseClient.js`, `services/transcription/TranscriptionService.js`.

### Paid (Pro) User Flow

The Pro tier removes limitations and adds features.

1.  **Authentication**: A user with a `subscription_status` of `'pro'` or `'premium'` logs in.
2.  **Unrestricted Usage**: Pro-specific features, like the "Custom Words" tracker, are enabled in the UI. There are no usage limits.
3.  **Speech Recognition (User's Choice)**: The process is **identical to the free user flow**.
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
