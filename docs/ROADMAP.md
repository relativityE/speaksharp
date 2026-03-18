**Owner:** [unassigned]
**Last Reviewed:** 2026-03-09

🔗 [Back to Outline](./OUTLINE.md)

# SpeakSharp Roadmap
*(For executive-level commentary on prioritization, see [REVIEW.md](./REVIEW.md)).*

This document outlines the forward-looking development plan for SpeakSharp. Completed tasks are moved to the [Changelog](./CHANGELOG.md).

Status Key: 🟡 In Progress | 🔴 Not Started | ✅ Complete | 🛡️ Gap Remediation
---

## 🛡️ CI Stability & Observability Hardening (Mar 2026) ✅ COMPLETE

> **Goal:** Eliminate race conditions in transcription lifecycles and implement high-fidelity observability for diagnostic audits.

| ID | Title | Priority | Status | Notes |
|----|-------|----------|--------|-------|
| **C1** | **Single-Chain Orchestration** | **CRITICAL** | ✅ Complete | Atomic `commandChain` for `TranscriptionService` lifecycle. |
| **C2** | **Triple-Identity Tracing** | **HIGH** | ✅ Complete | `serviceId`/`runId`/`engineId` tracing hierarchy. |
| **C3** | **Logger Standardization** | **CRITICAL** | ✅ Complete | Unified `@/lib/logger` mocks in Vitest `setup.ts`. |
| **C4** | **CI Output Optimization** | **MEDIUM** | ✅ Complete | Defaulted to `WARN` level and `line` reporter for cleaner CI logs. |

---

## 🚀 Live Recording UI & STT Stabilization (Mar 2026) ✅ COMPLETE

> **Goal:** High-fidelity UI redesign for the core recording interface and stabilization of hardware-dependent STT benchmarks.

| ID | Title | Priority | Status | Notes |
|----|-------|----------|--------|-------|
| **R1** | **LiveRecordingCard Redesign** | **HIGH** | ✅ Complete | Centered vertical stack (Mic/Timer) with proportional sizing and left-aligned SECURE/Selector column. |
| **R2** | **Vite Env Directory Fix** | **CRITICAL** | ✅ Complete | Aligned `envDir` to workspace root to enable project-wide `.env` loading for benchmarks/scripts. |
| **R3** | **Modular STT Benchmarks** | **HIGH** | ✅ Complete | Decomposed monolithic benchmarks into engine-specific specs with Pro-user auth support. |
| **R4** | **Hydration Race Resolution** | **HIGH** | ✅ Complete | Hardened `useSessionLifecycle.ts` against premature session termination during initial hydration. |

---

## 🧪 Frontend Verification & Defect Resolution (Jan 2026) ✅ COMPLETE

> **Goal:** Resolve critical defects identified during the Jan 26 production verification to ensure a stable Alpha user experience.

| ID | Title | Priority | Status | Notes |
|----|-------|----------|--------|-------|
| **V1** | **Cloud STT CORS** | **CRITICAL** | ✅ Complete | `ALLOWED_ORIGIN` set in Supabase production. Verified 2026-01-28. |
| **V2** | **Private STT WASM Crash** | **CRITICAL** | ✅ Complete | Implemented buffer preservation and strict chunk validation to prevent RangeErrors. |
| **V3** | **Transitions & Cleanup** | **CRITICAL** | ✅ Complete | Verified AudioContext cleanup and cross-component state synchronization. |
| **V4** | **Real-time Analysis UI** | **HIGH** | ✅ Complete | Refactored Session Page with paired grid layout and matched component heights. |
| **V5** | **Auth Token Refresh** | **HIGH** | ✅ FIXED | Resolved race conditions in session initialization and added safety timeouts. |
| **V6** | **STT Dropdown Selection**| **HIGH** | ✅ Complete | Resolved unresponsive selector and polished labels. (2026-01-28) |
| **V7** | **Initialization Crash** | **CRITICAL** | ✅ Complete | Fixed `__BUILD_ID__` ReferenceError in `main.tsx` causing E2E timeouts. (2026-01-28) |


---

## 🔒 Security & Infrastructure Hardening (Feb 2026) ✅ COMPLETE

> **Goal:** Standardize security credentials and upgrade AI capabilities for Release 1.2.0.

| ID | Title | Priority | Status | Notes |
|----|-------|----------|--------|-------|
| **S1** | **Universal Secret Migration** | **CRITICAL** | ✅ Complete | Migrated all workflows to `SUPABASE_SERVICE_ROLE_KEY`. Verified 0 legacy key usage. |
| **S2** | **Gemini 3.0 Flash Upgrade** | **HIGH** | ✅ Complete | Upgraded AI Coach for faster, smarter feedback. |
| **S3** | **Tier Limit Dynamic Labels** | **HIGH** | ✅ Complete | Unified ensuring "Daily" and "Monthly" limits are correctly handled in UI/Tests. |
| **S3.1**| **Tier Limit Logic** | **HIGH** | ✅ Complete | `tier-limits.e2e.spec.ts` now dynamically verifies "Daily" (Edge Function) or "Monthly" (RPC) limits based on backend response. Mock duration remains 6s to satisfy `MIN_SESSION_DURATION_SECONDS` (5s). |
| **S3.2**| **PDF Content Extraction** | **MEDIUM** | ✅ Complete | Migrated to `pdfjs-dist` for browser-native extraction. (2026-02-21) |
| **S3.3**| **STT Accuracy Comparison** | **MEDIUM** | ✅ Complete | Integrated WER scoring and Ground Truth ingestion. (2026-02-21) |
| **S4** | **Canary User Persistence** | **MEDIUM** | ✅ Complete | Migrated from automated cleanup to unique email persistence for easier debugging. |
| **S5** | **Design Parity Audit** | **MEDIUM** | ✅ Complete | Fixed "interpolation mud" in radial gradients and de-bloated upgrade banners. |
| **S6** | **Phase 2 Hardening Remediation**| **CRITICAL**| ✅ Complete | **Zero Tolerance CI:** Resolved all lint/type errors. Implemented stability guards (Stale closures, DI pattern, Global Error Handlers) and security hardening (Atomic updates, Rate limiting). |
| **S7** | **Architectural Lifecycle Stability**| **CRITICAL**| ✅ Complete | **Stability Audit:** Resolved state machine synchronization defects, decoupled store updates via microtasks, and stabilized unit test suite for high-concurrency lifecycle race conditions. |
| **S8** | **Expert CI Hardening (1A, 2A, 3A)**| **CRITICAL**| ✅ Complete | Professional CI Hardening: Mitigated Mock Poisoning (1A), prevented Over-Mocking (2A), and resolved Mock Divergence (3A). |
| **S9** | **Merge Wave 1: Baseline** | **CRITICAL**| ✅ Complete | Consolidated Master Security Fix, RPC Analytics, and O(1) NLP Counting. |
| **S10** | **Merge Wave 2: Hardening** | **CRITICAL**| ✅ Complete | Consolidated Atomic Row-locking, AI Persistence, and Debounced NLP. |


## 📽️ Marketing & Growth

### Homepage "How It Works" Video
- 🟡 **60-Second Product Demo Video:** Problem → Solution → Benefit structure
  - Privacy indicator UI enhancement (shows "On-Device" badge during Private STT)
  - Recording checklist: Pro account, clean session history, Chrome 1920x1080 dark mode
  - Tools: Descript/OBS (recording), ElevenLabs (voice-over), Canva (kinetic typography)

---

## Phase 1: Stabilize & Harden the MVP
This phase focuses on fixing critical bugs, addressing code health, and ensuring the existing features are reliable and robust.

### 🚧 Should-Have (Tech Debt)
- 🔴 **E2E Timeout: STT Initialization Race Condition:** E2E tests are currently timing out because the `TranscriptionService` instance is `null` when `useTranscriptionControl` attempts to access it during test execution. A circular dependency or initialization order issue between `SpeechRuntimeController`, `TranscriptionProvider`, and component mount cycles needs investigation.
- ✅ **Strategic Error Logging (2025-12-11):** Added defensive error logging to PrivateWhisper.ts, SessionPage.tsx, AuthPage.tsx. Comprehensive coverage in critical paths.
- ✅ **Usage Limit Pre-Check (2025-12-11):** P0 UX fix. New Edge Function `check-usage-limit` validates usage BEFORE session start. Shows toast with Upgrade button if exceeded.
- ✅ **Screen Reader Accessibility (2025-12-11):** Added `aria-live="polite"` to live transcript for screen reader announcements.
- ✅ **PDF Export Fix (2025-12-11):** Replaced manual download with FileSaver.js industry standard.
- 🔴 **Harden Supabase Security:** Address security advisor warnings.
  - ⏸️ **BLOCKED** - Shorten OTP expiry to <1 hour (requires Supabase Pro account)
  - ⏸️ **BLOCKED** - Enable leaked password protection (requires Supabase Pro account)
  - ⏸️ **DEFERRED** - Upgrade Postgres version (not critical for alpha)
