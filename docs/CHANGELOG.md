# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Speaker Identification:** Re-implemented the speaker identification feature to correctly handle speaker labels from the AssemblyAI API.
- **Top 2 Filler Words:** Re-implemented the "Top 2 Filler Words" analytics feature.
- **STT Accuracy Comparison:** Re-implemented the "STT Accuracy Comparison" feature to compare against a ground truth.
- **PDF Export Unit Tests:** Added comprehensive unit tests for the PDF export feature (`pdfGenerator.ts`).
- **Transcription Mode Selector:** Implemented a new UI control on the session page that allows users to select one of three transcription modes: "Cloud AI", "On-Device", or "Native Browser".
- **Automated SQM Reporting:** Implemented a feature in the `./run-tests.sh` script to automatically generate a Software Quality Metrics table and inject it into `docs/PRD.md`.
- **On-Device Transcription:** Implemented a fully on-device, privacy-first transcription mode for Pro users using `@xenova/transformers`.
- **E2E Tests:** Added comprehensive end-to-end tests for all user flows (free, pro).
- **Universal Navigation:** Implemented a persistent sidebar for navigation across all pages.
- **Analytics UI:** Created the UI components for the main analytics dashboard.
- **Automated Code Quality:** Implemented `lint-staged` and a `husky` pre-commit hook to enforce linting and type-checking.
- **Jitter Buffer & Resampling Guard:** Added audio processing guards to improve transcription quality and stability.
- **Design System Foundation:** Established the new CVA-based design system and configured the core theme.
- Initial project setup.
- Basic session recording functionality.

### Changed
- **CI/CD:** Simplified the CI pipeline in `.github/workflows/ci.yml` to a single, consolidated job for improved maintainability and clarity.
- **E2E Test Configuration**: Enabled Playwright's `webServer` to automatically start the application, making the test suite turn-key and CI-ready.
- **Dependencies:** Updated `vite` and `happy-dom` to their latest versions to resolve security vulnerabilities.
- **Test Scripts:** Removed the `--coverage` flag from the `test:unit` and `test:unit:watch` scripts in `package.json` to resolve a test runner hanging issue.
- **Mode Selector:** Added access control logic to restrict transcription modes based on user tier (Free, Pro) and developer status.
- **Documentation:** Performed a comprehensive audit of all mandated documentation (`ARCHITECTURE.md`, `PRD.md`, `ROADMAP.md`, etc.) to ensure it is accurate and consistent with the current state of the codebase, based on manual code review.
- **Tier Consolidation:** Consolidated user tiers from four to two (Free, Pro), simplifying the business logic and database schema.
- **TypeScript Migration:** Migrated several legacy JavaScript files to TypeScript (`fillerWordUtils`, `dateUtils`, `analyticsUtils`, etc.).
- **Abstraction:** Reintroduced the `TranscriptionService` abstraction layer to support multiple STT providers.
- **UI/UX:** Improved UI to provide explicit indication of the current transcription mode.
- Updated Supabase schema for better performance.
- Updated homepage routing logic to be conditional for development vs. production, allowing easier debugging of landing page components.
- Refined developer-only controls on the `SessionSidebar` to be more specific and only appear for designated dev users.

### Known Issues
- **`pnpm lint` Command Timeout:** The `pnpm lint` command is known to be slow and may time out in some environments. This is a known issue that is being tracked.

### Fixed
- **Comprehensive Build & Test Environment Fixes:** Resolved a cascade of critical issues preventing the application from building and tests from running. This included:
  - Correcting the PostCSS and Vite configurations to properly process Tailwind CSS.
  - Fixing multiple linting and TypeScript errors, including unused variables and incorrect component exports.
  - Refactoring `Button` and `Badge` components to align with best practices.
  - Resolving a fundamental E2E test failure by installing the necessary Playwright browser binaries and their system-level dependencies.
- **E2E Test Instability:** Stabilized the E2E test suite by adding a mock handler for PostHog API calls, preventing network errors that caused tests to hang.
- **E2E Test Hanging:** Resolved a persistent E2E test timeout by fixing multiple, cascading issues:
  - Replaced an unstable image processing library with the more reliable `canvas` package for the test environment.
  - Fixed a race condition between the Playwright test runner and the Mock Service Worker (MSW) by implementing a promise-based synchronization (`window.mswReady`).
  - Corrected a data mismatch in the MSW handlers that caused a silent `400 Bad Request` on login, which was the final root cause of the hang.
- **CI Pipeline Instability:** Replaced the monolithic `ci-run-all.sh` script with a parallelized GitHub Actions workflow, resolving the 7-minute timeout issue and stabilizing the CI process.
- **Hook Architecture & Performance:** Refactored the monolithic `useSpeechRecognition` hook to resolve critical performance issues, including memory exhaustion and infinite re-renders. The hook is now decomposed into smaller, single-responsibility hooks (`useTranscriptState`, `useFillerWords`, `useTranscriptionService`), making it more testable, maintainable, and performant. This also included creating a comprehensive new test suite that passes reliably.
- **Performance:** Fixed a major performance issue on the session page where the entire page would re-render every second during an active session. Refactored the timer logic to isolate updates and prevent unnecessary renders.
- **Test Environment Architecture:** Resolved critical architectural flaws that caused the entire test suite to be unstable. This included:
  - **Conflicting Setups:** Consolidated multiple, conflicting `global-setup.ts` files into a clear, purpose-driven structure (`unit-global-setup.ts`, `e2e-global-setup.ts`).
  - **Memory Leaks:** Fixed severe "heap out of memory" crashes in the unit test suite by reconfiguring Vitest to use isolated forked processes and by fixing memory leaks in `LocalWhisper.test.ts` and `SessionSidebar.test.tsx` with proper async/component cleanup.
- **Critical Application Bugs:**
  - Implemented protected routes to secure sensitive user pages.
  - Refactored `AuthContext.tsx` to stabilize authentication logic.
  - Corrected monetization logic to ensure Pro users receive paid features.
- **Failing Unit Test:** Fixed a failing unit test in `src/services/transcription/__tests__/CloudAssemblyAI.test.ts` by correcting the mock WebSocket implementation.
- **Silent Error Handling:** Added `console.error` logging to `AuthProvider.tsx` to prevent silent failures in authentication-related operations.
- **Test Environment Stability:**
  - Resolved a critical issue where a native dependency would fail to install in the test environment, blocking unit tests. The library is now correctly mocked.
  - Resolved all major E2E test environment configuration conflicts and dependency issues.
  - Installed all necessary system-level libraries for Playwright to run reliably.
- **E2E Test Robustness:** Enhanced all E2E test suites for better stability, maintainability, and error reporting.
- Corrected a bug in the `SessionSidebar` where the 'Upgrade' button was permanently disabled for free users.
- Resolved multiple critical test environment issues, including dependency installation failures (Supabase CLI), incorrect linting and type-checking configurations, and broken test setup logic. These fixes have stabilized the E2E test environment.
- Fixed a bug that caused the application to crash on login during tests due to an unapplied database migration and incorrect mock setup.
- Minor styling issues on the landing page.