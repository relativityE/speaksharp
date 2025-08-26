# System Architecture: SpeakSharp

## 1. Executive Summary

SpeakSharp is a **privacy-first, real-time speech analysis tool** designed as a modern, serverless SaaS web application. Its architecture is strategically aligned with the core product goal: to provide instant, on-device feedback that helps users improve their public speaking skills, while rigorously protecting their privacy.

The system is built for speed, both in user experience and development velocity. It leverages a **React (Vite)** frontend for a highly interactive UI and **Supabase** as an all-in-one backend for data, authentication, and user management. The speech recognition engine now uses a "Cloud-First, Native-Fallback" model to ensure reliability.

## 2. System Architecture & Technology Stack

The architecture is designed around a modern, client-heavy Jamstack approach. The frontend is a sophisticated single-page application that handles most of the business logic, including the transcription via a flexible `TranscriptionService` wrapper. This service attempts to use a cloud provider (AssemblyAI) and gracefully falls back to the native browser's speech recognition capabilities on failure.

### High-Level Overview
```text
+---------------------------------+      +---------------------------------+
|      React SPA (`src`)          |----->|      Development & Build        |
|    (in User's Browser)          |      |        (Vite, Vitest)           |
|                                 |      +---------------------------------+
|  +---------------------------+  |
|  |  TranscriptionService     |  |
|  | (Cloud-First, Native-    |  |
|  |  Fallback Logic)          |  |
|  |---------------------------|  |
|  | try {                     |  |
|  |   CloudAssemblyAI         |  |
|  | } catch {                 |  |
|  |   NativeBrowser           |  |
|  | }                         |  |
|  +---------------------------+  |
|                                 |
|  +---------------------------+  |
|  |  UI Components (`/src`)   |  |
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

### Cloud AI Transcription Workflow (Detailed View)
This diagram illustrates the step-by-step process for initiating a cloud-based transcription session.

```text
+---------------------------------+      +-------------------------------------+      +-----------------------------+
|         User's Browser          |      |        Supabase Edge Function       |      |      AssemblyAI Service     |
|        (React Client)           |      |        (assemblyai-token)           |      |                             |
+---------------------------------+      +-------------------------------------+      +-----------------------------+
               |                                       |                                       |
1. `createMicStream()` is called.                      |                                       |
   - Captures audio.                                   |                                       |
   - Downsamples via `AudioWorklet`.                   |                                       |
               |                                       |                                       |
2. `invoke('assemblyai-token')`  ──────────────────>   3. Receives request.                    |
   - Sends `Authorization` header                      |   - Checks for Dev Secret OR          |
     (Dev Secret or User JWT).                         |   - Validates User JWT.               |
               |                                       |                                       |
               |                                     4. `createTemporaryToken()` ───────────> 5. Validates API Key.
               |                                       |   (Uses master AssemblyAI API Key)    |   Generates temporary token.
               |                                       |                                       |
             6. Receives temporary token <────────────────────────────────────────────────────
               |                                       |                                       |
7. Connects to AssemblyAI WebSocket.                   |                                       |
   - Uses temporary token for auth.                    |                                       |
   - Begins streaming audio data.  ─────────────────────────────────────────────────────────> 8. Receives audio stream.
               |                                       |                                       |   Performs transcription.
