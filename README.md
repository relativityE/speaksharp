# SpeakSharp

SpeakSharp is an AI-powered speech coaching application that helps users improve their public speaking skills. It provides real-time feedback on filler words, speaking pace, and more.

## Getting Started

To get started with SpeakSharp, you'll need to have Node.js (version 22.12.0 or higher) and pnpm installed.

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/relativityE/speaksharp.git
    ```
2.  **Change into the directory:**
    ```bash
    cd speaksharp
    ```
3.  **Run the Pre-flight Check (Mandatory First Step):**
    This script prepares your environment by installing dependencies, installing browser binaries, and running a smoke test to ensure stability.
    ```bash
    ./scripts/preflight.sh
    ```
4.  **Run the development server:**
    ```bash
    pnpm dev
    ```

## Testing and CI/CD

This project uses a unified testing strategy to ensure that local validation and the CI pipeline are perfectly aligned.

### The Local Audit Script: Your Primary Tool

For all local testing and validation, use the `test-audit.sh` script. It is the **single source of truth** for ensuring code quality.

*   **Run the full local audit (lint, type-check, all tests):**
    ```bash
    ./test-audit.sh all
    ```
    This command mirrors the exact checks that are run in the CI pipeline.

If you need to run specific test suites during development, you can use the following `package.json` scripts:

*   **Run all unit tests with coverage:**
    ```bash
    pnpm test:unit:full
    ```

*   **Run all end-to-end tests:**
    ```bash
    pnpm test:e2e
    ```

*   **Run only the smoke tests:**
    ```bash
    pnpm test:e2e:smoke
    ```

### Continuous Integration (CI)

The definitive quality gate is our CI pipeline, which runs in GitHub Actions on every push and pull request to the `main` branch. The workflow is defined in `.github/workflows/ci.yml` and is orchestrated by the same `./test-audit.sh` script used for local validation. This ensures perfect consistency between the developer environment and the CI environment.
