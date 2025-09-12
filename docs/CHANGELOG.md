# Changelog

All notable changes to this project will be documented here.
This file is intended to provide a **human-readable summary** of major updates, not a full git log.
Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style with slight adaptation for our needs.

---

## [Unreleased]
### Fixed
- **Resolved Critical E2E Test Blockers:** Diagnosed and fixed multiple independent issues causing the E2E test suite to hang or crash. This included a Tailwind CSS bug that crashed the Vite server and several deadlocks/race-conditions within the network stubbing logic (`sdkStubs.ts`).

### Changed
- **Comprehensive E2E Test Suite Refactoring:** Refactored the entire E2E test suite (`auth`, `free`, `anon`, `pro`) for robustness and maintainability. This included adding explicit waits, improving selectors, and creating helper functions to reduce code duplication, following best practices.

### Added
- **Automated Code Quality Checks:** Implemented `lint-staged` and a `husky` pre-commit hook to automatically run `eslint` and `tsc` on staged files. This improves code quality and prevents errors from being committed.
- **New Testing Architecture:** Implemented a new testing architecture based on Mock Service Worker (MSW) to provide a stable and reliable testing environment. This includes a new `vitest.config.mjs` file, a new test setup file (`src/test-setup.js`), and a set of mock API handlers.
- **Developer Workflow Automation:** Implemented a secure database seeding strategy (`pnpm db:seed`) and a script to automate ML model management (`pnpm model:update`).
- **Local Premium Feature Testing:** Added a `VITE_DEV_PREMIUM_ACCESS` environment variable to allow for easy local testing of premium features without a real subscription.
- **On-Device Transcription for Premium Users:** Implemented a new privacy-first transcription mode using a local Whisper model via `@xenova/transformers`.
- **E2E Tests for All User Roles:** Added new E2E tests for the 'Free' and 'Premium' user flows, ensuring coverage for all user roles.

### Fixed
- **Refactored Build System and Dependencies:** Addressed critical build issues by installing numerous missing npm dependencies and migrating the toolchain to use the recommended `@tailwindcss/vite` plugin. This work has stabilized the development server but has not yet resolved all E2E test failures.
- **Codebase Type Safety:** Resolved a large number of TypeScript errors across the entire codebase, enabling strict type checking to pass. This significantly improves code quality and reduces the risk of runtime errors.
- **Resolved E2E Test Suite Crisis:** Overcame a persistent and critical failure in the E2E test suite where tests would time out. The root cause was a combination of race conditions, incorrect mocking strategies, and a subtle bug in the `AuthContext` initialization. The entire E2E test suite was refactored to be stable and reliable.
- **SECURITY:** Removed an insecure RLS policy migration that could expose all user data in development environments.
- **TESTING:** Repaired the entire unit test suite, resolving critical configuration, environment, and mocking issues. The suite is now stable and providing reliable feedback.
- **Improved On-Device Model Loading Reliability:** Implemented a hybrid loading strategy for the on-device model. The application now attempts to fetch the model from the Hugging Face Hub first and falls back to a local copy, enhancing resilience against network failures.
- **Stabilized Entire Test Suite:** Resolved critical test environment conflicts and race conditions that made the E2E suite unusable. All unit and E2E tests now pass reliably in parallel.
- **Fixed Dev User UI Controls:** Corrected a bug in the session sidebar where the developer-only controls for forcing transcription modes did not work correctly.

### Changed
- **Vitest Configuration:** Refactored the Vitest configuration (`vite.config.mjs`) to use a static object, which resolved numerous test stability issues.
- **Global Test Mocks:** Enhanced the global test setup (`src/test/setup.tsx`) with robust mocks for browser APIs (`SpeechRecognition`, `URL.createObjectURL`) and native modules (`sharp`).
- **Updated All Project Documentation:** Synchronized `ARCHITECTURE.md`, `PRD.md`, and `ROADMAP.md` to reflect the stabilized test suite and the new on-device transcription feature.

### TYPE SAFETY
- **Migrated `fillerWordUtils.js` to TypeScript:** Converted the file to TypeScript, adding strict types for all functions and data structures to improve type safety and developer experience.

---

## [2025-09-06]
### Changed
- **Project-Wide Documentation Overhaul:** Audited and rewrote all project documentation (`PRD.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `CHANGELOG.md`) to align with the actual state of the codebase and enforce a "Single Source of Truth" policy. This effort corrected numerous factual inaccuracies, removed false claims of progress, and established a baseline of truthful documentation.

---

## [2025-08-22]
### Added
- Initial roadmap draft for Phase 1 rollout.
- Real-time filler word detection (MVP feature set).

### Fixed
- Resolved Supabase auth bug during sign-up flow.

---

## [2025-07-16]
### Added
- Established initial repo structure with `PRD.md`, `ARCHITECTURE.md`, `ROADMAP.md`.
- Set up testing framework (100+ unit & integration tests).
