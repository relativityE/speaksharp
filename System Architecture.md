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
|   |   - `CloudAssemblyAI.js`: Handles cloud mode via pure WebSockets. |     | - Deno Test (`*.test.ts`)         |
|   |     - Calls `/assemblyai-token` function via `supabase.functions.invoke()`. |     +-----------------------------------+
|   |     - Opens direct WebSocket to AssemblyAI with the received token. |
|   |     - Uses `MediaRecorder` API to capture and stream audio.     |
|   |   - `NativeBrowser.js`: Handles local mode (Browser's native SpeechRecognition). |
|   +-----------------------------------------------------------------+
|                                   |
|                                   | API Calls to Supabase Functions
|                                   |
|                                   v
|   +-----------------------------------------------------------------+
|   | Supabase (Backend)                                              |
|   |-----------------------------------------------------------------|
|   | - **Edge Functions (`supabase/functions/`)**                    |
|   |   - `assemblyai-token`: Uses `Deno.serve` to get AssemblyAI token. |
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
|       |         | (Pure WebSocket)                        | AssemblyAI API (Real-time) |
|       |         +---------------------------------------> +----------------------------+
|       |
|       +---------------------------------------------------> +----------------------------+
|         (Via Supabase Function)                             | Google Gemini API (REST)   |
|                                                             +----------------------------+
|
+-----------------------------------------------------------------------------------------------------------------+
```

### Cloud AI Transcription Workflow (Detailed View)

This section details the updated, end-to-end process for cloud-based transcription, which now uses a pure WebSocket implementation on the frontend, aligning with modern best practices.

**New Workflow Diagram:**
```
+--------------------------------+
|      Browser (React App)       |
+--------------------------------+
               |
               | 1. User clicks "Start Recording".
               |    - `useSpeechRecognition.js` calls `getAssemblyAIToken()`.
               |
               v
+--------------------------------+
| `supabase.functions.invoke()`  |
| (Handles Auth Headers)         |
+--------------------------------+
               |
               | 2. POST to `/functions/v1/assemblyai-token`
               |
               v
+--------------------------------+
| Supabase Edge Function         |
| (`Deno.serve` pattern)         |
+--------------------------------+
               |
               | 3. Backend calls AssemblyAI API to get a temporary token.
               |
               v
+--------------------------------+
|      AssemblyAI Auth API       |
+--------------------------------+
               |
               | 4. Returns temporary token to Supabase function.
               |
               v
+--------------------------------+
| Supabase Edge Function         |
+--------------------------------+
               |
               | 5. Returns temporary token to Browser.
               |
               v
+--------------------------------+
|      Browser (React App)       |
+--------------------------------+
               |
               | 6. Establishes a direct WebSocket connection to AssemblyAI
               |    using the temporary token.
               |    - `new WebSocket("wss://api.assemblyai.com/v2/realtime/ws?...")`
               |
               v
+--------------------------------+
|   AssemblyAI Real-time API     |
|       (WebSocket)              |
+--------------------------------+
               |
               | 7. Browser uses `MediaRecorder` API to stream audio
               |    and receives transcripts back on the same connection.
               |
               v
+--------------------------------+
|      Browser (React App)       |
+--------------------------------+
```

### Environment Variables for Local Development

To run the application locally, create a `.env.local` file in the root of the project with the following variables:

```bash
# --- React App Variables ---
# Set this to true to enable the anonymous sign-in developer workflow
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
The `UUID_DEV_USER` secret is no longer required.

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

## STT Communication

The real-time Speech-to-Text (STT) functionality involves a multi-step communication flow between the frontend client, the Supabase backend, and the AssemblyAI service.

This process happens in two main phases:
1.  The frontend contacts the Supabase backend to get a temporary AssemblyAI token.
2.  The frontend uses that temporary token to connect directly to AssemblyAI's real-time transcription service.

---

### 1. Frontend to Supabase Backend Communication

For the frontend to successfully call the `assemblyai-token` function on Supabase, the following is required:

*   **Endpoint:** A `POST` request to the correct Supabase function URL (`.../functions/v1/assemblyai-token`).
*   **`apikey` Header:** This is the project's public, anonymous key. It identifies which Supabase project is being called.
*   **`Authorization` Header:** The Supabase gateway expects a valid JSON Web Token (JWT) for the logged-in user, passed as `Authorization: Bearer <user_access_token>`. This proves the user's identity.
*   **`body`:** A `POST` request with `Content-Type: application/json` should have a body. An empty JSON object (`{}`) is sent to prevent the request from hanging.

### 2. Backend to AssemblyAI & Frontend to AssemblyAI Communication

Once the Supabase function is successfully called, it communicates with AssemblyAI.

*   **Backend to AssemblyAI (to get a temporary token):**
    *   The Supabase function makes a secure, server-to-server request to AssemblyAI's API (`/v2/realtime/token`).
    *   It authenticates using the permanent `ASSEMBLYAI_API_KEY`, which is stored as a secret in the Supabase environment.
    *   It requests a **temporary token** that is safe to use on the frontend.

*   **Frontend to AssemblyAI (to start transcription):**
    *   The frontend receives this temporary token from the Supabase function.
    *   It then establishes a **WebSocket connection** to AssemblyAI's real-time transcription service.
    *   It authenticates this WebSocket connection using the **temporary token**.
    *   Once connected, it streams audio from the microphone and receives transcription results back in real-time.
