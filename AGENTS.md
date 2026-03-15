**Owner:** [unassigned]
**Last Reviewed:** 2026-03-14

# Agent Instructions for SpeakSharp Repository

---

## 🚨 Critical Environment & Workflow Rules

### 1. Mandatory Pre-flight Check (Start Here)

To address persistent environment instability, a new automated pre-flight check has been created. This is now the **mandatory** first step for all sessions.

**Your first action in every session MUST be to execute this script:**

```bash
pnpm preflight
```

This script performs a fast, minimal sanity check of your environment to ensure Node.js, pnpm, and all dependencies are correctly installed.

Do not proceed until this script completes successfully. If it fails, follow the "Dead Environment Trap" troubleshooting in `README.md` to stabilize your environment via `pnpm env:stabilize`.

---

## 🛡️ Project Manifesto: Core Principles

- **🧠 First Principles Mandatory**: Solve every task from first principles by stripping away assumptions and rebuilding from the project's most basic, undeniable truths. We operate on what we **know** is true, not what we **think** is true.
- **🔪 Document With a Scalpel, Not an Axe**: Documentation updates must be minimal, targeted, and directly tied to the code change that triggered them. Agents must modify only the specific section affected by the change and must not rewrite or restructure unrelated documentation.
### 🧪 Testing & Quality
- **📖 Testing Strategy (MANDATORY)**: All agents MUST read **[tests/TESTING.md](tests/TESTING.md)** and **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#3-testing-strategy--governance)** before writing any tests.
- **Integrity over Implementation**: Tests must validate requirements and design intent, not structural implementation. Every test must answer one question: *"Does the product do what the user paid for?"*
- **Behavioral Testing Contracts**: Tests must target stable `[data-state]` and `[data-action]` attributes, never brittle CSS classes or hardcoded text.
- **Isomorphic Golden Transcripts**: Use a shared registry of speech assets to ensure frontend mocks perfectly match backend/production behavior.
- **Fail Fast, Fail Hard**: Avoid hanging tests; use aggressive 30s timeouts and explicit assertions to surface failures immediately.
- **Strict Linting (ADR-001)**: `eslint-disable` is banned. Fix root causes (types, dependency arrays) for long-term stability. Permanent "Zero-Debt" mandate.
- **Decomposition over Monoliths**: Never create or expand "God Files" (e.g., `TranscriptionProvider.tsx`). Always decompose logic into atomic hooks (`useTranscriptionState`, `useTranscriptionControl`).
- **TestRegistry for DI**: Centralized engine injection via `TestRegistry` is the only way to register STT engines. This ensures deterministic mocking.
- **Log, Don't Suppress (MANDATORY)**: Never swallow exceptions with empty `catch` blocks in **ANY** code (Production, Tests, or Mocks). **EVERY** `catch` block MUST log the exception via `logger.error()`, `Sentry.captureException()`, or `console.error` (if logger is unavailable in that specific context).
    - **Principle**: If a promise can reject, it **MUST** have a `.catch()` attached in the same tick it is created to prevent unhandled rejections.
    - **Mock Integrity**: Mocks that return rejected promises MUST follow the same logging rules if they are likely to trigger unhandled rejections in test runners.
- **Use Logger, Not Console (STRICT)**: `console.log`, `console.warn`, `console.debug`, and `console.error` are STRICTLY FORBIDDEN in the entire codebase (Source and Tests). Use the unified `logger` utility with appropriate log levels (`info`, `debug`, `warn`, `error`).
- **PNPM Mandate (STRICT)**: This project exclusively uses `pnpm`. `npm` and `yarn` commands are rejected via preinstall hooks and enforcement guards.
- **CI Restoration Standard**: All CI-produced logs MUST use the `tee` restoration pattern to ensure full diagnostic visibility without polluting machine-readable artifacts.

### 🌳 Test Mock Hierarchy (The Decision Tree)
When adding a test, choose the **highest fidelity** option possible:
1. **REAL IMPLEMENTATION** (Highest Confidence): Use for Integration tests, critical paths. Do not mock internal logic. Use `renderWithAllProviders`.
2. **E2E CONFIG PRESET** (Standard Scenarios): Happy path E2E, standard user flows.
3. **TEST REGISTRY** (Edge Cases): Simulating specific failures (Network error, quota exceeded).
4. **VI.MOCK** (Unit Tests Only | Lowest Fidelity): Isolated pure functions. **NEVER** use `vi.mock` for core domain logic (Stores, Providers, Hooks) in feature tests.
- **Real Stores vs Mock Stores**: Use **Real Zustand Stores** + Reset. Anti-Pattern: `vi.mock('../../stores/useSessionStore')`.
- **Test Impact Analysis**: SpeakSharp optimizes test execution via a dependency map (`test-impact-map.json`). When modifying existing or adding new logic, make sure the affected directory mapped to its test suite in `test-impact-map.json`, so agents only run tests impacted by their changes via `pnpm test:agent`.

### 🚨 Error Classification
Distinguish between "Business Events" and "System Failures":
- **Expected Events:** `CacheMissEvent`, `QuotaExceededEvent` -> Handled via extensive logic (Circuit Breaker).
- **Unexpected Failures:** `MicrophoneError`, `NetworkDisconnect` -> Handled via `LocalErrorBoundary`.


