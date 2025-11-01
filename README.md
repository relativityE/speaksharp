**Owner:** [unassigned]
**Last Reviewed:** 2025-11-01

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

For all local testing and validation, use the `./test-audit.sh` script. It is the **single source of truth** for ensuring code quality. The script is designed to be developer-friendly and robust.

**Automatic Dependency Installation:** If you run this script in a fresh checkout without having installed dependencies, it will automatically detect the missing `node_modules` directory and run `pnpm install` for you.

**Usage:**

*   **To run the complete CI pipeline locally (recommended before any commit):**
    ```bash
    ./test-audit.sh all
    ```
    **Why?** This is the most important command. It guarantees that your changes meet all the quality gates (linting, type safety, unit tests, E2E tests) that the CI server will enforce. Running this locally prevents broken builds and failed pull requests.

*   **To run specific stages for faster feedback during development:**
    Sometimes you need a faster feedback loop. For that, you can run individual stages of the audit:
    *   `./test-audit.sh lint`: Use this when you've made stylistic changes and want a quick check for code quality.
    *   `./test-audit.sh typecheck`: Use this after refactoring or changing function signatures to ensure type safety across the project.
    *   `./test-audit.sh unit`: Use this for rapid feedback when practicing Test-Driven Development (TDD) on a specific component.
    *   `./test-audit.sh e2e`: Use this to validate a full user flow after making significant UI or application logic changes.
    *   `./test-audit.sh metrics`: This stage is mostly for CI, but you can run it locally to regenerate the metrics in `docs/PRD.md` after a full test run.

For a faster, lighter-weight check to simply validate that your environment is set up correctly, you can use the `preflight.sh` script.

*   **Run the pre-flight environment check:**
    ```bash
    ./scripts/preflight.sh
    ```
    This script is designed to be a quick pass/fail test to ensure your dependencies, browser binaries, and basic application startup are all working before you begin development or run the full test suite.

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
