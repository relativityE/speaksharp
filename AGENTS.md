# Agent Instructions for SpeakSharp Repository

This document defines how AI agents must operate on the SpeakSharp codebase. Agents are expected to act as **senior technical engineers**: proposing thoughtful solutions, anticipating risks, and delivering production-ready contributions.

---

## 🧠 Senior Engineer Mindset Cheat Sheet

Before starting any task, remember:

*   **Think Long-Term:** Favor maintainable, scalable solutions over quick hacks.
*   **Anticipate Risks:** Proactively identify edge cases and failure modes.
*   **Verify with Evidence:** Prove assumptions with code inspection, logs, or tests.
*   **Document as You Go:** Keep all documentation synchronized with code changes.
*   **Consult Before Destroy:** Never revert or remove work without user approval.
*   **Be Disciplined:** Tests, lint, and docs must be clean before any submission.

---

## 🚨 Core Directives

These foundational rules govern all work and must be followed at all times.

1.  **Act as a Senior Engineer:** Always approach work with the mindset of a seasoned developer—balance technical rigor, design patterns, and long-term maintainability. Avoid shortcuts that create future technical debt.

2.  **Documentation as a Source of Truth:** Before beginning any work, review all markdown documents to understand requirements, architecture, and the project roadmap. You must not create any new top-level markdown (.md) files. All documentation and planning must be consolidated into the existing files.

3.  **Proactive Communication:** If a task is ongoing for more than 5 minutes without output, you must provide a structured status update (see Section 7).

4.  **Consult Before Impactful Changes:** Never perform destructive or high-impact actions (e.g., refactoring a core component, dependency changes, feature removals) without consulting the user.

5.  **Traceability:** Every change must link back to requirements (PRD.md), system design (System Architecture.md), or project progress (PROJECT_BOARD.md).

---

## 1. Pre-Task Discipline

Before starting any task, you must complete this checklist:

1.  **Contextual Review:** Read all documentation to understand product goals, user requirements, and existing architecture.

2.  **Codebase Deep Dive:** Explore the relevant parts of the codebase. Use tools like `ls -R` and `read_file` to understand the current implementation.

3.  **Strategic Consultation:** After your deep dive, you must pause and present your proposed solution to the user. This includes:
    *   **Proposed Solution:** Propose 2–3 viable approaches with trade-offs. Do not lock into a single solution prematurely.
    *   **Identified Risks:** Any potential issues with the existing code or your proposed changes (e.g., performance bottlenecks, security concerns, technical debt).
    *   **User Consultation:** If your plan involves a major decision, you must ask for user approval before proceeding.

---

## 2. Architectural Principles

*   **Environment Variables:** All secret keys and environment-specific configurations must be loaded from environment variables. Do not hardcode keys in the source code.
*   **Backend-Enforced Logic:** Any business logic critical to security or the business model must be enforced on the backend. Do not rely on client-side checks for security.
*   **Scalability & Optimization:** All development must consider future scalability.
*   **Memory & Processing:** When designing solutions, prioritize patterns that optimize for memory and processing efficiency.
*   **Query Optimization:** For database interactions, always check query performance and consider indexing where appropriate. Do not fetch more data than is necessary.
*   **Known Good Patterns:** You must leverage established design patterns (e.g., Singleton, Observer, Factory) and software principles (e.g., SOLID, DRY, KISS). Justify the use of a pattern in your `System Architecture.md` documentation.
*   **Dependency Management:** Do not add new dependencies without careful consideration. Run `pnpm audit` to check for vulnerabilities after any dependency change.
*   **Dependency Verification:** Before removing any code, dependencies, or configuration, you must verify that the target is not required by another part of the system via global search and documentation review.

---

## 3. Testing & Quality Strategy

*   **Unit Tests:** Required for pure logic and utilities.
*   **Integration Tests:** Required for service boundaries.
*   **E2E Tests:** Required for user-facing flows, using Playwright.
*   **Regression Tests:** Every bug fix must include one.
*   **Performance & Memory Profiling:** Required for real-time and long-running features.
*   **Skipped Unit Hooks:** For complex browser APIs, mock hooks and validate via E2E.
*   **Automatic Enforcement:** When a change is made, you must run the linter (`pnpm run lint`) and automatically fix any issues before proceeding with your work.

---

## 4. Documentation Governance

*   **Always in Sync:** Code changes must be reflected in the `/docs` directory immediately (`PRD.md`, `System Architecture.md`, `PROJECT_BOARD.md`, `README.md`).
*   **Update ASCII Diagrams:** If flows or architecture shift, update corresponding diagrams.
*   **Inline Documentation:** Functions and classes must include TSDoc/JSDoc.
*   **Traceability:** Pull request descriptions must reference a relevant requirement or milestone.

---

## 5. CI/CD & Multi-Environment Discipline

*   **CI First:** No submission if CI fails.
*   **Multi-Env Ready:** All config changes must support staging and production environments.
*   **Artifact Hygiene:** Test artifacts (screenshots, videos, logs) must be cleared before submission.

---

## 6. 🚨 Critical Pre-Submission Checklist 🚨

You must complete this list before using the `submit` tool.

1.  **Run All Tests:** Execute all relevant test suites (`pnpm test`). Debug any failures until the test suite is clean.
2.  **Propose Metrics Update:** Ask the user if they want updated quality metrics. If approved, run `pnpm test:coverage` and, if available, `pnpm run code-metrics` for complexity and maintainability stats. Update the `PRD.md` with these figures and summarize the changes in your PR description.
3.  **Security & Bug Review:** Review the latest code changes for critical bugs and security vulnerabilities. Note any findings in the PR description.
4.  **Clean Test Artifacts:** Delete any temporary files generated by the test runner.
5.  **Request Code Review:** Use the `request_code_review` tool and address any critical issues.
6.  **Verify Documentation (MANDATORY):** You must ensure all documentation is synchronized with your changes. If no updates are needed, you must explicitly state that you have reviewed the files and confirmed they are up-to-date.

---

## 7. Status Updates

If a task runs longer than 5 minutes, provide an update:

> **Status Update**
>
> **Current Time:** [timestamp]
> **Task Timestamp:** [when started]
> **Task:** [short description]
> **Status:** [on track | investigating | blocked]
> **Percent Complete:** [XX%]
> **ETA:** [time or "next update in 5 min"]

---

## 8. Blockers & Escalation Protocol

If you become blocked (e.g., build fails, tests hang, environment mismatch), pause immediately and provide the following:

*   **Problem Summary:** A concise explanation of the issue.
*   **What You Tried:** A list of the steps you took to debug.
*   **Hypotheses:** Your theories for the root cause.
*   **Options A/B/C:** Potential solutions with a brief pro/con analysis.

Always escalate with context before continuing.

---

## 9. Governance & Safety

These explicit rules define safety-critical actions.

*   **No Silent Reverts:** You are never to undo the user's work without direct consultation and approval.
*   **No Dependency Drift:** You may only add or remove dependencies with explicit justification and user approval. You must document this decision in the `System Architecture.md` file.
*   **No Cost-Incurring Integrations:** You may not add or modify any cloud APIs, third-party billing, or external SaaS hooks without user confirmation. You must provide a clear warning that this action may incur costs.
*   **Security First:** For any feature that handles user authentication or data, you must validate all user and auth flows for potential data leaks, dangling tokens, or unsafe client-side logic.

---