### 🏛️ Architecture & Design
- **System Integrity over Developer Velocity**: Prioritize explicit contracts (interfaces) and robust error handling even if they trigger lint warnings or require more code. Never sacrifice the "Gold Standard" for quick check-ins.
- **Privacy-First**: Core differentiator. All audio stays on-device in "Private" mode.
- **UI-First State Reversion**: Decouple UI state from async engine cleanup for 100% responsiveness (preventing "See-Saw" failures).
- **Microtask Store Decoupling**: Isolate Zustand store updates from React synchronous state transitions using `queueMicrotask` to prevent concurrent rendering errors.
- **Shadowed State Prevention**: Hooks must select state directly from the global store (`useSessionStore`); never derive it from local, potentially stale variables.
- **Engine-Aware Usage Tracking**: Billing and tier enforcement must be tracked accurately based on the active engine (Native vs. Cloud vs. Private).
- **Event-Based Synchronization**: Never use arbitrary `sleep()` or timeouts for waiting. Use selectors or events.
- **Dual-Engine Facade**: Multi-stage fallback (WhisperTurbo -> TransformersJS -> Native) for 99.9% reliability.
- **Deterministic Timing**: Use **`setE2ETime`** helper for E2E store sync. **NEVER** use `page.clock` (prevents calculation drift).
- **Auto-Mocking**: Always use the **`mockedPage`** fixture in Playwright E2E tests for zero-config MSW parity.
- **Lean Schema**: Exclude optional fields to minimize data footprint and PII.
- **Zero-Wait UX (Optimistic Entry)**: Fallback immediately if heavy models aren't cached, but continue loading in background.

### 🛑 Error Handling Patterns
| Pattern | When to Use | Example |
|---------|-------------|---------|
| **Re-throw** | Critical failures that should bubble up | Auth failures, API crashes |
| **Log + Fallback** | Recoverable errors with graceful degradation | Network timeout → retry |
| **Log + Suppression** | Non-critical operations (Best-effort) | Analytics tracking, prefetch |

**Code Standard:** All `catch` blocks MUST log. Empty catches (`catch {}`) are strictly forbidden. Every catch must include a descriptive log prefix explaining the context of the failure.

### 🏛️ Seven Rules Governance (Architectural Integrity)
To prevent architectural drift and ensure system-wide stability, all agents must adhere to these seven core rules:

- **Isolation (UI → Service)**: UI components must **NEVER** import or call services (e.g., `TranscriptionService`) directly. All session-related commands must flow through the `SpeechRuntimeController`.
- **Lazy Initialization**: Resource-heavy modules (like WASM-based STT engines) must not load during the application boot phase. They must initialize lazily upon the first user interaction.
- **Deterministic Mocking**: The `TestRegistry` must be initialized exclusively via Playwright's `addInitScript` to ensure mock implementations are injected before the application code executes.
- **Readiness Contract**: The application must provide a single, deterministic readiness signal via `window.__APP_READY_STATE__`. All E2E tests must wait for this specific contract.
- **Automated Impact Mapping**: Test impact detection is automated via `dependency-cruiser`. Direct modification of `test-impact-map.json` is deprecated; the graph is dynamically derived from source code.
- **Command Serialization**: The `SpeechRuntimeController` must serialize all lifecycle commands (Start/Stop/Reset) using a mutex to prevent race conditions during rapid state transitions.
- **Unified Namespace**: All test-related configuration and metadata must reside under the unified `window.__APP_TEST_ENV__` namespace.

### 🏗️ SpeakSharp Architecture Patterns

### Hardening Patterns (2026-02-12)

The remediation strategy focuses on "defense in depth," addressing vulnerabilities across the frontend, edge functions, and database layers.

  ┌─────────────────────────────────────────────────────────────────────────┐
  │                    HARDENING ARCHITECTURE OVERVIEW (v3.5.4.1)           │
  └─────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────┐         ┌─────────────────────────────┐
  │ CLIENT LAYER (React/Zustand)│         │ LOGIC LAYER (Edge Functions)│
  │                             │         │                             │
  │  ┌───────────────────────┐  │         │  ┌───────────────────────┐  │
  │  │ LocalErrorBoundary    │  │         │  │ safeCompare (const-T) │  │
  │  └──────────┬────────────┘  │         │  └──────────┬────────────┘  │
  │             │               │         │             │               │
  │        (Isolation)          │         │        (Security)           │
  │             ▼               │         │             ▼               │
  │  ┌───────────────────────┐  │         │  ┌───────────────────────┐  │
  │  │ useSessionLifecycle   │──┼────┐    │  │ apply-promo (Admin)   │  │
  │  └───────────────────────┘  │    │    │  └──────────┬────────────┘  │
  │  ┌───────────────────────┐  │    │    │             │               │
  │  │ useTransService Hook  │  │    │    │        (Integrity)          │
  │  └───────────────────────┘  │    │    │             ▼               │
  │             │               │    │    │  ┌───────────────────────┐  │
  │        (Isolation)          │    │    │  │ update_user_usage RPC │  │
  │             ▼               │    │    │  └──────────┬────────────┘  │
  │  ┌───────────────────────┐  │    │    │             │               │
  │  │ Single-Chain Service  │  │    │    └─────────────┼───────────────┘
  │  └──────────┬────────────┘  │    │                  │
  │             │               │    │                  │ (Atomic)
  │        (Stability)          │    │                  ▼
  │             ▼               │    │   ┌───────────────────────────────────┐
  │  ┌───────────────────────┐  │    │   │      DATA LAYER (Supabase)        │
  │  │ Triple-Tracing Proxy  │──┼────┘   │                                   │
  │  └───────────────────────┘  │        │  ┌─────────────────────────────┐  │
  └─────────────────────────────┘        │  │   FOR UPDATE Row Locking    │  │
                                         │  └─────────────────────────────┘  │
                                         │           ▲                       │
                                         │           │ (Cleanup)             │
                                         │  ┌─────────────────────────────┐  │
                                         │  │     ON DELETE CASCADE       │  │
                                         │  └─────────────────────────────┘  │
                                         └───────────────────────────────────┘