```

## 3. Developer Workflow & Local Testing

### The Shared Secret Bypass

To facilitate local development and testing of premium cloud features without requiring a real, authenticated Pro user, the project uses a shared secret system.

**The Rationale:**
Instead of a simple on/off flag, we use a shared secret key that must be present on both the client and the server. This ensures that only trusted developers can access the developer mode bypass.

1.  **The Frontend (`.env.local`):** The client-side code reads a secret key from a `VITE_DEV_SECRET_KEY` variable in the `.env.local` file. It sends this key in the `Authorization` header of its request to the backend function.

2.  **The Backend (Supabase Secrets):** The Supabase Edge Function reads its own copy of the secret from a `DEV_SECRET_KEY` environment variable, which is set in the Supabase project dashboard (`Settings -> Secrets`).

When the backend function receives a request, it checks if the `Authorization` header from the client matches its own `DEV_SECRET_KEY`. If they match, the developer is authenticated, and the function bypasses the normal user login checks.

#### Authentication Flow by Role
The `assemblyai-token` Edge Function has a clear, priority-based authentication and authorization flow. It is critical to understand that the system checks for a developer secret *first*, and only if that is not present does it proceed to standard user authentication.

1.  **Developer Path (Highest Priority):**
    *   **Requirement:** The request must have an `Authorization: Bearer <DEV_SECRET_KEY>` header.
    *   **Behavior:** If the secret is valid, the function immediately grants access and generates a temporary AssemblyAI token. It **does not** check for a user, profile, or usage limits. This path is for trusted developers only.

2.  **Standard User Path (Fallback):** If the developer secret is not present or invalid, the function attempts to authenticate a standard user.
    *   **Pro User:**
        *   **Requirement:** A valid Supabase JWT (`Authorization: Bearer <user-jwt>`).
        *   **Authorization:** The function validates the JWT, then checks if the user's `subscription_status` in their profile is `'pro'` or `'premium'`.
    *   **Free User:**
        *   **Requirement:** A valid Supabase JWT.
        *   **Authorization:** The function validates the JWT, then checks if the user's `usage_seconds` is below the free tier limit. If they are over the limit, they are denied access with a `403 Forbidden` error.
    *   **Anonymous User (Not Logged In):**
        *   **Requirement:** Cannot provide a valid JWT.
        *   **Result:** The function cannot authenticate them, and they are denied access with a `401 Unauthorized` error.

**Important Note on Local Database Setup:**
Since you don't have Docker installed, you are not running a local database. You are running your frontend locally, but it is connecting to the **remote, deployed** database on Supabase's cloud. Therefore, the `supabase db reset` command will not work for you. This is a critical distinction in your development workflow.

**Deployment Configuration:**
The `supabase/config.toml` file must explicitly list all functions to ensure that deployments, especially updates to environment variables, are handled reliably. A failure to do so was the root cause of previous deployment issues. The correct configuration is:
```toml
[functions.assemblyai-token]
  entrypoint = "functions/assemblyai-token/index.ts"

[functions.get-ai-suggestions]
  entrypoint = "functions/get-ai-suggestions/index.ts"