- ✅ **COMPLETED - Integration Test (Usage Limits):** Deno unit tests exist at `backend/supabase/functions/check-usage-limit/index.test.ts` (167 lines, 6 test cases covering auth, free/pro users, exceeded limits, graceful degradation, CORS).
- 🔴 **Domain Services DI Refactor:** Evolve `domainServices.ts` from internal client retrieval to dependency injection pattern for fully pure, easily testable functions. Low priority - current spy-based testing works for alpha.
- ✅ **Console Error Highlighting (P0 - Debugging):** Implemented via `pino-pretty` with `colorize: true` in `lib/logger.ts`. Standardized for all domain services and async modes. (2026-02-16)
- ✅ **Independent Documentation Review (2026-01-28):** Conducted full audit of all project documents against `docs/OUTLINE.md` requirements. Verified sync across PRD, Architecture, and Roadmap.
- ✅ **Gap Analysis [HIGH PRIORITY]:** Conducted full audit of Zero-Debt status, tech debt, and architectural drift. (2026-02-16)
- ✅ **Side-by-Side Session Comparison:** Implemented `SessionComparisonDialog.tsx` supporting 2-session diffs (WPM, Clarity, Fillers).
- ✅ **Speaker Identification (2026-02-21):** Implemented diarization support in `CloudAssemblyAI.ts` and propagated via `Transcript` interface.
- ✅ **Canary Tests:** Real-API `@canary` tests for staging environment implemented in `tests/canary/`.
- ✅ **COMPLETED (2025-12-15) - E2E Test Infrastructure: MSW-to-Playwright Routes Migration:**
  - **Problem:** MSW service workers are browser-global per-origin. Parallel shards race for registration, causing intermittent `ui-state-capture` flakiness.
  - **Root Cause:** 99.5% confidence - service worker race conditions in parallel CI.
  - **Solution:** Migrated all 38 E2E tests from MSW to Playwright's `page.route()` API.
  - **Key Changes:**
    - Added `VITE_SKIP_MSW=true` to `.env.test`
    - Created `tests/e2e/mock-routes.ts` with Playwright route handlers
    - Updated `frontend/src/main.tsx` to skip MSW when flag set
    - Migrated all tests to use `programmaticLoginWithRoutes`
  - **Result:** All 38 E2E tests pass reliably in parallel CI.
  - **Warning:** DO NOT revert to MSW - the race conditions are fundamental architectural limitations.

### ⚡ Performance Optimization & CI Stabilization (2026-02-07) ✅ COMPLETE

- ✅ **Web Worker Offloading:** Moved heavy audio processing to a dedicated Web Worker to ensure UI responsiveness.
- ✅ **CI Stabilization:** Upgraded pnpm, increased memory limits, and tuned timeouts for 100% reliable CI runs.
- ✅ **Regex Memoization:** Implemented content-based regex memoization in `highlightUtils.ts` to eliminate repeated compilation in render loops.
- ✅ **Benchmarking Infrastructure:** Created `scripts/benchmark-highlighting.ts` to measure and verify performance gains (~60% improvement for stable word sets).
- ✅ **Soak Test Infrastructure (2026-02-08):** Implemented `api-load-test.ts` for dynamic concurrency and stabilized `soak-test.spec.ts` for UI smoke testing. Standardized `NUM_*_USERS` config.

### 🗑️ Codebase Bloat Cleanup (2025-12-18) ✅ COMPLETE

> **Source:** Forensic analysis of `repo.manifest.txt` cross-referenced with domain XMLs.

- ✅ **Dead Code Cleanup:**
  - ~~`AccuracyComparison.tsx`~~ → Renamed to `STTAccuracyComparison.tsx` (deferred feature, not dead code)
  - ✅ `test-import/` deleted
  - ✅ `dropdown-debug.e2e.spec.ts` deleted
  - ✅ Edge Function `package.json` files deleted
- ✅ **Deno Import Map:** Created `import_map.json` to centralize versions.
- ✅ **Lazy Load Analytics:** Already implemented - `AnalyticsPage` uses `React.lazy()` in App.tsx.

### 🛡️ Gap Analysis Audit (2025-12-18) ✅ COMPLETE

> **Status:** ✅ ALPHA READY  
> **Source:** Elite Software Architect audit of reconstructed repo.xml.

#### Security
- ✅ **CI Secret Exposure:** Verified - only public keys written to file. Sensitive creds already use `env:` block.
- ✅ **Permissive CORS:** Fixed - now uses `ALLOWED_ORIGIN` env var. TODO: Set in Supabase for production.

#### Reliability
- ✅ **Supply Chain Risk:** Fixed - `import_map.json` created.
- ✅ **Stripe Crash Risk:** Fixed - defensive initialization with null check.

#### Performance
- ✅ **Bundle Heaviness:** Already implemented - `AnalyticsPage` lazy loaded.

| **Metric** | **Target** | **Current** | **Status** |
| :--- | :--- | :--- | :--- |
| **Unit Test Coverage** | > 80% | **556 tests** (100% pass) | 🟢 ON TRACK |
| **E2E Pass Rate** | 100% | 100% (17 mocked CI tests) | 🟢 ON TRACK |
| **Code Bloat** | < 10% | **6.78%** | 🟢 HEALTHY |
| **Largest Chunk** | < 500KB | **822KB** | 🔴 BLOCKED (Post-Alpha) |

### 🛡️ Gap Analysis Audit (2025-12-22) - In Progress

> **Source:** Independent codebase review identifying critical gaps for alpha soft launch.

#### 1. Foundational & Strategic Gaps

| Finding | Priority | Status | Notes |
|---------|----------|--------|-------|
| **Testing Pyramid** | CRITICAL | ✅ Done | **478 unit tests** across 100+ files. Integration-to-unit ratio optimized. Coverage thresholds enforced. |
| **Documentation Drift & Hallucination** | CRITICAL | 🔄 PERPETUAL | PRD metrics now auto-updated by CI. Manual audit required per OUTLINE.md. |

#### 2. Core Architectural Flaws

| Finding | Priority | Status | Notes |
|---------|----------|--------|-------|
| **Brittle Coupling (window.TEST_MODE flags)** | HIGH | ✅ FIXED | Created `test.config.ts` with `getTestConfig()`. `TranscriptionService.ts` now uses centralized config. |
| **Container/Presentational Violation** | MEDIUM | ✅ FIXED | `AnalyticsPage.tsx` (CONTAINER) fetches all data, `AnalyticsDashboard.tsx` (PRESENTATIONAL) receives via props. JSDoc added. |

#### 3. Workflow & Maintainability Gaps

| Finding | Priority | Status | Notes |
|---------|----------|--------|-------|
| **Inefficient CI/CD Pipeline** | MEDIUM | ✅ PARTIAL | Dependencies cached. Full optimization requires single setup job. |
| **Ambiguous Setup Scripts** | LOW | ✅ FIXED | `scripts/setup.sh` deleted, replaced with `dev-init.sh` (2025-12-22). |

#### 4. Security Hardening (2025-12-23)

| Finding | Priority | Status | Notes |
|---------|----------|--------|-------|
| **Unauthenticated Token Endpoint** | CRITICAL | ✅ FIXED | `assemblyai-token` now requires JWT auth + Pro subscription check. Returns 401/403 for unauthorized requests. |
| **Anonymous Sign-In User Table Pollution** | HIGH | ✅ FIXED | Removed `signInAnonymously()` from `useSpeechRecognition`. Dev testing uses `devBypass` instead. |

#### 5. Code Quality Improvements (2025-12-23)

| Finding | Priority | Status | Notes |
|---------|----------|--------|-------|
| **Redundant useState+useEffect** | MEDIUM | ✅ FIXED | `useTranscriptState` now uses `useMemo` for derived transcript (React best practice). |
| **Redundant Vite Env Config** | LOW | ✅ FIXED | Removed manual `VITE_*` exposure loop - Vite handles this automatically. |
| **Inconsistent Lazy Loading** | LOW | ✅ FIXED | Added `export default` to 3 pages for consistent `React.lazy()` syntax. |
| **Domain Services Logging** | MEDIUM | ✅ FIXED | Replaced `console.error` with structured `logger` (Pino→Sentry). Added `logger.debug` for "not found" cases. |

#### 6. Test Infrastructure Fixes (2025-12-22)

| Finding | Status | Notes |
|---------|--------|-------|
| **localStorage Key Mismatch** | ✅ FIXED | Changed `sb-localhost-auth-token` → `sb-mock-auth-token` in `mock-routes.ts` |
| **SessionPage Router Context** | ✅ FIXED | Added `MemoryRouter` wrapper to 22 unit tests |
| **Session Store for E2E** | ✅ FIXED | Added `sessionStore` and RPC mock for session persistence verification |

#### 7. E2E Infrastructure Fixes (2025-12-23)

| Finding | Status | Notes |
|---------|--------|-------|
| **Canary Test Isolation** | ✅ FIXED | Moved `smoke.canary.spec.ts` to `tests/e2e/canary/`, excluded from default runs via `testIgnore` |
| **Network Error Shielding** | ✅ FIXED | Added LIFO-ordered catch-all handler for `mock.supabase.co` to prevent `ERR_NAME_NOT_RESOLVED` |
| **Logout Mock Pattern** | ✅ FIXED | Updated pattern from `**/auth/v1/logout` to `**/auth/v1/logout*` to match query params |
| **Private Fallback** | ✅ FIXED | Added try-catch with Native Browser fallback if Private init fails (Finding 7) |
| **Playwright Config Coupling** | ✅ FIXED | Removed unused `PORTS` import from `playwright.config.ts`. |

