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
3.  **Install all dependencies and browser binaries:**
    ```bash
    pnpm setup
    ```
4.  **Run the development server:**
    ```bash
    pnpm dev
    ```

## Testing and CI/CD

This project uses a new, unified testing strategy centered around a single, robust script (`test-audit.sh`) that is accessed via simple `pnpm` commands. This ensures that local validation and the CI pipeline are perfectly aligned.

### The Canonical Audit Commands

For all local testing and validation, use the following `pnpm` scripts. They are the **single source of truth** for ensuring code quality.

*   **Run the complete CI pipeline locally (recommended before any commit):**
    ```bash
    pnpm audit
    ```
    **Why?** This is the most important command. It mirrors the CI server exactly and guarantees that your changes meet all quality gates: preflight checks, linting, type safety, unit tests, a production-like build, and the full end-to-end (E2E) test suite. Running this locally prevents broken builds.

*   **Run a fast, local-only audit (no E2E tests):**
    ```bash
    pnpm audit:fast
    ```
    **Why?** This is your go-to command during development. It runs all the same checks as the full audit but skips the time-consuming E2E tests, providing a much faster feedback loop.

*   **Run a quick "health check" of the application:**
    ```bash
    pnpm audit:health
    ```
    **Why?** Use this for a quick sanity check. It runs the entire audit pipeline but only executes the single, critical "smoke test" in the E2E stage, ensuring the application is not fundamentally broken.

*   **Run only the unit tests:**
    ```bash
    pnpm test
    ```
    **Why?** The fastest possible feedback loop, useful when practicing Test-Driven Development (TDD) on a specific component.

*   **Capture visual snapshots of the application:**
    ```bash
    pnpm test:screenshots
    ```
    **Why?** Use this to generate a set of screenshots of key application states (e.g., logged out, logged in, analytics page). This is useful for visual regression testing and for quickly verifying the look and feel of the application.

### Software Quality Metrics (SQM)

The test runner automatically generates a Software Quality Metrics report.
*   When run locally (`pnpm audit:fast` or `pnpm audit:health`), a summary is printed to your console.
*   When run in CI (`pnpm audit`), the full report is automatically updated in `docs/PRD.md`.

### Continuous Integration (CI)

The definitive quality gate is our CI pipeline, which runs in GitHub Actions. The workflow is defined in `.github/workflows/ci.yml` and is orchestrated by the `pnpm audit` command, ensuring perfect consistency between the developer environment and the CI environment.
