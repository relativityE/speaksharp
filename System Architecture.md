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


#### React SPA 
SPA = Single-Page Application

A React SPA is a web application built with React where the browser loads one HTML page (usually index.html) once, and then JavaScript dynamically updates the content as the user navigates.

=> So instead of going back to the server for each new page, the app swaps components in/out on the client side.


### Detailed Component & Service Interaction Diagram

This diagram provides a more granular view of how the different parts of the codebase interact with each other and with external services.

```text
+-----------------------------------------------------------------------------------------------------------------+
|                                         SpeakSharp System Architecture                                          |
+=================================================================================================================+
|                                                                                                                 |
|   +-----------------------------------------------------------------+     +-----------------------------------+
|   | Browser (Client - React SPA in `src/`)                          |     | Development & Testing             |
|   |-----------------------------------------------------------------|     |-----------------------------------|
|   | - `SessionSidebar.jsx`: User clicks "Start" button.             |     | - Vite (`vite.config.mjs`)        |
|   | - `useSpeechRecognition.js`: Handles UI logic.                  |     | - Vitest (`*.test.jsx`)           |
|   | - `TranscriptionService.js`: Core logic to choose mode.         |     | - Playwright (`*.spec.ts`)        |
|   |   - `CloudAssemblyAI.js`: Handles cloud mode.                   |     | - Deno Test (`*.test.ts`)         |
|   |     - Makes POST to `/generate-dev-jwt`                         |     +-----------------------------------+
|   |     - Makes POST to `/assemblyai-token`                         |
|   |     - Opens WebSocket to AssemblyAI with the received token.    |
|   |   - `LocalWhisper.js`: Handles local mode (Transformers.js).    |
|   +-----------------------------------------------------------------+
|                                   |         |
|                                   | API Calls to Supabase Functions
|                                   |         |
|                                   v         v
|   +-----------------------------------------------------------------+
|   | Supabase (Backend)                                              |
|   |-----------------------------------------------------------------|
|   | - **Edge Functions (`supabase/functions/`)**                    |
|   |   - `generate-dev-jwt`: Creates a temporary JWT for devs.       |
|   |     (Code: `index.ts`, Config: `config.toml`)                   |
|   |     (Uses Secrets: `SERVICE_ROLE_KEY`, `UUID_DEV_USER`)         |
|   |                                                                 |
|   |   - `assemblyai-token`: Verifies JWT, gets AssemblyAI token.    |
|   |     (Code: `index.ts`, Config: `config.toml`)                   |
|   |     (Uses Secrets: `ASSEMBLYAI_API_KEY`)                        |
|   |                                                                 |
|   |   - `get-ai-suggestions`: Gets suggestions from Gemini.         |
|   |     (Code: `index.ts`, Config: `config.toml`)                   |
|   |     (Uses Secrets: `GEMINI_API_KEY`)                            |
|   |                                                                 |
|   | - **Database (PostgreSQL)**: Stores user data, sessions.        |
|   |   (Schema: `supabase/migrations/`)                              |
|   +-----------------------------------------------------------------+
|       |         |                      |
|       |         |                      +----------------> +----------------------------+
|       |         | (Via Supabase Function)                 | AssemblyAI API (Real-time) |
|       |         +---------------------------------------> +----------------------------+
|       |
|       +---------------------------------------------------> +----------------------------+
|         (Via Supabase Function)                             | Google Gemini API (REST)   |
|                                                             +----------------------------+
|
+-----------------------------------------------------------------------------------------------------------------+
```

### Cloud AI Transcription Workflow (Detailed View)
This diagram illustrates the step-by-step process for initiating a cloud-based transcription session.

**Authentication & Developer Workflow**

The system supports two authentication paths: one for standard users and a special flow for local development to bypass the need for a full login.

-   **Standard Users:** Authenticate using the standard JWT provided by Supabase Auth upon login.
-   **Developers (Local Env Only):** This flow is triggered by setting `VITE_DEV_MODE='true'` in the `.env.local` file. It uses a secure, two-step token exchange process to grant access without exposing any long-lived secrets to the browser.

**Developer Workflow Diagram:**
```
Browser (React App, VITE_DEV_MODE=true)
  |
  | 1. Request short-lived dev JWT (no secret needed)
  |    POST /functions/v1/generate-dev-jwt
  |
  v
Supabase Edge Function: generate-dev-jwt
  - Uses server-side UUID_DEV_USER.
  - Signs a new JWT with the secret SUPABASE_SERVICE_ROLE_KEY.
  - JWT expires in 10 minutes.
  |
  | 2. Response: { token: "<dev-JWT>" }
  v
Browser stores dev JWT (in memory)
  |
  | 3. Request AssemblyAI token with the dev JWT
  |    POST /functions/v1/assemblyai-token
  |    Header: Authorization: Bearer <dev-JWT>
  |
  v
Supabase Edge Function: assemblyai-token
  - Verifies the dev JWT signature.
  - Confirms the JWT's subject (`sub`) matches UUID_DEV_USER.
  - If valid, calls AssemblyAI with the secret ASSEMBLYAI_API_KEY.
  |
  | 4. Response: { token: "<assemblyai-temp-token>" }
  v
Browser uses the temporary AssemblyAI token for the WebSocket connection.
```

### Environment Variables for Local Development

To run the application locally in developer mode, create a `.env.local` file in the root of the project with the following variables:

```bash
# --- React App Variables ---
# Set this to true to enable the developer authentication flow
VITE_DEV_MODE='true'

# Your project's public Supabase URL and Anon Key
VITE_SUPABASE_URL=<Your Supabase Project URL>
VITE_SUPABASE_ANON_KEY=<Your Supabase Project Anon Key>


# --- Supabase Edge Function Variables ---
# These are used by the functions when running locally via `supabase start`
# and should also be set in your project's secrets for deployment.

# Your project's Service Role Key (found in API settings)
SUPABASE_SERVICE_ROLE_KEY=<Your Supabase Project Service Role Key>

# Your AssemblyAI API Key
ASSEMBLYAI_API_KEY=<Your AssemblyAI API Key>

# Your Gemini API Key for AI suggestions
GEMINI_API_KEY=<Your Gemini API Key>

# The UUID of the dedicated, non-privileged user you created for development
# (Go to Supabase Dashboard > Authentication > Users > Click on dev user > Copy UUID)
UUID_DEV_USER=<The UUID of the dev user>

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
                                                       |   - Gateway does NOT validate JWT.    |
                                                       |   - Function code validates JWT.      |
                                                       |   - Function checks user's plan.      |
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
