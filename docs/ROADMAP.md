[← Back to Docs README](./README.md)

# SpeakSharp Roadmap
This board provides a two-dimensional view of our project tasks, combining Phased Milestones (timeline) with MoSCoW Prioritization.

Status Key: ✅ Done | 🟡 In Progress | 🔴 Not Started
---
## Phase 1: Stabilize & Harden the MVP
This phase focuses on fixing critical bugs, addressing code health, and ensuring the existing features are reliable and robust.

### 🎯 Must-Have
- 🔴 **Implement On-Device 'Local Transcript' Mode:** Implement a fully on-device, privacy-first transcription mode for Premium users. (See [Architecture: Transcription Service](./ARCHITECTURE.md#5-transcription-service))
  - 🔴 1. Research & Select Model: Choose a suitable on-device speech recognition model (e.g., from Transformers.js, Whisper WASM) that balances performance and accuracy.
  - 🔴 2. Create LocalWhisper Provider: Build a new provider class within the TranscriptionService that conforms to the existing service interface.
  - 🔴 3. Integrate Model & Audio Processing: Implement the logic to load the selected model into the provider and process audio chunks locally.
  - 🔴 4. Add UI Selector: Create a UI control for Premium users to select the 'Local Transcript' mode.
  - 🔴 5. E2E Testing & Hardening: Write comprehensive tests and harden the feature for production use.
- 🔴 **Harden and Polish the Native Transcription Experience:** Improve the reliability and UX of the default NativeBrowser (cloud-based) mode.
- ✅ **Implement Conditional Rendering for Missing Env Vars:** The app should not crash if environment variables are missing, but instead show a graceful "offline" or "configuration needed" state.
- ✅ **Add structured logging:** Implement for both frontend and backend to improve debuggability.
- 🟡 **Update E2E tests for v3 transcription flow:** This is blocked by a critical rendering failure in the Playwright environment.
- 🔴 **Add full unit test coverage for `CloudAssemblyAI.js`:** Target ≥80% coverage for core logic.
- ✅ Fix cloud transcription connection: Use correct v3 endpoint and handle raw PCM audio instead of JSON.
- ✅ **Fix Session History Data Flow:** Repaired the data flow between session creation and the analytics page to ensure new sessions are displayed correctly.
- ✅ **Implement Filler Word Table:** Replaced the 'Top Filler Words' bar chart with a more detailed table view.
- ✅ **Clean Up Analytics Page UI:** Removed unnecessary "Live Session" and "Developer Options" panels from the dashboard.
- ✅ Fix data flow race condition: Ensure session data is saved before navigation.
- ✅ Fix state management & navigation bugs: Resolved issues in the session page.
- ✅ **Stabilize the Vitest test suite:** The suite is now stable, with almost all previously disabled tests fixed and re-enabled.
- ✅ Fix CSS Build Process & Styling: Resolved a cascade of issues including incompatible build plugins, incorrect dependencies, and a disconnected theme.
- ✅ Reinstate session saving & analytics: Ensure new v3 transcripts are stored correctly.

### 🚧 Should-Have (Tech Debt)
- ✅ **Fix Test Suite Environment:** A parent task to investigate and fix the root causes of the test suite's instability.
  - ✅ 1. Diagnose Root Cause: The memory leak has been traced to the Supabase `onAuthStateChange` listener.
  - ✅ 2. Implement Code-Level Fix: A robust, prop-gated `AuthProvider` has been implemented to disable the listener in tests.
  - ✅ 3. Verify Fix & Re-enable Tests: The test environment has been stabilized by fixing caching, mocking, and component-level issues.
- ✅ Improve toast notification styling: Toasts are now pill-shaped with appropriate styling.
- ✅ **Tune Highlight Performance:** Reduced debounce timer on filler word counting to improve perceived responsiveness of live transcript highlighting.
- ✅ Improve loading/waiting state feedback: The transcript panel now provides clearer UI feedback.
- ✅ Add Page-Level Render Tests: Create a test for each main page (Home, Session, Analytics, Auth) to verify it renders without crashing.
- 🔴 **Create Troubleshooting Guide:** Add error recovery steps to the documentation.

### Gating Check
- 🔴 **Bring all documentation up to date to reflect latest/current code implementation**
- 🔴 **Do a Gap Analysis of current implementation against the Current Phase requirements.**

---
## Phase 2: User Validation & Polish
This phase is about confirming the core feature set works as expected and polishing the user experience before wider release.

### 🎯 Must-Have
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
