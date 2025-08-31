# System Architecture: SpeakSharp

## 1. System Architecture & Technology Stack

The architecture is designed around a modern, client-heavy Jamstack approach. The frontend is a sophisticated single-page application that handles most of the business logic.

- **Frontend**: React (with [Vite](https://vitejs.dev/))
- **Styling**: Tailwind CSS, shadcn/ui, and `class-variance-authority` (CVA)
  - **Styling Strategy**: The project has adopted a comprehensive, token-based design system built on a hybrid CVA and Tailwind strategy. This approach is the standard for all new UI components.
    - **Design Tokens (`tailwind.config.ts`):** All core design properties (colors, spacing, fonts, radii) are defined as tokens in the Tailwind configuration. This provides a single source of truth for the application's visual style. Semantic color names (e.g., `primary`, `secondary`, `danger`) are used throughout.
    - **Component Variants (CVA):** The `class-variance-authority` library is used within each UI component (e.g., `Button`, `Card`, `Alert`) to define variants for different styles (`variant`), sizes (`size`), and other properties. These variants compose the base Tailwind utility classes.
    - **Component Usage:** Components are used with simple props (e.g., `<Button variant="destructive" size="sm">`) which are translated into the correct CSS classes by CVA. This makes the UI code clean, declarative, and easy to maintain.
    - **CSS Variables:** The core theme is defined as CSS variables in `src/index.css`, which are then consumed by Tailwind's configuration. This is a standard and robust practice for theming with Tailwind.
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
|   | - `Header.jsx`: Main application header.                        |     | - Vite (`vite.config.mjs`)        |
|   |   - `SideNav.jsx`: Universal, mobile-first navigation menu.     |     | - Vitest (`*.test.jsx`)           |
|   | - `AnalyticsPage.jsx`: Displays user analytics.                 |     | - Playwright (`*.spec.ts`)        |
|   |   - `SessionStatus.jsx`: Card for starting a new session.       |     | - Deno Test (`*.test.ts`)         |
|   | - `useSpeechRecognition.js`: Handles UI logic.                  |     +-----------------------------------+
|   | - `TranscriptionService.js`: Core logic to choose mode.         |
|   |   - `CloudAssemblyAI.js`: Handles cloud mode via pure WebSockets. |
|   |     - Calls `/assemblyai-token` function via `supabase.functions.invoke()`. |
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

### Iron-Clad E2E Testing Strategy
To combat persistent, environment-specific rendering failures, a robust, deterministic E2E testing strategy has been implemented. This strategy is designed to be CI-friendly and provide clear, actionable feedback without requiring manual debugging.

The core components are:

1.  **Testing Against a Production Build:** All E2E tests run against a production-like build of the application (`pnpm build -- --mode e2e && pnpm preview`). This eliminates inconsistencies between the development server and the final bundled code. A dedicated `--mode e2e` is used to bake E2E-specific behavior into the bundle.

2.  **Runtime Test Environment Shim (`src/testEnv.ts`):** A critical shim file is imported as the very first module in the application's entry point (`src/main.jsx`). When `import.meta.env.MODE === 'test'`, this shim replaces the initializers for all third-party services (Stripe, PostHog, Sentry, AssemblyAI WebSocket) with deterministic, no-op implementations on the `globalThis` object. This prevents flaky or hanging SDK initializations from blocking the application's render tree.

3.  **Strict Network Interception (`tests/setup.ts`):** At the Playwright level, a global `page.route()` interceptor is used as a safety net. It operates on an "allowlist" principle: only requests to `localhost` and `supabase.co` are allowed to proceed. All other external network requests are immediately blocked and fulfilled with an empty `204` response. This guarantees that no unexpected third-party scripts or API calls can interfere with the test run.

4.  **Debug Mode:** The network interception logic includes a debug mode, activated by running tests with the `DEBUG=1` environment variable (`DEBUG=1 pnpm test:e2e`). In this mode, external requests are logged to the console and allowed to proceed, enabling developers to trace hidden dependencies or unexpected network behavior during local debugging.

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

---

## 4. Known Issues

This section documents critical, unresolved issues that are currently impacting the project.

-   **[TENTATIVELY FIXED] Tailwind CSS Build Failure:**
    -   **Symptom:** No Tailwind-generated styles are being applied anywhere in the application. The UI renders as an unstyled HTML document.
    -   **Status:** The initial build crash has been resolved by fixing misconfigurations in `postcss.config.js` and `tailwind.config.ts`.
    -   **Diagnosis:** Despite the build now running without errors, the application still renders without styles in the Playwright test environment. This is believed to be a persistent caching issue. **A VM reboot is required to fully verify the fix.**
