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
3.  **Install Dependencies (Canonical Method):**
    This is the required command to install dependencies. It uses a frozen lockfile to ensure that the exact versions of all packages are installed, creating a consistent and reproducible environment that matches CI.
    ```bash
    pnpm setup
    ```
4.  **Run the development server:**
    ```bash
    pnpm dev
    ```

## Running the Full Test & Audit Suite

This project uses a unified testing strategy to ensure that local validation and the CI pipeline are perfectly aligned. The `./test-audit.sh` script is the **single source of truth** for all testing, and it is wrapped by a series of `pnpm` scripts for ease of use.

### Primary Local Audit Command

To run the complete CI pipeline locally (recommended before any commit), use the following command:

```bash
pnpm run audit:full
```

**Why?** This is the most important command. It guarantees that your changes meet all the quality gates (linting, type safety, unit tests, E2E tests) that the CI server will enforce. Running this locally prevents broken builds and failed pull requests. **Note:** This command may time out in some environments. If it does, use the staged execution below.

### Staged Execution (Mirroring CI)

To mirror the CI pipeline's staged execution and avoid timeouts, run the commands in the following order:

1.  **Prepare the environment:**
    This command lints, type-checks, builds the application, and runs all unit tests.
    ```bash
    pnpm run audit:prepare
    ```
2.  **Run the E2E tests:**
    The `prepare` stage splits the E2E tests into groups called "shards". You can run them all sequentially with one command, or run a specific shard.
    *   To run all E2E shards:
        ```bash
        pnpm run audit:e2e -- --all
        ```
    *   To run a specific shard (e.g., shard 0):
        ```bash
        pnpm run audit:e2e -- --shard=0
        ```
3.  **Generate the final report:**
    This command is primarily for CI use, but you can run it locally to merge the E2E test reports and update the metrics in `docs/PRD.md`.
    ```bash
    pnpm run audit:report
    ```