These core patterns were established during the Hardening cycle and refined in v3.5.7 to ensure system-wide stability and security.

#### 1. Lately Captured State Pattern (`useTranscriptionCallbacks.ts`)
**Problem:** Stale closures in `useEffect` or `useCallback` when passing callbacks to async services (like Transcription).
**Solution:** A `useRef`-based proxy that captures the "Lately Captured State" of component variables, providing a stable reference that always accesses the most recent values during async execution.
- **Used in:** `useTranscriptionCallbacks.ts` (Handles `onTranscriptUpdate`, `onStatusUpdate`).
- **Benefit:** Prevents "Zombie Callbacks" where services execute logic against old component state.

#### 2. Double-Dispose Guard (`TranscriptionService.ts`)
**Problem:** Race conditions during rapid "Stop/Start" cycles where a secondary instance might be initialized before the primary teardown completes.
**Solution:** Explicit `isDisposed` flag check in the `dispose` method and `initialized` guards in the singleton/registry.
- **Benefit:** Guaranteed resource cleanup and prevention of overlapping audio streams.

#### 3. Atomic Usage Updates (PostgreSQL)
**Problem:** Race conditions in usage limit enforcement where concurrent sessions could bypass limits.
**Solution:** Migrated from `SELECT -> UPDATE` (application logic) to atomic SQL `UPDATE ... SET usage = usage + 1 WHERE id = ... AND usage < limit`.
- **Benefit:** Strong consistency for tier-based resource consumption.

#### 4. Triple-Identity Tracing (`TranscriptionService.ts`)
**Problem:** Non-deterministic debugging in high-concurrency environments where mapping specific logs to a "Service Lifecycle" vs a "Recording Run" was impossible.
**Solution:** Implemented `serviceId` (Service Instance), `runId` (Specific recording session), and `engineId` (Backend driver) tagging on every log entry.
- **Benefit:** 100% correlation between frontend user actions, service state transitions, and backend engine events.

#### 5. Microtask Store Decoupling (`TranscriptionService.ts`)
**Problem:** React 18 concurrent update errors ("Should not already be working") occurring when store updates are triggered during component unmounting or concurrent rendering cycles.
**Solution:** Decouple Zustand store updates from synchronous state transitions using `queueMicrotask`. This ensures the rendering cycle completes before the store notifies listeners.
- **Benefit:** Prevents internal React inconsistency and stabilizes UI updates during rapid lifecycle transitions.

#### 6. ProfileGuard & useProfile Hook (`App.tsx` / `useProfile.ts`)
**Problem:** Transcription services or hooks initializing before the user profile is loaded, leading to null pointer errors or incorrect policy application.
**Solution:** A global `ProfileGuard` component that blocks rendering of sensitive routes until the profile is fetched. Paired with a `useProfile` context hook that guarantees non-null access to profile data for downstream components.
- **Benefit:** Eliminates "early initialization" race conditions and simplifies component logic by removing redundant null-checks.

#### 7. Post-Lock Instance Validation (`TranscriptionService.ts`)
**Problem:** Race conditions in `safeTerminateInstance` where concurrent `destroy` calls might access a nulled instance after waiting for a lock.
**Solution:** Re-verify the existence of `this.instance` immediately after acquiring the termination lock.
- **Benefit:** Robust prevention of null-pointer exceptions in high-concurrency lifecycle scenarios.

#### 8. Dynamic Policy Synchronization (`TranscriptionService.ts`)
**Problem:** The service singleton initializes with a default (Free) policy before the user profile is available, leading to restricted features even for Pro users.
**Solution:** Explicit `updatePolicy()` and `updateCallbacks()` methods that re-synchronize the service with the latest user data immediately before transcription starts.
- **Benefit:** Resolves the "Wrong ID" and "Stale Callback" race conditions.

#### 9. Error Isolation Boundaries (`SessionPage.tsx`)
**Problem:** A failure in a secondary UI widget (e.g., Pause metrics) could crash the entire transcription session.
**Solution:** Use of `<LocalErrorBoundary>` per-widget to isolate failures and provide a "Retry" mechanism without impacting the core recording logic.
- **Benefit:** Increased system resilient and improved UX during partial failures.

#### 10. Behavioral Test Contracts ([data-state] / [data-action])
**Problem:** Flaky E2E tests due to unpredictable loading states or brittle CSS/text-based selectors that break when the UI is restyled.
**Solution:** Explicit use of `data-state` and `data-action` attributes to define a stable behavioral contract for Playwright.
- **`data-state`**: Captures FSM or UI states (e.g., `recording`, `connecting`, `idle`, `secure`).
- **`data-action`**: Captures user-intent hooks (e.g., `start`, `stop`, `select-mode`).
- **Benefit:** Decouples automation from design. Tests target the *meaning* of an element rather than its *appearance*.

