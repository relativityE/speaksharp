# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **On-Device Transcription:** Implemented a fully on-device, privacy-first transcription mode for Pro users using `@xenova/transformers`.
- **E2E Tests:** Added comprehensive end-to-end tests for all user flows (anonymous, free, pro) using Playwright.
- **Universal Navigation:** Implemented a persistent sidebar for navigation across all pages.
- **Analytics UI:** Created the UI components for the main analytics dashboard.
- **Automated Code Quality:** Implemented `lint-staged` and a `husky` pre-commit hook to enforce linting and type-checking.
- **Jitter Buffer & Resampling Guard:** Added audio processing guards to improve transcription quality and stability.

### Changed
- **Technical Debt:** Migrated several legacy JavaScript files to TypeScript (`fillerWordUtils`, `dateUtils`, `analyticsUtils`, etc.) to improve type safety.
- **Design System:** Implemented the foundational layers of the new CVA-based design system.
- **Abstraction:** Reintroduced the `TranscriptionService` abstraction layer to support multiple STT providers.
- **Tier Consolidation:** Consolidated user tiers from four to two (Free, Pro), simplifying the business logic and database schema.
- **UI/UX:** Improved UI to provide explicit indication of the current transcription mode.

### Fixed
- **Critical Application Bugs:**
  - `[C-01]` Implemented protected routes to secure sensitive user pages.
  - `[C-02]` Refactored `AuthContext.tsx` to stabilize authentication logic.
  - `[C-03]` Fixed broken session persistence for anonymous users.
  - `[C-04]` Corrected monetization logic to ensure Pro users receive paid features.
- **Test Environment Stability:**
  - Resolved all major E2E test environment configuration conflicts and dependency issues.
  - Installed all necessary system-level libraries for Playwright to run reliably.
- **E2E Test Robustness:** Enhanced all E2E test suites for better stability, maintainability, and error reporting.

## [Previous Releases]

### Added
- Initial project setup.
- Basic session recording functionality.

### Changed
- Updated Supabase schema for better performance.
- Replaced `sharp` image processing library with `jimp` to remove native dependencies and improve environment stability.
- Updated homepage routing logic to be conditional for development vs. production, allowing easier debugging of landing page components.
- Refined developer-only controls on the `SessionSidebar` to be more specific and only appear for designated dev users.

### Fixed
- Corrected a bug in the `SessionSidebar` where the 'Upgrade' button was permanently disabled for free users.
- Resolved multiple critical test environment issues, including dependency installation failures (Supabase CLI), incorrect linting and type-checking configurations, and broken test setup logic. These fixes have stabilized the E2E test environment.
- Fixed a bug that caused the application to crash on login during tests due to an unapplied database migration and incorrect mock setup.
- Minor styling issues on the landing page.