# ... and so on for all other functions
```text
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

---

## 8. Developer Workflow & Local Testing

*For a detailed explanation of the developer workflow, please see Section 3 of this document.*

### History of the Deployment Issue

The developer workflow was previously blocked by a persistent `401 Unauthorized` error, even when secrets were set. The root cause was twofold:
1.  The `supabase/config.toml` was missing the `[functions]` block, causing the `supabase functions deploy` command to fail to correctly update the environment variables for the deployed functions.
2.  The local development workflow was not clearly documented, leading to confusion between client-side (`VITE_`) and server-side environment variables.

By explicitly defining the functions in `config.toml` and clarifying the setup in this document, the process is now stable and reliable.

---

## 4. Database Management & Performance

This section details the process for managing the database schema and highlights key performance optimizations that have been implemented.

### Applying Database Migrations

All changes to the database schema (e.g., creating tables, adding indexes) are managed through timestamped SQL migration files located in the `supabase/migrations` directory.

To apply new migrations to your deployed Supabase project, run the following CLI command:
```bash
supabase db push
```
This command compares the migrations in your local directory with the ones that have already been run on the remote database and executes only the new ones.

### Performance Optimizations

Based on feedback from the Supabase Database Linter, the following performance improvements have been implemented via migrations:

1.  **Row Level Security (RLS) Policy Optimization:**
    *   **Issue:** The original RLS policies on the `sessions` table used `auth.uid()` directly, causing the function to be re-evaluated for every row in a query, leading to poor performance.
    *   **Fix:** The policies were consolidated and updated to use `(select auth.uid())`. This ensures the function is treated as a stable value and is only evaluated once per query.

2.  **Foreign Key Indexing:**
    *   **Issue:** The `user_id` column on the `sessions` table is a foreign key but was missing a database index. This can lead to slow queries when filtering or joining on this column.
    *   **Fix:** A new index was added to the `sessions(user_id)` column to significantly speed up these lookups.

---

## 5. Test Approach

Our project employs a robust testing strategy centered on **Vitest**.

### Unit & Integration Testing (Vitest)
This is the primary testing stack. It provides a fast and reliable way to test components and logic.

*   **`jsdom`**: A simulated browser environment. Note: The project was migrated from `happy-dom` because it was causing silent, difficult-to-debug crashes in the test runner.
*   **Dependency Mocking & Memory Leaks**: We use advanced mocking to handle complex dependencies (like `@xenova/transformers`) that can cause memory leaks in the test environment. The key to solving this is to ensure mocks are established *before* any module imports are processed. The recommended pattern for this is `vi.hoisted()`:
    1.  **Hoist Mocks:** Any mocks for heavy dependencies are wrapped in `vi.hoisted()` and placed at the very top of the test file. This ensures they run before any standard `import` statements.
    2.  **Import Hook/Component:** The component under test can then be imported normally.
    3.  **Result:** This strategy prevents the large libraries from being loaded into memory during the test run.

### Handling Browser-Specific Imports in a Node.js Test Environment
A critical challenge in this stack is testing code that relies on browser-specific features not present in the `jsdom`/Node.js environment. A key example is Vite's `?url` import syntax for loading assets like Audio Worklets.

**The Problem: Static Analysis Failure**
Vitest's Node.js-based test runner performs **static analysis** on the entire dependency tree *before* executing any tests or applying mocks. When it encounters a browser-specific import syntax like `import WORKLET_URL from './audio-processor.worklet.js?url';`, it fails at this initial parsing/resolution stage. Standard mocking techniques like `vi.mock` or even `vi.hoisted` are ineffective because they only execute *after* this static analysis has already failed.

**The Solution: Architectural Separation (Wrapper/Implementation Pattern)**
The only reliable solution is to architect the code to physically separate the problematic import from the code path that the test runner analyzes.

1.  **Implementation File (`*.impl.js`):** The code containing the browser-specific import (e.g., `?url`) is placed in a separate implementation file.
    ```javascript
    // audioUtils.impl.js
    import WORKLET_URL from './audio-processor.worklet.js?url';
    // ... actual implementation ...
    ```

2.  **Wrapper File (`*.js`):** A "safe" wrapper file is created, which is the module that the rest of the application imports. This wrapper **dynamically imports** the implementation file only when its functions are called at runtime.
    ```javascript
    // audioUtils.js
    export async function createMicStream(options = {}) {
      const { createMicStreamImpl } = await import('./audioUtils.impl.js');
      return createMicStreamImpl(options);
    }
    ```

3.  **Mocking the Wrapper:** In tests, you mock the safe wrapper file. The test runner's static analysis never sees the `.impl.js` file and therefore never encounters the problematic import.
    ```javascript
    // MyComponent.test.jsx
    vi.mock('../services/transcription/utils/audioUtils', () => ({
      createMicStream: vi.fn().mockResolvedValue(/*...mocked stream...*/),
    }));
    ```
This pattern ensures browser-specific code can be used without breaking the Node.js-based test environment.

### End-to-End Testing (Playwright)
For critical user flows, we use **Playwright** to run tests in a real browser environment.

### Backend Function Testing (Deno Test)
For Supabase Edge Functions, we use **Deno's built-in test runner**. These tests use dependency injection to mock external services.
