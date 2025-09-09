# Changelog

All notable changes to this project will be documented here.
This file is intended to provide a **human-readable summary** of major updates, not a full git log.
Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style with slight adaptation for our needs.

---

## [Unreleased]
### Added
- **On-Device Transcription for Premium Users:** Implemented a new privacy-first transcription mode using a local Whisper model via `@xenova/transformers`.
- **E2E Tests for All User Roles:** Added new E2E tests for the 'Free' and 'Premium' user flows, ensuring coverage for all user roles.

### Fixed
- **Improved On-Device Model Loading Reliability:** Implemented a hybrid loading strategy for the on-device model. The application now attempts to fetch the model from the Hugging Face Hub first and falls back to a local copy, enhancing resilience against network failures.
- **Stabilized Entire Test Suite:** Resolved critical test environment conflicts and race conditions that made the E2E suite unusable. All unit and E2E tests now pass reliably in parallel.
- **Fixed Dev User UI Controls:** Corrected a bug in the session sidebar where the developer-only controls for forcing transcription modes did not work correctly.

### Changed
- **Updated All Project Documentation:** Synchronized `ARCHITECTURE.md`, `PRD.md`, and `ROADMAP.md` to reflect the stabilized test suite and the new on-device transcription feature.

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
