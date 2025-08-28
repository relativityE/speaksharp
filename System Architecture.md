# System Architecture: SpeakSharp

## 1. System Architecture & Technology Stack

The architecture is designed around a modern, client-heavy Jamstack approach. The frontend is a sophisticated single-page application that handles most of the business logic.

- **Frontend**: React (with [Vite](https://vitejs.dev/))
- **Styling**: Tailwind CSS & shadcn/ui
- **Testing**:
    - **Vitest:** For unit and integration tests.
    - **Playwright:** For end-to-end tests.
    - **Deno Test:** For backend function tests.
- **Backend & Database**: Supabase
- **Speech Processing**:
    - **On-Device (Default)**: Transformers.js for private, in-browser transcription.
    - **Cloud-Based (Pro Option)**: AssemblyAI v3 for premium, high-accuracy transcription.


### High-Level Overview
```text
+---------------------------------+      +---------------------------------+
|      React SPA (`src`)          |----->|      Development & Build        |
|    (in User's Browser)          |      |   (Vite, Vitest, Playwright)    |
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
|   |     - Uses `AudioWorklet` pipeline to capture and stream raw PCM audio. |
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
|       |         | (Pure WebSocket)                        | AssemblyAI API (v3 Real-time)|
|       |         +---------------------------------------> +----------------------------+
|       |
|       +---------------------------------------------------> +----------------------------+
|         (Via Supabase Function)                             | Google Gemini API (REST)   |
|                                                             +----------------------------+
|
+-----------------------------------------------------------------------------------------------------------------+
```

### Cloud AI Transcription Workflow (Detailed View)

This section details the updated, end-to-end process for cloud-based transcription, which now uses the AssemblyAI v3 API and a pure WebSocket implementation on the frontend.

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
               | 3. Backend calls AssemblyAI v3 API to get a temporary token.
               |
               v
+--------------------------------+
|      AssemblyAI Auth API (v3)  |
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
               | 6. Establishes a direct WebSocket connection to AssemblyAI v3
               |    using the temporary token.
               |    - `new WebSocket("wss://streaming.assemblyai.com/v3/ws?...")`
               |
               v
+--------------------------------+
|   AssemblyAI Real-time API (v3)|
|       (WebSocket)              |
+--------------------------------+
               |
               | 7. Browser uses `AudioWorklet` pipeline to stream raw 16-bit PCM
               |    audio and receives transcripts back on the same connection.
               |
               v
+--------------------------------+
|      Browser (React App)       |
+--------------------------------+
```

## 2. Test Approach

Our project employs a robust testing strategy centered on **Vitest**, with **Playwright** for end-to-end tests and **Deno Test** for backend functions.

### Unit & Integration Testing (Vitest)
This is the primary testing stack. It provides a fast and reliable way to test components and logic in a simulated `jsdom` environment. The test suite is now stable and all tests pass without warnings.

### End-to-End Testing (Playwright)
For critical user flows, we use **Playwright** to run tests in a real browser environment. The E2E tests have been updated to cover both native and cloud transcription flows.

### Backend Function Testing (Deno Test)
For Supabase Edge Functions, we use **Deno's built-in test runner**. These tests use dependency injection to mock external services.

## 3. STT Communication

The real-time Speech-to-Text (STT) functionality involves a multi-step communication flow between the frontend client, the Supabase backend, and the AssemblyAI service.

This process happens in two main phases:
1.  The frontend contacts the Supabase backend to get a temporary AssemblyAI token.
2.  The frontend uses that temporary token to connect directly to AssemblyAI's real-time transcription service.

---

### Frontend to Supabase Backend Communication

For the frontend to successfully call the `assemblyai-token` function on Supabase, the following is required:

*   **Endpoint:** A `POST` request to the correct Supabase function URL (`.../functions/v1/assemblyai-token`).
*   **`apikey` Header:** This is the project's public, anonymous key. It identifies which Supabase project is being called.
*   **`Authorization` Header:** The Supabase gateway expects a valid JSON Web Token (JWT) for the logged-in user, passed as `Authorization: Bearer <user_access_token>`. This proves the user's identity.
*   **`body`:** A `POST` request with `Content-Type: application/json` should have a body. An empty JSON object (`{}`) is sent to prevent the request from hanging.

### Backend to AssemblyAI & Frontend to AssemblyAI Communication

Once the Supabase function is successfully called, it communicates with AssemblyAI.

*   **Backend to AssemblyAI (to get a temporary token):**
    *   The Supabase function makes a secure, server-to-server request to AssemblyAI's v3 API (`/v3/token`).
    *   It authenticates using the permanent `ASSEMBLYAI_API_KEY`, which is stored as a secret in the Supabase environment.
    *   It requests a **temporary token** that is safe to use on the frontend.

*   **Frontend to AssemblyAI (to start transcription):**
    *   The frontend receives this temporary token from the Supabase function.
    *   It then establishes a **WebSocket connection** to AssemblyAI's v3 real-time transcription service.
    *   It authenticates this WebSocket connection using the **temporary token**.
    *   Once connected, it streams raw 16-bit PCM audio from the microphone via an `AudioWorklet` pipeline and receives transcription results back in real-time.
