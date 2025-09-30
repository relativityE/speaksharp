# SpeakSharp

SpeakSharp is an AI-powered speech coaching application that helps users improve their public speaking skills. It provides real-time feedback on filler words, speaking pace, and more.

## Getting Started

To get started with SpeakSharp, you'll need to have Node.js and pnpm installed.

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/relativityE/speaksharp.git
    ```
2.  **Change into the directory:**
    ```bash
    cd speaksharp
    ```
3.  **Install dependencies and browser binaries:**
    ```bash
    pnpm setup:dev
    ```
4.  **Run the development server:**
    ```bash
    pnpm dev
    ```

## Testing

SpeakSharp uses Vitest for unit tests and Playwright for end-to-end tests.

*   **Run all unit tests:**
    ```bash
    pnpm test:unit:full
    ```
*   **Run all checks (lint, type-check, unit tests):**
    ```bash
    ./test-audit.sh
    ```

*   **Run end-to-end tests:**

    To run the full E2E suite, you first need to create a test-specific environment file.

    1.  **Create a `.env.test` file** in the root of the repository. This file is loaded by Playwright's configuration (`playwright.config.ts`) to provide necessary environment variables for the test run. A minimal example would be:
        ```env
        # Supabase (use mock values, as the real backend is mocked by MSW)
        VITE_SUPABASE_URL="http://localhost:54321"
        VITE_SUPABASE_ANON_KEY="your-supabase-anon-key"

        # Stripe (use a mock value)
        VITE_STRIPE_PUBLISHABLE_KEY="pk_test_your_stripe_pk"

        # Vite server port
        VITE_PORT=5173
        ```

    2.  **Run the tests:**
        ```bash
        pnpm test:e2e
        ```
        This command will automatically start the web server (both Vite and the Supabase mock server) using the `pnpm dev:foreground` script before running the Playwright tests.

## CI/CD

SpeakSharp uses GitHub Actions for CI/CD. The workflow is defined in `.github/workflows/ci.yml`. It runs a single, consolidated job that executes linting, type-checking, unit tests, and end-to-end tests on every push to ensure code quality and application stability.