### 🧪 Adversarial Test Suite Hardening (2025-12-19) ✅ P1 Complete

> **Goal:** Increase line coverage from 56% → 75% with integrity-preserving, adversarial validation. Focus on resilience and design invariants over structural coverage.

*   **P0: Resilience & Revenue Integrity**
    *   ✅ **WebSocket Resilience (2026-02-16):** Fully tested in `CloudAssemblyAI.test.ts` using `vi.useFakeTimers()` for backoff and heartbeat verification.
    *   ✅ **Billing Idempotency (2025-12-19):** 15 tests covering webhook replay, idempotency lock, and partial failure recovery.
    *   ✅ **Auth Resilience (2025-12-19):** 7 tests in `fetchWithRetry.test.ts` (exponential backoff, custom retry count, error preservation).
*   **P1: Business Logic**
    *   ✅ **Tier Gating (2025-12-19):** 17 tests in `subscriptionTiers.test.ts` (isPro, isFree, getTierLabel, getTierLimits, TIER_LIMITS values).
    *   🔴 **Domain Services:** CRUD validation in `domainServices.ts`.
    *   🔴 **Analytics Correctness:** Month-boundary rollover and session aggregation logic.
*   **P2: E2E Trust**
    *   ✅ **Canary Tests:** Real-API `@canary` tests implemented in `tests/canary/` (`smoke.canary.spec.ts`).

### 🚨 Alpha Launch Blockers (Comprehensive Audit - 2025-12-12)

> **Source:** Independent code review. Verified with code evidence.

#### P0 - Must Fix Before Alpha

- ✅ **Usage Reset DB Persistence (2025-12-12):** The `check-usage-limit` Edge Function now persists monthly usage resets to the database.
  - **File:** `check-usage-limit/index.ts:78-93`
  - **Fix:** Added Supabase UPDATE call to reset `usage_seconds` to 0 and set new `usage_reset_date`

- ✅ **Stripe Subscription Webhooks (2025-12-12):** The `stripe-webhook` Edge Function now handles all subscription lifecycle events.
  - **File:** `stripe-webhook/index.ts:46-109`
  - **Events Handled:** `customer.subscription.deleted`, `customer.subscription.updated`, `invoice.payment_failed`
  - **Behavior:** Downgrades `subscription_status` to 'free' on cancellation, unpaid status, or after 3 failed payment attempts

#### P1 - Should Fix (Tech Debt)

- ✅ **Session Store elapsedTime Reset (2025-12-12):** The `stopSession` action no longer resets `elapsedTime`, allowing UI to show final duration.
  - **File:** `useSessionStore.ts:51-57`
  - **Fix:** `elapsedTime` reset moved to `resetSession()` only

- ✅ **Filler Word NLP Integration (2026-01-31):** Integrated `compromise` NLP for Part-of-Speech tagging and context-aware detection of "like" and "so" fillers.
  - **Fix:** "I like pizza" (Verb) is correctly excluded; "It's, like, big" (Expression) is included.
  - **Performance:** Optimized with single-item NLP memoization and pre-compiled regexes to handle long transcripts efficiently.
  - **Files:** `fillerWordUtils.ts`

- ✅ **Document Backend Secrets for Contributors (2025-12-12):** Added backend secrets documentation to `.env.example`.
  - **File:** `./.env.example` (project root)
  - **Documented:** `ASSEMBLYAI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` (set via Supabase Dashboard or CLI)

- ✅ **Stripe "Pro Mode" Backend Flag (2025-12-15):** Completed Stripe checkout integration with rigorous negative verification.
  - **Backend:** `stripe-checkout/index.ts` now uses `STRIPE_PRO_PRICE_ID` env var, extracts user from auth header, includes userId in metadata.
  - **Diagnostics:** Added "Diagnostic Logging" and "Negative Verification" (expect 400 with specific error body) to prove configuration in CI without exposing secrets.
  - **Testing:** Added `stripe-checkout-test.yml` workflow and `setup-test-users.yml` for E2E testing with real credentials.

- ✅ **Independent Review Remediation (2025-12-17):** Addressed findings from external codebase audit.
  - **P0 - Secret Sanitization:** Removed real Stripe Price ID from `.env.development`, added code fallback.
  - **P1 - Test Hardening:** Added URL validation in catch block for fail-fast behavior.
  - **P2 - Shared Types:** Created `_shared/types.ts`, updated `tsconfig.json` with `@shared/*` path.
  - **P2 - Webhook Tests:** Created `stripe-webhook/index.test.ts` with extracted handler pattern (5 test cases).
  - **Reviewer Correction:** `check-usage-limit` already had 167 lines of unit tests (6 test cases).

- ✅ **Whisper Architecture Documentation (2025-12-12):** ARCHITECTURE.md section 3.2.1 expanded with comprehensive Service Worker caching strategy, architecture diagram, component tables, and setup instructions.

#### P2 - Known Limitations (Alpha Acceptable)

- 🟡 **Code Bloat Index Above Industry Standard (Updated 2026-02-20):** Current bloat index is 26.3% (industry std: <20%).
  - **Metric:** Initial Chunk (933.63KB) / Estimated Total Source (3.5MB) = 26.3%
  - **Optimizations:** Lazy-load Recharts, lazy-load Whisper model loader, aggressive route-based code splitting
  - **Status:** Acceptable for Alpha, optimize in Beta for performance SLO compliance. *Note: AnalyticsPage chunk optimized from 877KB to 500.64KB via RPC migration.*

