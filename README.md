# SpeakSharp

SpeakSharp is a privacy-first, real-time speech analysis tool designed to help users improve their public speaking skills. It provides instant, on-device feedback and is built as a modern, serverless SaaS web application using React (Vite) and Supabase.

## 📚 Documentation

All project documentation is located in the `/docs` directory. For a complete overview and map of the documentation, please see **[docs/OUTLINE.md](./docs/OUTLINE.md)**.

Here are the direct links to the core documents:

*   **[PRD.md](./docs/PRD.md)**: The "What & Why" - Product Requirements Document.
*   **[ARCHITECTURE.md](./docs/ARCHITECTURE.md)**: The "How" - System Architecture and technical deep dive.
*   **[ROADMAP.md](./docs/ROADMAP.md)**: The "When & Status" - Development plan and project status.

## 🚀 Getting Started

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

### Troubleshooting
*   **`rounded-pill` error on startup:** This is often a caching issue with Vite. Try deleting the `node_modules/.vite` directory and restarting the dev server.
*   **API Key errors (401 Unauthorized):** Ensure your `.env` file is correctly populated with the `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and any other required keys. Refer to `.env.example` for the full list.
*   **`toast` notifications not appearing:** This is a known issue in local development. Please see the full list of [Known Issues in the PRD](./docs/PRD.md#3-known-issues) for status.


## ✅ Testing

This project uses [Vitest](https://vitest.dev/) for unit and integration tests and [Playwright](https://playwright.dev/) for end-to-end tests.

*   **Run all tests:**
    ```bash
    pnpm test
    ```

*   **Run tests with UI:**
    ```bash
    pnpm test:ui
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
