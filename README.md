# SpeakSharp

SpeakSharp is a privacy-first, real-time speech analysis tool designed to help users improve their public speaking skills. It provides instant, on-device feedback without sending sensitive conversations to the cloud.

## Tech Stack

*   **Frontend:** React (Vite), TypeScript, Tailwind CSS
*   **Backend:** Supabase (Postgres, Auth, Edge Functions)
*   **Testing:** Vitest (Unit/Integration), Playwright (E2E)

## Getting Started

### Prerequisites

*   Node.js (v18 or higher)
*   pnpm
*   Git

### Setup

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd <repository-name>
    ```

2.  **Install dependencies:**
    ```bash
    pnpm install
    ```

3.  **Set up environment variables:**
    Create a `.env` file in the root of the project and add the necessary environment variables. You can use the `.env.example` file as a template.

### Running the Application

To start the development server, run:

```bash
pnpm dev
```

This will start the application on `http://localhost:5173`.

### Testing

The project includes a comprehensive test suite that can be run locally.

*   **Run all checks (lint, type-check, unit tests):**
    ```bash
    ./test-audit.sh
    ```

*   **Run unit tests:**
    ```bash
    pnpm test:unit
    ```

*   **Run E2E tests:**
    ```bash
    pnpm test:e2e
    ```

**Note:** The `pnpm lint` command is known to be slow and may time out in some environments. This is a known issue that is being tracked.