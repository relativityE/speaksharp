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
3.  **Setup the environment:**
    Run once per environment or when errors occur:
    ```bash
    ./scripts/env-setup.sh
    ```
4.  **Run the development server:**
    ```bash
    pnpm dev
    ```

## Testing and CI/CD

This project uses a two-tiered testing strategy to balance rapid development with high code quality.

### Local Testing

For comprehensive local validation, use the new E2E orchestrator script. This script is designed to run a full, phase-locked E2E test suite, mirroring the checks that will eventually be run in a dedicated CI pipeline.

*   **Setup & Pre-Check:**
    Run once per environment or when errors occur:
    ```bash
    ./scripts/env-setup.sh
    ```
*   **Run the comprehensive local E2E test suite:**
    ```bash
    ./scripts/e2e-run.sh
    ```
    This script runs a full, 7-phase E2E test, including environment setup, DOM validation, and visual verification. All logs and artifacts are stored in the `./logs` directory.

If you need to run specific test suites, you can still use the following commands:

*   **Run all unit tests:**
    ```bash
    pnpm test:unit:full
    ```

*   **Run the full end-to-end test suite:**
    ```bash
    pnpm test:e2e
    ```

### Continuous Integration (CI)

The definitive quality gate is our CI pipeline, which runs in GitHub Actions on every push and pull request to the `main` branch. The workflow is defined in `.github/workflows/ci.yml`.

The CI pipeline runs a comprehensive set of checks, including:
- Linting
- Type-checking
- Unit tests
- The **full** end-to-end test suite

A commit must pass all checks in the CI pipeline before it can be merged.