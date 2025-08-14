# System Architecture: SpeakSharp

## 1. Executive Summary

SpeakSharp is a **privacy-first, real-time speech analysis tool** designed as a modern, serverless SaaS web application. Its architecture is strategically aligned with the core product goal: to provide instant, on-device feedback that helps users improve their public speaking skills, while rigorously protecting their privacy.

The system is built for speed, both in user experience and development velocity. It leverages a **React (Vite)** frontend for a highly interactive UI and **Supabase** as an all-in-one backend for data, authentication, and user management. This stack was chosen to rapidly deliver a feature-rich MVP, focusing on the core value proposition of real-time, private speech analysis.

## 2. System Architecture & Technology Stack

The architecture is designed around a modern, client-heavy Jamstack approach, directly supporting the PRD's stated competitive edge of **"speed + privacy"**. The frontend is a sophisticated single-page application that handles most of the business logic, communicating with a managed backend service for data persistence and authentication. This minimizes server-side complexity and accelerates development.

### High-Level Overview

The following diagram provides a simplified, high-level overview of the major technology components and their general relationships.

```text
+--------------------------+      +---------------------------------+
|      React SPA (`src`)   |----->|      Development & Build        |
|    (in User's Browser)   |      |        (Vite, Vitest)           |
+--------------------------+      +---------------------------------+
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
| +-----------------------v----------------+  +-----------------------+ |
| |      React SPA (Vite, `src`)           |  | Browser Web Speech API| |
| |                                        |  | (On-Device STT)       | |
| |  - `SessionPage.jsx`                   |<-+ (Privacy: No audio  | |
| |  - `SessionSidebar.jsx`                |  |      leaves device)   | |
| |  - `useSpeechRecognition.js`           |  +-----------------------+ |
| |  - `useSessionManager.js`              |                            |
| +----------------------------------------+                            |
|                         |                                             |
+-------------------------+---------------------------------------------+
                          |
+-------------------------+---------------------------------------------+
|       FREE USER         |                PRO USER                     |
| (Usage Limit Enforced)  |  (No Usage Limit, Pro Features, Cloud STT)  |
+-------------------------+---------------------------------------------+
             |                                       |
             |                                       +----------------------------------+
             |                                       |                                  |
             |                                       |  IF "High-Accuracy Mode" ON:     |
             |                                       |  1. Record Audio in Browser      |
             |                                       |  2. `supabase.functions.invoke`  |
             |                                       |     ('cloud-transcribe')         |
             |                                       |           |                      |
             |                                       |           v                      |
             |                                       |  +------------------+            |
             |                                       |  | Supabase Edge Fn |-+          |
             |                                       |  +------------------+ |          |
             |                                       +-----------------------+          |
             |                                                         |                |
             |                                                         v                |
             |                                                +--------------------+    |
             |                                                | Google Cloud STT |    |
             |                                                +--------------------+    |
             |                                                                          |
+------------v--------------------------+ +-----------v------------------------------------------------+
| Save Session (Metadata Only)          | | Save Session (Browser & Cloud Transcripts)                   |
| `supabase.from('sessions').insert()`  | | `supabase.from('sessions').insert()`                         |
+---------------------------------------+ +----------------------------------------------------------------+
             |                                       |
+------------v--------------------------+ +-----------v---------------------------+
| Update Usage                          | | Update Usage                          |
| `supabase.rpc('update_user_usage')`   | | `supabase.rpc('update_user_usage')`   |
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

┌──────────────────┬────────────────────────────┬──────────────────────────────────────────────────────────────────────┐
│ Technology       │ Purpose                    │ Implementation Location(s) & Notes                                   │
├──────────────────┼────────────────────────────┼──────────────────────────────────────────────────────────────────────┤
│ shadcn/ui        │ UI Component Library       │ Provides pre-built, accessible, and composable React components.     │
│                  │                            │ • `src/components/ui/`: Location of all `shadcn` components.       │
│                  │                            │ • Key components like `Header.jsx` and `SessionSidebar.jsx` use    │
│                  │                            │   `Sheet` for mobile menus and `Tooltip` for enhanced UX.          │
├──────────────────┼────────────────────────────┼──────────────────────────────────────────────────────────────────────┤
│ Vitest           │ Test Runner                │ Used for all unit and integration testing. Chosen for speed and      │
│                  │                            │ seamless integration with Vite.                                      │
│                  │                            │ • `vitest.config.js`: Test environment configuration.              │
│                  │                            │ • `src/__tests__/`: Location of test files.                        │
├──────────────────┼────────────────────────────┼──────────────────────────────────────────────────────────────────────┤
│ Web Speech API   │ Core Feature               │ Browser API for on-device, real-time speech-to-text. This is         │
│                  │                            │ the heart of the privacy-first approach.                             │
│                  │                            │ • `src/hooks/useSpeechRecognition.js`: Encapsulates API interaction. │
├──────────────────┼────────────────────────────┼──────────────────────────────────────────────────────────────────────┤
│ React Router     │ Client-Side Routing        │ Manages navigation between pages in the SPA.                         │
│                  │                            │ • `src/App.jsx`: Route definitions.                                │
│                  │                            │ • `src/main.jsx`: `BrowserRouter` setup.                           │
└──────────────────┴────────────────────────────┴──────────────────────────────────────────────────────────────────────┘
```

## 3. The Test Environment and Suite

The testing strategy is designed for rapid feedback and reliability, directly supporting the goal of launching a stable MVP quickly.

