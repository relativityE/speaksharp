**Owner:** [Unassigned]
**Last Reviewed:** 2025-09-05

🔗 [Back to Outline](./OUTLINE.md)

# SpeakSharp Roadmap
*(For executive-level commentary on prioritization, see [REVIEW.md](./REVIEW.md)).*

This board provides a two-dimensional view of our project tasks, combining Phased Milestones (timeline) with MoSCoW Prioritization.

Status Key: ✅ Done | 🟡 In Progress | 🔴 Not Started
---
## Phase 1: Stabilize & Harden the MVP
This phase focuses on fixing critical bugs, addressing code health, and ensuring the existing features are reliable and robust. (Timeline: Extended by 1-2 weeks to ensure all Must-Haves are 100% complete before GTM).

### 🎯 Must-Have
- 🔴 **Implement On-Device 'Local Transcript' Mode:** Implement a fully on-device, privacy-first transcription mode for Premium users. (See [Architecture: Transcription Service](./ARCHITECTURE.md#5-transcription-service))
  - 🔴 1. Research & Select Model: Choose a suitable on-device speech recognition model (e.g., from Transformers.js, Whisper WASM) that balances performance and accuracy.
  - 🔴 2. Create LocalWhisper Provider: Build a new provider class within the TranscriptionService that conforms to the existing service interface.
  - 🔴 3. Integrate Model & Audio Processing: Implement the logic to load the selected model into the provider and process audio chunks locally.
  - 🔴 4. Add UI Selector: Create a UI control for Premium users to select the 'Local Transcript' mode.
  - 🔴 5. E2E Testing & Hardening: Write comprehensive tests and harden the feature for production use.
- 🔴 **Harden and Polish the Native Transcription Experience:** Improve the reliability and UX of the default NativeBrowser (cloud-based) mode.
- 🟡 **Update E2E tests for v3 transcription flow:** This is currently blocked by the E2E environment instability.
- 🔴 **Add full unit test coverage for `CloudAssemblyAI.js`:** Target ≥80% coverage for core logic.
- ✅ **Stabilize the Vitest test suite:** The suite is now stable, with all 87 tests passing and the root memory leak fixed.

### 🚧 Should-Have (Tech Debt)
- 🔴 **Create Troubleshooting Guide:** Add error recovery steps to the documentation.
- 🔴 **Implement "Free User Quota" E2E test:** Close the critical gap in monetization flow testing.
- 🔴 **Refactor Integration Tests:** Slim down component tests (`SessionSidebar`, `AnalyticsPage`, etc.) to remove redundant coverage now handled by E2E tests.
- 🔴 **Enhance Anonymous and Pro E2E tests:** Update existing E2E tests to cover the full "golden path" for each role.
- 🔴 **Isolate developer-only E2E tests:** Move the 'cloud mode' test to a separate suite to prevent test pollution.

### Gating Check
- 🔴 **Bring all documentation up to date to reflect latest/current code implementation**
- 🔴 **Do a Gap Analysis of current implementation against the Current Phase requirements.**

---
## Phase 2: User Validation & Polish
This phase is about confirming the core feature set works as expected and polishing the user experience before wider release.

### 🎯 Must-Have
- 🔴 **Implement Speaking Pace Analysis:** Add real-time feedback on words per minute to the core analytics.
- 🔴 **Implement Vocal Variety / Pause Detection:** Add a new Pro-tier feature to analyze vocal variety or pause duration, enhancing the value of the paid subscription.
- ✅ **Explicit Mode Indication in UI:** The UI must be unambiguously clear about which transcription mode (Native vs. Cloud vs. Local) is active at all times.
- 🔴 **User-Friendly Error Handling:** Implement specific, user-facing error messages for common issues (e.g., WebSocket disconnects, token failures).
- 🔴 **Deploy & confirm live transcript UI works:** Ensure text appears within 2 seconds of speech in a live environment.
- 🔴 **Remove all temporary console.logs:** Clean up the codebase for production.
- ✅ Implement Universal Navigation: Add a consistent, mobile-first sidebar navigation accessible from all pages.
- ✅ Implement Analytics Page UI Components: Add the session status box and a developer checkbox for forcing cloud AI.

### 🚧 Should-Have (Tech Debt)
- 🟡 **Implement new SpeakSharp Design System:** (See [Architecture: Design System](./ARCHITECTURE.md#2-frontend-architecture))
  - ✅ 1. Configure Core Theme & Test
  - ✅ 2. Create Component Plugins & Test
  - 🟡 3. Refactor UI Components & Test
  - 🔴 4. Final Verification & Test
- ✅ **Add Robust UX States:** For error, loading, and empty transcript scenarios.
- 🔴 **Improve Accessibility:** Use an ARIA live region for the transcript so screen readers can announce new lines.
- 🔴 **Add Deno unit tests for the token endpoint:** Ensure the assemblyai-token function is fully covered.
- 🔴 **Add a soak test:** Create a test that runs for 1-minute with continuous audio to check for memory leaks or hangs.
- 🔴 **Create e2e tests for different user roles (anonymous, free, pro):** To validate the user flows for each subscription tier. (See [PRD: User Roles & Flows](./PRD.md#user-roles-&-flows))

### Gating Check
- 🔴 **Bring all documentation up to date to reflect latest/current code implementation**
- 🔴 **Do a Gap Analysis of current implementation against the Current Phase requirements.**

---
## Phase 3: Extensibility & Future-Proofing
This phase focuses on long-term architecture, scalability, and preparing for future feature development.

### 🎯 Must-Have
- 🔴 **Implement WebSocket reconnect logic:** Add heartbeat and exponential backoff for a more resilient connection.
- ✅ Implement new CVA-based Design System: Establish a new, comprehensive design system for all UI components.
- ✅ Reintroduce TranscriptionService abstraction: Place both cloud and local modes behind a single, unified service layer.

### 🌱 Could-Have (Future Enhancements)
- 🔴 **Add a Jitter Buffer & Audio Resampling Guard:** To gracefully handle unstable microphone inputs.
- 🔴 **Implement Stripe "Pro Mode" Flag:** For feature gating and usage-based billing.
- 🟡 **Set up Multi-Env CI/CD:** With preview deployments for staging and production. (Note: A basic implementation for DB migrations exists.)

### Gating Check
- 🔴 **Bring all documentation up to date to reflect latest/current code implementation**
- 🔴 **Do a Gap Analysis of current implementation against the Current Phase requirements.**
