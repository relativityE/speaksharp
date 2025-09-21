# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
- **Tier Consolidation:** Consolidated user tiers from four to two (Free, Pro), simplifying the business logic and database schema.
- **TypeScript Migration:** Migrated several legacy JavaScript files to TypeScript (`fillerWordUtils`, `dateUtils`, `analyticsUtils`, etc.).
- **Abstraction:** Reintroduced the `TranscriptionService` abstraction layer to support multiple STT providers.
- **UI/UX:** Improved UI to provide explicit indication of the current transcription mode.
- Updated Supabase schema for better performance.
- Replaced `sharp` image processing library with `jimp` to remove native dependencies and improve environment stability.
- Updated homepage routing logic to be conditional for development vs. production, allowing easier debugging of landing page components.
- Refined developer-only controls on the `SessionSidebar` to be more specific and only appear for designated dev users.

### Fixed
- **Build & CI/CD:**
  - Resolved a blocking `jimp` type error by upgrading the dependency and refactoring its usage. This unblocks the `pnpm type-check` quality gate.
- **Critical Application Bugs:**
  - Implemented protected routes to secure sensitive user pages.
  - Refactored `AuthContext.tsx` to stabilize authentication logic.
  - Fixed broken session persistence for anonymous users.
  - Corrected monetization logic to ensure Pro users receive paid features.
- **Test Environment Stability:**
  - Resolved a critical issue where the `sharp` native dependency would fail to install in the test environment, blocking unit tests. The library is now correctly mocked using `jimp`.
  - Resolved all major E2E test environment configuration conflicts and dependency issues.
  - Installed all necessary system-level libraries for Playwright to run reliably.
- **E2E Test Robustness:** Enhanced all E2E test suites for better stability, maintainability, and error reporting.
- Corrected a bug in the `SessionSidebar` where the 'Upgrade' button was permanently disabled for free users.
- Resolved multiple critical test environment issues, including dependency installation failures (Supabase CLI), incorrect linting and type-checking configurations, and broken test setup logic. These fixes have stabilized the E2E test environment.
- Fixed a bug that caused the application to crash on login during tests due to an unapplied database migration and incorrect mock setup.
- Minor styling issues on the landing page.
