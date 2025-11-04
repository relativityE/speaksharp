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

The `test-audit.sh` script has been optimized for different stages of the development workflow. Use the following commands for a balance of speed and thoroughness.

*   **For Quick, Iterative Development (Fast Feedback):**
    ```bash
    pnpm audit:fast
    ```
    This command is designed for speed. It runs a minimal set of checks to give you a quick signal while you are actively coding. It performs a quick preflight check, lints only your changed files, and runs unit tests and a single E2E health check. It intentionally skips slower steps like the full type-check and production build.

*   **For Pre-Commit Confidence (Comprehensive Local Check):**
    ```bash
    pnpm audit:local
    ```
    This is the recommended command to run before you commit your code. It runs a full, optimized validation that is much more thorough than the `fast` command. It includes the preflight check, parallelized linting and unit tests, a full type-check, and the complete E2E suite. This provides a high degree of confidence that your changes are sound.

*   **For Simulating the Full CI Pipeline (Pre-Push):**
    ```bash
    pnpm audit
    ```
    This command (`pnpm audit` is an alias for `./test-audit.sh all`) runs the exact same, comprehensive sequence that the CI server runs. It is the most thorough check and guarantees that your changes will pass the CI pipeline. It includes all steps from the `local` audit, plus the production build, E2E test sharding, and report generation. Run this before you push your branch to avoid broken builds.

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

## Troubleshooting: Environment Recovery

If you encounter persistent or unusual errors during testing—such as port conflicts, zombie Vite processes, or inconsistent test failures—your local development environment may have become unstable.

We provide a script to safely reset the environment.

*   **Run the environment stabilizer:**
    ```bash
    ./env-stabilizer.sh
    ```
    This script will gracefully kill any lingering Vite or Vitest processes, ensuring a clean slate for your next test run. It is a safe and effective first step for resolving mysterious test failures.
