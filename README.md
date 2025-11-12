**Owner:** [unassigned]
**Last Reviewed:** 2025-11-12

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
3.  **Install Dependencies from Lockfile:**
    ```bash
    pnpm run setup
    ```
4.  **Run the development server:**
    ```bash
    pnpm dev
    ```

### Stabilizing the Environment by Enforcing the Lockfile

**This is a critical step to prevent "works on my machine" issues.**

This project uses a strict `pnpm-lock.yaml` file to guarantee that every developer and every CI run uses the exact same dependency versions. If you encounter unexpected build, type-check, or linting errors in a fresh environment, it is likely due to dependency drift.

**To fix this, you must enforce the lockfile:**

1.  **Delete the `node_modules` directory:**
    ```bash
    rm -rf node_modules
    ```
2.  **Re-install using the canonical setup script:**
    ```bash
    pnpm run setup
    ```

The `pnpm run setup` command executes `pnpm install --frozen-lockfile`, which is the **only** correct way to install dependencies in this project. It forces pnpm to install the exact versions specified in the lockfile, ensuring a reproducible environment.

## Running the Full Test & Audit Suite

This project uses a unified testing strategy centered around a single, robust script (`test-audit.sh`) that is accessed via simple `pnpm` commands. This ensures that local validation and the CI pipeline are perfectly aligned.

### The Canonical Test Commands

For all local testing and validation, use the following `pnpm` scripts. They are the **single source of truth** for ensuring code quality.

*   **Run the complete CI pipeline locally (recommended before any commit):**
    ```bash
    pnpm test:all
    ```
    **Why?** This is the most important command. It mirrors the CI server exactly and guarantees that your changes meet all quality gates: linting, type safety, unit tests, a production-like build, and the full end-to-end (E2E) test suite.

*   **Run a fast, local-only test run (skips full E2E):**
    ```bash
    pnpm test:all:fast
    ```
    **Why?** This is your go-to command during development. It runs all the same checks as the full test run but skips the time-consuming full E2E suite, providing a much faster feedback loop.

*   **Run a quick "health check" of the application:**
    ```bash
    pnpm test:all:health
    ```
    **Why?** Use this for a quick sanity check. It runs a minimal set of checks to ensure the application is not fundamentally broken.

*   **Run only the unit tests:**
    ```bash
    pnpm test
    ```
    **Why?** The fastest possible feedback loop, useful when practicing Test-Driven Development (TDD) on a specific component.

### Software Quality Metrics (SQM)

The test runner automatically generates a Software Quality Metrics report.
*   When run locally (`pnpm audit:fast` or `pnpm audit:health`), a summary is printed to your console.
*   When run in CI (`pnpm audit`), the full report is automatically updated in `docs/PRD.md`.

### Continuous Integration (CI)

The definitive quality gate is our CI pipeline, which runs in GitHub Actions. The workflow is defined in `.github/workflows/ci.yml` and is orchestrated by the `pnpm audit` command, ensuring perfect consistency between the developer environment and the CI environment.
