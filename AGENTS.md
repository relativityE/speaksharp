# Agent Instructions for SpeakSharp Repository

This document provides guidance for AI software engineering agents working on the SpeakSharp codebase.

## 1. Technology Stack

- **Frontend:** React (with Vite)
- **Styling:** Tailwind CSS & shadcn/ui
- **Backend:** Supabase (PostgreSQL, Auth, Edge Functions)
- **Testing:**
    - **Vitest:** For unit and integration tests (`.test.jsx`). This is the primary test runner.
    - **Playwright:** For end-to-end tests that require a real browser environment (`.spec.ts`).
- **Package Manager:** `pnpm`

## 2. Getting Started & Running Tests

1.  **Install Dependencies:** Always start by running `pnpm install` to ensure all dependencies are present.
2.  **Run the Main Test Suite (Vitest):** Before submitting any changes, you **must** run the Vitest suite and ensure all tests pass.
    ```bash
    pnpm test
    ```
3.  **Run the E2E Test Suite (Playwright):** If you make changes to the speech recognition service or other browser-specific features, run the Playwright suite.
    ```bash
    npx playwright test
    ```

## 3. Key Architectural Principles & Conventions

-   **Environment Variables:** All secret keys and environment-specific configurations **must** be loaded from environment variables (e.g., `import.meta.env.VITE_...`). Do **not** hardcode keys in the source code. The Vitest environment is configured to use `.env.test` for its variables.
-   **Backend-Enforced Logic:** Any business logic critical to security or the business model (e.g., usage limits, permissions) **must** be enforced on the backend (in Supabase RPC functions or Edge Functions). Do not rely on client-side checks for security.
-   **Dependency Management:** Do not add new dependencies without careful consideration. Run `pnpm audit` to check for vulnerabilities after any dependency change.
-   **Testing `useSpeechRecognition`:** The `useSpeechRecognition` hook has a complex dependency on the `TranscriptionService`. The Vitest tests for this hook (`src/__tests__/useSpeechRecognition.test.jsx`) use `vi.mock()` to mock this service at the module level. This is the preferred way to test the hook's logic. Do not attempt to mock the service in Playwright unless absolutely necessary, as it is significantly more complex.

## 4. Code Style & Linting

-   Follow the existing code style.
-   Run the linter to check for issues: `pnpm run lint`.

## 5. Branching and Pull Request (PR) Workflow

Jules, an asynchronous coding agent, offers a streamlined workflow for publishing changes and creating pull requests (PRs).
Here's how to use the "Publish Branch" and "Open PR" features within Jules:

**Publish Branch:**
After Jules completes its tasks and makes changes to the code, locate the "Publish Branch" button.
Clicking this button will push Jules's changes to a new branch on GitHub, making the work available for collaboration.

**Open PR (Pull Request):**
Next to the "Publish Branch" button, you'll find a new dropdown menu.
Select "Open PR" from this dropdown to create a pull request.
Jules will automatically configure the PR to merge the newly published branch into the main branch, simplifying the process of getting changes reviewed and merged.

This functionality within Jules simplifies the process of making changes, publishing them, and submitting them for review, leading to faster merging and reduced context switching.

## 6. Pre-Submission Checklist

Before generating a pull request, you **must** perform the following steps, unless explicitly waived by the user.

1.  **Update `AGENTS.md`:** Review and update the "1. Technology Stack" and "2. Getting Started & Running Tests" sections of this file to reflect any changes to dependencies, build tools, or test commands.
2.  **Update Documentation:** Review and update all other Markdown files (`.md`) to reflect the code changes you have made. This is critical for keeping the project documentation in sync with the codebase.
3.  **Run Comprehensive Analysis:** Execute the following prompt to perform a full analysis of the codebase. This helps to identify any new issues or regressions introduced by your changes.

    > You are acting as a combined Principal Software Engineer, Security Architect, and Senior Code Reviewer. Analyze the codebase in the main branch of the SpeakSharp GitHub repository. Your task is to identify and prioritize all known and likely issues in these categories:
    >
    > Bugs — incorrect logic, runtime errors, failing tests, regressions.
    >
    > Security issues — insecure API handling, unsafe data processing, vulnerabilities in dependencies, potential injection or XSS risks.
    >
    > Bad design or architecture — poor separation of concerns, anti-patterns, excessive coupling, scalability bottlenecks.
    >
    > Output format (grouped and ranked):
    >
    > Critical — Issues that break core functionality, cause security vulnerabilities, or block deployment.
    >
    > High — Significant usability, performance, or maintainability problems that could lead to bigger issues.
    >
    > Medium — Non-blocking issues that degrade UX, maintainability, or efficiency.
