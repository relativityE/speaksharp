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
3.  **Install dependencies:**
    ```bash
    pnpm install
    ```
4.  **Run the development server:**
    ```bash
    pnpm dev
    ```

## Testing

SpeakSharp uses Vitest for unit tests and Playwright for end-to-end tests.

*   **Run all unit tests:**
    ```bash
    pnpm test:unit:full
    ```
*   **Run core unit tests:**
    ```bash
    pnpm test:unit:core
    ```
*   **Run end-to-end tests:**
    ```bash
    pnpm test:e2e
    ```
*   **Run the local audit script:**
    ```bash
    ./test-audit.sh
    ```

This will run linting, type-checking, and the core unit tests.

## CI/CD

SpeakSharp uses GitHub Actions for CI/CD. The workflow is defined in `.github/workflows/ci.yml`. The pipeline is designed to be fast and efficient, with parallel jobs for different types of tests.