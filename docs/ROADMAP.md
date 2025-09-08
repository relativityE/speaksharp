**Owner:** Jules
**Last Reviewed:** 2025-09-08

🔗 [Back to Outline](./OUTLINE.md)

# SpeakSharp Roadmap
*(For executive-level commentary on prioritization, see [REVIEW.md](./REVIEW.md)).*

This board provides a two-dimensional view of our project tasks, combining Phased Milestones (timeline) with MoSCoW Prioritization.

Status Key: ✅ Done | 🟡 In Progress | 🔴 Not Started
---
## Phase 1: Stabilize & Harden the MVP
This phase focuses on fixing critical bugs, addressing code health, and ensuring the existing features are reliable and robust. (Timeline: Extended by 1-2 weeks to ensure all Must-Haves are 100% complete before GTM).

### 🎯 Must-Have
- ✅ **Fix Critical Application Bugs (BLOCKING ALL PROGRESS):**
  - ✅ `[C-01]` Lack of Protected Routes: Implemented protected routes for all sensitive user pages.
  - ✅ `[C-02]` Flawed Auth Provider: Refactored `AuthContext.tsx` to remove anti-patterns and stabilize authentication logic.
  - ✅ `[C-03]` Anonymous User Flow is Broken: Fixed the session persistence logic for anonymous users.
  - ✅ `[C-04]` Premium Users Do Not Receive Paid Features: Corrected the monetization logic in `TranscriptionService.js`.
- ✅ **Technical Debt: Remediate and Stabilize the Test Suite**
  - **Resolution:** The test suite has been fully stabilized. The root causes of instability (Vite configuration conflicts, test race conditions) have been resolved. Unit and E2E tests now run reliably in parallel.
- ✅ **Implement "Free User Quota" E2E test:** An E2E test for the 'Free' user role has been added.

### 🚧 Should-Have (Tech Debt)
- 🔴 **Refactor Integration Tests:** Slim down component tests (`SessionSidebar`, `AnalyticsPage`, etc.) to remove redundant coverage now handled by E2E tests.
- 🔴 **Create Troubleshooting Guide:** Add error recovery steps to the documentation.
- ✅ **Enhance Anonymous and Pro E2E tests:** The E2E tests have been stabilized and now correctly test the full authentication flow.
- ✅ **Add full unit test coverage for `CloudAssemblyAI.js`:** All unit tests for this module are now passing.

### Gating Check
- ✅ **Bring all documentation up to date to reflect latest/current code implementation**
- 🔴 **Do a Gap Analysis of current implementation against the Current Phase requirements.**

---
## Phase 2: User Validation & Polish
This phase is about confirming the core feature set works as expected and polishing the user experience before wider release.

### 🎯 Must-Have
- ✅ **Implement On-Device 'Local Transcript' Mode (`[C-04]`):** Implemented a fully on-device, privacy-first transcription mode for Premium users using `@xenova/transformers`.
  - ✅ 1. Research & Select Model
  - ✅ 2. Create LocalWhisper Provider
  - ✅ 3. Integrate Model & Audio Processing
  - 🔴 4. Add UI Selector
  - ✅ 5. E2E Testing & Hardening
- 🔴 **Implement Speaking Pace Analysis:** Add real-time feedback on words per minute to the core analytics.
- 🔴 **Implement Vocal Variety / Pause Detection:** Add a new Pro-tier feature to analyze vocal variety or pause duration.
- ✅ **Explicit Mode Indication in UI:** UI elements are now accurate.
- 🔴 **User-Friendly Error Handling:** Implement specific, user-facing error messages for common issues.
- 🔴 **Deploy & confirm live transcript UI works:** Ensure text appears within 2 seconds of speech in a live environment.
- 🔴 **Remove all temporary console.logs:** Clean up the codebase for production.
- ✅ **Implement Universal Navigation:** The sidebar is now fully functional and accessible from all pages.
- ✅ **Implement Analytics Page UI Components:** Components are now fed by correct data flows.

### 🚧 Should-Have (Tech Debt)
- 🟡 **Implement new SpeakSharp Design System:** (See [Architecture: Design System](./ARCHITECTURE.md#2-frontend-architecture))
  - ✅ 1. Configure Core Theme & Test
  - ✅ 2. Create Component Plugins & Test
  - 🟡 3. Refactor UI Components & Test
  - 🔴 4. Final Verification & Test
- 🟡 **Add Robust UX States:** Some states exist, but are inconsistently applied.
- 🔴 **Improve Accessibility:** Use an ARIA live region for the transcript so screen readers can announce new lines.
- 🔴 **Add Deno unit tests for the token endpoint.**
- 🔴 **Add a soak test:** Create a test that runs for 1-minute with continuous audio to check for memory leaks or hangs.
- ✅ **Create e2e tests for different user roles (anonymous, free, pro).** E2E tests now exist for anonymous, free, pro, and premium user flows.

### Gating Check
- ✅ **Bring all documentation up to date to reflect latest/current code implementation**
- 🔴 **Do a Gap Analysis of current implementation against the Current Phase requirements.**

---
## Phase 3: Extensibility & Future-Proofing
This phase focuses on long-term architecture, scalability, and preparing for future feature development.

### 🎯 Must-Have
- 🔴 **Implement WebSocket reconnect logic:** Add heartbeat and exponential backoff for a more resilient connection.
- ✅ **Implement new CVA-based Design System:** The foundation is established.
- ✅ **Reintroduce TranscriptionService abstraction:** The service exists and provides an abstraction layer.

### 🌱 Could-Have (Future Enhancements)
- ✅ **Add a Jitter Buffer & Audio Resampling Guard:** A critical resampling bug has been fixed, improving stability.
- 🔴 **Implement Stripe "Pro Mode" Flag:** For feature gating and usage-based billing.
- 🟡 **Set up Multi-Env CI/CD:** A basic implementation for DB migrations exists, but needs expansion.

### Gating Check
- ✅ **Bring all documentation up to a-date to reflect latest/current code implementation**
- 🔴 **Do a Gap Analysis of current implementation against the Current Phase requirements.**
