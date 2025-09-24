# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **PDF Export Unit Tests:** Added comprehensive unit tests for the PDF export feature (`pdfGenerator.ts`).
- **Transcription Mode Selector:** Implemented a new UI control on the session page that allows users to select one of three transcription modes: "Cloud AI", "On-Device", or "Native Browser".
- **Automated SQM Reporting:** Implemented a feature in the `./run-tests.sh` script to automatically generate a Software Quality Metrics table and inject it into `docs/PRD.md`.
- **On-Device Transcription:** Implemented a fully on-device, privacy-first transcription mode for Pro users using `@xenova/transformers`.
- **E2E Tests:** Added comprehensive end-to-end tests for all user flows (anonymous, free, pro).
- **Universal Navigation:** Implemented a persistent sidebar for navigation across all pages.
- **Analytics UI:** Created the UI components for the main analytics dashboard.
- **Automated Code Quality:** Implemented `lint-staged` and a `husky` pre-commit hook to enforce linting and type-checking.
- **Jitter Buffer & Resampling Guard:** Added audio processing guards to improve transcription quality and stability.
- **Design System Foundation:** Established the new CVA-based design system and configured the core theme.
- Initial project setup.
- Basic session recording functionality.

### Changed
- **Dependencies:** Updated `vite` and `happy-dom` to their latest versions to resolve security vulnerabilities.
- **Test Scripts:** Removed the `--coverage` flag from the `test:unit` and `test:unit:watch` scripts in `package.json` to resolve a test runner hanging issue.
- **Mode Selector:** Added access control logic to restrict transcription modes based on user tier (Free, Pro) and developer status.
- **Documentation:** Performed a comprehensive audit of all mandated documentation (`ARCHITECTURE.md`, `PRD.md`, `ROADMAP.md`, etc.) to ensure it is accurate and consistent with the current state of the codebase, based on manual code review.
- **CI/CD Pipeline:** Refactored the entire test and documentation pipeline for robustness and timeout resilience. Replaced the monolithic `run-tests.sh` with a granular, orchestrated suite of scripts managed by `ci-run-all.sh`. This resolves critical timeout and stability issues in the test environment.
- **Tier Consolidation:** Consolidated user tiers from four to two (Free, Pro), simplifying the business logic and database schema.
- **TypeScript Migration:** Migrated several legacy JavaScript files to TypeScript (`fillerWordUtils`, `dateUtils`, `analyticsUtils`, etc.).
- **Abstraction:** Reintroduced the `TranscriptionService` abstraction layer to support multiple STT providers.
- **UI/UX:** Improved UI to provide explicit indication of the current transcription mode.
- Updated Supabase schema for better performance.
- Replaced `sharp` image processing library with `jimp` to remove native dependencies and improve environment stability.
- Updated homepage routing logic to be conditional for development vs. production, allowing easier debugging of landing page components.
- Refined developer-only controls on the `SessionSidebar` to be more specific and only appear for designated dev users.

### Known Issues
- **CI Pipeline Instability:** The main CI script (`./ci-run-all.sh`) is currently unstable and consistently fails due to a 7-minute timeout in the execution environment. This affects long-running steps like linting and type-checking, preventing the full test suite from completing automatically. This is a pre-existing environment issue that needs to be addressed separately.

### Fixed
- **Performance:** Fixed a major performance issue on the session page where the entire page would re-render every second during an active session. Refactored the timer logic to isolate updates and prevent unnecessary renders.
- **Test Environment Architecture:** Resolved critical architectural flaws that caused the entire test suite to be unstable. This included:
  - **Conflicting Setups:** Consolidated multiple, conflicting `global-setup.ts` files into a clear, purpose-driven structure (`unit-global-setup.ts`, `e2e-global-setup.ts`).
  - **Memory Leaks:** Fixed severe "heap out of memory" crashes in the unit test suite by reconfiguring Vitest to use isolated forked processes and by fixing memory leaks in `LocalWhisper.test.ts` and `SessionSidebar.test.tsx` with proper async/component cleanup.
- **Build & CI/CD:**
  - Resolved a blocking `jimp` type error by upgrading the dependency and refactoring its usage. This unblocks the `pnpm type-check` quality gate.
- **Critical Application Bugs:**
  - Implemented protected routes to secure sensitive user pages.
  - Refactored `AuthContext.tsx` to stabilize authentication logic.
  - Fixed broken session persistence for anonymous users.
  - Corrected monetization logic to ensure Pro users receive paid features.
- **Failing Unit Test:** Fixed a failing unit test in `src/services/transcription/__tests__/CloudAssemblyAI.test.ts` by correcting the mock WebSocket implementation.
- **Silent Error Handling:** Added `console.error` logging to `AuthProvider.tsx` to prevent silent failures in authentication-related operations.
- **Test Environment Stability:**
  - Resolved a critical issue where the `sharp` native dependency would fail to install in the test environment, blocking unit tests. The library is now correctly mocked using `jimp`.
  - Resolved all major E2E test environment configuration conflicts and dependency issues.
  - Installed all necessary system-level libraries for Playwright to run reliably.
- **E2E Test Robustness:** Enhanced all E2E test suites for better stability, maintainability, and error reporting.
- Corrected a bug in the `SessionSidebar` where the 'Upgrade' button was permanently disabled for free users.
- Resolved multiple critical test environment issues, including dependency installation failures (Supabase CLI), incorrect linting and type-checking configurations, and broken test setup logic. These fixes have stabilized the E2E test environment.
- Fixed a bug that caused the application to crash on login during tests due to an unapplied database migration and incorrect mock setup.
- Minor styling issues on the landing page.