#### Pattern 11: Mock Poisoning Mitigation
*   **Problem:** Top-level imports of services in `setup.ts` were caching real instances before test-level mocks could be applied.
*   **Solution:** Use dynamic imports within `beforeEach` and ensure all infrastructure polyfills (like `Worker`) are defined at the very top of `setup.ts`.
*   **Result:** Reliable mocking even for transitively imported modules.

#### Pattern 12: Single Source of Truth for Session State (Zustand)
*   **Problem:** Session state (timer, listening status) was fragmented across multiple hooks, leading to race conditions.
*   **Solution:** Centralized all ephemeral session state in a single Zustand store (`useSessionStore`).
*   **Result:** Deterministic state updates and simplified reasoning for React-STT synchronization.

#### Pattern 13: Deterministic Asynchronous Operations
*   **Problem:** Flaky tests in `useSessionLifecycle` due to non-deterministic `requestAnimationFrame` or `setTimeout` updates.
*   **Solution:** Unified heartbeat/tick logic in the store, allowing tests to use `vi.useFakeTimers()` for precise time advancement.
*   **Result:** 100% green CI for high-frequency state updates.

### CI Stabilization (2026-02-15)

The following patterns were implemented to achieve CI stability.

#### Pattern 14: Advanced Mock Poisoning Mitigation
*   **Problem:** Standard Mock Poisoning mitigation (Pattern 11) was insufficient for complex transitive dependencies in `setup.ts`.
*   **Solution:**
    *   **Hoisted Mocks:** Use `vi.hoisted()` for shared constants and infrastructure polyfills.
    *   **Lazy Initialization:** Created `tests/unit/helpers/serviceHelper.ts` to provide `createTestTranscriptionService`, which uses dynamic `import()` to ensure mocks are applied before the service class is even loaded.
*   **Result:** Reliable, isolated testing environment with zero cross-test interference.

#### Pattern 15: Over-Mocking Regression Prevention
*   **Problem:** Blindly mocking large modules (like `@/services/transcription/TranscriptionService`) often breaks transitive dependencies that actually need a real implementation to function (e.g., `AudioProcessor` or utility functions).
*   **Solution:**
    *   **Targeted Unmocking:** Explicitly call `vi.unmock()` in tests that require the real logic of a component while its parent or peer is mocked.
    *   **Conditional Mocking:** In `setup.ts`, mocks are only applied if a specific test file hasn't opted out, preventing "Global Mock Poisoning."
*   **Result:** High-fidelity tests that exercise real logic where appropriate, reducing "Mock Divergence" risk.

#### Pattern 16: Mock Divergence / Isolated Store Factory
*   **Problem:** Manual, incomplete mocks of Zustand stores in component tests were drifting away from the real store implementation, leading to false positives or logic failures that didn't match production.
*   **Solution:**
    *   **Shared Factory:** Created `frontend/tests/unit/factories/storeFactory.ts` which provides `createTestSessionStore`.
    *   **Real Store Logic:** The factory creates a *real* Zustand store but with **mocked actions** (via `vi.fn()`).
    *   **Isolation:** Each test receives a fresh, isolated instance of the store, preventing state leakage between tests.
*   **Result:** Tests interact with a store that behaves exactly like production (state-wise) while allowing verification of action calls.

### Logic & Infrastructure Reliability (2026-02-17)

The following patterns were added to address persistent "Zombie Build" and "Shadowed State" issues.

#### Pattern 17: Nuclear Clean Strategy [Infrastructure]
*   **Problem:** Standard `vite build` commands were serving stale code due to aggressive caching in `node_modules/.cache`, `.vite`, and Playwright's distinct browser cache.
*   **Solution:**
    *   **Script:** `scripts/nuclear-clean.sh` aggressively kills processes and deletes all cache directories (`dist`, `.vite`, `node_modules/.cache`, `test-results`).
    *   **Dev Server:** E2E tests now default to `pnpm dev` (Vite Dev Server) instead of `preview`, ensuring 0ms build latency and fresh code execution.
*   **Result:** Deterministic test environments free from "Zombie Code."

#### Pattern 18: Shadowed State Prevention [Logic]
*   **Problem:** Hooks returning hardcoded derived state (e.g., `status: 'ready'`) masked the actual state transitions occurring in the global `useSessionStore` (e.g., `status: 'recording'`), causing UI/Logic Desync.
*   **Solution:**
    *   **Store Authority:** All hooks must return state *only* by selecting from the global store, never by deriving it from local variables that might be stale.
    *   **Audit:** Any hook returning `sttStatus` must pull it via `useSessionStore.getState().sttStatus`.
*   **Result:** UI faithfully reflects the exact state of the business logic.

#### Pattern 19: Isomorphic Golden Transcripts
*   **Problem:** Mock divergence between MSW (frontend) and Playwright (E2E) leading to "Green Illusion" where tests pass against outdated mocks.
*   **Solution:** Centralized all ground-truth expectations (transcripts, audio, WER thresholds) in `tests/fixtures/stt-isomorphic/`.
*   **Result:** 100% parity between simulated unit tests and real STT accuracy regressions.

