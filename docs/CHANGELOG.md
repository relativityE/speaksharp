# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Comprehensive Testing Framework Overhaul:**
  - Implemented a new canonical audit script (`./test-audit.sh`) that orchestrates all static analysis and E2E tests, serving as the single source of truth for local and CI validation.
  - Introduced a dynamic, runtime-based sharding system (`test-support/utils/create-shards.js`) to split the E2E test suite into smaller chunks, preventing CI platform timeouts.
  - Refactored all major E2E tests to use a new, robust `loginAndWait` helper, eliminating race conditions and improving stability.
  - Hardened the environment stabilization script (`./env-stabilizer.sh`) to be more resilient against stale processes and port conflicts.
  - Established a new `test-support/` directory to centralize all testing-related scripts and reports, cleaning up the repository root.

### Changed
- **Test Environment Overhaul:**
  - **Environment Separation:** The Vite development server now runs in standard `development` mode by default, isolating it from the `test` environment. Test-specific logic (like MSW) is now conditionally loaded only when `VITE_TEST_MODE` is true.
  - **Test Isolation:**
    - **E2E:** Fixed fatal JavaScript errors by conditionally disabling third-party SDKs (Sentry, PostHog) during E2E tests.
    - **Unit:** Resolved state leakage in `AuthContext` tests by clearing `localStorage` and adding specific mocks to ensure each test runs in a clean, isolated environment.
  - **CI/CD Alignment:** The local audit script (`test-audit.sh`) now runs the full E2E suite, aligning it with the CI pipeline to prevent discrepancies.
  - **Code Reorganization:** Moved all test-related files from `src/test` to a top-level `tests` directory for better separation of concerns.

### Fixed
- **Critical E2E Test Timeout and Instability:** Resolved a persistent and complex E2E test timeout issue through a series of fixes:
  - **`AuthProvider` Loading State:** Fixed a bug where the `AuthProvider` would get stuck in a permanent loading state in the test environment, preventing the application from rendering and causing tests to hang. The loading state is now correctly initialized to `false` in test mode.
  - **Incorrect Test Selector:** Corrected the login helper function (`loginUser`) to use the proper "Sign In" link text instead of "Login".
  - **Fragile Test Infrastructure:** Replaced the custom test wrapper (`verifyOnlyStepTracker.ts`) with a new, resilient version that includes action timeouts to prevent indefinite hangs.
  - **Conflicting Mocking Systems:** Removed a redundant Playwright-based mocking system from `sdkStubs.ts` to consolidate all API mocking within MSW, eliminating race conditions.

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

## [0.1.0] - 2025-09-08

### Added
- Initial release of SpeakSharp.
- Core features: Real-time transcription, filler word detection, and session history.
- Basic user authentication (sign up, sign in).
- Pro and Free user tiers with feature gating.
- CI/CD pipeline with linting, type-checking, and unit tests.
- Basic session recording functionality.