# SpeakSharp Product Requirements Document

**Version 6.26** | **Last Updated: August 31, 2025**

## 1. Executive Summary

SpeakSharp is a **privacy-first, real-time speech analysis tool** designed as a modern, serverless SaaS web application. Its architecture is strategically aligned with the core product goal: to provide instant, on-device feedback that helps users improve their public speaking skills, while rigorously protecting their privacy.

The system is built for speed, both in user experience and development velocity. It leverages a **React (Vite)** frontend for a highly interactive UI and **Supabase** as an all-in-one backend for data, authentication, and user management.


## 2. Recent Updates (v6.26)
*August 31, 2025*
- **Comprehensive Test Suite Expansion**: Implemented a full suite of new and refactored tests to enhance code quality and stability. This includes new tests for `AuthPage`, `useBrowserSupport`, and `useSpeechRecognition`, as well as significant enhancements to existing tests for `AnalyticsPage`, `SessionPage`, and `MainPage`.
- **Hardened Test Environment**: Implemented a robust test environment with shims for external services (`Stripe`, `PostHog`, etc.) and network interception via Playwright to ensure deterministic E2E tests.
- **Code Cleanup**: Deleted obsolete test files to streamline the codebase.

---

## 3. Known Issues
- **Test Environment Instability:** The test suite has historically suffered from memory leaks and hangs, particularly when dealing with complex asynchronous operations or under specific test runners like `happy-dom`. While significant fixes have been implemented, some commands like `pnpm test:coverage` may still fail. For a detailed explanation of the issues and the official testing strategy, see the **[Testing Strategy documentation](./System Architecture.md#6-testing-strategy)**.
- **E2E Tests Blocked by Browser API Dependencies:** The Playwright E2E tests are currently blocked. The application's `useBrowserSupport` hook checks for the `SpeechRecognition` API on page load. This API is not available in the headless browser environment used by the test runner, causing the check to fail and preventing the main application from rendering. This blocks all E2E tests from running successfully. A potential solution is to mock this API in the test setup.
- **`SessionSidebar.test.jsx` Dialog Failures:** Two tests within this suite are failing (`shows the end session dialog after stopping` and `saves the session with duration and navigates to analytics`). Both failures are due to an inability to find the `AlertDialog` component's content in the test environment. This is likely because the dialog component (from Radix UI) portals its content outside the main component tree, making it inaccessible to standard test queries. Attempts to mock the dialog have been unsuccessful so far.
- **Agent Tooling Instability:** The `replace_with_git_merge_diff` tool has been observed to hang indefinitely, blocking development. This requires a VM restart to resolve.
- **On-Device Transcription Needs Polish:** The `LocalWhisper` provider in `TranscriptionService` may require further UI/UX polishing.

---

## 4. Development Roadmap
The project's development status is tracked in the [**Project Board**](./PROJECT_BOARD.md). This board provides a two-dimensional view of our project tasks, combining Phased Milestones (timeline) with MoSCoW Prioritization.

---

## 5. Software Quality Metrics

This section tracks key software quality metrics for the project.

| Metric                        | Current Value | Date       | Notes                                           |
| ----------------------------- | ------------- | ---------- | ----------------------------------------------- |
| **Test Coverage (Lines)**     | `N/A`         | 2025-09-03 | Coverage generation still fails due to memory leak. |
| **Total Tests**               | `98`          | 2025-09-03 | From full suite run. 15 tests are skipped.      |
| **Test Suite RunTime**        | `~87s`        | 2025-09-03 | Last full run before heap crash.                  |

### Latest Test Suite Run (Detailed)
*   **Date:** 2025-09-03
*   **Total Test Files:** 14
*   **Total Tests:** 98
*   **Passed:** 62
*   **Failed:** 35
*   **Skipped:** 15 (estimate from documentation)
*   **Result:** Catastrophic failure (JavaScript heap out of memory). The test suite is currently unstable.

---

## 6. Metrics and Success Criteria

### Service Level Indicators (SLIs) & Objectives (SLOs)

**SLIs (what we measure):**

- 🕑 **Time to first transcript chunk (latency)** — ms between mic start and first transcript event.
- ⚡ **End-to-end transcription latency (speed)** — avg delay between spoken word and displayed text.
- 📉 **WebSocket error rate** — % of sessions terminated by non-1000 close codes.
- 🔄 **Reconnect success rate** — % of reconnect attempts that resume within 2s.
- 🔐 **Token issuance error rate** — % of failed requests to /assemblyai-token.
- 💰 **Cost guardrail** — $/minute STT usage per active user session.

**SLOs (targets):**

- <2s to first transcript chunk (p95).
- <500ms streaming transcription delay (p90).
- <1% WebSocket error rate.
- >95% reconnect success rate within 2s.
- <0.5% token issuance failures.
- <$0.05/min STT cost at MVP scale.
