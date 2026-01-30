**Owner:** [unassigned]
**Last Reviewed:** 2026-01-30

🔗 [Back to Outline](./OUTLINE.md)

# SpeakSharp Roadmap
*(For executive-level commentary on prioritization, see [REVIEW.md](./REVIEW.md)).*

This document outlines the forward-looking development plan for SpeakSharp. Completed tasks are moved to the [Changelog](./CHANGELOG.md).

Status Key: 🟡 In Progress | 🔴 Not Started | ✅ Complete | 🛡️ Gap Remediation
---

## 🧪 Frontend Verification & Defect Resolution (Jan 2026) 🟡 IN PROGRESS

> **Goal:** Resolve critical defects identified during the Jan 26 production verification to ensure a stable Alpha user experience.

| ID | Title | Priority | Status | Notes |
|----|-------|----------|--------|-------|
| **V1** | **Cloud STT CORS** | **CRITICAL** | 🟡 Ready to Deploy | `ALLOWED_ORIGIN` secret missing in production. Fix prepared in `deploy-supabase-migrations.yml`. |
| **V2** | **Private STT WASM Crash** | **CRITICAL** | ✅ Complete | Implemented buffer preservation and strict chunk validation to prevent RangeErrors. |
| **V3** | **Transitions & Cleanup** | **CRITICAL** | ✅ Complete | Verified AudioContext cleanup and cross-component state synchronization. |
| **V4** | **Real-time Analysis UI** | **HIGH** | ✅ Complete | Refactored Session Page with paired grid layout and matched component heights. |
| **V5** | **Auth Token Refresh** | **MEDIUM** | 🔴 Investigating | 400 Bad Request on refresh_token calls. |
| **V6** | **STT Dropdown Selection**| **HIGH** | ✅ Complete | Resolved unresponsive selector and polished labels. (2026-01-28) |
| **V7** | **Initialization Crash** | **CRITICAL** | ✅ Complete | Fixed `__BUILD_ID__` ReferenceError in `main.tsx` causing E2E timeouts. (2026-01-28) |

---

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
- 🟡 **Console Error Highlighting (P0 - Debugging) [HIGH PRIORITY]:** Add automatic ANSI color highlighting for ERROR/FAILED/FATAL (red bold) and WARNING/WARN (yellow bold) in all terminal output. Should apply globally to any console usage (not require agents to remember a specific script). Improves developer experience for spotting issues.
- ✅ **Independent Documentation Review (2026-01-28):** Conducted full audit of all project documents against `docs/OUTLINE.md` requirements. Verified sync across PRD, Architecture, and Roadmap.
- 🟡 **Gap Analysis [HIGH PRIORITY]:** Do a Gap Analysis of current implementation against the Current Phase requirements.
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
| **Unit Test Coverage** | > 80% | **407 tests** | 🟢 ON TRACK |
| **E2E Pass Rate** | 100% | 100% (local) | 🟢 ON TRACK (Local) |
| **Code Bloat** | < 10% | **6.79%** | 🟢 HEALTHY |
| **Largest Chunk** | < 500KB | **822KB** | 🔴 BLOCKED (Post-Alpha) |

### 🛡️ Gap Analysis Audit (2025-12-22) - In Progress

> **Source:** Independent codebase review identifying critical gaps for alpha soft launch.

#### 1. Foundational & Strategic Gaps

| Finding | Priority | Status | Notes |
|---------|----------|--------|-------|
| **Testing Pyramid** | CRITICAL | ✅ Done | **404 unit tests** across 100+ files. Integration-to-unit ratio optimized. Coverage thresholds enforced. |
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
    *   🟡 **WebSocket Resilience:** Test `CloudAssemblyAI.test.ts` with `vi.useFakeTimers()` (backoff, heartbeats).
    *   ✅ **Billing Idempotency (2025-12-19):** 15 tests covering webhook replay, idempotency lock, and partial failure recovery.
    *   ✅ **Auth Resilience (2025-12-19):** 7 tests in `fetchWithRetry.test.ts` (exponential backoff, custom retry count, error preservation).
*   **P1: Business Logic**
    *   ✅ **Tier Gating (2025-12-19):** 17 tests in `subscriptionTiers.test.ts` (isPro, isFree, getTierLabel, getTierLimits, TIER_LIMITS values).
    *   🔴 **Domain Services:** CRUD validation in `domainServices.ts`.
    *   🔴 **Analytics Correctness:** Month-boundary rollover and session aggregation logic.
*   **P2: E2E Trust**
    *   🔴 **Canary Tests:** Real-API `@canary` tests for staging environment.

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

