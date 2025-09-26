# SpeakSharp

SpeakSharp is an AI-powered speech coaching application that helps users improve their public speaking skills. It provides real-time feedback on filler words, speaking pace, and more.

## Getting Started

To get started with SpeakSharp for development or testing, you'll need to have Node.js and pnpm installed.

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
    pnpm run setup:dev
    ```
    This command installs all necessary npm packages and downloads the browsers required by Playwright.

4.  **Run the development server:**
    ```bash
    pnpm dev
    ```
    The application will be available at `http://localhost:5173`.

## Testing

SpeakSharp uses Vitest for unit tests and Playwright for end-to-end tests. The test environment is configured to use a mock backend.

*   **Run all unit tests:**
    ```bash
    pnpm test:unit:full
    ```
*   **Run end-to-end tests:**
    ```bash
    pnpm test:e2e
    ```
    This command will automatically start the Vite server and run all Playwright tests in headless mode.

*   **Run the local audit script:**
    ```bash
    ./test-audit.sh
    ```
    This script will run linting, type-checking, and the core unit tests.

## CI/CD

The CI/CD pipeline is managed through custom scripts in the repository root. The primary entry point for local validation is `./test-audit.sh`. The full E2E suite is run via `pnpm test:e2e`, which is configured in `playwright.config.ts` to manage the test server lifecycle.