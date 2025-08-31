# SpeakSharp Project Board

This document tracks the high-level project status, including the development roadmap, key tasks, and known issues.

## 1. Development Roadmap & Status

### Phase 1: Core Functionality & Stability (Q3 2025)

| Task                                  | Status      | Owner | Notes                                                                                                                                                             |
| ------------------------------------- | ----------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Foundation & Setup**                |             |       |                                                                                                                                                                   |
| User Authentication                   | `Done`      | Core  | Email/password sign-in and sign-up flows are complete.                                                                                                            |
| Real-time Transcription (Browser)     | `Done`      | Core  | Initial implementation using the browser's native SpeechRecognition API.                                                                                          |
| **Test Suite Overhaul**               |             |       |                                                                                                                                                                   |
| Implement Robust Test Environment     | `Done`      | Jules | Created `testEnv.ts` shim and Playwright network interception to ensure deterministic tests.                                                                      |
| Expand Test Coverage                  | `Done`      | Jules | Added new unit and integration tests for all major components and hooks. Refactored existing tests for stability.                                                 |
| **Core Features**                     |             |       |                                                                                                                                                                   |
| Session Summary & Analytics Page      | `Done`      | Core  | Users can view a summary of their past sessions.                                                                                                                  |
| User Profile & Settings               | `To Do`     |       | Allow users to manage their profile and application settings.                                                                                                     |
| **Known Issues & Bugs**               |             |       |                                                                                                                                                                   |
| Resolve Test Memory Leak              | `To Do`     |       | The test suite runs out of memory when generating a coverage report. This is a high-priority issue blocking quality metric reporting.                               |
| Fix `useBrowserSupport` Hook Tests    | `To Do`     |       | The tests for this hook are skipped due to persistent mocking issues in the JSDOM environment.                                                                    |

### Phase 2: Advanced Features (Q4 2025)

| Task                                  | Status  | Owner | Notes                                                                   |
| ------------------------------------- | ------- | ----- | ----------------------------------------------------------------------- |
| Cloud Speech-to-Text Integration      | `To Do` |       | Integrate AssemblyAI for higher accuracy transcription (Pro feature). |
| Advanced Analytics                    | `To Do` |       | Implement sentiment analysis and tone detection.                        |
| Custom Filler Word Tracking           | `To Do` |       | Allow users to define their own filler words to track.                  |
| Goal Setting & Progress Visualization | `To Do` |       |                                                                         |

## 2. Known Issues

-   **Test Environment Memory Leak:** The test suite fails with a "JavaScript heap out of memory" error when running with coverage enabled (`pnpm test:coverage`). This is a high-priority issue that prevents the generation of an up-to-date code coverage report.
-   **`useBrowserSupport` Hook Test Failures:** The unit tests for the `useBrowserSupport` hook are persistently failing and have been temporarily skipped. This is due to issues with mocking global browser APIs in the JSDOM environment.
-   **Inconsistent Browser SpeechRecognition API:** The native browser API for speech recognition can behave differently across various browsers, which may lead to an inconsistent user experience.
