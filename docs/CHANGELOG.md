# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Ephemeral E2E Test Logging:** Implemented a new automated logging system for Playwright tests using a custom fixture (`verifyOnlyStepTracker.ts`). This system provides detailed, inline diagnostics (including step tracking and ephemeral base64 screenshots) directly in CI logs without relying on filesystem artifacts.
- **Speaker Identification:** Re-implemented the speaker identification feature to correctly handle speaker labels from the AssemblyAI API.
- **Top 2 Filler Words:** Re-implemented the "Top 2 Filler Words" analytics feature.
- **STT Accuracy Comparison:** Re-implemented the "STT Accuracy Comparison" feature to compare against a ground truth.

### Changed
- **E2E Test Suite Refactoring:** Refactored the entire E2E test suite to use the new automated, ephemeral logging fixture, improving consistency and maintainability while removing manual logging code.
- **CI/CD:** Simplified the CI pipeline in `.github/workflows/ci.yml` to a single, consolidated job for improved maintainability and clarity.
- **E2E Test Configuration**: Enabled Playwright's `webServer` to automatically start the application, making the test suite turn-key and CI-ready.
- **Dependencies:** Updated `vite` and `happy-dom` to their latest versions to resolve security vulnerabilities.
- **UI & UX:**
- Updated homepage routing logic to be conditional for development vs. production, allowing easier debugging of landing page components.
- Refined developer-only controls on the `SessionSidebar` to be more specific and only appear for designated dev users.

### Removed
- **Visual Regression Test:** Removed the `visual.e2e.spec.ts` file as its file-based screenshot comparison strategy is incompatible with the new artifact-free testing approach.

### Known Issues
- **`pnpm lint` Command Timeout:** The `pnpm lint` command is known to be slow and may time out in some environments. This is a known issue that is being tracked.

### Fixed
- **Client-Side Rendering and E2E Test Stability:** Resolved a critical E2E test timeout caused by a client-side rendering failure. The fix involved correcting a component definition error in `src/pages/Session.tsx`, resolving multiple TypeScript errors, and implementing a sandbox-safe rendering mechanism in `src/main.tsx` to prevent a race condition with the mock server.
- **Critical E2E Test Timeout:** Fixed a persistent E2E test timeout that was caused by a silent failure during test environment initialization.
  - **Root Cause:** Vite was tree-shaking the `src/testEnv.ts` script, which prevented the Mock Service Worker (MSW) from ever starting.
  - **Fix:** Updated `vite.config.mjs` to explicitly prevent `testEnv.ts` from being tree-shaken in test mode.
  - **Defense-in-Depth:** Added a "FAIL LOUD" check to `src/main.tsx` that will immediately crash the application and the test runner if the mock server fails to initialize, preventing future silent hangs.
- **Critical Memory Leak:** Resolved a severe memory leak in the `useTranscriptionService` hook caused by improper management of the `TranscriptionService` class instance, which led to orphaned WebSocket connections and audio processors.
- **Unit Test Failures:** Corrected unit tests for `useTranscriptionService` and the main `useSpeechRecognition` integration test that were failing as a result of the memory leak fix.
- **Documentation Overhaul:** Updated `README.md`, `docs/ARCHITECTURE.md`, `docs/PRD.md`, and `docs/ROADMAP.md` to remove obsolete information regarding test instability and technical debt, ensuring all documentation now reflects the current, stable state of the codebase.
- **CI Build Failure:** Fixed a critical CI build failure by updating `postcss.config.cjs` to use the correct `@tailwindcss/postcss` plugin.
- **Comprehensive Build & Test Environment Fixes:** Resolved a cascade of critical issues preventing the application from building and tests from running. This included:
  - Correcting the PostCSS and Vite configurations to properly process Tailwind CSS.
  - Fixing multiple linting and TypeScript errors, including unused variables and incorrect component exports.
  - Stabilizing the test environment by installing missing dependencies and resolving hangs in the test runners.
- **Monolithic Test Script (`ci-run-all.sh`):** Decommissioned the monolithic test script in favor of a parallelized GitHub Actions workflow, resolving the 7-minute timeout issue.
- **Memory Leaks in Unit Tests:** Addressed severe memory leaks in the Vitest unit test suite by properly isolating test environments and mocking timers.
- **E2E Test Failures:**
  - Resolved multiple E2E test failures caused by incorrect locators, race conditions, and improper handling of the mock service worker.
  - Implemented a robust, custom global setup for Playwright to ensure the application and its mocks are reliably initialized before tests run.

## [0.1.0] - 2025-09-08

### Added
- Initial release of SpeakSharp.
- Core features: Real-time transcription, filler word detection, and session history.
- Basic user authentication (sign up, sign in).
- Pro and Free user tiers with feature gating.
- CI/CD pipeline with linting, type-checking, and unit tests.
- Basic session recording functionality.