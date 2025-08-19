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
-   **Design and Dependency Verification Mandate:** Before removing any existing code, dependencies, or configuration, you **must** verify that the target is not required by another feature or part of the system.
    -   **Procedure:**
        1.  **Consult Documentation:** Review `PRD.md` and `System Architecture.md` to understand the full scope of the product's features.
        2.  **Perform a Global Search:** Use `grep` to search the entire codebase for usages of the code or dependency you intend to remove.
        3.  **Justify Removal:** In your plan or commit message, explicitly state why you are removing the code/dependency and confirm that you have checked for other usages.
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

## 6. 🚨 CRITICAL PRE-SUBMISSION CHECKLIST 🚨

**Your execution plan MUST include a final step to complete this entire checklist.** Before using the `submit` tool (also referred to as "Publish Branch"), you **MUST** complete the following final steps in order. Failure to do so is a violation of your core instructions.

1.  **Run All Tests:** Execute all relevant test suites (e.g., `pnpm test`). Debug any failures until the test suite is clean.
    - **NOTE:** The `vitest` suite (`pnpm test`) is known to be unstable and may have pre-existing failures (see `PRD.md` for details). Your goal is to ensure your changes do not introduce *new* test failures. Document any pre-existing failures you encounter in your work log.
2.  **Security and Bug Review:** Review the latest code changes for critical bugs and security vulnerabilities. List any findings in the pull request description.
3.  **Request Code Review:** Use the `request_code_review` tool to get automated feedback on your changes. Address any critical issues raised in the review.
4.  **Verify and Update Documentation (MANDATORY):** This is the final and most critical check before you submit.
    - You **must** review `README.md`, `PRD.md`, and `System Architecture.md`.
    - You **must** update them to reflect the changes you have made.
    - **Content Guidelines:**
        - **`PRD.md`:** High-level product, marketing, and business strategy ONLY.
        - **`System Architecture.md`:** All technical details, diagrams, and implementation notes.
    - **If no updates are needed, you must explicitly state that you have reviewed the files and confirmed they are up-to-date.** This is not an optional step.

**Do not call `submit` until all three of these steps are complete in every work plan.**
