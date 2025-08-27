# System Architecture: SpeakSharp

## 1. Executive Summary

SpeakSharp is a **privacy-first, real-time speech analysis tool** designed as a modern, serverless SaaS web application. Its architecture is strategically aligned with the core product goal: to provide instant, on-device feedback that helps users improve their public speaking skills, while rigorously protecting their privacy.

The system is built for speed, both in user experience and development velocity. It leverages a **React (Vite)** frontend for a highly interactive UI and **Supabase** as an all-in-one backend for data, authentication, and user management.

## 2. System Architecture & Technology Stack

The architecture is designed around a modern, client-heavy Jamstack approach. The frontend is a sophisticated single-page application that handles most of the business logic.

> **Serverless + Edge Functions**
>
> Lets you run backend logic without managing servers.
>
> - **Serverless functions** → run on demand (API endpoints, auth, etc.).
> - **Edge functions** → run geographically closer to the user for faster response.

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
|   |   - `CloudAssemblyAI.js`: Handles cloud mode via SDK.           |     | - Deno Test (`*.test.ts`)         |
|   |     - If dev mode & not logged in, calls signInAnonymously().   |     +-----------------------------------+
|   |     - Makes POST to `/assemblyai-token` to get API key.         |
|   |     - Uses `assemblyai` SDK to stream audio.                    |
|   |   - `LocalWhisper.js`: Handles local mode (Transformers.js).    |
|   +-----------------------------------------------------------------+
|                                   |
|                                   | API Calls to Supabase Functions
|                                   |
|                                   v
|   +-----------------------------------------------------------------+
|   | Supabase (Backend)                                              |
|   |-----------------------------------------------------------------|
|   | - **Edge Functions (`supabase/functions/`)**                    |
|   |   - `assemblyai-token`: Verifies user JWT, returns API key.     |
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
|       |         | (SDK handles this)                      | AssemblyAI API (Real-time) |
|       |         +---------------------------------------> +----------------------------+
|       |
|       +---------------------------------------------------> +----------------------------+
|         (Via Supabase Function)                             | Google Gemini API (REST)   |
|                                                             +----------------------------+
|
+-----------------------------------------------------------------------------------------------------------------+
```

### Cloud AI Transcription Workflow (Detailed View)

This diagram illustrates the step-by-step process for initiating a cloud-based transcription session using the modern, SDK-based approach.

**Authentication & Developer Workflow**

The system supports two authentication paths: one for standard users and a special flow for local development to bypass the need for a full login.

-   **Standard Users:** Authenticate using the standard JWT provided by Supabase Auth upon login.
-   **Developers (Local Env Only):** This flow is triggered by setting `VITE_DEV_MODE='true'` in the `.env.local` file. It uses Supabase's built-in anonymous sign-in feature to create a temporary user session. This is secure and uses standard Supabase functionality.

**Workflow Diagram:**
```
Browser (React App)
  |
  | 1. Get User JWT (either from normal login or anonymous sign-in for devs)
  |
  | 2. Request AssemblyAI API Key
  |    POST /functions/v1/assemblyai-token
  |    Header: Authorization: Bearer <user-JWT>
  |
  v
Supabase Edge Function: assemblyai-token
  - Verifies the user's JWT via `auth.getUser()`.
  - If valid, retrieves the master ASSEMBLYAI_API_KEY from secrets.
  |
  | 3. Response: { apiKey: "<master-assemblyai-key>" }
  v
Browser (CloudAssemblyAI.js)
  |
  | 4. Initialize AssemblyAI SDK with the received API key.
  |    `const client = new AssemblyAI({ apiKey });`
  |    `const transcriber = client.streaming.transcriber(...)`
  |
  | 5. Start sending audio data to the transcriber.
  |    The SDK handles the WebSocket connection and authentication.
  |
  v
AssemblyAI Service
  - Receives audio stream and returns transcripts.
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

# Your AssemblyAI API Key
ASSEMBLYAI_API_KEY=<Your AssemblyAI API Key>

# Your Gemini API Key for AI suggestions
GEMINI_API_KEY=<Your Gemini API Key>
```

> [!NOTE]
> **`VITE_DEV_MODE` is for the Frontend Only**
> You do **not** need to set `VITE_DEV_MODE` as a secret in your Supabase project. Any variable prefixed with `VITE_` is specifically for your React application running in the browser. It's used in your `.env.local` file to tell the frontend to enable the developer workflow (the anonymous sign-in). Supabase Edge Functions run on a server and use a separate set of secrets that you configure in the Supabase dashboard.

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
