# SpeakSharp

A real-time speech analysis tool to help you speak more confidently.

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- pnpm (v10.4.1 or higher)
- Supabase Account (for backend services)

### Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/relativityE/speaksharp.git
    cd speaksharp
    ```

2.  **Install dependencies:**
    ```bash
    pnpm install
    ```

3.  **Set up environment variables:**
    Create a file named `.env` in the root of the project. You can use `.env.test` as a template for the required variable names. For a detailed explanation of the required keys and services, please see the `System Architecture.md` file.

4.  **Start the development server:**
    ```bash
    pnpm run dev
    ```

5.  Open your browser and navigate to the URL shown in your terminal (usually `http://localhost:5173`).

## Running Tests

-   **Unit & Integration Tests (Vitest):**
    ```bash
    pnpm test
    ```

-   **End-to-End Tests (Playwright):**
    ```bash
    pnpm run test:e2e
    ```

-   **Run All Tests (Unit, E2E, Functions):**
    ```bash
    pnpm run test:all
    ```

---

## Current Status & Blocker (As of August 30, 2025)

This section provides a detailed report on a critical, unresolved rendering issue that is currently blocking further progress.

### Summary of Completed Fixes

A series of deep-rooted issues have been identified and fixed in an attempt to resolve a complete failure of the application to render. The codebase is now in a much healthier and more stable state. The completed fixes include:

1.  **Build Configuration:** The entire build process was corrected by removing an incompatible `@tailwindcss/vite` plugin and replacing it with the standard, correct PostCSS configuration for Tailwind v3.
2.  **Theming & Styling:** The application's design system, defined in `src/lib/theme.ts`, was correctly integrated with Tailwind CSS by defining a full palette of CSS variables in `src/index.css` and consuming them in `tailwind.config.ts`.
3.  **Client-Side Crash:** A fatal JavaScript error was diagnosed and fixed. The application was crashing on initialization due to an invalid mock Stripe API key in the `.env.test` file.
4.  **Dependency Issues:** A version mismatch between the `react` library (`18.2.0`) and its type definitions (`@types/react@19.1.2`) was corrected. This type of mismatch is known to cause silent failures in Vite's dependency pre-bundling, which was preventing the `React` object from being loaded.
5.  **Component Bugs:** A bug was fixed in the `HeroSection` where a `Button` was being rendered with a non-existent `variant="default"`, causing it to be invisible.
6.  **Unit Test Suite:** All unit tests for the `SessionSidebar` were updated to reflect the new button labels ('Start Session' / 'Stop Session').

### The Intransigent Error: E2E Failure

Despite this exhaustive list of fixes, the application **still fails to render in the Playwright E2E test environment.**

-   **Symptom:** The `pnpm run test:e2e` command consistently fails with a `TimeoutError`, as Playwright cannot find the initial "Start For Free" button on the main page. The screenshots from the test show a blank white page.
-   **Current State:** The unit test suite (`pnpm test`) passes completely. The Vite development server (`pnpm dev`) starts without any errors. Diagnostic tests have confirmed that the browser is successfully downloading all JavaScript bundles and that the core React instance is mounting to the DOM.

### Hypothesis

The evidence points to a subtle, environment-specific issue with the Playwright test runner. All other indicators (clean build, passing unit tests, successful React mount detection) suggest the application *should* be working. The error is likely one of the following:

1.  **A Hidden Console Error:** There may be a client-side error that is only being thrown in the specific context of the Playwright browser, and which my previous diagnostic scripts failed to catch.
2.  **A Styling/Layout Issue:** An invisible overlay may still be present, but only under Playwright's specific rendering conditions. The `Toaster` component was a suspect, but commenting it out did not resolve the issue.
3.  **A "Phantom Cache" or Deep Environmental Problem:** As mentioned in the original hand-off report, there may be a persistent environmental issue that is not being cleared, even by a full reset.

### Test Environment

-   **Node:** `v20.15.1` (as per `Dockerfile.test`)
-   **pnpm:** `10.4.1`
-   **Vite:** `6.3.5`
-   **React:** `18.2.0`
-   **Playwright:** `1.54.2`
-   **Vitest:** `3.2.4`

### Recommended Next Step

**Manual browser-based debugging is required.** The code needs to be run in a local development environment and viewed in a standard browser with the developer tools open. This is the most likely way to uncover the final error that is blocking the E2E tests. The code has been submitted for review to enable this process.
