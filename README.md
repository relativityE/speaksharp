# SpeakSharp

A real-time speech analysis tool to help you speak more confidently.

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- pnpm (v10.4.1 or higher)
- Supabase Account (for backend services)

### Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/relativityE/speaksharp.git
    cd speaksharp
    ```

2.  **Install dependencies:**
    ```bash
    pnpm install
    ```

3.  **Set up environment variables:**
    Create a file named `.env.local` in the root of the project. You can use `.env.example` as a template. For a detailed explanation of the required keys and services, please see the **Environment Variables** section in the `System Architecture.md` file.

4.  **Start the development server:**
    ```bash
    pnpm run dev
    ```

5.  Open your browser and navigate to the URL shown in your terminal (usually `http://localhost:5173`).

## Running Tests

-   **Unit & Integration Tests (Vitest):**
    ```bash
    pnpm test
    ```

-   **End-to-End Tests (Playwright):**
    ```bash
    npx playwright test
    ```

-   **Backend Function Tests (Deno):**
    ```bash
    pnpm run test:functions
    ```
