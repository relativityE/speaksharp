# System Architecture: SpeakSharp

## 1. Executive Summary

SpeakSharp is a **privacy-first, real-time speech analysis tool** designed as a modern, serverless SaaS web application. Its architecture is strategically aligned with the core product goal: to provide instant, on-device feedback that helps users improve their public speaking skills, while rigorously protecting their privacy.

The system is built for speed, both in user experience and development velocity. It leverages a **React (Vite)** frontend for a highly interactive UI and **Supabase** as an all-in-one backend for data, authentication, and user management.

## 2. System Architecture & Technology Stack

The architecture is designed around a modern, client-heavy Jamstack approach. The frontend is a sophisticated single-page application that handles most of the business logic.

### High-Level Overview
```text
+---------------------------------+      +---------------------------------+
|      React SPA (`src`)          |----->|      Development & Build        |
|    (in User's Browser)          |      |        (Vite, Vitest)           |
+---------------------------------+      +---------------------------------+
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

### Cloud AI Transcription Workflow (Detailed View)
This diagram illustrates the step-by-step process for initiating a cloud-based transcription session.

**Authentication:**
- **Standard Users:** Authenticate using the JWT obtained at login.
- **Developers (Local Env Only):** If a `VITE_DEV_SECRET_KEY` is present in the `.env.local` file, the application enters developer mode. It calls a special `generate-jwt` edge function (which has JWT verification disabled). This function returns a short-lived JWT for a hardcoded, non-privileged developer user. This temporary JWT is then used to authenticate subsequent requests to secured functions.

**Workflow:**
```text
+---------------------------------+      +-------------------------------------+      +-----------------------------+
|         User's Browser          |      |        Supabase Edge Function       |      |      AssemblyAI Service     |
|        (React Client)           |      |        (assemblyai-token)           |      |                             |
+---------------------------------+      +-------------------------------------+      +-----------------------------+
               |                                       |                                       |
1. `createMicStream()` is called.                      |                                       |
   - Captures audio.                                   |                                       |
   - Downsamples via `AudioWorklet` (`pcm-downsampler`) to 16,000 Hz. |                               |
               |                                       |                                       |
2. `_getAuthToken()` is called.                        |                                       |
   - If dev mode, calls `generate-jwt` function to get a temporary JWT. |
   - Otherwise, uses the logged-in user's JWT.         |                                       |
               |                                       |                                       |
3. `_getAssemblyAIToken()` is called.                  |                                       |
   - Invokes `assemblyai-token` function with the JWT. |                                       |
   ──────────────────────────────────────────────────> 4. Receives request.                    |
                                                       |   - Supabase Gateway validates JWT.   |
                                                       |   - Function gets user from JWT.      |
                                                       |   - Checks user's plan/usage.         |
                                                       |                                       |
                                                     5. `createTemporaryToken()` ───────────> 6. Validates API Key.
                                                       |   (Uses master AssemblyAI API Key)    |   Generates temporary token.
                                                       |                                       |
             7. Receives temporary token <────────────────────────────────────────────────────
               |                                       |                                       |
8. Connects to AssemblyAI WebSocket.                   |                                       |
   - Uses temporary token for auth.                    |                                       |
   - Begins streaming audio data.  ─────────────────────────────────────────────────────────> 9. Receives audio stream.
               |                                       |                                       |   Performs transcription.
```

## 3. Database Management & Performance

### Applying Database Migrations
All changes to the database schema are managed through timestamped SQL migration files located in the `supabase/migrations` directory. To apply new migrations, run: `supabase db push`.

### Performance Optimizations
- **RLS Policy Optimization:** RLS policies on the `sessions` table were updated to use `(select auth.uid())` to ensure the function is evaluated only once per query.
- **Foreign Key Indexing:** An index was added to the `sessions(user_id)` column to speed up lookups.

## 4. Test Approach

Our project employs a robust testing strategy centered on **Vitest**.

### Unit & Integration Testing (Vitest)
This is the primary testing stack. It provides a fast and reliable way to test components and logic in a simulated `jsdom` environment.

### Handling Browser-Specific Imports in a Node.js Test Environment
A critical challenge is testing code that relies on browser-specific features (e.g., `?url` imports for Audio Worklets) in a Node.js environment.

**The Solution: Architectural Separation (Wrapper/Implementation Pattern)**
The code is architected to physically separate the problematic import from the code path that the test runner analyzes.
1.  **Implementation File (`*.impl.js`):** Contains the browser-specific import.
2.  **Wrapper File (`*.js`):** A "safe" wrapper that the rest of the application imports. It **dynamically imports** the implementation file only at runtime.
3.  **Mocking the Wrapper:** In tests, the safe wrapper file is mocked, so the test runner's static analysis never encounters the problematic import.

### End-to-End Testing (Playwright)
For critical user flows, we use **Playwright** to run tests in a real browser environment.

### Backend Function Testing (Deno Test)
For Supabase Edge Functions, we use **Deno's built-in test runner**. These tests use dependency injection to mock external services.
