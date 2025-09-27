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

## CI/CD

SpeakSharp uses GitHub Actions for CI/CD. The workflow is defined in `.github/workflows/ci.yml`. It runs a single, consolidated job that executes linting, type-checking, unit tests, and end-to-end tests on every push to ensure code quality and application stability.