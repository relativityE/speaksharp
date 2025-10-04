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

## Testing and CI/CD

This project uses a two-tiered testing strategy to balance rapid development with high code quality.

### Local Testing

For comprehensive local validation, use the local audit script. This script is designed to mirror the checks run in our CI pipeline and is the recommended check to run before committing your changes.

*   **Run the comprehensive local audit:**
    ```bash
    ./test-audit.sh
    ```
    This script runs a full suite of checks, including: linting, type-checking, a production build, all unit tests, and the complete E2E test suite. Running this script locally is the best way to ensure your changes will pass in CI.

If you need to run specific test suites, you can use the following commands:

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