- 🟡 **Bundle Chunk Size Warning (2026-02-20):** Vite build emits warning about chunks >500KB.
  - **Affected Chunks:** `index-*.js` (933.63KB), `vendor-transformers-*.js` (823.85KB)
  - **Warning Text:** `(!) Some chunks are larger than 500 kB after minification`
  - **Recommended Fixes:**
    - Use `dynamic import()` for code-splitting heavy components (Recharts, html2canvas)
    - Configure `build.rollupOptions.output.manualChunks` for vendor chunking
    - Consider `build.chunkSizeWarningLimit` as last resort (masks issue, doesn't fix)
  - **Reference:** https://rollupjs.org/configuration-options/#output-manualchunks
  - **Status:** P2 - Acceptable for Alpha, optimize in Beta

- 🟡 **E2E Test Console Warnings (2025-12-22):** The following console logs appear during E2E tests and should be addressed:
  - **Recharts Dimension Warning:** `The width(-1) and height(-1) of chart should be greater than 0` - Chart renders before container has dimensions in headless browser.
    - **Status:** Acceptable for Alpha, cosmetic only.
  - **✅ FIXED - Failed to fetch (Supabase signOut):** Added `auth/v1/logout*` mock to `mock-routes.ts`.


- 🟢 **Vocal Analysis Disabled:** The `useVocalAnalysis` hook exists but is initialized with `false`. Pause detection feature intentionally disabled pending microphone stream integration.
  - **File:** `useSpeechRecognition/index.ts:30`
  - **Evidence:** `const vocalAnalysis = useVocalAnalysis(false); // We'll enable this when we have mic access`
  - **Status:** Feature placeholder for future release, not a bug

- ✅ **Transient Profile Fetch Error (RESOLVED 2025-12-15):** Initial profile fetch occasionally failed with `TypeError: Failed to fetch` on page load, then self-healed on retry.
  - **Root Cause (70% confidence):** Cold start timing - first request to Supabase Edge Function/DB times out
  - **Solution:** Added `fetchWithRetry` utility with exponential backoff (5 retries, 100ms-1600ms)
  - **Files:** `utils/fetchWithRetry.ts`, `AuthProvider.tsx`
  - **Status:** ✅ RESOLVED - Retry logic eliminates transient failures

### ⚠️ Known Issues

**12 issues resolved** (Nov 2025 - Jan 2026). Details moved to `CHANGELOG.md`.

#### Active Issues

- **ℹ️ INFO - Node.js Punycode Deprecation Warning**
  - Cosmetic warning from transitive dependency chain. Suppressed via `NODE_NO_WARNINGS=1`.
  - **Status:** Safe to ignore

- **ℹ️ INFO - **STT Comparison Partially Integrated (2026-02-15)**: Component exists in settings carousel but requires ground truth input feature for full utility. 
- **PDF Export Fully Functional**: Pro users can now export session reports as PDF.
  - **Status:** Deferred feature - requires sessions with `ground_truth`, `transcript`, and `engine` fields populated.
  - **Priority:** P3 - Nice-to-have for beta

- **✅ FIXED - Filler Words/Min Edge Case (2026-01-06)**
  - `avgFillerWordsPerMin` in `analyticsUtils.ts` was using `Math.round(totalDurationSeconds / 60)` for rate calculation.
  - **Fix Applied:** Now uses precise minutes (`totalDurationSeconds / 60`) for industry-standard filler rate calculation.
  - **Formula:** `Filler Rate = Total Fillers / Total Speaking Time (precise minutes)`
  - **Status:** ✅ RESOLVED - Unit tests passing

- **✅ FIXED - STT UI & Label Polish (2026-01-28):**
  - **Fix:** Resolved the issue where the STT mode selection dropdown was unresponsive.
  - **Label:** Updated PDF export label to "Download Session PDF" for better clarity.
  - **UX:** The dropdown is now disabled during active recordings to prevent configuration conflicts and state-syncing bugs.
- **✅ FIXED - Minimum Session Duration Warning (2026-01-06)**
  - Users were previously unaware why sessions under 5s weren't saved or analyzed.
  - **Fix Applied:** Added inline warning in `LiveRecordingCard` and a warning toast when stopping prematurely.
  - **Policy:** Sessions < 5s are discarded to maintain data integrity.
  - **Status:** ✅ RESOLVED - Implemented & Documented in UI/UX Standards

#### Parked

- **⏸️ PARKED - Metrics E2E MockSpeechRecognition Loading Issue**
  - Mock class may not load via `addInitScript`. Event buffering implemented.
  - **Status:** Test infrastructure only (not production bug)

### Gating Check
- ✅ **All P0/P1 blockers resolved.** See Tech Debt summary above.

---
## Phase 2: User Validation & Polish
This phase is about confirming the core feature set works as expected and polishing the user experience before wider release.

### 🎯 Must-Have
- ✅ **Implement Speaking Pace Analysis:** Add real-time feedback on words per minute to the core analytics.
- ✅ **Implement User Words:** Allow Pro users to add user words (jargon, names) to improve transcription accuracy.
- ✅ **Implement Vocal Variety / Pause Detection:** Add a new Pro-tier feature to analyze vocal variety or pause duration.
  - ✅ **Pause Detection UI**: Integrate `PauseMetricsDisplay` into SessionPage (Completed 2025-11-30)
- ✅ **CI Stability**: Fix Lighthouse CI timeouts and ensure local/remote parity (Completed 2025-11-30)
- ✅ **Live Transcript E2E**: Fix test environment render loop to unskip `live-transcript.e2e.spec.ts` (Completed 2025-12-02)
- ✅ **User-Friendly Error Handling:** Implement specific, user-facing error messages for common issues.
- ✅ **Clarity Score Visualization:** Detailed breakdown of speech clarity.
- ✅ **Goal Setting (2025-12-07):** Weekly/Daily targets for practice consistency.
  - ✅ `useGoals` hook with localStorage + Supabase sync
  - ✅ `EditGoalsDialog` modal (1-20 sessions, 50-100% clarity)
  - ✅ `user_goals` table with RLS
  - ✅ Migrations deployed to production
- 🔴 **1-Click Practice Session Summaries (Funnel Feature):** Allow users to generate PDF practice summaries. Free users must receive prominently **Watermarked** PDFs ("Generated by SpeakSharp") to drive viral acquisition and up-sells. Pro users get clean branding.
- 🔴 **AI Speech Coach (Pro Tier Value Add):** Implement a post-session summarization and coaching agent using Gemini Flash to provide structured feedback on tone, structure, and delivery.
-  **ℹ️ CAVEAT - User Filler Words Native STT (2026-01-02):** Native STT (Web Speech API) does **NOT** support user filler words - it's entirely browser-controlled. Only Cloud STT (`word_boost` param via AssemblyAI) supports this feature. **Testing Impact:** User filler words E2E verification can only be done with Cloud STT, which requires API keys.
- [ ] **Alpha Deployment Checklist**
    - ✅ **Set `PROMO_GEN_ADMIN_SECRET` secret in Supabase Dashboard (2026-02-08):** Finalized secure, server-side validated promo generation. Legacy ALPHA_BYPASS_CODE purged.
    - [ ] Verify rotation via `pnpm generate-promo`
- [ ] **Infrastructure Cleanup**
- ✅ **Restructure Codebase:** Reorganize the project structure for better maintainability before alpha soft launch.\
  - **Implemented Structure:**\
    - `frontend/`: React application code\
    - `backend/`: Supabase functions, migrations, seed data\
    - `scripts/`: Build, test, and maintenance scripts\
    - `docs/`: Documentation\
    - `tests/`: E2E and integration tests\
- ✅ **Audit and Fix UX States:** Standardized loading/error states across SessionPage, SignInPage, SignUpPage, WeeklyActivityChart, GoalsSection (2025-11-27)
- ✅ **Apply Supabase Migration:** `user_filler_words` migration applied to production
- ✅ **Implement Lighthouse CI:** Lighthouse stage added to CI pipeline with performance thresholds (2025-11-22)
- ✅ **Hide "TBD" Placeholders:** Remove or hide "TBD" sections (e.g., testimonials) for the Alpha launch.\
- ⏸️ **Harden Supabase Security:** BLOCKED - OTP/password features require Supabase Pro account (deferred to production launch)\
- ✅ **Centralize Configuration:** Move hardcoded values to `src/config.ts`.\
- ✅ **Fix E2E Test Gap (Live Transcript):** Complete end-to-end coverage implemented (2025-11-27)
- ✅ **Implement WebSocket Reconnect Logic:** Added heartbeat and exponential backoff (1s, 2s, 4s, 8s, max 30s) logic to `CloudAssemblyAI.ts`.
- ✅ **Session Comparison & Progress Tracking (2025-12-06):** Users can now select 2 sessions to compare side-by-side with progress indicators (green ↑ for improvement, red ↓ for regression). Added WPM and Clarity trend charts showing progress over last 10 sessions. **Components:** `ProgressIndicator.tsx`, `TrendChart.tsx`, `SessionComparisonDialog.tsx`. **Status:** ✅ Complete.
- ✅ **Implement Local STT Toast Notification:** Show user feedback when Whisper model download completes.
- ✅ **User Filler Words Tier Limits \u0026 Conversion Nudges (2025-12-11):** Implemented tier-based limits (Free: 10 words, Pro: 100 words) with subtle upgrade nudges when free users approach limit (shown at 8/10 words). Error messages include upgrade CTA. Uses `Math.min(MAX_WORDS_PER_USER, MAX_WORDS_FREE)` pattern for free tier enforcement.
- ✅ **Contract Rectification (2025-12-19):** Grounded application assumptions in the database. Added `transcript`, `engine`, `clarity_score`, and `wpm` to the `sessions` table. Implemented atomic `create_session_and_update_usage` Ghost RPC. Purged `avatar_url` and `full_name` phantoms.
- ✅ **Analytics Integrity Fix (2025-12-19):** Resolved regression in clarity score aggregation to correctly use grounded DB fields.
- ✅ **Plan Selection at Signup (2025-12-21):** Users choose Free or Pro plan during signup. Pro selection redirects to Stripe Checkout after account creation (as Free). Webhook upgrades to Pro on successful payment. Added persistent "Upgrade to Pro" button in Navigation for Free users.
  - **Files:** `AuthPage.tsx`, `Navigation.tsx`, `App.tsx`, `stripe-checkout/index.ts`
- ✅ **Promo Admin Migration (2026-02-08):** Migrated from legacy Alpha Bypass to a professional, server-side validated Promo Code system. Replaced `ALPHA_BYPASS_CODE` with `PROMO_GEN_ADMIN_SECRET` and implemented `generate-promo.ts`.
- ✅ **Analytics UI Restoration & Consolidation (2025-12-31):** Resolved MSW initialization regression. Consolidated redundant upgrade prompts and merged plan status indicators for a cleaner Analytics dashboard.
- ✅ **Port Centralization (2025-12-21):** Eliminated hardcoded port numbers. Created `scripts/build.config.ts` with `PORTS.DEV` (5173) and `PORTS.PREVIEW` (4173). Updated 10+ files.
- ✅ **PERPETUAL - Documentation Audit (2026-02-09):** Verified PRD Known Issues, ROADMAP, and CHANGELOG match actual codebase state. Resolved CI path resolution and MSW identity issues. **Frequency:** Before each release and after major feature work.
- ✅ **Side-by-Side Session Comparison (2025-12-06):** Implemented `SessionComparisonDialog.tsx` with `ProgressIndicator` and integrated into `AnalyticsDashboard.tsx`. Verified via `session-comparison.e2e.spec.ts`.
- [ ] **🛡️ Private STT Hardening (Post-Alpha Tech Debt):**
  - **Multi-Tab State Corruption**: Implement `SharedWorker` or Cross-Tab Broadcast Channel to strictly enforce a single WebGPU instance across tabs.
  - **WebGPU Context Loss**: Add `device-lost` event handlers to the `WhisperEngineRegistry` to trigger graceful WASM fallback mid-session.
  - **Mobile RAM Optimization**: Implement dynamic model unloading or Tiny-model preference for iOS Safari (300MB RAM limit).
  - **Ad-Blocker Resilience**: Detect asset load failures and fallback to a "Lite" model probe with exponential backoff on retry.
  - **Asset MITM Protection**: Move model weights to authenticated Supabase buckets with short-lived signed URLs.

- ✅ **Refactor Usage Tier Logic (Database) (2026-02-23):** Partially addressed via atomic usage updates and strict multi-tab prevention. Decoupled daily/monthly caps deferred to Beta.
  - ✅ **Task 3: Cross-Tab Mutex Lock (COMPLETE):** Resolved by enforcing a universal single-session policy and synchronous lock release.
  - ✅ **Task 4: Voice Activity Auto-Pause (COMPLETE):** Fully implemented and verified via deterministic `page.clock` E2E tests.
  - ✅ **Task 6: Graceful Session Wrap-up & Limit Modals (COMPLETE):** Implemented "Gracious Sunset" UI and status message synchronization.
- ✅ **Prioritize WebGPU Local Engine (Code & UX):** Refactored to default Pro users to the Local Engine ($0.00/hr) to maximize gross margins.
- ✅ **Private STT CI Stability (2026-01-01):** Resolved WASM deadlocks and flaky integration tests using Triple-Engine Architecture and MockEngine strategy.

- ⚠️ **Stripe Webhook E2E Verification (2025-12-21):** End-to-end test of Pro signup flow completed via CLI simulation. Confirmed: Auth → Select Pro → Stripe Redirect → Webhook Upgrade → Success Toast. Ad-hoc fix implemented for double toasts (see Tech Debt section below).
- ✅ **Toast Notification Styling (2026-01-15):** Reduced toast pill size (px-6 py-2 → px-4 py-1.5) and font sizes for less screen real estate usage.
- ✅ **STT Status Notification Bar (2026-01-15):** Added persistent StatusNotificationBar component above LiveRecordingCard showing STT state transitions (initializing, ready, fallback, error).
- ✅ **Filler Word Individual Counts (2026-01-15):** FillerWordsCard now shows individual count next to each word badge, sorted by frequency.
- ✅ **Promo Code Auto-Select Pro (2026-01-15):** AuthPage automatically selects Pro plan when user enters a promo code.
- ✅ **Filler Words UX Polish (2026-01-16):** Unified orange styling, cleaner "Total Detected" layout, and Popover-based "Add User Word" flow.
- ✅ **Private STT Timeout Tuning (2026-01-16):** Increased WebGPU init timeout to 20s for better stability on older hardware.
- 🟡 **Profile Loading Root Cause Investigation:** Move beyond retries to identify why Supabase fetches intermittently fail on load. (See Tech Debt section below)
- ✅ **COMPLETED - CVA-Based Design System Refinement:**
  - ✅ Audited all 20 UI components for consistent CVA variant usage (2025-11-28)
  - ✅ Fixed Badge typo, refactored Input to use CVA, replaced Card shadow
  - ✅ Documented design token guidelines in `docs/DESIGN_TOKENS.md`
  - ✅ **Component showcase (2025-12-11):** `/design` route with `DesignSystemPage`
  - ✅ **CVA implemented in 8 components (verified 2025-12-15):** badge, button, card, alert, input, label, sheet, toast
- ✅ **Refactor `useSpeechRecognition` hook:** Improve maintainability and fix memory leaks.
- ✅ **Add Robust UX States:** Completed 2025-11-27 (SessionPage, SignInPage, SignUpPage, WeeklyActivityChart, GoalsSection)
- ✅ **Centralize configuration:** Move hardcoded values (e.g., session limits) to a config file.
- **✅ COMPLETED (2025-11-29) - Fix E2E Race Conditions (Finding 3):**
  - Replaced global flag polling with event-driven synchronization in `scripts/e2e-playbook.sh`
  - Eliminates intermittent E2E test failures caused by race conditions
- **✅ COMPLETED (2025-11-29) - Implement Global State Management (Finding 4):**
  - Installed Zustand for centralized state management
  - Created `frontend/src/stores/useSessionStore.ts` for session state
  - Refactored `SessionPage.tsx` to use store instead of local useState
  - Improves code maintainability and scalability
- ✅ **Add a soak test:** 5-minute concurrent user test implemented (`tests/soak/soak-test.spec.ts`) with memory leak detection
  - ✅ **STABILIZED - Soak Test "Empty Body" (2025-12-15):**
    - **Problem:** CI soak test failing with "Success Rate: 0/4" - Race condition and hydration failures ("Empty Body").
    - **Mitigation:** Implemented `browser.newContext()` for strict user isolation and `expect().toBeVisible()` state guards.
    - **Status:** Stabilized (Guardrail enforced), though shared process risk remains.
    - **Files:** `tests/soak/soak-test.spec.ts`, `docs/ARCHITECTURE.md`
  - ✅ **COMPLETED (2025-12-14) - Fix Soak Test E2E Bridge Initialization:**
    - **Problem:** Soak test stuck in READY state, `dispatchMockTranscript` was undefined in CI
    - **Root Cause:** Workflow used `VITE_E2E=true` but `IS_TEST_ENVIRONMENT` checks `VITE_TEST_MODE`
    - **Solution:** Changed to `VITE_TEST_MODE=true` in soak-test.yml. Added critical warning to ARCHITECTURE.md.
    - **Files:** `.github/workflows/soak-test.yml`, `docs/ARCHITECTURE.md`
  - ✅ **COMPLETED (2025-12-15) - CI Workflow Architectural Fix:**
    - **Problem:** ELIFECYCLE errors from orphaned node/esbuild processes when manually killing dev server. Also `postinstall` installed Playwright browsers (~7 min wasted).
    - **Solution:** 
      - Replaced manual `kill` with `start-server-and-test` for clean process lifecycle
      - Removed Playwright from `postinstall` entirely (separation of concerns: postinstall=app, workflows=environment)
      - Added explicit `pw:install` scripts for developers
    - **Principle:** `postinstall` prepares the app; workflows prepare the environment.
    - **Files:** `package.json`, `.github/workflows/soak-test.yml`, `.github/workflows/stripe-checkout-test.yml`, `docs/ARCHITECTURE.md`
  - 🔴 **TODO - Simplify Setup Test Users Workflow UI:**
    - **Problem:** Current workflow interface (`setup-test-users.yml`) is confusing with overlapping inputs for E2E and Soak modes.
    - **UX Issues:** "Ignored for e2e/soak" labels are workarounds. Ideally, irrelevant fields should not appear.
    - **Limitation:** GitHub Actions workflow_dispatch does not support conditional field visibility, greyed-out fields, or dynamic data.
    - **Future Option:** Build custom web UI that queries Supabase for current state and triggers workflow via GitHub API.
- **✅ COMPLETED - Expand Unit Test Coverage (2025-12-08):**
  - **Note:** Test suite expanded significantly. Current: **556 unit tests + 17 mocked CI E2E tests** (verified 2026-03-01).
  - ✅ Authentication pages: SignInPage (14), SignUpPage (15)
  - ✅ Core pages: AnalyticsPage (14), SessionPage (18)
  - ✅ Utilities: storage.ts (10), utils.ts (8), supabaseClient.ts (5)
  - ✅ Transcription: AudioProcessor.test.ts (15), TranscriptionError.test.ts (10)
  - **Target:** 70% coverage (currently 54.8%)
  - **✅ COMPLETED (2025-12-10) - Refactor Test Organization:**
  - Moved `auth-real.e2e.spec.ts` to `frontend/tests/integration/` to isolate real-backend tests from local E2E suite
- ⚪ **Light Theme Implementation (Nice-to-Have):** Add CSS or disable toggle. Dark theme only is acceptable for alpha launch.
- **✅ COMPLETED - Refactor E2E Test Infrastructure (2025-12-07):**
  - ✅ Fix `analytics-empty-state.e2e.spec.ts` timeout (empty state not rendering)
  - ✅ Fix `metrics.e2e.spec.ts` WPM calculation timing issue
  - ✅ **COMPLETED (2025-12-10) - Fix CI Metrics Reporting (Data Loss):**
  - **Issue:** `update-metrics` script only captured the last shard's results (e.g., 8 vs 35 tests) in sharded CI runs.
  - **Solution:** Implemented per-shard blob output (`PLAYWRIGHT_BLOB_OUTPUT_DIR`) and JSONL extraction to aggregate test counts from all shards. Now correctly reports 35 E2E tests.
  - **Files:** `scripts/test-audit.sh`
- ✅ **COMPLETED (2025-12-10) - Refactor: Centralize Test IDs & Fix Duplicates:**
  - **Goal:** Eliminate magic strings and duplicate selectors (e.g., `.first()`).
  - **Solution:** 
    - Created `frontend/src/constants/testIds.ts` as single source of truth (55 IDs)
    - Mirrored in `tests/constants.ts` for E2E test imports
    - Refactored components: `Navigation.tsx`, `SessionPage.tsx`, `AnalyticsDashboard.tsx`
    - Fixed dynamic IDs: `session-history-item-${id}` pattern for lists
    - Replaced brittle `.first()` selectors with specific `data-testid` attributes (e.g., mobile button)
    - Fixed E2E tests: `session-comparison.e2e.spec.ts`, `pdf-export.e2e.spec.ts`, `navigation.e2e.spec.ts`
  - **Files:** `testIds.ts`, `tests/constants.ts`, plus 6 component/test files
  - ✅ Fix `local-stt-caching.e2e.spec.ts` mode selector timeout
  - ✅ Fix `custom-vocabulary.e2e.spec.ts` hanging issue
  - ✅ Set up Pro test account for Local STT tests
  - ✅ Goal Setting and Session Comparison fully implemented
- **✅ COMPLETED (2025-12-07) - Magic Link Authentication:**
  - Implemented passwordless sign-in via Supabase OTP (`signInWithOtp`) to reduce friction.
- **✅ COMPLETED (2025-12-07) - PostHog Analytics Integration:**
  - Integrated `posthog-js` for product analytics.
  - Tracking events: `signup_completed`, `session_started`, `session_ended` (w/ metrics).
- **✅ COMPLETED (2025-12-07, Updated 2025-12-10) - Demo Recording Automation:**
  - Created Playwright test (`tests/demo/demo-recording.spec.ts`) with dedicated config (`playwright.demo.config.ts`)
  - Showcases Cloud AI and Native STT modes with brief recording sessions
  - Captures full user journey: Landing → Auth → Session (STT mode selection) → Analytics
  - Run: `pnpm build:test && pnpm exec playwright test --config=playwright.demo.config.ts`
- **🟡 PARTIAL (2025-12-07) - Populate Testimonials:**
  - [x] **Testimonials Section** (Implemented but contains "TBD" placeholders. Needs real content.)
- **✅ COMPLETED (2025-12-03) - Resolve TypeScript 'any' Type Errors in Test Suite:**
  - Fixed 23+ `Unexpected any` lint errors across 7 test files
  - Replaced `as any` with proper type assertions using `ReturnType<typeof hook>` pattern
  - All lint checks passing (exit code 0)
  - Files modified: Navigation.test.tsx, SessionPage.test.tsx, AnalyticsPage.test.tsx, SignInPage.test.tsx, SignUpPage.test.tsx, storage.test.ts, supabaseClient.test.ts, utils.test.ts
- **✅ COMPLETED (2025-12-03) - Fix GitHub CI Playwright Installation Failure:**
  - Resolved 403 Forbidden errors from Microsoft package repositories
  - Removed problematic `microsoft-prod.list` and `azure-cli.list` before browser installation
  - CI infrastructure issue, not code issue - safe removal as we don't use Azure/Microsoft tools
  - Playwright dependencies come from standard Ubuntu repositories
- **✅ COMPLETED (2025-12-03) - Generate Visual Regression Test Baselines:**
  - Visual regression tests in `visual-regression.e2e.spec.ts` now have baseline snapshots
  - Run locally with `--update-snapshots` flag to generate baselines
  - Snapshots committed to repository for CI comparison
- **✅ COMPLETED - UX/UI Test Plan Execution:**
  - **Scope**: 14 complete user journeys covering all features
  - **Coverage**: All 3 STT modes (Local Device, Native, Cloud), authentication, session recording, analytics, user filler words, accessibility, mobile responsiveness
  - **Deliverables**: 
    - Visual regression baseline snapshots (generated)
    - Bug reports documented in ROADMAP Tech Debt section
    - UX improvement recommendations incorporated
  - **Status**: ✅ Complete - All 35 E2E tests passing, journeys verified



### Gating Check
- ✅ **Gap Analysis Complete (2025-11-28, Updated 2025-12-08)**
  - **Phase 1:** 100% Complete
  - **Phase 2 Must-Have:** 100% Complete
    - ✅ WebSocket Reconnect: Implemented with exponential backoff (1s-30s), 5 max retries, 30s heartbeat (`CloudAssemblyAI.ts:221-291`)
    - ✅ Error Boundary: `Sentry.ErrorBoundary` wraps `<App/>` (`main.tsx:111-113`)
  - **Phase 2 Should-Have (Tech Debt):** In Progress (7 new items from Dec 2025 Code Review)
  - **Production Readiness:** READY - Prior P0 blockers verified as implemented

### ✅ Tech Debt Resolved (Summary)

**23 items resolved** from Dec 2025 - Jan 2026 independent code reviews. Details moved to `CHANGELOG.md`.

---

### ⏸️ Pending Tech Debt (Post-Alpha)

| # | Finding | Location | Priority | Notes |
|---|---------|----------|----------|-------|
| 1 | **TranscriptionService SRP Violation** | `TranscriptionService.ts` | P2 | ✅ REFACTORED - Split into specialized mode Providers |
| 2 | **UI State Boolean Flags** | `RecordingControls.tsx` | P2 | ✅ REFACTORED - Decomposed into clean hooks and sub-components |
| 3 | **Migration Idempotency** | `supabase/migrations/*` | P3 | Add `IF NOT EXISTS` guards before public launch |
| 4 | **Filler Word Regex False Positives** | `fillerWordUtils.ts` | P3 | ✅ FIXED - Integrated `compromise` NLP and optimized for performance |
| 5 | **React Router v7 Deprecation** | Console output | P3 | Add future flags before upgrading |
| 6 | **SessionPage Mega Component** | `SessionPage.tsx` | P2 | ✅ DECOMPOSED - Logic moved to hooks, UI split into cards |
| ~~7~~ | ~~**Filler/Min Rounding Edge Case**~~ | ~~`analyticsUtils.ts:61`~~ | ~~P3~~ | ✅ FIXED 2026-01-06 - Now uses precise minutes |
| 8 | **Minimum Session Duration UX** | `SessionPage.tsx` | P2 | ✅ FIXED - Added HUD indicator and feedback message |
| 9 | **Test Harness Config (Stale Closure)** | `useSpeechRecognition/__tests__` | P3 | ✅ FIXED - Atomic hook decomposition (`useTranscriptionCallbacks`) and `useRef`-based proxying eliminates stale closure risk. |
| 10 | **Unified Documentation Metric Sync** | `scripts/update-prd-metrics.mjs` | P2 | Automate metric sync for `README.md` and `ARCHITECTURE.md` using markers (currently manual). |
| 11 | **Remove Mock Timeout Bypass** | `TranscriptionService.ts` | P2 | Evolve the Optimistic Entry logic to handle mocks via a more generic "ready-on-init" flag rather than explicitly checking for mocks, reducing test-prod coupling. |
| 12 | **E2E Timeout Standardization** | `tests/e2e/` | P2 | Standardize wait timeouts to "ideal duration + 50% buffer max" to avoid masking performance regressions or slow CI execution. |
| 13 | **Mock-to-Schema Synchronization** | `tests/e2e/mock-routes.ts` | P2 | Implement factory-based session mocking and PostgREST header compliance to prevent regression. |
| 14 | **WASM Binary Cache** | `TranscriptionService.ts` | P2 | 🔴 Not Started - Implement global binary caching for $O(1)$ startup vs. current init lag. |
| 15 | **Transient Transcript Policy** | `TranscriptionService.ts` | P2 | 🔴 Not Started - Ephemeral local storage for transcripts to protect PII and save disk costs. |
| 16 | **Free-Tier Private Gating** | `SessionPage.tsx` | P3 | 🔴 Not Started - User-tier gating in DOM for Free users to reduce asset load noise. |


### 🛡️ Prevention Mechanisms (Choose 1 of 3)


Three mechanisms, each catching a different category of drift at a different point in the development cycle.

#### Mechanism 1 — Type-Safe Mock Factories (Catches Drift at Compile Time)

This is the most powerful prevention. When your mock factory return type is derived directly from your database types, a schema change becomes a TypeScript error:

```typescript
// tests/support/factories/session.factory.ts
import type { Database } from '@/types/database.types';

// Derive the mock type directly from the generated DB types
type SessionRow = Database['public']['Tables']['sessions']['Row'];

// TypeScript will error if any required field is missing
export function createMockSession(
    overrides: Partial<SessionRow> = {}
): SessionRow {
    return {
        id: crypto.randomUUID(),
        user_id: 'mock-user-id',
        status: 'completed',
        engine: 'private',
        // ... every field required by SessionRow
        ...overrides,
    };
}
```

When the Phase 2 migration added `engine_version`, `model_name`, `device_type` — if the factory used `SessionRow` as its return type, TypeScript would have immediately shown a red underline on the factory and blocked compilation. The drift would have been caught before any test ran.

The key is regenerating `database.types.ts` from the actual schema after every migration:

```bash
# Add to the migration deployment step:
pnpm supabase gen types typescript --local > frontend/src/types/database.types.ts
git add frontend/src/types/database.types.ts
```

Make type regeneration mandatory in `deploy-supabase-migrations.yml`.

#### Mechanism 2 — Contract Tests (Catches Drift at Test Time)

Type safety catches missing fields. Contract tests catch semantic drift — wrong values, wrong headers, wrong response shape even when all fields are present.

Add a contract test that runs the real Supabase client against your mocks and asserts the shapes match:

```typescript
// tests/contracts/supabase-mock-parity.spec.ts
import { createMockSession } from '../support/factories/session.factory';
import type { Database } from '@/types/database.types';

type SessionRow = Database['public']['Tables']['sessions']['Row'];

describe('Mock Parity Contract', () => {
    it('mock session contains all required DB fields', () => {
        const mock = createMockSession();
        
        // These are the fields the frontend actually reads
        // If a new field is added to the DB and read in the frontend
        // but missing from the mock, this test catches it
        const requiredFields: (keyof SessionRow)[] = [
            'id', 'user_id', 'status', 'engine', 'engine_version',
            'model_name', 'device_type', 'created_at', 'transcript',
            'clarity_score', 'wpm', 'idempotency_key',
        ];
        
        requiredFields.forEach(field => {
            expect(mock).toHaveProperty(field);
            expect(mock[field]).not.toBeUndefined();
        });
    });

    it('mock response headers satisfy PostgREST single() contract', () => {
        // Document and enforce the header contract
        const singleHeaders = SUPABASE_SINGLE_HEADERS;
        expect(singleHeaders['Content-Type'])
            .toBe('application/vnd.pgrst.object+json');
    });
});
```

#### Mechanism 3 — Migration-Linked Mock Update Checklist (Catches Drift at PR Review)

The first two mechanisms are technical. This one is process. Add to your PR template and to `AGENTS.md`:

```markdown
## Required for any Supabase migration PR

- [ ] Ran: `pnpm supabase gen types typescript --local > frontend/src/types/database.types.ts`
- [ ] Updated mock factories in `tests/support/factories/` to include new columns
- [ ] Ran contract tests: `pnpm test -- --grep "Mock Parity"`
- [ ] Verified mock headers match PostgREST spec for any new .single() queries
```

And add a CI lint rule that detects migration files without corresponding factory updates.

#### Summary

Each mechanism offers a different level of protection. While any one of these would have caught the array body bug, the schema drift, or the header mismatch, Mechanism 1 (Type-Safe Factories) is recommended as the primary defense for this project.


### ℹ️ Known Limitations (Accepted)

| Finding | Status |
|---------|--------|
| Documentation Drift | 🔄 PERPETUAL - Audit before each release |
| devBypass Edge Function 401 | ✅ BY DESIGN - UI-only testing |
| TranscriptionService Mode Coupling | ✅ BY DESIGN - Policy-Driven Strategy |
| CI ≠ Local Dev Parity | ✅ ACCEPTABLE - Edge Functions tested in CI |

---

## Phase 2.5: UI/UX & Design Polish
This phase addresses findings from the December 2025 UX Audit (`ux_audit.md`) to align the product with "Premium" design standards.

### 🎯 Must-Have
- ✅ **Refactor Shadows:** Replace hardcoded shadows in `SessionPage` with design system tokens (`shadow-elegant`). (Completed 2025-12-06)
- ✅ **Premium Loading States:** Replace spinners with `SessionPageSkeleton` for a refined experience. (Completed 2025-12-06)
- ✅ **Fix Layout Shifts (CLS):** Constrain transcript container in `SessionPage` to prevent layout jumps.
    - **Fix:** Switched to fixed `h-[250px]` container and matched Skeleton height.
- ✅ **HeroSection Contrast Fixed (2025-12-07):** Added drop-shadow and backdrop-blur for WCAG AA compliance.

### 🚧 Should-Have
- 🔴 **Guest Mode / Quick Start:** Allow users to try a "Demo Session" without full sign-up (reduce friction). No generic login logic in `SignInPage.tsx` yet.
- ✅ **Mobile Optimization (2025-12-11):** Implement "Sticky Bottom" controls for `SessionPage` on mobile viewports. (Implemented in `SessionPage.tsx` via `MobileActionBar`).

### 🌱 Could-Have
- 🔴 **Live Overlay / Mini-Mode:** Create a compact "Heads Up Display" view for use during real video calls (vs practice mode).
- ✅ **Positive Reinforcement (2025-12-11):** Implemented "Gamified" toasts (e.g., "🔥 3 Day Streak!") and `useStreak` hook.

### 🎯 UI/UX Audit Remediation (Mar 2026) ✅ COMPLETE
- ✅ **Accessibility:** Added descriptive `aria-label`s to unlabelled sections across Landing and Design System pages.
- ✅ **Social Sharing:** Generated `og-image.webp` and injected Open Graph meta tags into `index.html` for rich link previews.
- ✅ **Page Transitions:** Implemented seamless entry/exit routing animations using a new Framer Motion `<PageTransition>` wrapper.
- ✅ **Visual Polish:** Resolved generic component hierarchies (gradients, hover states, mobile nav aesthetics, Pro badges) across the application.

---
## Phase 3: Stripe Webhook Optimization (Mar 2026) ✅ COMPLETE

> **Goal:** Optimize Stripe webhook performance and ensure atomic database operations for billing logic.

| ID | Title | Priority | Status | Notes |
|----|-------|----------|--------|-------|
| **P3.1** | **Atomic Stripe RPC** | **HIGH** | ✅ Complete | Migrated from sequential HTTP processing to atomic Postgres RPC. |

---

## Phase 4: PDF Parsing Performance (Mar 2026) ✅ COMPLETE

> **Goal:** Improve PDF extraction performance for multi-page documents.

| ID | Title | Priority | Status | Notes |
|----|-------|----------|--------|-------|
| **P4.1** | **Concurrent PDF Parsing** | **HIGH** | ✅ Complete | Refactored serial page processing to `Promise.all` concurrency. |
- ✅ **COMPLETED - Whisper Model Caching & Auto-Update:**
  - ✅ **Script & SW:** `download-whisper-model.sh` and `sw.js` (2025-12-10). Load time: >30s → <5s.
  - ✅ **Terminology:** Renamed "Local" to "Private" (2025-12-11).
  - ✅ **Internal Refactor:** `OnDeviceWhisper` class with 36 references updated (2025-12-11).
  - ✅ **Documentation (2025-12-15):** Added Private STT section to ARCHITECTURE.md with full cache flow, URL mappings, and setup instructions.
  - ✅ **Cache WASM Model:** Service Worker caches `.bin` and `.wasm` via Cache Storage API.
  - ✅ **Offline Support:** Model loads from cache when offline.
- 🔴 **Add Platform Integrations (e.g., Zoom, Google Meet):** Allow SpeakSharp to connect to and analyze audio from third-party meeting platforms.
- 🔴 **Speaker Identification:** Distinguish between multiple speakers (diarization). Currently not implemented in `CloudAssemblyAI.ts`.
- 🟡 **Set up Multi-Env CI/CD:** A basic implementation for DB migrations exists, but needs expansion.
- ✅ **COMPLETED (2025-12-15) - Replace E2E Custom Event Synchronization:** Migrated from `programmaticLogin` (which relied on custom events like `e2e-profile-loaded`) to `programmaticLoginWithRoutes` which uses Playwright route interception. No longer dependent on internal event synchronization.
- ✅ **Create Mock Data Factory Functions:** Rich mock data implemented in `handlers.ts` (2025-12-07) - 5 sessions with improvement trend, 6 vocabulary words. Supports trend analysis and goal verification.

### Gating Check
- ✅ **Gap Analysis Complete:** P1 tech debt resolved (7/7 items - see "Tech Debt Resolved" section above).

---


---

## 🚨 Phase 4: Production Readiness Hardening (Audit Feb 2026) ✅ COMPLETE

> **Goal:** Resolve all CRITICAL and HIGH severity issues identified in the Production Readiness Audit before public release.

### 🛡️ DOMAIN 1: Memory Leaks & Resource Exhaustion ✅ COMPLETE
| ID | Title | Severity | Status | Notes |
|----|-------|----------|--------|-------|
| D1.1 | **Unbounded Mic Listeners** | **CRITICAL** | ✅ Complete | `PrivateWhisper.ts`: Implemented `cleanupFrameListener` to ensure single subscription. |
| D1.2 | **Zombie Instance Overwrite** | **HIGH** | ✅ Complete | `TranscriptionService.ts`: Added double-dispose guard before re-instantiation. |

### 🛡️ DOMAIN 2: Race Conditions & State Synchronization ✅ COMPLETE
| ID | Title | Severity | Status | Notes |
|----|-------|----------|--------|-------|
| D2.1 | **Stale Closure in Session Save** | **CRITICAL** | ✅ FIXED | `useSpeechRecognition`: Return data from `stopListening()` to guarantee final metrics. |
| D2.2 | **Immutable Callback Capture** | **HIGH** | ✅ Complete | `TranscriptionService.ts`: Refactored to access latest state during async callbacks. |

### 🛡️ DOMAIN 3: Error Boundaries & Failure Modes ✅ COMPLETE
| ID | Title | Severity | Status | Notes |
|----|-------|----------|--------|-------|
| D3.1 | **Lack of Sub-component Boundaries** | **CRITICAL** | ✅ Complete | Wrapped `LiveRecordingCard`, `LiveTranscriptCard`, and `FillerWordsCard` in `LocalErrorBoundary`. |
| D3.2 | **Unhandled Promise Rejections** | **HIGH** | ✅ Complete | `TranscriptionService.ts`: Added robust try-catch-finally blocks to background model loads. |

### 🛡️ DOMAIN 4: Performance Bottlenecks ✅ COMPLETE
| ID | Title | Severity | Status | Notes |
|----|-------|----------|--------|-------|
| D4.1 | **High-Frequency Re-renders** | **CRITICAL** | ✅ FIXED | `useSessionLifecycle.ts`: Consolidated logic and optimized state updates. |
| D4.2 | **Fake Waveform Visualization** | **HIGH** | ✅ Complete | Standardized UI state and minimized render noise. |

### 🛡️ DOMAIN 5: Test Coverage Gaps ✅ COMPLETE
| ID | Title | Severity | Status | Notes |
|----|-------|----------|--------|-------|
| D5.1 | **Zero Tier Transition Coverage** | **CRITICAL** | ✅ Complete | Implemented E2E and Unit coverage in `security_verification.test.ts`. |
| D5.2 | **Unstable Test Environment** | **HIGH** | ✅ FIXED | Stabilized `useVocalAnalysis` tests and optimized Vitest pool for isolation. |

### 🛡️ DOMAIN 6: Security Vulnerabilities ✅ COMPLETE
| ID | Title | Severity | Status | Notes |
|----|-------|----------|--------|-------|
| D6.1 | **Timing Attack on Admin Secret** | **CRITICAL** | ✅ FIXED | `apply-promo`: Implemented constant-time comparison for admin/promo secrets. |
| D6.2 | **Input Length Validation** | **HIGH** | ✅ Complete | `storage.ts`: Enforced strict byte-length limits for local/session storage items. |

### 🛡️ DOMAIN 7: Database Schema & Migrations ✅ COMPLETE
| ID | Title | Severity | Status | Notes |
|----|-------|----------|--------|-------|
| D7.1 | **Non-Atomic Usage Updates** | **CRITICAL** | ✅ FIXED | `create_session_and_update_usage`: Implemented atomic SQL counter increment. |
| D7.2 | **Missing Orphan Protection** | **HIGH** | ✅ Complete | `sessions.user_id`: Added `ON DELETE CASCADE` via migration. |


### 🛡️ DOMAIN 8: Scalability Architecture ✅ COMPLETE
| ID | Title | Severity | Status | Notes |
|----|-------|----------|--------|-------|
| D8.1 | **Missing Server-Side Rate Limits** | **CRITICAL** | ✅ Complete | Implemented Signal-based Rate Limiting in Edge Functions. |
| D8.2 | **Edge Function Cold Starts** | **HIGH** | ✅ FIXED | Optimized imports and implemented background warmup retry logic. |

---

## 💎 Phase 5: Zero-Debt & Architectural Refinement (Feb 2026) ✅ COMPLETE

> **Goal:** Eliminate all linting and type errors while decomposing core providers into atomic, maintainable hooks.

| ID | Title | Priority | Status | Notes |
|----|-------|----------|--------|-------|
| **Z1** | **Zero-Debt Linting** | **CRITICAL** | ✅ Complete | Resolved all remaining linting errors (no `eslint-disable`) across 100+ files. |
| **Z2** | **Full Type Safety** | **CRITICAL** | ✅ Complete | Achieved 100% type-check pass with unified transcription types and literal widening fixes. |
| **Z3** | **God File Decomposition** | **HIGH** | ✅ Complete | Split `TranscriptionProvider.tsx` and refactored `useSpeechRecognition_prod.ts` into specialized atomic hooks. |
| **Z4** | **TestRegistry Standardization**| **HIGH** | ✅ Complete | Unified engine injection via `TestRegistry`, enabling deterministic mocking in Vitest and E2E. |
| **Z5** | **React Refresh Compliance** | **MEDIUM** | ✅ Complete | Resolved Fast Refresh export warnings by isolating provider components. |


 ## ⚖️ Test Consistency & Behavioral Pivot ✅ COMPLETE
 
 > **Goal:** Resolve "See-Saw" failures and implement high-precision Behavioral Testing Integrity.
 
 | ID | Title | Priority | Status | Notes |
 |----|-------|----------|--------|-------|
 | **T1** | **Behavioral Integrity Pivot** | **CRITICAL** | ✅ Complete | Refactored tests to focus on requirements (Accuracy, FSM safety) via Playwright data-attributes. |
 | **T2** | **Isomorphic Fixtures** | **HIGH** | ✅ Complete | Established `STT_FIXTURES` as the single source of truth for Golden Transcripts. |
 | **T3** | **Drift Guardian** | **HIGH** | ✅ Complete | Implemented E2E contract verification to prevent mock-to-service logic drift. |
 | **T4** | **Hardware Safety Audit** | **CRITICAL** | ✅ Complete | Hardened FSM against mic lock-ups during rapid concurrent recording cycles. |

## 🌎 Nightly CI Harmonization & Live Validation ✅ COMPLETE

> **Goal:** Consolidate fragmented CI workflows into a single tiered quality gate and run verified high-integrity suites.

| ID | Title | Priority | Status | Notes |
|----|-------|----------|--------|-------|
| **L1** | **Tiered Quality Gate** | **CRITICAL** | ✅ Complete | Consolidated `nightly-stt-serial`, `dev-real-integration`, and ad-hoc scripts into a unified `test-audit.sh` pipeline: Preflight → Lint → Typecheck → Unit → Build → E2E (4 shards). |
| **L2** | **Test Category Consolidation** | **HIGH** | ✅ Complete | Superseded legacy per-phase test trackers. New execution routine: `pnpm ci:full:local` (simulate) and `pnpm test:all:local` (quick). Unit: 556 tests passing. E2E: 17 tests across 4 shards. |
| **L3** | **Drift Guardian** | **HIGH** | ✅ Complete | `drift-detector.spec.ts` verifies STT engine contract signatures and store observability via E2E bridge. Fixed `SecurityError` on `about:blank` by adding `programmaticLoginWithRoutes` to `beforeEach`. |
| **L4** | **CI Test Stabilization** | **HIGH** | ✅ Complete | Resolved all pre-existing test failures: 4 unit (testId/title/class/mock mismatches), 3 e2e (drift-detector, diag-private-stt, private-stt download text). Added elapsed time reporting to `ci-simulate` stage. |
| **L5** | **Nightly WER Suite** | **HIGH** | 🟡 In Progress | Scheduling `wer-baseline.spec.ts` against real Cloud/Private engines. Requires live API keys in CI secrets. |
| **L6** | **Live Drift Monitoring** | **MEDIUM** | 🟡 In Progress | `drift-detector.spec.ts` now runs in sharded CI. Alerting on API contract changes deferred to nightly cron trigger. |
| **L7** | **E2E Stabilization (70/70)** | **CRITICAL** | ✅ Complete | Resolved all persistent flakiness in VAD, Mutex, and Tier Limit tests. Achieved 100% pass rate on full 70-test suite. |

## 🚀 v1.4.2 Release Hardening (Mar 2026) ✅ COMPLETE

> **Goal:** Finalize the v1.4.2 production release with absolute technical synchronization and CI stabilization.

| ID | Title | Priority | Status | Notes |
|----|-------|----------|--------|-------|
| **R1** | **CI Restoration Standard** | **CRITICAL** | ✅ Complete | Migrated from `script` to `tee` for reliable TTY logging without JSON corruption. |
| **R2** | **Engine-Aware Tracking** | **CRITICAL** | ✅ Complete | Implemented Pattern 28 for accurate tier enforcement across all STT engines. |
| **R3** | **UI-First State Reversion** | **HIGH** | ✅ Complete | Pattern 27 implemented for sub-second UI responsiveness during engine teardown. |
| **R4** | **Documentation Audit** | **HIGH** | ✅ Complete | Synchronized all 7 core markdown files to v1.4.2 SSOT standard. |
| **R5** | **70/70 E2E Success** | **CRITICAL** | ✅ Complete | Achieved 100% reliability across the full sharded Playwright suite. |

---

## 🚀 Phase 6: Performance & Architecture Consolidation (Mar 2026) ✅ COMPLETE

> **Goal:** surgical application of performance patches and enforcement of strict domain boundaries.

| ID | Title | Priority | Status | Notes |
|----|-------|----------|--------|-------|
| **P6.1** | **O(N) Dashboards** | **HIGH** | ✅ Complete | Refactored `AnalyticsDashboard.tsx` filtering logic from O(M*N) to O(N) using memoized Sets (#726). |
| **P6.2** | **Domain Mapping Layer** | **CRITICAL** | ✅ Complete | Migrated DB mapping (snake_case) to `goalsService`, decoupling Hooks from schema (#727). |
| **P6.3** | **Analytics Aggregation Fix** | **HIGH** | ✅ Complete | Optimized `analyticsUtils.ts` by consolidating redundant reduce operations and calculations (#728). |
| **P6.4** | **README Hardening** | **CRITICAL** | ✅ Complete | Documented "Dead Environment" recovery steps and clarified TIA test taxonomy. |

---

## 🤖 System Integrity & Agent-Loop Formalization (Mar 2026) ✅ COMPLETE

> **Goal:** Solidify system reliability via strict test governance and formalize the infrastructure for autonomous AI agents to safely interact with the CI loop.

| ID | Title | Priority | Status | Notes |
|----|-------|----------|--------|-------|
| **A1** | **System Integrity Audit** | **CRITICAL** | ✅ Complete | Fixed flaky `auth.e2e.spec.ts` (Behavioral logic) and `private-stt.live.spec.ts` (Explicit DOM signals). |
| **A2** | **Agent-Safe Interface (`test:agent`)** | **HIGH** | ✅ Complete | Established strict, live-service-free suite (`test:agent`) outputting stable JSON for agent consumption. |
| **A3** | **TIA Dependency Map** | **HIGH** | ✅ Complete | Implemented `test-impact-map.json` and `detect-impact.mjs` for surgical testing. |
| **A4** | **Node Orchestrator (`run-ci.mjs`)**| **HIGH** | ✅ Complete | Built script to execute impacted tests and format output for AI parsing. |

### B. Analytics & AI Insights (STT Accuracy vs Benchmark)
| ID | Title | Priority | Status | Description |
|----|-------|----------|--------|-------|
| **B1** | **Accuracy Signal Strategy** | **HIGH** | ✅ Complete | Selected Path A: Client-Side Dynamic Comparison against static JSON config. |
| **B2** | **Harvard Sentence Baselines** | **HIGH** | ✅ Complete | Created `harvard-sentences.ts`, generated 16kHz audio fixtures, and implemented `benchmark-*.mts` Node.js runners using `tsx`. |
| **B3** | **STTAccuracyVsBenchmark**   | **HIGH** | ✅ Complete | Built Recharts component for plotting dynamic accuracy vs config ceiling. |
| **B4** | **Hook Integration**         | **HIGH** | ✅ Complete | Updated `useAnalytics` and DB to track active `engine` per session. |