#### Pattern 20: Atomic State Lock (FSM `CLEANING_UP`)
*   **Problem:** Race conditions during rapid "Stop/Start" cycles where `destroy()` could interrupted by a new `initialize()`, leading to orphaned audio nodes.
*   **Solution:** Introduced an explicit `CLEANING_UP` state in the `TranscriptionFSM`. The service cannot be re-initialized until the background cleanup is complete.
*   **Result:** Deterministic service lifecycle even during aggressive user interaction.

#### Pattern 21: Cloud Redirect Hardening (Stripe)
*   **Problem:** Open redirect vulnerabilities where the client could override the Stripe `return_url`.
*   **Solution:** Edge functions now strictly enforce the `SITE_URL` environment variable for all checkout redirects, ignoring any client-provided origin overrides.
*   **Result:** Enhanced platform security and prevention of phagocyte attacks.

#### Pattern 22: O(1) Filler Word Observer (`useFillerWords.ts`)
*   **Problem:** Transcription performance degraded O(N) relative to session length as the entire transcript was re-scanned for filler words on every chunk.
*   **Solution:** Implemented an incremental observer pattern that only processes the *newest* chunk against the existing counts.
*   **Result:** Constant-time (O(1)) performance during recording, enabling hours-long sessions without UI lag.

#### Pattern 23: NLP LRU Document Cache (`fillerWordUtils.ts`)
*   **Problem:** NLP parsing (compromise.js) is expensive and was being re-run redundantly for short, alternating sentences.
*   **Solution:** Implemented a 10-item Least Recently Used (LRU) cache for parsed NLP documents.
*   **Result:** ~500x speedup for session analysis when users repeat similar patterns or alternate between known phrases.

#### Pattern 24: Debounced Interim NLP (`useFillerWords.ts`)
*   **Problem:** High-frequency interim transcript updates were triggering rapid re-renders and NLP passes, causing main-thread stuttering.
*   **Solution:** Debounced the NLP processing on interim text (150ms), while maintaining immediate processing for final chunks.
*   **Result:** Smooth UI performance during rapid speech without sacrificing final accuracy.

#### Pattern 25: Atomic Row-locking (`FOR UPDATE`)
*   **Problem:** Potential for "Double Spend" in usage limits where concurrent session starts could exceed daily/monthly caps before the first update completes.
*   **Solution:** Restored atomic row-locking using `SELECT ... FOR UPDATE` within the `update_user_usage` Supabase RPC.
*   **Result:** Absolute consistency for billing and tier-enforcement, accepting minor lock contention during simultaneous starts.

#### Pattern 26: Single-Chain Promise Orchestration (`TranscriptionService.ts`)
**Problem:** Race conditions during rapid "Start/Stop" transitions where multiple overlapping initialization promises could lead to duplicate engine instances or orphaned audio streams.
**Solution:** Centralized all lifecycle commands through a serial `commandChain` (Promise queue) that ensures only one operation executes at a time and state transitions are atomic.
- **Result:** Elimination of "Engine See-Saw" and "Orphaned Audio" bugs.

#### Pattern 27: UI-First State Reversion
*   **Problem:** User experience "hangs" or "See-Saw" failures where the UI remains in a "Stopping..." state for seconds while awaiting asynchronous engine cleanup, causing frustration and potential multi-click race conditions.
*   **Solution:** Decouple the UI state from the engine's asynchronous lifecycle. The stop action immediately flips `isListening` to `false`, reverts the button to "Start," and releases the local mutex *synchronously* before `await`-ing the engine's `stopTranscription` call.
*   **Result:** 100% responsive UI and deterministic lock release, even if the engine teardown is delayed or times out.

#### Pattern 28: Engine-Aware Usage Enforcement
*   **Problem:** Users could bypass cloud usage limits by toggling engines (e.g., switching from Cloud to Native) mid-session, leading to billing inaccuracies.
*   **Solution:** Implemented a unified usage enforcement layer that distinguishes between Native (local/unlimited), Cloud (metered/A-AI), and Private (local/hardened) flows. Usage is tracked based on the *active* engine's tier requirements, and the backend RPC `update_user_usage` now requires an `engine_type` parameter to apply the correct decrement logic.
*   **Result:** Precise billing and tier enforcement across all STT modes.