*   **Framework**: The project uses **Vitest**, a modern test runner built on top of Vite. This choice is strategic: it shares the same configuration as the development server, making it exceptionally fast and simple to maintain. This speed is critical for a fast-paced MVP development cycle.
*   **Test Organization**: Tests are co-located with the code they validate (e.g., `src/__tests__`, `src/components/__tests__`), making them easy to find and run. They focus on testing individual components and hooks.
*   **Mocking (`src/test/setup.js`)**: For the Vitest suite, a key part of the strategy is the robust mocking of browser-only APIs like `MediaRecorder` and `SpeechRecognition`. This allows the core application logic to be tested quickly in a simulated `jsdom` environment.
*   **Playwright for Real Browser Testing**: For features that are inherently difficult to mock or require a true browser environment (like the Web Speech API), the project uses **Playwright**. This secondary test suite runs in a real browser, providing a higher level of confidence for critical, browser-dependent features. This hybrid approach balances the speed of JSDOM with the accuracy of a real browser.
*   **Rationale vs. Alternatives**:
    *   **vs. Jest**: Vitest is faster and requires less configuration in a Vite project.
    *   **vs. Cypress/Playwright for everything**: While Playwright is used, relying on it for all tests would be too slow for rapid development. The hybrid approach provides the best of both worlds.

## 4. Alignment with PRD Goals

The entire system architecture is a direct reflection of the goals outlined in the **SpeakSharp PRD**.

*   **Goal: "Privacy-First, Real-Time Analysis"**:
    *   **Architecture**: The decision to use the browser's **Web Speech API** and perform all analysis on the client-side is the cornerstone of the privacy promise. The architecture ensures that raw audio never leaves the user's device for free-tier users.

*   **Goal: "Rapid MVP Launch" (3-Week Target)**:
    *   **Architecture**: The technology choices are optimized for development speed to meet the aggressive **3-week MVP timeline** defined in the PRD.
        *   **React + Vite + shadcn/ui**: Allows for rapid development of a modern, interactive frontend.
        *   **Supabase**: Provides a complete backend out-of-the-box, saving weeks of development time on building auth, user management, and a database API from scratch.
        *   **Vitest**: Enables a fast, reliable testing workflow, allowing developers to iterate with confidence.

*   **Goal: "Scalable Freemium Model"**:
    *   **Architecture**: The client-heavy architecture for free users is infinitely scalable at near-zero cost. The system is already designed to integrate with a serverless function for a "High-accuracy cloud transcription" feature for Pro users, demonstrating a clear and cost-effective path to scaling premium features. The database schema includes fields for `subscription_status` and `usage_seconds`, directly enabling the tiered pricing model.

In summary, the architecture is not just a technical blueprint; it is a well-considered plan to efficiently build, launch, and scale the exact product envisioned in the PRD.

## 5. User Flows & API Usage

This section details the step-by-step execution flow for both free and paid users, clarifying which APIs are used and what data is stored.

### Free User Flow

The free tier is designed to be privacy-first and low-cost, with all core speech analysis happening on the user's device.

1.  **Authentication & Limits**: A user with a `subscription_status` of `'free'` logs in. The frontend, specifically the `SessionSidebar.jsx` component, checks their `usage_seconds` against the `FREE_TIER_LIMIT_SECONDS` (currently 5 minutes). If the limit is exceeded, the recording functionality is disabled.
2.  **Speech Recognition (Client-Side)**: When the user starts a session, the `useSpeechRecognition.js` hook is activated. It exclusively uses the **browser's built-in Web Speech API** for speech-to-text conversion.
    *   **Privacy Guarantee**: All transcription and real-time analysis (e.g., filler word counting) occurs locally in the browser. Raw audio and full transcripts **never** leave the user's device.
3.  **Session Completion**: The user manually stops the session or hits the free-tier time limit.
4.  **Data Persistence (Metadata Only)**: The `useSessionManager.js` and `lib/storage.js` modules collaborate to save the session.
    *   **API Hit**: An `insert` call is made to the Supabase `sessions` table.
    *   **Data Stored**: Only session metadata is persisted (e.g., `duration`, `total_words`, `filler_words` JSON). The full transcript is discarded and **not** sent to the database, reinforcing privacy.
5.  **Usage Tracking**: After a successful save, an RPC (Remote Procedure Call) is made to a Supabase function.
    *   **API Hit**: `supabase.rpc('update_user_usage', ...)` is called.
    *   **Action**: This secure function adds the `session_duration_seconds` to the user's monthly total in the `user_profiles` table.

**Key Files & Components**: `SessionPage.jsx`, `SessionSidebar.jsx`, `useSpeechRecognition.js`, `useSessionManager.js`, `lib/storage.js`, `lib/supabaseClient.js`.

### Paid (Pro) User Flow

The Pro tier enhances the experience with higher accuracy transcription and additional features.

1.  **Authentication**: A user with a `subscription_status` of `'pro'` or `'premium'` logs in.
2.  **Transcription Mode Selection**: In `SessionSidebar.jsx`, the Pro user can enable "High-Accuracy Mode".
    *   **If OFF**: The flow is identical to the Free User Flow, using the browser's Web Speech API.
    *   **If ON**: The application uses the `useAudioRecording` hook to capture audio.
3.  **Cloud Speech Recognition**: When the session ends, the recorded audio is sent to the `cloud-transcribe` Supabase Edge Function. This function acts as a secure proxy, forwarding the audio to the **Google Cloud Speech-to-Text API** for transcription.
4.  **Session Completion & Persistence**: When the session is saved, both the original browser-generated transcript and the new high-accuracy cloud transcript are saved to the `sessions` table in the `browser_transcript` and `cloud_transcript` columns, respectively. This allows for a side-by-side comparison on the analytics page.
5.  **Usage Tracking**: The `update_user_usage` RPC function is still called. This is harmless and ensures the usage metric is still tracked, even if it isn't used to limit the user. The function's logic also correctly handles monthly resets for all user types.

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
