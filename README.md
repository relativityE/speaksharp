**Owner:** [unassigned]
**Last Reviewed:** 2025-11-18

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

## Asset Organization

This project uses a hybrid approach for managing image assets:

### Public Assets (`public/assets/`)
- **Static files** that don't require build-time processing (e.g., `speaksharp-logo.png`)
- Referenced directly in code as `/assets/filename.ext`
- Served as-is by Vite

### Source Assets (`src/assets/`)
- **Build-optimized assets** that go through Vite's import pipeline
- JPEG images (`analytics-visual.jpg`, `hero-speaker.jpg`) are **symlinked** from `public/assets/`
  - Actual files: `public/assets/*.jpg`
  - Symlinks: `src/assets/*.jpg` → `../public/assets/*.jpg`
- This allows components to use standard ES imports while keeping the source files in one location
- SVG assets (`react.svg`) are stored directly in `src/assets/`

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
    **Why?** This is the canonical command for a full local quality check. It runs the same sequence as the CI `prepare` stage (Preflight, Lint, Typecheck, Unit Tests, Build) and then runs the **entire** End-to-End (E2E) test suite. It is the best way to guarantee your changes will pass CI.

*   **Run a fast "health check" of the application:**
    ```bash
    pnpm test:health-check
    ```
    **Why?** This is your go-to command during active development. It runs the full suite of pre-flight and quality checks but only executes the small, critical E2E "health check" suite instead of the full E2E suite. This provides a much faster feedback loop.

*   **Run only the unit tests:**
    ```bash
    pnpm test
    ```
    **Why?** The fastest possible feedback loop, useful when practicing Test-Driven Development (TDD) on a specific component.

### Software Quality Metrics (SQM)

The test runner automatically generates a Software Quality Metrics report.
*   When run locally (e.g., `pnpm test:all` or `pnpm test:health-check`), a summary is printed to your console.
*   When run in CI, the full report is automatically generated and committed to `docs/PRD.md`.

### Continuous Integration (CI)

The definitive quality gate is our CI pipeline, which runs in GitHub Actions. The workflow is defined in `.github/workflows/ci.yml` and is orchestrated by the `test-audit.sh` script. This ensures perfect consistency between the developer environment and the CI environment.
