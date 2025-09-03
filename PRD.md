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
- **Test Environment Memory Leak:** The test suite fails with a "JavaScript heap out of memory" error when running with coverage enabled (`pnpm test:coverage`). This prevents the generation of an up-to-date code coverage report. This issue is considered high-priority as it blocks our ability to track code quality.
- **Full Test Suite Hang:** The `pnpm test` command does not run to completion. While many individual test suites have been fixed, this command still hangs, preventing a full report of passing/failing tests. This indicates a fundamental instability in the test runner's environment.
- **`useSpeechRecognition.test.jsx` Test Hang:** The test suite for the `useSpeechRecognition` hook hangs indefinitely, even after a full refactoring of both the test and the hook itself. The issue is likely a fundamental incompatibility between the hook's complexity and the `happy-dom` test environment. The suite remains skipped.
- **On-Device Transcription Needs Polish:** The `LocalWhisper` provider in `TranscriptionService` may require further UI/UX polishing.

---

## 4. Development Roadmap
The project's development status is tracked in the [**Project Board**](./PROJECT_BOARD.md). This board provides a two-dimensional view of our project tasks, combining Phased Milestones (timeline) with MoSCoW Prioritization.

---

## 5. Software Quality Metrics

This section tracks key software quality metrics for the project.

| Metric                        | Current Value | Date       | Notes                                           |
| ----------------------------- | ------------- | ---------- | ----------------------------------------------- |
| **Test Coverage (Lines)**     | `N/A`         | 2025-09-02 | Coverage generation still fails due to memory leak. |
| **Total Tests**               | `~93`         | 2025-09-02 | Estimate. 1 suite (15 tests) skipped due to hang. |
| **Test Suite RunTime**        | `N/A`         | 2025-09-02 | Full suite does not complete due to hang.       |
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
