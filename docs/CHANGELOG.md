# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