#### Pattern 29: CI Diagnostic Logging (tee)
*   **Problem:** Using the `script` command in Linux CI environments to capture TTY output frequently breaks JSON reporters (e.g., Vitest's `unit-metrics.json`) and introduces race conditions in character encoding.
*   **Solution:** Standardized on the `FORCE_COLOR=1 ... | tee log.txt` pattern. This preserves ANSI color codes for human-readable artifacts while allowing the stdout stream to remain clean for machine-readable JSON outputs.
*   **Result:** 100% stable CI reports with full diagnostic visibility on failure.

#### Pattern 30: Modular Hardware Benchmarking [Benchmarking]
*   **Problem:** Monolithic benchmark scripts are slow, brittle, and difficult to run selectively on resource-constrained hardware.
*   **Solution:** Decompose hardware-dependent benchmarks into tiered, engine-specific spec files (`benchmark-cpu`, `benchmark-webgpu`, `benchmark-cloud`). Use custom auth logic in `setup.ts` to support Pro-user credential injection via `E2E_PRO_EMAIL`.
*   **Result:** Faster iteration cycles and cleaner failure isolation for tiered STT features.

#### Pattern 31: Unified Root-Env Resolution [Infrastructure]
*   **Problem:** Vite sub-packages or test runners failing to load root-level `.env` files because they resolve relative to the script location rather than the workspace root.
*   **Solution:** Explicitly set `envDir: '../../'` (or equivalent workspace root) in `vite.config.mjs` to ensure uniform secret loading across all execution contexts.
*   **Result:** Predictable environment configuration for benchmarks, scripts, and the frontend.


#### 32. Immutable Callback Proxy (`ImmutableCallbackProxy.ts`)
**Problem:** React component re-renders causing "Stale Closures" in long-lived transcription services, leading to services executing logic against old/null props.
**Solution:** A stable proxy wrapper that holds a mutable reference to the latest React callbacks, ensuring the service always executes the "Latest" version of a function without needing to re-bind.
- **Benefit:** Guarantees component-to-service state synchronization without triggering service restarts.

#### 33. Logger Mock Standardization (`setup.ts`)
**Problem:** Redundant, inconsistent logger mocks across hundreds of test files leading to `TypeError: default.debug is not a function` and fragile test suites.
**Solution:** Centralized a standard, high-fidelity logger mock in the global `setup.ts` using `vi.mock('@/lib/logger')` and standardized sub-tests to use `import { logger } from '@/lib/logger'`.
- **Benefit:** Continuous CI stability and simplified test writing.
|
#### Pattern 34: Atomic Stripe Webhook RPC (Phase 3)
*   **Problem:** Sequential database awaits in the Stripe webhook edge function caused significant latency and potential race conditions in user state updates.
*   **Solution:** Merged all billing logic and idempotency checks into a single atomic Postgres RPC `process_stripe_webhook_event`.
*   **Benefit:** 100% atomic user state transitions; eliminates edge function I/O overhead.

#### Pattern 35: Concurrent PDF Parsing (Phase 4)
*   **Problem:** Serial page processing in `pdfParser.ts` caused linear performance degradation as document size increased.
*   **Solution:** Replaced the `for` loop with `Promise.all` orchestration to parse all PDF pages concurrently.
*   **Benefit:** ~90% reduction in extraction latency for multi-page documents.

### 🚀 Development & Pipeline
- **Cross-Env Persistence**: Explicitly propagate env vars to subprocesses in CI.
- **Boundary Separation**: `postinstall` is for app setup; Workflows are for environment setup (browsers).
- **Log Level Governance**: CI/Production defaults to `WARN` level to reduce noise while maintaining fail-fast diagnostic visibility.


---

### 2. The Local Audit Script (Single Source of Truth for Testing)

The primary runner for all local validation is `pnpm test:all:local` (which calls `./scripts/test-audit.sh`), which is accessed via `pnpm` scripts. This script is the SSOT for running lint, type-checking, and all tests.

*   **Always use this script for validation.** Do not invent your own runners or call `pnpm test` or `pnpm lint` directly for final validation.
*   The audit script automatically runs the `pnpm preflight` check, ensuring a stable environment for the test run.

### 3. Selective Use of `scripts/env-stabilizer.sh`

The `./scripts/env-stabilizer.sh` script is a powerful tool for recovering a broken environment, but it should be used selectively.

*   Run `pnpm preflight` first.
*   If instability persists (e.g., hanging tests, port conflicts), then run `pnpm env:stabilize`.
*   Escalate to the user **before using** `./scripts/vm-recovery.sh`.
*   Always read `README.md` to understand setup, workflow, and scripts.

### 4. Handling Silent Crashes in E2E Tests

The E2E test environment has known incompatibilities with heavy WebAssembly-based speech recognition libraries used for on-device transcription. These libraries are loaded via dynamic imports.

*   **Symptom:** When a test triggers the import of these heavy WASM modules, the browser can crash instantly and silently, resulting in a blank screenshot with no console or network errors. This is a fatal, untraceable error.
*   **Solution:** A source-code-level guard is in place. A `window.TEST_MODE = true` flag is injected by the test setup. The application code (`frontend/src/config/TestFlags.ts`) checks for this flag and conditionally skips mocks if `VITE_USE_REAL_DATABASE` is true to prevent "Identity Hijack" in live tests.
*   **Implication:** Do not remove this flag or the corresponding check in the application code. If you encounter a similar silent crash, investigate for other dynamic imports of heavy, WebAssembly-based libraries.

### 5. CI Robustness: Standard Subshell Pattern
To prevent directory drift in CI background processes (e.g., during Lighthouse CI), always use subshells `()` for backgrounded tasks:
```bash
(cd frontend && timeout 10 pnpm preview --port 4173 &)
```
This ensures the main CI shell's working directory remains stable for subsequent commands (like `node scripts/generate-lhci-config.js`).

---

## ⚡ Non-negotiable rules

No destructive reverts without user approval. If you reverted something, immediately report which files/lines and why.
Always provide ≥2 solutions for any non-trivial problem (fast fix + robust fix).
Every claim must include file path and exact line numbers and a 2–5 line code snippet as evidence.
No escalation until Diagnostic Protocol completed (see §4).
Code MUST be tested locally AND verified via CI (or explicitly waived by user) before merging/pushing to main. Agents must not check in code that is not built or tested.
- **PNPM Mandate**: This is a pure `pnpm` project. `package-lock.json` is banned. Any agent attempting to use `npm` or `yarn` will be blocked by the `preinstall` engine check. All scripts and documentation MUST use `pnpm`.
- **Full Health Mandate**: Every session MUST end with a 100% clean pass of `pnpm typecheck` and `pnpm lint`. No exceptions.

---

## ⚡ Code Quality Standards (Strict)

- **No `eslint-disable`**: We now have a "Zero Tolerance" policy. The `check-eslint-disable.sh` script will fail the build if any `// eslint-disable` comments are found in the source code.
- **Zero-Any Mandate**: The use of the `any` type is strictly forbidden. All variables, parameters, and return types must be explicitly typed or inferred. This is enforced via linting to ensure long-term maintainability and type safety.
- **Testing "Gold Standard"**: Mandates that all unit tests must use proper wrappers (like `QueryClientProvider`) and avoid "green illusions" (tests that pass but test nothing).
- **Fail Fast, Fail Hard**: Tests should never hang. Use aggressive timeouts and explicit assertions to surface failures immediately.
- **Print/Log Negatives, Assert Positives**: Only log errors and warnings. Use assertions for success verification (no `console.log("✅ Success")` noise).
- **ASCII Diagrams Only**: Do not use Mermaid. All architectural diagrams must use ASCII for maximum compatibility and readability across all agents and environments.
- **No Internal Tracking IDs in Comments or Filenames**: Never add internal project identifiers like "Fix #", "Step #", "Phase #", "Expert ", or similar task-tracking metadata to code comments or filenames. These provide no value to future developers and clutter the codebase.
- **Event-Based Waits > Timeouts**: Arbitrary timeouts are forbidden unless for failsafes or specific UX timing. Always prefer `waitForSelector`, `vi.waitUntil`, or similar event-driven checks.

___

## ⚡ Quick reference (most-common tasks)

Use page.addInitScript() to set flags that must exist before app JS runs:
await page.addInitScript(() => { window.__USE_MOCK_DATA__ = true; });

For MSW: prefer handler-driven mocks over brittle query-param hacks.
For flaky SPA navigation: prefer user-style navigation (clicks) or verify with waitForSelector() on a stable DOM marker.
___

## ⚡ Diagnostic Protocol — mandatory (follow exactly)

Before asking questions or escalating, do the following in order:
Read the error literally — copy/paste exact failing command + error.
Reproduce minimal case — run the single failing test and capture artifacts:
pnpm exec playwright test tests/e2e/that-test --workers=1 |& tee run.log
Attach run.log, trace.zip, screenshot(s).
Trace to code — open implicated files and cite filename:line-range and a short snippet (3–8 lines).
Example: frontend/src/mocks/handlers.ts:35-40 with the snippet that returns [].
Form 2 hypotheses (A and B). For each, state:
What you expect to observe in logs/trace if true.
One quick check that will falsify it (grep, console.log, DOM dump).
Run quick checks (console logs, DOM dump, unzip trace, grep network entries). Attach outputs.
Propose fixes (≥2) with:
Code diff (file + line numbers)
Pros / cons / risk level
Confidence % (e.g., 90%)
If you tried both fixes (or cannot), then escalate with the exact artifacts and choices tried.
If any step is skipped, escalation will be rejected.

___

## ⚡ Evidence & PR expectations

Any PR or patch must include:
One-paragraph problem summary (plain English).
Exact failing command and raw error.
File:line snippets used as evidence.
Two options (fast + robust) with code snippets and risks.
Artifacts: trace.zip path, run.log, screenshot(s).
**Changelog**: All `CHANGELOG.md` entries MUST include the primary file(s) modified or implemented to verify the claim.
PRs missing these will be returned for more detail.

___

## ⚡ Quick Reference – Non-Negotiable Rules

6. ✅ **Hardening Protocols** – All agents MUST strictly follow these new stability patterns:
    *   **Disposable Pattern**: Every class/hook that creates event listeners or long-lived resources MUST implement and call a `.dispose()` or `.terminate()` method. See `MicStream.ts` or `TranscriptionService.ts` for examples.
    *   **Race Condition Mitigation**: Use `useRef` to capture the "Lately Captured State" for callbacks passed to long-lived services. This prevents stale closures in async operations. See `useSpeechRecognition_prod.ts` (Lines 174-183) for the implementation.
    *   **Atomic SQL Operations**: Use single-statement atomic increments for usage counters. Avoid `SELECT` -> `UPDATE` cycles. See `20260212000000_database_hardening.sql` for the `update_user_usage` function.
    *   **Constant-Time Secrets**: Use `safeCompare` (XOR-based) for all secret/token comparisons in Edge Functions to prevent timing attacks.
2.  ✅ **Codebase Context** – Inspect `/frontend/src`, `/tests` (E2E), `/frontend/tests/integration` (Real DB), `/docs` before acting.
3.  ❌ **No Code Reversals Without Consent** – Never undo user work.
4.  ⏱️ **Timeout Constraint** – Every command must complete within 7 minutes.
5.  ✅ **Approved Scripts** – Use the following `package.json` scripts for validation and development. The `ci:full:local` script runs the EXACT same pipeline as GitHub CI.

    ```json
     "test:all:local": "pnpm run test:all:local",
     "ci:full:local": "pnpm run ci:full:local",
     "test:health:local": "pnpm run test:health:local",
     "test": "pnpm test:unit:local",
     "dev": "pnpm run dev",
     "build": "pnpm run build",
     "pw:install": "pnpm run pw:install",
     "pw:install:all": "pnpm run pw:install:all"
    ```
    
    **Script Taxonomy:** All test scripts follow `test:<level>:<env>[:<mode>]`. See `ARCHITECTURE.md` for the full reference.
    
    **Playwright Browsers:** Browser installation is NOT automatic. After `pnpm install`, run `pnpm pw:install` to install Chromium for E2E testing.
    
    **Terminology Clarification:**
    - `test:health:local`: Runs a fast validation suite (Preflight + Unit Tests + Mock E2E).
    - **"Healthcheck passed!"**: This log message comes from the Lighthouse CLI and refers to its internal environment check, NOT the project's health check script.
    - **Health Check Test**: Refers specifically to `tests/e2e/health-check.e2e.spec.ts`.
    
    **CRITICAL:** `ci:full:local` is NOT a simulation - it runs the exact same commands as GitHub CI (frozen lockfile, same build, same shards). If it passes locally, CI will pass.
    
    **New Configuration Scripts (2025-11-28):**
    - `build.config.js` - Centralized port configuration (DEV: 5173, PREVIEW: 4173)
    - `generate-lhci-config.js` - Dynamic Lighthouse CI config generation
    - `process-lighthouse-report.js` - Robust JSON parsing (replaces `jq`)

6. ✅ **Foreground Logging** – All E2E tasks must run in the foreground with live logs (`tee`) for traceability.

---

## 🔍 Task Workflow

1. **Contextual Review** – Read `/docs` and `README.md` before acting.
    - **Handling Secrets**: Critical credentials (like `ASSEMBLYAI_API_KEY`) are managed via **GitHub Secrets**, not `.env` files. Run `gh secret list` to verify available secrets.
    - **Cloud Execution**: Consult `tests/TEST_PLAYBOOK.md` to understand how tests are dispatched to the GitHub Cloud via YAML scripts (e.g., `ci:dispatch:soak`).
2. **Stabilize Environment** – Run `pnpm env:stabilize` only if instability signs appear.
3. **Grounding** – Review current workflows, scripts, and audit runners.
4. **Codebase Deep Dive** – Inspect actual code, not assumptions.
5. **Strategic Consultation** – Present root cause + 2–3 solution paths **before major changes**.
6. **Implementation** – Follow coding standards, architecture principles, and scripts.
7. **Validation** – Complete Pre-Check-In List (see below).
8. **Submission** – Ask user **before running recovery scripts** (`./scripts/vm-recovery.sh`).

---

## 🚦 Pre-Check-In List (MANDATORY)

*Complete before any commit or PR:*

1.  **Run Local Audit Script**
    ```bash
    pnpm test:all:local
    ```
    Must pass lint, typecheck, all unit tests, and the full E2E suite.

2.  **Mandatory Pre-Push Validation**
    Before pushing to `main`, you MUST run:
    ```bash
    pnpm run ci:full:local
    ```
    This runs the EXACT GitHub CI pipeline locally (frozen lockfile, sharded E2E, lighthouse). If it fails, DO NOT PUSH. Fix the issues first.

3.  **Supabase Migration Protocol**
     Required for any PR containing a database migration:
     - [ ] Ran: `pnpm supabase gen types typescript --local > frontend/src/types/database.types.ts`
     - [ ] Updated mock factories in `tests/support/factories/` to include new columns
     - [ ] Ran contract tests: `pnpm test -- --grep "Mock Parity"`
     - [ ] Verified mock headers match PostgREST spec for any new .single() queries
 
 4.  **Documentation (SSOT)**
    *   Review and update the seven mandatory documents as per `docs/OUTLINE.md`: `README.md`, `AGENTS.md`, `docs/OUTLINE.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`.

4.  **Branch & Commit Hygiene**
    *   Branches: `feature/...`, `fix/...`, `chore/...`.
    *   Commit messages must clearly summarize the changes and their impact.

---

## 📢 Escalation Protocol

If blocked:

1.  Summarize the problem.
2.  List what you tried.
3.  Provide hypotheses.
4.  Offer 2–3 solution paths with pros/cons.
5.  **Pause and wait for user guidance** before proceeding.

Escalation format (required)

If you must escalate, submit a single message with:
One-line result (what you attempted and outcome).
Attached artifacts (trace.zip, run.log, screenshots).
File evidence list (path:lines + snippets).
Two actionable next steps (with diffs) and the one you recommend.

---

## Behavioral checklist (short)

Think like a senior: diagnose → propose → try → attach evidence → escalate.
No “try one quick thing and ask” — do work first.
Be concise, factual, and cite code.

___

## 🔐 Absolute Non-Negotiables

*   ❌ Never run `./scripts/vm-recovery.sh` without asking first.
*   ❌ Never exceed the 7-minute runtime per command.
*   ❌ Never undo or destroy user work without consent.
*   ❌ Never use `git checkout --theirs/--ours`. Always manually resolve conflict markers.
*   📄 Documentation first.
*   🧠 Think like a senior engineer — prioritize evidence-based, long-term stability.

---
