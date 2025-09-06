# Changelog

All notable changes to this project will be documented here.
This file is intended to provide a **human-readable summary** of major updates, not a full git log.
Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style with slight adaptation for our needs.

---

## [Unreleased]
### Fixed
- Corrected a critical bug in the `AuthProvider` that hardcoded all users as 'free', preventing pro users from accessing premium features. The context now correctly handles real and mocked session data.
- Fixed the `assemblyai-token` serverless function, which was failing to generate tokens due to an incorrect Authorization header. Cloud transcription for Pro users is now functional.

---

## [2025-09-05]
### Fixed
- Stabilized the entire test suite (Unit, Integration, and E2E) by fixing a critical memory leak and implementing a new, robust test helper. All 87 tests now pass.
- Implemented the missing E2E test for the "Free User Quota" monetization flow, closing a critical test gap.
- Corrected multiple bugs in `AuthProvider`, `SessionPage`, and `TranscriptionService` that were discovered during E2E testing.

### Changed
- Overhauled project documentation to follow Lean + SSOT principles, improving clarity and reducing bloat. See the [Test Strategy](./ARCHITECTURE.md#7-testing-strategy) and [Software Quality Metrics](./PRD.md#5-software-quality-metrics) for details.
- Consolidated `README.md` files into a single source of truth at `docs/README.md`.
- Updated `AGENTS.md` with new governance rules for documentation and agent behavior.

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
