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

## 3. Developer Workflow & Local Testing

### The `SUPER_DEV_MODE` Bypass

To facilitate local development and testing of premium cloud features without requiring a real, authenticated Pro user, the project uses a `SUPER_DEV_MODE`.

**The Rationale (The "Two Doors" Analogy):**
The system has two layers of security that must be bypassed in development: the frontend application and the backend functions.

1.  **The Frontend Door (The Browser):** The React app has checks to see if a user is logged in before attempting to call a protected backend function.
    *   **The Key:** `VITE_SUPER_DEV_MODE=true`
    *   **How it Works:** This environment variable, placed in the `.env.local` file, is made available to the frontend code by Vite's build process. When our client-side code sees this is `true`, it bypasses its own login checks.

2.  **The Backend Door (The Server):** The Supabase Edge Functions have their own separate security.
    *   **The Key:** `SUPER_DEV_MODE=true`
    *   **How it Works:** This variable must be set in the environment where the Edge Functions are running.
        *   **For Deployed Functions (e.g., on a preview branch):** This is set as a secret in the Supabase project dashboard (`Settings` > `Edge Functions`).
        *   **For True Local Development (with Docker):** The local Supabase environment (started with `supabase start`) reads this variable from the `.env.local` file (without the `VITE_` prefix).

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
```

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

*   **`happy-dom`**: A lightweight, simulated browser environment.
*   **Dependency Mocking & Memory Leaks**: We use advanced mocking to handle complex dependencies (like `@xenova/transformers`) that can cause memory leaks in the test environment. The key to solving this is to ensure mocks are established *before* any module imports are processed. The recommended pattern for this is `vi.hoisted()`:
    1.  **Hoist Mocks:** Any mocks for heavy dependencies are wrapped in `vi.hoisted()` and placed at the very top of the test file. This ensures they run before any standard `import` statements.
    2.  **Import Hook/Component:** The component under test can then be imported normally.
    3.  **Result:** This strategy prevents the large libraries from being loaded into memory during the test run.

### End-to-End Testing (Playwright)
For critical user flows, we use **Playwright** to run tests in a real browser environment.

### Backend Function Testing (Deno Test)
For Supabase Edge Functions, we use **Deno's built-in test runner**. These tests use dependency injection to mock external services.
