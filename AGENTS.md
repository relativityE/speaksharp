# Agent Instructions for SpeakSharp Repository

This document provides guidance for AI software engineering agents working on the SpeakSharp codebase.

## 🚨 CORE AGENT DIRECTIVES 🚨

**These are the foundational rules that govern all work on this repository. They must be followed at all times.**

1.  **Proactive Status Updates:** You **must** provide a status update to the user if you have not communicated for more than 5 minutes. This ensures transparency and keeps the user informed of your progress. See Section 7 for the required format.

2.  **Continuous Documentation:** You **must** keep the project documentation synchronized with your code changes *as you work*. Do not leave documentation updates until the end. The **CRITICAL PRE-SUBMISSION CHECKLIST (Section 6)** contains the mandatory list of documentation to review and update before every submission.

3.  **Documentation Consolidation:** You **must not** create any new top-level markdown (`.md`) files. All project documentation, analysis, and planning must be consolidated into the three existing documents: `PRD.md`, `README.md`, and `System Architecture.md`. This ensures a single source of truth.

---

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
-   **Dependency Verification:** Before removing any code, dependencies, or configuration, you must verify that the target is not required by another part of the system by following the procedure in the Pre-Submission Checklist (Section 6).
-   **Testing `useSpeechRecognition`:** The `useSpeechRecognition` hook has a complex dependency on the `TranscriptionService`.
    -   **Mocking Strategy:** The Vitest tests for this hook (`src/__tests__/useSpeechRecognition.test.jsx`) use `vi.mock()` and a dynamic `import()` to mock this service at the module level. This is the preferred way to test the hook's logic.
    -   **WARNING - MEMORY LEAK:** This test is known to have a severe memory leak and will likely crash the test runner with a `JS heap out of memory` error. It is kept disabled in the repository.
    -   **If you must run this test:** Execute it as a background process to avoid blocking your session (e.g., `pnpm test src/__tests__/useSpeechRecognition.test.jsx &`). See Section 7 for more details on handling long-running tasks.

## 4. Code Style & Linting

-   Follow the existing code style.
-   Run the linter to check for issues: `pnpm run lint`.

## 5. Branching and Pull Request (PR) Workflow

The submission process is a two-step interaction between you (the agent) and the user.

1.  **Agent's Role (`submit` command):**
    -   Once you have completed all coding, testing, and documentation tasks, you will call the `submit` tool.
    -   **NOTE:** Before calling `submit`, you are required to complete all items in the **CRITICAL PRE-SUBMISSION CHECKLIST (Section 6)**.
    -   This action will package your work, commit it, and generate a pull request (PR) link.

2.  **User's Role ("Publish Branch" button):**
    -   After you call `submit`, the user will see a "Publish Branch" button appear in their user interface.
    -   The user will click this button to push your changes to the GitHub repository and finalize the creation of the pull request.

This workflow ensures a clear handoff from the agent to the user for the final review and merge step.

## 6. 🚨 CRITICAL PRE-SUBMISSION CHECKLIST 🚨

**Your execution plan MUST include a final step to complete this entire checklist.** Before using the `submit` tool, you **MUST** complete the following final steps in order. Failure to do so is a violation of your core instructions.

1.  **Run All Tests:** Execute all relevant test suites (e.g., `pnpm test`). Debug any failures until the test suite is clean.
2.  **Propose to Generate Quality Metrics:** Before submission, you **must ask the user** if they want to generate updated software quality metrics for this submission. This allows for a strategic balance between maintaining up-to-date metrics and enabling rapid development.
    -   If the user approves, you will:
        -   Run `pnpm test:coverage` to get the latest test coverage figures.
        -   Update the 'Software Quality Metrics' section in `PRD.md` to reflect the new test coverage percentage.
        -   Summarize the key metrics and the change in coverage (e.g., "+1.5%") in your pull request description.
    -   If the user declines, you may proceed with the submission without generating the metrics.
3.  **Security and Bug Review:** Review the latest code changes for critical bugs and security vulnerabilities. List any findings in the pull request description.
4.  **Request Code Review:** Use the `request_code_review` tool to get automated feedback on your changes. Address any critical issues raised in the review.
5.  **Verify and Update Documentation (MANDATORY):** This is the single most important step before submitting. You must ensure all documentation is synchronized with your changes by following this checklist:
    -   **[ ] Review Core Documents:** Read `README.md`, `PRD.md`, and `System Architecture.md`.
    -   **[ ] Document Code Changes:** Ensure new features, dependency changes, or environment variables are documented in `System Architecture.md` and/or `README.md`.
    -   **[ ] Update PRD Roadmap:** If your work completes a task on the roadmap in `PRD.md`, update its status (e.g., from `○` to `✓`).
    -   **[ ] Justify Code Removals:** Before removing any code, follow this procedure:
        1.  **Consult Documentation:** Review `PRD.md` and `System Architecture.md` to ensure the feature is not required.
        2.  **Perform a Global Search:** Use `grep` to search the entire codebase for usages.
        3.  **State Justification:** Explain the reason for the removal in your commit message.
    -   **[ ] Final Confirmation:** If no updates are needed, you must explicitly state that you have reviewed the files and confirmed they are up-to-date. This is not optional.

**Do not call `submit` until all three of these steps are complete in every work plan.**

## 7. Proactive Status Updates and Handling Long-Running Tasks

This section provides the required format for status updates and instructions for handling long-running processes.

-   **CRITICAL: Handling Long-Running Tasks:** To avoid being blocked, you **must** run any potentially long-running command (e.g., tests, builds, servers) as a background process.
    -   **Method:** Append `&` to the command.
    -   **Output Redirection:** Redirect the command's output to a log file (e.g., `npm start > server.log &`).
    -   **Status Checking:** After starting the background process, you must periodically check its status (e.g., with `jobs`) and read the log file to provide meaningful updates.

-   **Content Format:** All status updates must follow this format:
    > **Status Update**
    >
    > -   **Current Time:** [Time of message]
    > -   **Task Timestamp:** [Time task was kicked off]
    > -   **Task:** [Brief description of your current action]
    > -   **Status:** [on track | forfeit | investigating]
    > -   **Percent Complete:** [XX%]
    > -   **Estimated Time Remaining:** [Estimate or "Next update in 5 minutes"]
