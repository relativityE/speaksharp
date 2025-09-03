# SpeakSharp

SpeakSharp is a privacy-first, real-time speech analysis tool designed to help users improve their public speaking skills. It provides instant, on-device feedback and is built as a modern, serverless SaaS web application using React (Vite) and Supabase.

## Project Documentation

This repository contains several key documents that outline the project's goals, architecture, and status.

*   **[Product Requirements Document (PRD.md)](./PRD.md):** Detailed information about the product, its features, user requirements, known issues, and success metrics.
*   **[System Architecture](./System Architecture.md):** A description of the technical architecture, technology stack, and data flow.
*   **[Project Board](./PROJECT_BOARD.md):** The canonical source for the development roadmap and task status, prioritized using the MoSCoW method.
*   **[Agent Instructions](./AGENTS.md):** Core directives and instructions for AI agents working on this codebase.
*   **[Testing Strategy](./System Architecture.md#6-testing-strategy):** The canonical guide to testing, debugging, and verification for this project.

## Getting Started

### Prerequisites

*   [Node.js](https://nodejs.org/) (v18 or higher)
*   [pnpm](https://pnpm.io/)
*   [Supabase CLI](https://supabase.com/docs/guides/cli)

### Installation and Setup

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd speaksharp
    ```

2.  **Install dependencies:**
    ```bash
    pnpm install
    ```

3.  **Set up environment variables:**
    Create a `.env` file in the root of the project by copying the example file:
    ```bash
    cp .env.example .env
    ```
    Populate the `.env` file with your Supabase project URL and anon key, as well as any other required service keys.

4.  **Run database migrations (if using a local Supabase instance):**
    ```bash
    supabase db reset
    ```

### Running the Development Server

To start the Vite development server, run:

```bash
pnpm dev
```

The application will be available at `http://localhost:5173`.

## Development Conventions

### Structured Logging

The project uses `pino` for structured logging. To log messages, import the logger instance from `src/lib/logger.js` and use its methods.

**Example:**
```javascript
import logger from '@/lib/logger'; // Use appropriate relative path or alias

// Log a simple informational message
logger.info('User has started a new session.');

// Log an error with a structured object
logger.error({ error: new Error('Something went wrong'), sessionId: '123' }, 'An error occurred during payment processing.');

// Log a warning
logger.warn({ userId: 'abc' }, 'User profile is missing an avatar.');
```
This provides more context than a simple `console.log` and helps with debugging.

## Testing

This project uses [Vitest](https://vitest.dev/) for unit and integration tests and [Playwright](https://playwright.dev/) for end-to-end tests.

*   **Run all tests:**
    ```bash
    pnpm test
    ```

*   **Run tests with UI:**
    ```bash
    pnpm test:ui
    ```

*   **Run tests with coverage:**
    *Note: This is currently broken due to a memory leak.*
    ```bash
    pnpm test:coverage
    ```

*   **Run E2E tests:**
    ```bash
    pnpm test:e2e
    ```

## Linting

To check the code for linting errors, run:

```bash
pnpm run lint
```
