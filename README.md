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
    ```bash
    pnpm test:e2e
    ```

### Debugging End-to-End Tests
The project uses a custom Playwright fixture that automatically logs every step and action to the console. If a test fails in the CI/CD environment, the logs will contain detailed information about the last successful step and a base64-encoded screenshot of the failure.

For a complete guide on how to interpret these logs and debug failed E2E tests, please see the **"Debugging E2E Test Failures"** section in `AGENTS.md`.

## CI/CD

SpeakSharp uses GitHub Actions for CI/CD. The workflow is defined in `.github/workflows/ci.yml`. It runs a single, consolidated job that executes linting, type-checking, unit tests, and end-to-end tests on every push to ensure code quality and application stability.