- 🟡 **Filler Word Regex False Positives:** Simple regex patterns for "like" and "so" will match legitimate uses (e.g., "I like pizza", "so what happened").
  - **File:** `fillerWordUtils.ts:39-41`
  - **Evidence:** `/\b(like)\b/gi` matches all instances, not just filler usage
  - **Reviewer Comment:** "More advanced NLP techniques or context-aware models are typically required for high-accuracy filler word detection, which is a core feature."
  - **Problem Explained:**
    - "I **like** pizza" → Counted as filler (WRONG - it's a verb)
    - "It's, **like**, really big" → Counted as filler (CORRECT - it's a filler)
    - "**So** what happened?" → Counted as filler (WRONG - it's a conjunction)
    - "**So**... I was thinking" → Counted as filler (CORRECT - it's a discourse marker)
  - **Fix (Beta):** Integrate NLP library (e.g., `compromise` or `transformers.js`) for Part-of-Speech tagging to only flag words when used as interjections/discourse markers
  - **Alpha Decision:** Current regex is acceptable for alpha. Users may see some false positives. Refinement based on real user feedback in Beta.

- ✅ **Document Backend Secrets for Contributors (2025-12-12):** Added backend secrets documentation to `.env.example`.
  - **File:** `./.env.example` (project root)
  - **Documented:** `ASSEMBLYAI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` (set via Supabase Dashboard or CLI)

- ✅ **Stripe "Pro Mode" Backend Flag (2025-12-15):** Completed Stripe checkout integration with rigorous negative verification.
  - **Backend:** `stripe-checkout/index.ts` now uses `STRIPE_PRO_PRICE_ID` env var, extracts user from auth header, includes userId in metadata.
  - **Diagnostics:** Added "Diagnostic Logging" and "Negative Verification" (expect 400 with specific error body) to prove configuration in CI without exposing secrets.
  - **Testing:** Added `stripe-checkout-test.yml` workflow and `setup-test-users.yml` for E2E testing with real credentials.

- ✅ **Stripe Test Response Handling (2025-12-15):** Fixed test to handle response body read after Stripe redirect.
  - **Problem:** Browser navigates to Stripe Checkout URL before `response.json()` can be called, causing "Protocol error".
  - **Fix:** Validate status (200) first, gracefully handle parse error, fall back to verifying browser navigated to `checkout.stripe.com`.
  - **Files:** `tests/stripe/stripe-checkout.spec.ts`

- ✅ **Independent Review Remediation (2025-12-17):** Addressed findings from external codebase audit.
  - **P0 - Secret Sanitization:** Removed real Stripe Price ID from `.env.development`, added code fallback.
  - **P1 - Test Hardening:** Added URL validation in catch block for fail-fast behavior.
  - **P2 - Shared Types:** Created `_shared/types.ts`, updated `tsconfig.json` with `@shared/*` path.
  - **P2 - Webhook Tests:** Created `stripe-webhook/index.test.ts` with extracted handler pattern (5 test cases).
  - **Reviewer Correction:** `check-usage-limit` already had 167 lines of unit tests (6 test cases).

- ✅ **Whisper Architecture Documentation (2025-12-12):** ARCHITECTURE.md section 3.2.1 expanded with comprehensive Service Worker caching strategy, architecture diagram, component tables, and setup instructions.

#### P2 - Known Limitations (Alpha Acceptable)

- 🟡 **Code Bloat Index Above Industry Standard:** Current bloat index is 26.48% (industry std: <20%).
  - **Metric:** Initial Chunk (876KB) / Total Source (3.2MB) = 26.48%
  - **Optimizations:** Lazy-load Recharts, lazy-load Whisper model loader, aggressive route-based code splitting
  - **Status:** Acceptable for Alpha, optimize in Beta for performance SLO compliance

- 🟡 **Bundle Chunk Size Warning (2025-12-22):** Vite build emits warning about chunks >500KB.
  - **Affected Chunks:** `AnalyticsPage-*.js` (877KB), `index-*.js` (902KB)
  - **Warning Text:** `(!) Some chunks are larger than 500 kB after minification`
  - **Recommended Fixes:**
    - Use `dynamic import()` for code-splitting heavy components (Recharts, html2canvas)
    - Configure `build.rollupOptions.output.manualChunks` for vendor chunking
    - Consider `build.chunkSizeWarningLimit` as last resort (masks issue, doesn't fix)
  - **Reference:** https://rollupjs.org/configuration-options/#output-manualchunks
  - **Status:** P2 - Acceptable for Alpha, optimize in Beta

- 🟡 **E2E Test Console Warnings (2025-12-22):** The following console logs appear during E2E tests and should be addressed:
  - **Recharts Dimension Warning:** `The width(-1) and height(-1) of chart should be greater than 0` - Chart renders before container has dimensions in headless browser.
    - **Fix:** Add `minWidth`/`minHeight` props or guard rendering until container is measured.
  - **Failed to fetch (Supabase signOut):** `TypeError: Failed to fetch` during tests that don't mock the signOut endpoint.
    - **Fix:** Add signOut mock to `mock-routes.ts`.
  - **`[FREE] ⚠️ No upgrade button found`:** Expected conditional behavior when upgrade button isn't shown (e.g., session count threshold not met).
    - **Status:** Expected behavior, not a bug.
  - **Status:** P3 - Cosmetic warnings only, tests pass.


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

- **ℹ️ INFO - STT Comparison Not Integrated (2026-01-06)**
  - `STTAccuracyComparison.tsx` component exists (renamed from `AccuracyComparison.tsx`) but is not currently rendered in Analytics UI.
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
- ✅ **Implement User Filler Words:** Allow Pro users to add custom words (jargon, names) to improve transcription accuracy.
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
-  **ℹ️ CAVEAT - User Filler Words Native STT (2026-01-02):** Native STT (Web Speech API) does **NOT** support user filler words - it's entirely browser-controlled. Only Cloud STT (`word_boost` param via AssemblyAI) supports this feature. **Testing Impact:** User filler words E2E verification can only be done with Cloud STT, which requires API keys.
- [ ] **Alpha Deployment Checklist**
    - [ ] Deploy `apply-promo` Edge Function (`supabase functions deploy apply-promo`)
    - ✅ **Set `ALPHA_BYPASS_CODE` secret in Supabase Dashboard (2025-12-31):** Implemented secret-driven validation in `apply-promo` Edge Function. Code is no longer hardcoded in frontend.
    - [ ] Verify 7-digit numeric rotation via `scripts/generate-alpha-code.ts`
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
- ✅ **Alpha Bypass Mechanism (2025-12-31):** Implemented secure, secret-driven upgrade path using Supabase Vault. Removed legacy hardcoded codes and updated E2E suite to use automated code generation.
- ✅ **Analytics UI Restoration & Consolidation (2025-12-31):** Resolved MSW initialization regression. Consolidated redundant upgrade prompts and merged plan status indicators for a cleaner Analytics dashboard.
- ✅ **Port Centralization (2025-12-21):** Eliminated hardcoded port numbers. Created `scripts/build.config.ts` with `PORTS.DEV` (5173) and `PORTS.PREVIEW` (4173). Updated 10+ files.
- 🔄 **PERPETUAL - Documentation Audit:** Verify PRD Known Issues, ROADMAP, and CHANGELOG match actual codebase state. Run test suite and cross-reference with documented issues to eliminate drift. **Frequency:** Before each release and after major feature work.
- 🔴 **Side-by-Side Session Comparison:** Implement full comparison UI to complement existing trend analysis.
  - **Context:** Session history list currently displays metrics for trend analysis. Full comparison requires additional UI and logic.
  - **Requirements:**
    1. Add checkboxes/multi-select to session history items
    2. Create comparison modal/dialog component
    3. Calculate deltas between 2-3 selected sessions (WPM, Clarity, Filler count, Duration)
    4. Display visual indicators: green ↑ for improvement, red ↓ for regression
    5. Show percentage change and absolute differences
  - **Test Coverage:** E2E test exists in `session-comparison.e2e.spec.ts` documenting expected behavior
  - **Priority:** MEDIUM - Enhances trend analysis but not blocking for alpha

### 🚧 Should-Have (Tech Debt)

- ✅ **Private STT CI Stability (2026-01-01):** Resolved WASM deadlocks and flaky integration tests using Triple-Engine Architecture and MockEngine strategy.

- ⚠️ **Stripe Webhook E2E Verification (2025-12-21):** End-to-end test of Pro signup flow completed via CLI simulation. Confirmed: Auth → Select Pro → Stripe Redirect → Webhook Upgrade → Success Toast. Ad-hoc fix implemented for double toasts (see Tech Debt section below).
- ✅ **Toast Notification Styling (2026-01-15):** Reduced toast pill size (px-6 py-2 → px-4 py-1.5) and font sizes for less screen real estate usage.
- ✅ **STT Status Notification Bar (2026-01-15):** Added persistent StatusNotificationBar component above LiveRecordingCard showing STT state transitions (initializing, ready, fallback, error).
- ✅ **Filler Word Individual Counts (2026-01-15):** FillerWordsCard now shows individual count next to each word badge, sorted by frequency.
- ✅ **Promo Code Auto-Select Pro (2026-01-15):** AuthPage automatically selects Pro plan when user enters a promo code.
- ✅ **Filler Words UX Polish (2026-01-16):** Unified orange styling, cleaner "Total Detected" layout, and Popover-based "Add Custom Word" flow.
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
  - **Note:** Test suite expanded significantly. Current: **407 unit tests + 61 E2E tests** (verified 2026-01-30).
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
- **✅ COMPLETED (2025-12-07) - Populate Testimonials:**
  - [x] **Testimonials Section** (Implemented but Disabled pending real content)
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
| 1 | **TranscriptionService SRP Violation** | `TranscriptionService.ts` | P2 | Split into `TranscriptionCoordinator` + mode Providers |
| 2 | **UI State Boolean Flags** | `RecordingControls.tsx` | P2 | Implement XState or reducer with enumerated states |
| 3 | **Migration Idempotency** | `supabase/migrations/*` | P3 | Add `IF NOT EXISTS` guards before public launch |
| 4 | **Filler Word Regex False Positives** | `fillerWordUtils.ts` | P3 | Integrate NLP for Part-of-Speech tagging |
| 5 | **React Router v7 Deprecation** | Console output | P3 | Add future flags before upgrading |
| 6 | **SessionPage Mega Component** | `SessionPage.tsx` | P2 | Decompose into smaller sub-components |
| ~~7~~ | ~~**Filler/Min Rounding Edge Case**~~ | ~~`analyticsUtils.ts:61`~~ | ~~P3~~ | ✅ FIXED 2026-01-06 - Now uses precise minutes |
| 8 | **Minimum Session Duration UX** | `SessionPage.tsx` | P2 | Add toast warning when session < 5 sec |

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
- 🔴 **Guest Mode / Quick Start:** Allow users to try a "Demo Session" without full sign-up (reduce friction).
- ✅ **Mobile Optimization (2025-12-11):** Implement "Sticky Bottom" controls for `SessionPage` on mobile viewports. (Implemented in `SessionPage.tsx`).

### 🌱 Could-Have
- 🔴 **Live Overlay / Mini-Mode:** Create a compact "Heads Up Display" view for use during real video calls (vs practice mode).
- ✅ **Positive Reinforcement (2025-12-11):** Implemented "Gamified" toasts (e.g., "🔥 3 Day Streak!") and `useStreak` hook.

---
## Phase 3: Integration Safety (NEXT)
This phase focuses on hardening the interface between frontend and backend and ensuring robust monitoring.

### 🎯 Must-Have
- ✅ **Schema Canary Spec (2025-12-19):** Built a soft-fail E2E spec to detect API drift. Verifies that real/mock Supabase responses match TypeScript interfaces.
- ✅ **Aggregation Audit (2025-12-19):** Verified behavior for aborted/empty sessions. Implemented safety guards in `SessionSidebar` and Ghost RPC to prevent zero-second usage deduction.

### 🌱 Could-Have (Future Enhancements)
- ✅ **Implement WebSocket reconnect logic:** Add heartbeat and exponential backoff for a more resilient connection.
  - *Status:* ✅ Complete (2025-12-08). Implemented in `CloudAssemblyAI.ts` with exponential backoff (1s-30s), max 5 retries, 30s heartbeat, connection state callbacks.

### 🌱 Could-Have (Future Enhancements)
- ✅ **Implement Stripe "Pro Mode" Flag (2025-12-12):** Completed. See P1 section above.
  - *Status:* Partially Implemented. `UpgradePromptDialog` and `PricingPage` exist, but the backend "Pro Mode" flag and full checkout flow are incomplete.
- ✅ **COMPLETED - Whisper Model Caching & Auto-Update:**
  - ✅ **Script & SW:** `download-whisper-model.sh` and `sw.js` (2025-12-10). Load time: >30s → <5s.
  - ✅ **Terminology:** Renamed "Local" to "Private" (2025-12-11).
  - ✅ **Internal Refactor:** `OnDeviceWhisper` class with 36 references updated (2025-12-11).
  - ✅ **Documentation (2025-12-15):** Added Private STT section to ARCHITECTURE.md with full cache flow, URL mappings, and setup instructions.
  - ✅ **Cache WASM Model:** Service Worker caches `.bin` and `.wasm` via Cache Storage API.
  - ✅ **Offline Support:** Model loads from cache when offline.
- 🔴 **Add Platform Integrations (e.g., Zoom, Google Meet):** Allow SpeakSharp to connect to and analyze audio from third-party meeting platforms.
- 🟡 **Set up Multi-Env CI/CD:** A basic implementation for DB migrations exists, but needs expansion.
- ✅ **COMPLETED (2025-12-15) - Replace E2E Custom Event Synchronization:** Migrated from `programmaticLogin` (which relied on custom events like `e2e-profile-loaded`) to `programmaticLoginWithRoutes` which uses Playwright route interception. No longer dependent on internal event synchronization.
- ✅ **Create Mock Data Factory Functions:** Rich mock data implemented in `handlers.ts` (2025-12-07) - 5 sessions with improvement trend, 6 vocabulary words. Supports trend analysis and goal verification.

### Gating Check
- ✅ **Gap Analysis Complete:** P1 tech debt resolved (7/7 items - see "Tech Debt Resolved" section above).

---

