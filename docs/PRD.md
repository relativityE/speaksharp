**Owner:** [unassigned]
**Last Reviewed:** 2026-03-24
**Version:** v0.6.3 (CI Stabilized)
**Last Updated:** 2026-04-21
**Version: 11.0.1** | **Last Updated:** 2026-04-21

## 1. Executive Summary

SpeakSharp is a **privacy-first, real-time speech analysis tool** designed as a modern, serverless SaaS web application. Its architecture is strategically aligned with the core product goal: to provide instant, private feedback that helps users improve their public speaking skills, while rigorously protecting their privacy.

The system is built for speed, both in user experience and development velocity. It leverages a **[React (Vite) frontend](./ARCHITECTURE.md#3-frontend-architecture)** for a highly interactive UI and **[Supabase as an all-in-one backend](./ARCHITECTURE.md#4-backend-architecture)** for data, authentication, and user management.

## 2. Vision & Positioning
*   **Vision:** To be the leading real-time speech coach for professionals, helping them communicate with confidence and clarity.
*   **Positioning:** SpeakSharp is a real-time speech analysis tool. A key differentiator on the roadmap is a **privacy-first, private transcription mode** that will provide instant feedback without sending sensitive conversations to the cloud.

### User Roles & Flows
This section contains ASCII art diagrams illustrating the journey for each user role.

```ascii
+-----------------------------------------------------------------+
|                         [New User]                                |
|                  Arrives at Landing Page                          |
+-----------------------------------------------------------------+
                           |
                           v
+-----------------------------------------------------------------+
|                  Prompted to Sign Up / Login                      |
+-----------------------------------------------------------------+
                           |
                           v
+-----------------------------------------------------------------+
|                  [Authenticated User]                             |
+-----------------------------------------------------------------+
                           |
  +------------------------+------------------------+
  |                                                 |
  v                                                 v
+--------------------------+                      +--------------------------+
| [Free User]              |                      | [Pro User]               |
| - 1 Hr/Day (Max 25h/mo)  |                      | - 2 Hr/Day (Max 50h/mo)  |
| - 60-Min Max Session     |                      | - 60-Min Max Session     |
| - Native Browser STT     |                      | - Cloud/Private STT      |
| - View Session History   |                      | - AI Coach Feedback      |
| - Watermarked PDF Export |                      | - Clean PDF Exports      |
| - Vocab & Vocal Variety  |                      | - Custom Vocab Tracking  |
+--------------------------+                      +--------------------------+
           |
           v
+--------------------------+
| Usage Limit Reached?     |
+--------------------------+
     |           |
   [No]        [Yes]
     |           |
     v           v
(Practice)  +----------------------+
            | UpgradePromptDialog  |
            +----------------------+
                     |
                     v
            +----------------------+
            |    Go to Pro Plan    |
            +----------------------+
```

### Canonical Feature List & Unit Test Status

This section provides a granular breakdown of user-facing features, grouped by priority, and tracks their unit test coverage status per the new engineering mandate.

#### 🎯 Must-Have

| Feature | Release | Description | Status | Unit Test |
| :--- | :--- | :--- | :--- | :--- |
| **Transcription** | 1 | The core service that converts speech to text. | ✅ Implemented | ✅ Yes |
| **Cloud Server STT** | 1 | High-accuracy transcription via AssemblyAI. Hardened with **Triple-Identity Tracing** and **Atomic Orchestration**. (Pro) | ✅ Implemented | ✅ Yes |
| **Private STT** | 1 | On-device, local-first transcription using Whisper (WebGPU/WASM). Hardened with **STTEngine Abstract Base Class**, **heartbeat monitoring**, and **AnalyticsBuffer** decoupling. (Pro) | ✅ Implemented | ✅ Yes |
| **Fallback STT** | 1 | Reliable fallback to native browser API for Free users and as an **auto-recovery mode** for Cloud/Private STT. Hardened with **Microtask Decoupling** and **Atomic Signal Waits**. | ✅ Implemented | ✅ Yes |
| **UI Mode Selector** | 1 | Allows users to select their preferred transcription engine. | ✅ Implemented | ✅ Yes |
| **Session History** | 1 | Users can view and analyze their past practice sessions. | ✅ Implemented | ✅ Yes |
| **Filler Word Detection** | 1 | Detects and counts common filler words (um, uh, like, etc.). | ✅ Implemented | ✅ Yes |
| **Speaking Pace (WPM)** | 2 | Provides real-time words-per-minute analysis. | ✅ Implemented | ✅ Yes |
| **Clarity Score** | 2 | Score based on filler word usage. | ✅ Implemented | ✅ Yes |
| **Goal Setting** | 2 | Weekly/Daily targets for practice consistency. | ✅ Implemented | ✅ Yes |
| **User-Friendly Error Handling** | 2 | Specific, user-facing error messages. | ✅ Implemented | ✅ Yes |
| **User Filler Words** | 2 | User's personalized filler words to track (in addition to defaults like "um", "uh"). Stored in Supabase, passed to Cloud STT for improved recognition. Free: 100 words max. Pro: 100 words max. | ✅ Implemented | ✅ Yes |
| **Vocal Variety / Pause Detection** | 2 | Analyzes pause duration and frequency. | ✅ Implemented | ✅ Yes |
| **Session Hardening** | 3 | Prevents saving empty or 0-second sessions to preserve usage and data quality. | ✅ Implemented | ✅ Yes |
| **Screen Reader Accessibility** | 2 | Live transcript uses ARIA live regions so screen readers announce new text automatically. | ✅ Implemented | ✅ Yes |
| **Usage Limit Pre-Check** | 2 | Checks remaining usage BEFORE session starts. Shows upgrade prompt if exceeded. | ✅ Implemented | ✅ Yes |
| **PDF Export** | 1 | Allows users to download a PDF report of their session (FileSaver.js). | ✅ Implemented | ✅ Yes |
| **STT Accuracy Vs Benchmark** | 1 | Real-time comparison of a user's transcription accuracy against the theoretical ceiling of their active STT engine (Native, Cloud, Private). Uses **Path A: Client-Side Dynamic Comparison** against static engine ceilings established by Harvard Sentences benchmark runs (`STT_BENCHMARKS.json`). | ✅ Implemented | ✅ Yes |
| **Top Filler Words**| 1 | Aggregates and ranks all detected filler words across sessions. | ✅ Implemented | ✅ Yes |
| **Weekly Activity Chart** | 2 | Visual chart showing practice frequency over the past week. | ✅ Implemented | ✅ Yes |
| **Premium Loading States** | 2.5 | Skeleton loading UI for premium user experience. | ✅ Implemented | ✅ Yes |
| **Private Model Caching** | 3 | Service Worker caches Whisper model for faster subsequent loads (<5s). | ✅ Implemented | ✅ Yes |
| **Gamification (Streaks)** | 2 | Tracks daily practice streaks with local storage + toast positive reinforcement. | ✅ Implemented | ✅ Yes |
| **Design System Showcase** | 2 | `/design` route to visualize and test UI components in isolation. | ✅ Implemented | ✅ Yes |
| **Performance Optimization** | 1 | Regex memoization in `highlightUtils` to prevent redundant compilation in render loops. | ✅ Implemented | ✅ Yes |



### Differentiation
*   **vs. Otter.ai:** Privacy-first (private option is a key roadmap item), focused on improvement, not just transcription.
*   **vs. Poised:** More affordable, simpler to use, no installation required.

### Go-to-Market & Financials
*   **GTM Strategy:** Execute a phased GTM strategy. Start with organic channels to validate product-market fit before scaling up paid advertising.
    *   **Phase 1 (Validation):** Focus on organic channels like SEO, content marketing, and public speaking forums. Engage with communities like Toastmasters to gather feedback and testimonials. A "How it Works" video will be created for the landing page to improve conversion.
    *   **Phase 2 (Growth):** Based on the data and validated product-market fit from Phase 1, gradually scale paid advertising campaigns.
*   **Community Engagement:** Actively participate in relevant online communities (like Reddit) to build a following and attract early adopters. This helps in building a brand and getting early feedback.
*   **KPIs and Tracking:** Implement real-time tracking of key metrics (conversion rate, CAC, LTV) to make data-driven decisions. A dashboard (e.g., PostHog, ChartMogul) will be used for this.
*   **Financials:** The business model is Freemium with a Pro tier subscription. Financial models will be based on a conservative conversion rate of 2% to ensure sufficient runway. Detailed projections are in internal documents.

---

## 3. UX Standards & Product Guardrails

To maintain a consistent and premium user experience, SpeakSharp follows these standard feedback and data integrity patterns.

### 3.1 Feedback & Notification Hierarchy

We use a tiered approach to user feedback based on the severity and context.

| Severity | Pattern | Trigger | Goal |
|-----------|---------|---------|------|
| **Critical** | Modal / Dialog | Blockers, Tier limits, permanent deletes. | Force acknowledgement before proceeding. |
| **Warning** | Inline Message | Real-time status (e.g. short session warning). | Contextual guidance without breaking flow. |
| **Info** | Toast (Sonner) | Background success confirmations. | Non-blocking confirmation of transient events. |
| **Persistent**| Badge | Core state (e.g. "Recording", "Pro"). | Constant at-a-glance information. |

### 3.2 Session Duration Policy

To ensure data integrity and meaningful analysis:
*   **Minimum Duration:** 5 seconds (`MIN_SESSION_DURATION_SECONDS`).
*   **Enforcement:** Sessions under 5 seconds are **discarded** and not saved to the database.
*   **User Feedback:** Users see an inline warning during recording and a toast explanation if they stop prematurely.

### 3.3 Metric Calculation Standards

*   **Filler Rate (FW/min):** `Total Fillers / (Total Duration Seconds / 60)`. Must use precise minutes for calculation to ensure accuracy in short sessions.
*   **Rolling WPM:** Real-time speaking pace calculated on a **15-second rolling window** to provide dynamic feedback without excessive volatility.
*   **Optimal WPM Range:** Professional speakers typically target **130-150 WPM**. UI highlights progress toward this target.
*   **Aggregation:** Dashboard metrics represent the aggregate of the user's entire history (Single Source of Truth).
*   **Trend Smoothing:** Trend visualizations use a **5-session rolling average** to reflect true progress and minimize session-specific noise.

### 3.4 Multi-Session Prevention
*   **Policy:** **NO user** (Free or Pro) is allowed to have multiple concurrent recording sessions active. This is a critical guardrail for data integrity and accurate quota enforcement.
*   **Enforcement:** Distributed mutex (`localStorage`-based) prevents a second tab from starting a session if one is already active on the same device.
*  | **User Experience** | If a user attempts to start a second session, the UI blocks the action and provides clear feedback that only one session is allowed. |

### 3.5 Intentional Privacy UX (Active Model Control)

To prevent unexpected high-bandwidth background activity and maintain explicit user consent, the Private STT engine follows an "Intentional Privacy" model.

*   **DOWNLOAD_REQUIRED State:** The `TranscriptionService` identifies when a requested offline model is not present in the browser cache.
*   **Explicit User Trigger:** Models are **never** automatically downloaded in the background. Users must explicitly click a "Download Offline Model" trigger (e.g., in the SessionPage header) to initiate the process.
*   **Tier Gating (Upgrade Funnel):** The "Download Offline Model" trigger is visible to ALL users. For **Free Users**, the button is disabled/greyed-out to serve as a Pro-tier teaser, ideally accompanied by an upgrade tooltip. For **Pro Users**, the button is active and initiating the download flow.
*   **FSM Integration:** The status is tracked via the `DOWNLOAD_REQUIRED` state in the `TranscriptionService` Finite State Machine (FSM).
*   **Native Fallback:** While a model is downloading or if the user declines, the system falls back to **Native Browser STT** to ensure zero-wait recording.


## 4. User Experience & Feedback

### 4.1 Check-Then-Act Protocol (Heavy Resources)
To preserve user bandwidth and system performance, all heavy resource acquisition (e.g., Offline STT Models) MUST follow a "Check-Then-Act" protocol:
1. **Probe Phase**: Automatic background pulses (`warmUp`) strictly check for availability. If a resource is missing, the system MUST signal `DOWNLOAD_REQUIRED` and gate further execution.
2. **Provision Phase**: Acquisition MUST only be triggered by an explicit user action (e.g., clicking "Download Offline Model"). This intent MUST be modeled in the FSM to distinguish it from a background pulse.
3. **Feedback**: During the Provision phase, the UI MUST provide a visual indicator (Background Task Indicator) with real-time progress.

### 4.2 Error Recovery
- **Silence Recovery**: If the STT engine enters a silent state (no heartbeats), the system MUST attempt a graceful re-initialization before notifying the user.
- **Hardware Failures**: In the event of a persistent hardware error (mic blocked, WebGPU crash), a clear, actionable modal MUST guide the user through recovery steps.

---

## 5. Testing & Quality Assurance

The project's testing strategy prioritizes stability, reliability, and a tight alignment between the local development environment and the CI/CD pipeline.

> **See Also:** [ARCHITECTURE.md § Test Pyramid](./ARCHITECTURE.md#test-pyramid) for technical implementation details of all 10 test categories.

### The 5-Point Design Plan for Stability
To eliminate non-deterministic failures and "flakiness," the system adheres to a strict 5-point design plan:
1.  **ProfileGuard**: Global wrapper ensuring profile data is available before any app rendering.
2.  **canStart Checks**: Logic-level guards in `useSessionLifecycle` preventing actions during engine initialization.
3.  **Error Boundaries**: Per-widget isolation using `LocalErrorBoundary` for all critical session components.
4.  **Simplified Hooks**: Re-engineered `useProfile` to return guaranteed non-nullable data, eliminating "null-check fatigue."
5.  **Behavioral Contracts**: Explicit use of `[data-state]` and `[data-action]` attributes for stable, design-agnostic E2E synchronization.
6.  **Fail-Fast Pipeline**: CI pipelines fail immediately on the first error to ensure 100% stable release gates.
7.  **Isomorphic Consistency**: Mandatory use of `stt-isomorphic` fixtures for all engine mocks to prevent "green illusions."
8.  **DOM Signaling Contract**: Standardized engine visibility via `data-user-tier` and `data-engine-variant` attributes on `document.body`, eliminating signal collisions and providing deterministic state for E2E.
9.  **Analytics Decoupling**: Implementation of `AnalyticsBuffer` to ensure telemetry never blocks the UI thread or readiness signals.
10. **Deterministic Readiness**: Global readiness signals via `data-app-ready`, `data-route-ready`, and `data-model-status` for flake-free synchronization.
12. **Environment Bridge (Strangler Pattern)**: Centralized environmental logic in `TestFlags.ts` (`ENV` object) to ensure a single source of truth across all test runners.
13. **Industrial Alias Resolution**: Precise sync between Vitest and `tsconfig.json` paths via `vite-tsconfig-paths`.
14. **Deterministic Bridge (T=0 Reset)**: Mandatory reset of `isEngineInitialized` and `_activeCallbacks` on every page load to prevent "Bridge Drift."
15. **isEngineInitialized Signal**: Renamed legacy `isReady` to `isEngineInitialized` to distinguish between UI and Engine readiness.

*   **Behavioral Testing Integrity (Vitest/Playwright):** We have pivoted from structural verification to **Black-Box Behavioral Testing**. We test user-facing requirements (Accuracy, Privacy, Speed) rather than internal implementation details.
    *   **Isomorphic Golden Transcripts**: A shared registry of speech assets ensuring frontend mocks match backend results.
    *   **WER Regression**: Automated build-failure floors for STT accuracy (Private <10%, Cloud <8%).
    *   **FSM Adversarial Safety**: Explicit stress testing to prevent "Mic Lock-ups" during rapid concurrent interactions.
*   **Unit & Integration Tests (Vitest):** These form the foundation of our testing pyramid. **Target: ≥55% lean line coverage with high design-intent integrity.**
*   **Agent-Safe Interface (`test:agent`):** A rigid, isolated local-only execution loop designed explicitly for AI coding agents to autonomously run and parse the unit and mock E2E suite output cleanly, without external dependencies breaking the loop.
*   **End-to-End Tests (Playwright):** E2E tests validate complete user flows from start to finish. To combat the flakiness often associated with UI-driven tests, we have adopted a critical strategic decision:
    *   **Programmatic Login Only:** All E2E tests that require an authenticated state **must** use the `programmaticLogin` helper. This method directly injects a session into `localStorage`, bypassing the UI for sign-up and login. This approach is significantly faster and more reliable than attempting to simulate user input in the auth form.
    *   **Secure User Provisioning:** We use a dedicated Supabase Edge Function (`create-user`) authorized by CI secrets (`SUPABASE_SERVICE_ROLE_KEY`) to provision test data. This avoids the fragility of UI registration automation and guarantees a clean slate for every test.
    *   **Canonical Health Check:** The `pnpm test:infra` command (orchestrated via `test-audit.sh`) is the primary quality gate for daily development. It focuses exclusively on the canonical `infra.probe.e2e.spec.ts`, verifying the full data flow (Home -> Session -> Analytics) without the overhead of the full unit test suite.
    *   **No UI-Driven Auth Tests:** Tests that attempt to validate the sign-up or login forms via UI interaction have been removed. The stability and speed gained by using programmatic login are considered a higher priority than testing the auth form itself in the E2E suite.
    *   **Canary Deployment Tests:** A subset of E2E tests (marked `@canary`) are designed to hit real staging endpoints periodically to detect API contract drift and production-specific failures that mocks might hide.
*   **API Mocking (MSW & Playwright Routes):** External services and backend APIs are mocked for deterministic testing. However, mocks are audited against real production response shapes to prevent "Green Illusion" (tests passing while production is broken).
*   **Adversarial Audit Mandate:** All new tests must pass an adversarial review—ensuring they validate design intent (e.g., tier gating, SLOs, resilience) and would fail if production code deviates from intended behavior, even if the structural implementation remains similar.
*   **Private STT Integration Strategy:** To ensure high-fidelity verification of the triple-engine architecture, `PrivateSTT.integration.test.ts` validates engine selection, WebGPU detection, and fallback logic. For headless CI environments, the engine automatically switches to a reliable `MockEngine` when `window.__E2E_PLAYWRIGHT__` is detected.
*   **Single Source of Truth (`pnpm test:all:local` & `pnpm ci:full:local`):**
    *   `pnpm test:all:local`: User-facing entry point for quick validation.
    *   `pnpm ci:full:local`: Full simulation of the CI pipeline (including build and lighthouse), ensuring that "it works on my machine" means it works in CI.
    *   Both run an underlying orchestration script (`test-audit.sh`) that executes all checks (lint, type-check, tests) in a parallelized, multi-stage process.

### Testing Principles

*   **Fail Fast, Fail Hard:** Tests should never hang. Use aggressive timeouts (30s default) and explicit assertions to surface failures immediately. Silent failures are unacceptable.
*   **Print/Log Negatives, Assert Positives:** Only log errors and warnings. Use assertions (`expect()`) to verify successful outcomes—never `console.log("✅ Success")`. Clean CI output makes failures instantly visible.

---

## 5. Known Issues & Risks

This section tracks **active** product risks and constraints only. Resolved issues are documented in `CHANGELOG.md`.

For E2E infrastructure troubleshooting, see [tests/CODEBASE_FIX_APPROACH.md](../tests/CODEBASE_FIX_APPROACH.md).

### 5.5 Known Infrastructure Defects (v0.5.4.6 Baseline)

The following pipeline components and regressions are documented as **Active Known Issues**. This section serves as the candid status report for the CI stabilization effort:

| Category | Component | Issue Description | Status | Why it's broken |
| :--- | :--- | :--- | :--- | :--- |
| **Lint** | `fixtures.ts` | **RESOLVED**: Fixed `@typescript-eslint/no-empty-pattern` vs Playwright requirement. Standardized on `playwright` destructuring. | ✅ FIXED | N/A |
| **STT** | `getUserMedia` | **RESOLVED**: Implemented Hardware Bypass in `STTServiceFactory.ts` for CI. Prevents 100% of 30s timeouts on runners without mics. | ✅ FIXED | N/A |
| **Init** | `Readiness` | **RESOLVED**: Unified state in `useReadinessStore.ts`. Replaced fragmented `window` signals with a single `READY` source of truth. | ✅ FIXED | N/A |
| **E2E** | `analytics.spec` | **RESOLVED**: Fixed race condition in Playwright's `waitForAppReady` helper via synchronous DOM signaling. | ✅ FIXED | N/A |
| **E2E** | `Transcript` | **RESOLVED**: Stabilized mock transcript propagation timing in React 18 using `flushSync` equivalent state updates. | ✅ FIXED | N/A |
| **Audit** | `Coverage` | **RESOLVED**: Implemented robust file system flushes in the CI runner to ensure all coverage data is captured. | ✅ FIXED | N/A |
| **Alias** | `@/*` Paths | **RESOLVED**: Synchronized Vitest with `tsconfig.json` using `vite-tsconfig-paths` at the monorepo root. | ✅ FIXED | N/A |
| **Bridge** | `ENV` Bridge | **RESOLVED**: Centralized all environment flags in `TestFlags.ts` via the Strangler Pattern. | ✅ FIXED | N/A |
| **Reset**  | `T=0 Bridge` | **RESOLVED**: Implemented mandatory signal reset on page load to eliminate "Bridge Drift" and stale callback leaks. | ✅ FIXED | N/A |
| **Signal** | `Uniformity` | **RESOLVED**: Renamed `isReady` to `isEngineInitialized` for unambiguous engine-level synchronization. | ✅ FIXED | N/A |

> [!WARNING]
> **Hardware Boundary**: The current CI pipeline is incapable of validating real audio driver initialization. All "Green" CI runs verify logic and mock integrity only. Manual "Headed" testing with a real microphone remains mandatory for hardware-level regressions.

> [!IMPORTANT]
> **Readiness Sync**: Tests targeting the `Analytics` page must explicitly wait for the `auth` signal *and* the `READY` global state to prevent premature navigation errors.

### 5.3 Expert Testing Strategy & Quality Mandate (2026-03-14)

To ensure the "Gold Standard" of production readiness, the project enforces the following behavioral quality requirements:
- **Behavioral Contract Governance**: All E2E tests MUST target `[data-state]` and `[data-action]` attributes. This decouples functional verification from UI design shifts, ensuring tests validate *intent* rather than *pixels*.
- **Isomorphic Consistency Requirement**: Frontend mocks (MSW) and E2E expectations MUST derive from the shared `stt-isomorphic` fixture registry. A "Green UI" with a "Red E2E" is a failed quality gate.
- **Fail-Fast Metric**: CI pipelines are configured to fail immediately upon a single test failure. No "flaky" retries are permitted in the official release branch.
- **Atomic Initialization**: All core services MUST provide a deterministic readiness signal. Tests are forbidden from using arbitrary `wait()` calls; they must await the `window.__APP_READY_STATE__` contract.

### 5.4 Active System Constraints & Known Issues
- ✅ RESOLVED: v0.6.16 Stabilization - Lifecycle Invariant Stabilization: Enforced strictly monotonic lifecycle versioning and purged the last remaining test-aware production branches (E2E fast-path and test-specific timer guards).
- ✅ RESOLVED: v0.6.4 Stabilization - Forensic Signaling Infrastructure: Centralized all investigative telemetry into `e2eProbe.ts`, resolving stale-closure regressions and enforcing authoritative signal paths for CI.
- **✅ RESOLVED: v0.6.2 Stabilization - STT Contract Alignment**: E2E mocks in `engine-lifecycle.e2e.spec.ts` now support full FSM lifecycle including heartbeat monitoring.
- **✅ RESOLVED: v0.6.2 Stabilization - Vitest Alias Fracture**: Synchronized `vitest.config.mjs` with root `tsconfig.json` ensuring 100% path-mapping resolution.
- **Resolved: STT Initialization Timeout in E2E:** Fixed via **STT Warm-up Bypass** (skipping real microphone initialization in CI/E2E environments).
- **Active Constraint: Missing Real Microphone Testing in CI:** Due to the **STT Warm-up Bypass**, the CI pipeline no longer validates the physical microphone initialization path (`getUserMedia`). This is a deliberate trade-off for pipeline stability; real-world hardware verification must be performed via local/headed testing.
- **Theming:** Dark Theme fully implemented with polished UI (Inter font, glassmorphism).
- **Unit Test Coverage:** 100% Codebase Health (Lint/Typecheck). Tracked in Phase 5.
- **Resolved: Test See-Saw Failure** (Feb 2026): Fixed by implementing "UI State First" architecture. Decoupled session lifecycle from engine stop, ensuring UI reverts to "Start" and mutex is released *before* awaiting slow engine cleanup.
- **UX - Mobile Experience:** Controls on `SessionPage` scroll away ("thumb stretch" issue). Sticky footer required. (✅ RESOLVED - `MobileActionBar` implemented).
- **🟡 Testimonials:** `TestimonialsSection` has placeholder content ("TBD"). Needs real user testimonials.
- **✅ REFACTORED - God File Decomposition (2026-02-16):** Successfully split monolithic `useSpeechRecognition_prod.ts` and `TranscriptionProvider.tsx` into atomic, testable hooks. Resolved Fast Refresh compliance issues.
- **ℹ️ Mock Timeout Bypass:** The `TranscriptionService` now explicitly bypasses the 2s Optimistic Entry timeout when a mock is detected. This ensures deterministic behavior in CI but introduces a tight coupling between the service and test infrastructure. (Tracked as tech debt).
- **✅ RESOLVED - Known Bug: Global Usage Limit Constraint:** Fixed by implementing Pattern 28 (Engine-Aware Usage Tracking) which distinguishes between Native (Unlimited), Cloud (Metered), and Private flows. Billing is now correctly enforced at the edge regardless of engine selection.
- **🟡 UI Redesign Status (LiveRecordingCard):** The vertical centered layout (Mic above Timer) is implemented for standard viewports. Left-aligned stacking for SECURE badge and STT selector is concluded; however, mobile responsiveness for this specific alignment remains a future optimization.
- **✅ RESOLVED - STT E2E Signal Collisions:** Standardized visibility via `data-user-tier` and `data-engine-variant` DOM attributes.
- **✅ RESOLVED - STT Integration Test Timeouts:** Playwright tests for Private (Transformers.js) and Native STT modes have been stabilized via **Atomic Chain Orchestration** and optimized timeout handling. Verified 100% pass rate in CI.
- **✅ RESOLVED - Private STT E2E Flakiness:** Implemented `window.__E2E_CONTEXT__` for reliable bridge detection and capability-aware skip logic for WebGPU-heavy tests in non-GPU CI environments.
- **✅ RESOLVED - E2E Navigation Flakiness:** Removed brittle `nav-upgrade-button` assertions in `primary-journey.e2e.spec.ts` that caused spurious CI timeouts in headless Pro-tier matrices, switching to deterministic `data-route-ready` sync.
- **✅ RESOLVED - Unit Test Mock Bypasses:** Fixed an issue in `CloudAssemblyAI.test.ts` where redundant `ENV.isTest` checks incorrectly bypassed the E2E mock proxy in unit tests. Now correctly decoupled through strictly using `isE2EEnvironment()`.
- **🔴 Active Tech Debt - Vite Rollup Chunks Warning:** Suboptimal code-splitting for dynamically and statically imported modules (e.g., `storage.ts`) generates `dynamic import will not move module into another chunk` warnings and exceeds 500KB limits. Requires architecture refactor of shared service imports.
- **ℹ️ Native Environment Dependency (Sharp):** Executing the acoustic benchmark requires `darwin-arm64v8` specific prebuilt binaries for `sharp` (via `@xenova/transformers`). Manual `npm rebuild` within specific nested `node_modules` remains a requisite step after environment resets.
### Tech Debt (Database & Tier Tracking)

- **🟡 Database Tier Enforcement Refactor (Inch-stones):** The `update_user_usage` RPC and `useSessionLifecycle.ts` hooks are being refactored to align with the new financial model:
  1. **Split Usage Tracking:** Introduce `cloud_usage_seconds` and `native_usage_seconds` into the profile schema.
  2. **Update RPC Logic:** The `create_session_and_update_usage` transaction must inspect the `engine` parameter to decide which counter to augment.
  3. **Revise Edge Function Limits:** The `check-usage-limit` barrier function must parse daily vs monthly logic. Allow 1h/day (25h/mo cap) for Free, and 2h/day (50h/mo cap) for Pro.
  4. **Frontend UI Sync:** The frontend must request and display decoupled daily and monthly usage bars.
  5. ✅ **Multi-Tab Prevention (COMPLETE):** Resolved by universal single-session policy.
- **✅ RESOLVED - Prioritize Local STT (Code Update):** Refactored the frontend STT selector to **default to Private STT** instead of Cloud STT for Pro users. Cloud STT now requires a deliberate opt-in in the UI.

### Tech Debt (Testing)

- **✅ Native STT Headless Test:** Resolved via `MockNativeBrowser` injection (see `tier-limits.e2e.spec.ts`).
- **✅ Private STT E2E Hardening:** Stabilized via runtime bridge detection and `stt-isomorphic` mocks. (2026-03-16).
- **✅ Tier Limit Logic:** `tier-limits.e2e.spec.ts` now dynamically verifies "Daily" (Edge Function) or "Monthly" (RPC) limits based on backend response. Mock duration remains 6s to satisfy `MIN_SESSION_DURATION_SECONDS` (5s).
- **🟡 PDF Content Extraction & Generation:** `pdf-parse` requires `DOMMatrix`. PDF structure validated only. (By design). **New Requirement:** PDF Generation for Free tier users must explicitly inject a prominent "Generated by SpeakSharp" watermark as part of the Phase 2 Funnel strategy. Pro tier exports remain clean.
- ✅ **Cloud STT (Production) (2026-01-28):** Resolved CORS (`ALLOWED_ORIGIN` mismatch) blocking production usage.
- ✅ **Cloud STT E2E (2026-01-28):** Resolved mode selector and button dropdown unresponsiveness.
- **Pattern 27: UI-First State Reversion** (100% Responsiveness).
- **Pattern 28: Engine-Aware Usage Tracking** (P0 Hardening).
- ✅ **Initialization Crash (2026-01-28):** Resolved `__BUILD_ID__` ReferenceError causing 15s E2E timeouts.
- ✅ **Session Page UI Polish (2026-01-28):** Implemented "Live Session" label, paired layout, and multi-color highlights.
- ✅ **CI Path Resolution (2026-02-09):** Resolved Lighthouse CI `MODULE_NOT_FOUND` by implementing subshells `()` for backgrounded preview processes, ensuring stable CWD for subsequent steps.
- ✅ **Live Test Identity Stability (2026-02-09):** Prevented MSW from hijacking live database sessions by ensuring `shouldEnableMocks` respects `USE_REAL_DATABASE`.
- ✅ **Model Loading Indicator (2026-02-09):** Normalized progress reporting to a standard 0-100% scale and fixed UI display multipliers.
- ✅ **User Filler Words Native STT:** Native STT doesn't support user filler words (browser-controlled). Only Cloud STT (`word_boost`) supports this.
- ✅ **100% Type Safety (2026-02-16):** Eliminated all `any` usage in transcription types and resolved literal widening issues. Permanent "Zero-Debt" pass.

### Official Vendor API Limits (Free Tier)
To ensure test stability and prevent accidental overages, SpeakSharp strictly adheres to the following vendor free-tier constraints:
- **AssemblyAI WebSockets (Cloud STT):** Maximum of **5 concurrent streaming sessions** per minute. Exceeding this causes `1008 Unauthorized Connection` errors. (Note: Paid accounts scale to 100+ concurrent).
- **Supabase Edge Functions:** 
  - Maximum **500,000 invocations** per month.
  - Maximum **150 seconds** execution duration (wall clock limit).
  - Maximum **256MB** memory allocation per invocation.

### Gap Analysis: Alpha Launch Blockers

| Issue | Status |
|-------|--------|
| Rate Limiting | ✅ RESOLVED - `rateLimiter.ts` |
| Usage Limit UX | ✅ RESOLVED - `check-usage-limit` Edge Function |
| Error Reporting | ✅ RESOLVED - Sentry integration |
| Documentation Drift | ✅ RESOLVED - ARCHITECTURE.md updated |
| E2E Error States | ✅ RESOLVED - `error-states.e2e.spec.ts` |
| Promo Admin | ✅ RESOLVED - `apply-promo` Edge Function |
| **C1-C3, H2, H3**| ✅ RESOLVED - Jan 2026 Audit Complete |
| **Performance (1.1, 2.1)**| ✅ RESOLVED - Bundle & CI Optimized |
| CI Stabilization | ✅ RESOLVED - Identity Bridge Hub Fixed |
| Document Alignment | ✅ RESOLVED - PRD/ARCHITECTURE/CHANGELOG synchronized |

**All P0/P1 blockers resolved.** See `CHANGELOG.md` for details.

---

## 6. Development Roadmap
The project's development status is tracked in the [**Roadmap**](./ROADMAP.md). This board provides a two-dimensional view of our project tasks, combining Phased Milestones with MoSCoW Prioritization.

---

<!-- SQM:START -->
## 6. Software Quality Metrics

**Last Updated:** Thu, 19 Mar 2026 00:19:00 GMT

**Note:** This section is automatically updated by the CI pipeline. The data below reflects the most recent successful run.

**Metric Definitions:**
- **Total Source Size:** Sum of all code in src, backend, tests, docs, and scripts.
- **Total Project Size:** Total disk footprint including node_modules and assets.
- **Initial Chunk Size:** The size of the largest initial JavaScript bundle.
- **Code Bloat Index:** Ratio of Initial Chunk Size to Total Source Size (lower is better).

---

### Test Suite State

| Metric                  | Value |
| ----------------------- | ----- |
| Total tests             | 635 (622 unit + 13 E2E) |
| Unit tests              | 622   |
| E2E tests (Playwright)  | 13  |
| Passing tests           | 634 (621 unit + 13 E2E)   |
| Failing tests           | 0   |
| Disabled/skipped tests  | 1 (Landing.test.tsx)   |
| Passing unit tests      | 621/622 (99.8%)   |
| Passing E2E tests       | 13/13 (100%)   |
| Total runtime           | ~1.5m (Unit) + 1m (E2E)   |

---

### Coverage Summary

| Metric     | Value |
| ---------- | ----- |
| Statements | 0%   |
| Branches   | 0%   |
| Functions  | 0%   |
| Lines      | 0%   |

---

### Code Bloat & Performance

| Metric              | Value |
| ------------------- | ----- |
| Total Source Size   | 20M   |
| Total Project Size  | 1.9G   |
| Initial Chunk Size  | 1.1M   |
| Code Bloat Index    | 5.33%   |
| Lighthouse Scores   | P: 96, A: 100, BP: 100, SEO: 91 |

---
<!-- SQM:END -->
<!-- do not remove - used by sqm script -->

### 6.3 Known Defects & Limitations
*   **Active Issue: Mobile RAM Optimization**: Tiny-model preference for iOS Safari (300MB RAM limit) is still pending implementation.

## 8. Metrics and Success Criteria

### Service Level Indicators (SLIs) & Objectives (SLOs)

**SLIs (what we measure):**

- 🕑 **Time to first transcript chunk (latency)** — ms between mic start and first transcript event.
- ⚡ **End-to-end transcription latency (speed)** — avg delay between spoken word and displayed text.
- 📉 **WebSocket error rate** — % of sessions terminated by non-1000 close codes.
- 🔄 **Reconnect success rate** — % of reconnect attempts that resume within 2s.
- 🔐 **Token issuance error rate** — % of failed requests to /assemblyai-token.
- 💰 **Cost guardrail** — $/minute STT usage per active user session.

**SLOs (targets):**

- <2s to first transcript chunk (p95).
- <500ms streaming transcription delay (p90).
- <1% WebSocket error rate.
- >95% reconnect success rate within 2s.
- <0.5% token issuance failures.
- <$0.05/min STT cost at MVP scale.

---

## 9. Future Enhancements / Opportunities

### [COMPLETED] Feature: STT Accuracy Vs Benchmark (Path A)
**Goal:** Improve transparency and user trust via deterministic STT Verification.

Successfully implemented via an **Acoustic Ground Truth Metric Pipeline**. The backend dynamically synthesizes deterministic 16kHz audio using macOS `say` and `ffmpeg` via `scripts/generate-filler-audio.sh`. This produces phonemes enriched with filler words ("ums", "ahs"). The evaluation engine (`scripts/benchmark-filler-ceiling.mts`) routes these controlled audio fixtures into machine engines (e.g. Whisper-tiny) and quantifies the algorithmic Word Error Rate (WER). The static reference ceilings derived from this isolated evaluation pipeline are stored in `tests/STT_BENCHMARKS.json`.

### [COMPLETED] Feature: Dynamic Software Quality Metrics Reporting

**Goal:** To provide an accurate, at-a-glance overview of the project's health directly within the documentation.

**Problem:** The current Software Quality Metrics section in this document is not updated automatically and relies on placeholder data.

**Solution Implemented:** A robust, parallel CI/CD pipeline has been implemented in `.github/workflows/ci.yml`. This workflow runs all necessary checks, including linting, type-checking, unit tests, and E2E tests, in a distributed and efficient manner. The results of these checks can be used to automatically update the Software Quality Metrics section of this document.

---

## 10. Strategic Review & Analysis

This section provides high-level insights into the SpeakSharp project from multiple senior perspectives.

### 💰 CFO Perspective (Financials & Business Model)

**Pricing:**
*   The Pro tier is priced at **$14.99/month**. This price point is strictly required to buffer against the $0.47/hr streaming costs of AssemblyAI while capping maximum usage to 50 hours per month.

**Conversion Rate:**
*   Financial models use a conservative base conversion rate of **2%**.
*   To improve conversion, the product strategy will focus on:
    *   **Optimizing the "Aha!" Moment:** The Free tier must quickly demonstrate the product's value.
    *   **Creating a Compelling Upgrade Path:** The Pro tier offers vastly superior cloud transcription and absolute privacy via local WebGPU.
    *   **Effective Upgrade Prompts:** The `UpgradePromptDialog` should execute when usage limits are hit.

**Operating Costs (2024 Reality):**
*   The serverless architecture minimizes DevOps overhead, but API inference is expensive.
*   The primary variable cost is the **AssemblyAI Universal-Streaming API** ($0.47/hour). It is a strategic imperative to incentivize users to utilize the **Private Local Engine** ($0.00/hour) to maximize gross margins.

**Estimated Monthly Operating Costs (Full Stack):**

*   **Fixed Infrastructure Costs:**
    *   **Supabase Pro Plan:** **$25.00/month**. (Core backend, auth, database, edge functions).
    *   **Vercel Pro:** **$20.00/month**. (Frontend hosting and serverless SSR).
    *   **Sentry Team:** **$29.00/month**. (Error tracking, 50k events).
    *   **Resend Pro:** **$20.00/month**. (Transactional emails, 50k emails).
    *   **PostHog:** **$0.00/month**. (Product analytics, free under 1M events).
    *   **Total Fixed Base:** **$94.00/month**.

*   **Variable Costs (per Pro user per month):**
    *   **Stripe:** **3.4% + $0.30 per charge**. For a $14.99 subscription, this is **$0.81 per user**.
    *   **AssemblyAI:** **$0.47/hour** of streaming speech-to-text. (Assumed average use: 10 hrs/mo = $4.70/user).

**Key Financial Metrics (CAC & LTV):**
*   **Customer Acquisition Cost (CAC):** Since the estimated LTV is ~$85, CAC via paid channels (Reddit Ads, Meta) must be strictly capped at **< $28.00** to maintain a healthy 3:1 LTV/CAC ratio.
*   **Lifetime Value (LTV):**
    *   **Assumption:** Average user retention of **6 months**.
    *   **Estimated LTV:** Based on the new $14.99/mo Pro price and average fees, LTV is approximately **$85**.

**Breakeven Analysis & Profitability Timeline:**
*   **Breakeven Calculation:**
    *   **Revenue per Pro user:** $14.99/month.
    *   **Average Variable Costs per Pro user:** $0.81 (Stripe) + $4.70 (10 hrs AssemblyAI) = **$5.51/month**.
    *   **Net Margin per Pro user:** $14.99 - $5.51 = **$9.48/month gross profit**.
    *   **Fixed Costs:** $94.00/month.
    *   **Breakeven Point:** $94.00 / $9.48 = **~10 Pro users**. (At a 2% conversion rate, this requires ~500 total active users).

### 🚀 CEO Perspective (Marketing & User Acquisition)

**Marketing Approach:**
*   The phased GTM strategy (organic first, then paid) is a sound approach for a startup with a limited budget, allowing for validation before scaling.

**Advertising Strategy:**
*   The advertising strategy will follow the phased GTM approach.
*   **Phase 1 (Organic):** Focus on organic channels as described below.
*   **Phase 2 (Paid):** Once a stable conversion rate of at least 2% is achieved, a limited and targeted paid advertising campaign will be launched.
    *   **Initial Platform:** Reddit ads, targeting the subreddits listed below.
    *   **Expansion Platforms:** Based on the success of the Reddit ads, expansion to Facebook or Google Ads will be considered. Target CAC is strict (< $28).

**User Acquisition Channels:**
*   **Reddit:** This is a key channel for reaching niche communities.
    *   **Target Subreddits:** `r/publicspeaking`, `r/toastmasters`, `r/communication`, `r/presentations`, `r/entrepreneur`, `r/startups`.
    *   **Approach:**
        1.  **Be a Community Member:** Participate genuinely before promoting.
        2.  **Seek Feedback:** Frame posts as seeking feedback on a new tool.
        3.  **Offer Value:** Provide free Pro access to early adopters for feedback.
        4.  **Share the Journey:** Document and share the building process.
*   **Other Channels:**
    *   **Toastmasters:** Partner with local clubs and offer discounts.
    *   **Public Speaking Forums:** A great source for early adopters.
    *   **Content Marketing:** Create blog posts and videos to drive organic traffic.
    *   **Product Hunt:** Launch on Product Hunt to generate initial buzz.

**Product Strategy & Roadmap:**

**Gaps / Market Risks:**

*   **Financial Limit Risk:** If power users maximize their 50-hour Cloud STT limit (`50 hrs * $0.47 = $23.50`), we lose money on their $14.99 subscription. This requires aggressive UX nudges toward the local WebGPU engine.
*   Limited feature set at MVP (filler words only). Competitors offer richer analytics.
*   No social proof (testimonials, coach endorsements, beta case studies).

**Recommendations:**

*   **[COMPLETED]** Prioritize “speaking pace” analysis in Phase 2 ([ROADMAP.md](./ROADMAP.md#phase-2-user-validation--polish)).
*   **[IN PROGRESS]** Refactor database `update_user_usage` logic to separate Native STT hours from Cloud STT hours.
*   Produce a “How it Works” demo video for the landing page highlighting the Private Engine.

### 💰 Updated Pricing Tiers & Recommendations

> **🚨 50% Margin of Safety Governance:** The session limits listed below (60m Free / 120m Pro) are currently *hypothetical target bounds*. Their final values will be strictly governed by the results of the "Extreme Duration Soak Test." Whatever absolute maximum duration the Browser RAM, Gemini Context Window, and PDF Generator can technically survive, we will apply a **50% Margin of Safety** to determine our actual marketed limits to ensure 100% reliability for paying users.

*   **Free User (Authenticated):**
    *   **Limit:** **1 Hour / Day** (Capped at Max 25 Hours / Month). *Max 60-Minute soft limit per session, plus a 5-minute graceful wrap-up warning.*
    *   **Engine:** Restricted strictly to **Native Browser STT** ($0.00 cost to SpeakSharp).
    *   **Funnel Features:** Access to Custom Vocab tracking, Vocal Variety metrics, and **Watermarked** PDF Practice Export (Strictly limited to **1 teaser export per month**).
    *   **Recommendation:** Giving them 1 free, watermarked PDF is the ultimate "freemium teaser" funnel to up-sell the Pro tier. Daily/Monthly limit cutoffs must utilize "Gracious Sunsetting" UX (e.g., "You crushed your goals today! Upgrade for more, or see you tomorrow!").

*   **Pro User (Authenticated):**
    *   **Price:** **$14.99 / month.** (Or $149/year).
    *   **Limit:** **2 Hours / Day** (Capped at Max 50 Hours / Month). *Max 120-Minute soft limit per session, plus a 5-minute graceful wrap-up warning.*
    *   **Engine:** Full access to **Private STT (WebGPU)** and the premium **Cloud AI (AssemblyAI)**.
    *   **Exclusive Premium Features:** To justify the $14.99 point, Pro users receive access to features that provide massive value but cost pennies in compute:
        *   **AI Speech Coach Feedback:** Post-session comprehensive analysis powered by advanced LLMs (e.g., Gemini Flash) providing structured feedback on tone, delivery, and structure.
        *   **Clean PDF Exports:** Professional, un-watermarked PDF report generation.
        *   **Speaker Diarization:** Multi-speaker awareness for real-world meeting analysis (Cloud STT only).
    *   **Recommendation:** As AssemblyAI costs $0.47/hr, we must default users to the Private STT engine in the code. Cloud STT should be positioned as an auxiliary fallback for users on weak hardware or when ultimate accuracy is required. We must visually incentivize the Local Engine in the UI to push variable costs toward $0.

---

## 11. Deployment (Alpha Release)

This section provides a complete step-by-step guide to deploy SpeakSharp to Vercel for alpha testing with new users.

### Pre-Deployment Checklist

Before deploying, verify:

| Item | Command | Expected Result |
|------|---------|-----------------|
| Whisper model files | `ls -lh frontend/public/models/` | `tiny-q8g16.bin` (~30MB), `tokenizer.json` (~2MB) |
| Full test suite | `pnpm test:all:local` | All 539 tests passing |
| Production build | `pnpm build` | Builds successfully |
| Database migrations | Check Supabase Dashboard → SQL Editor | 14 migrations applied |

### Step 1: Vercel Project Setup

1. **Create Vercel Project:**
   - Go to [vercel.com](https://vercel.com) → "New Project"
   - Import from GitHub: `your-org/speaksharp`
   - Framework Preset: **Vite** (auto-detected)

2. **Configure Build Settings (auto-populated from vercel.json):**
   - Build Command: `pnpm build`
   - Output Directory: `frontend/dist`
   - Install Command: `pnpm install --frozen-lockfile`

### Step 2: Vercel Environment Variables

Go to **Project Settings → Environment Variables** and add:

| Variable | Value | Environments |
|----------|-------|--------------|
| `VITE_SUPABASE_URL` | `https://yxlapjuovrsvjswkwnrk.supabase.co` | Production, Preview, Development |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key (starts with `sb_publishable_`) | Production, Preview, Development |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Your Stripe publishable key (starts with `pk_live_` or `pk_test_`) | Production, Preview, Development |
| `VITE_SENTRY_DSN` | Your Sentry DSN (optional) | Production, Preview |

> **Finding Your Keys:**
> - **Supabase:** Dashboard → Project Settings → API → `anon` public key
> - **Stripe:** Dashboard → Developers → API keys → Publishable key

### Step 3: Supabase Edge Functions Secrets

Go to **Supabase Dashboard → Edge Functions → Secrets** and add:

| Secret | Description | How to Get |
|--------|-------------|------------|
| `SITE_URL` | Your Vercel production URL (e.g., `https://speaksharp.vercel.app`) | Vercel Dashboard after first deploy |
| `STRIPE_SECRET_KEY` | Stripe secret key (starts with `sk_live_` or `sk_test_`) | Stripe Dashboard → Developers → API keys |
| `STRIPE_PRO_PRICE_ID` | Price ID for Pro subscription (e.g., `price_1Sdiu075Lp2WYe28gYDhJokR`) | Stripe Dashboard → Products → Pro plan → Price ID |

### Promo Code Signup Flow (Design Specification)

Authentication is the primary gate. Optional features (like promo codes) are secondary and must not block access if they fail but credentials are valid.

1. **Credentials provided + promo fails:**
   - Authenticate the user.
   - Redirect to `/session` as a free user.
   - Show error toast: "Promo code invalid. You've been signed up as a free user."

2. **No credentials provided + promo fails (Validation phase):**
   - Stay on signup page.
   - Show inline error in red bold text below the field.
   - Do not authenticate.
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (starts with `whsec_`) | Created in Step 5 |
| `ASSEMBLYAI_API_KEY` | AssemblyAI API key for Cloud STT | [AssemblyAI Dashboard](https://www.assemblyai.com/app) → API Keys |
| `ALLOWED_ORIGIN` | Vercel production URL for CORS (e.g., `https://speaksharp.vercel.app`) | Same as SITE_URL |

### Step 4: Supabase Authentication Configuration

Go to **Supabase Dashboard → Authentication → URL Configuration**:

1. **Site URL:** `https://speaksharp.vercel.app` (your Vercel URL)
2. **Redirect URLs:** Add:
   - `https://speaksharp.vercel.app/*`
   - `https://speaksharp-*.vercel.app/*` (for PR previews)

### Step 5: Stripe Webhook Configuration

Go to **Stripe Dashboard → Developers → Webhooks**:

1. **Add Endpoint:**
   - URL: `https://yxlapjuovrsvjswkwnrk.supabase.co/functions/v1/stripe-webhook`
   - Events to send:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_failed`

2. **Copy Signing Secret:**
   - After creating, click "Reveal" on signing secret
   - Copy the `whsec_...` value
   - Add as `STRIPE_WEBHOOK_SECRET` in Supabase (Step 3)

### Step 6: Deploy to Vercel

```bash
# Option A: Via CLI
pnpm i -g vercel
vercel link
vercel              # Preview deploy
vercel --prod       # Production deploy

# Option B: Via Dashboard
# Push to main branch - auto-deploys to production
# Push to any other branch - auto-deploys to preview
```

### Step 7: Verify Deployment

After deployment, verify the complete user journey:

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Visit `https://your-app.vercel.app` | Landing page loads |
| 2 | Click "Get Started" → Sign Up | Signup form with Free/Pro options |
| 3 | Create account (Free) | Redirects to `/session` |
| 4 | Start a session | Native Browser STT works |
| 5 | Check Analytics | Session appears in history (Metrics only; transcript is ephemeral) |
| 6 | Upgrade to Pro | Redirects to Stripe checkout |
| 7 | Complete payment | Pro features unlocked |
| 8 | Test Cloud STT | AssemblyAI transcription works |
| 9 | Test Private STT | Whisper model downloads and works |

### Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Build fails | Missing env vars | Verify all `VITE_*` vars are set in Vercel |
| Auth redirect fails | Wrong redirect URL | Add Vercel URL to Supabase redirect URLs |
| Stripe checkout fails | Missing `SITE_URL` | Set `SITE_URL` in Supabase secrets |
| Webhook not working | Wrong URL or secret | Verify webhook URL and `STRIPE_WEBHOOK_SECRET` |
| Cloud STT fails | Missing API key | Set `ASSEMBLYAI_API_KEY` in Supabase secrets |
| CORS errors | Missing `ALLOWED_ORIGIN` | Set `ALLOWED_ORIGIN` to Vercel URL in Supabase |

### Alpha Release URL Strategy

| Environment | URL | Purpose |
|-------------|-----|---------|
| Preview | `speaksharp-*.vercel.app` | PR previews |
| Alpha/Staging | `alpha.speaksharp.app` | Soft launch, beta testers |
| Production | `speaksharp.app` | Public release |

**Custom domain setup:**
1. Vercel Dashboard → Project → Domains
2. Add `alpha.speaksharp.app`
3. Add CNAME record in DNS: `alpha → cname.vercel-dns.com`
