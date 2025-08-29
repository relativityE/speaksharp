# SpeakSharp Project Board

This board provides a two-dimensional view of our project tasks, combining **Phased Milestones** (timeline) with **MoSCoW Prioritization**.

- **Status Key:** ✅ Done | 🟡 In Progress | 🔴 Not Started

---

## Phase 1: Stabilize & Harden the MVP

*This phase focuses on fixing critical bugs, addressing code health, and ensuring the existing features are reliable and robust.*

### 🎯 Must-Have

- ✅ **Fix cloud transcription connection:** Use correct v3 endpoint and handle raw PCM audio instead of JSON.
- ✅ **Fix data flow race condition:** Ensure session data is saved before navigation.
- ✅ **Fix state management & navigation bugs:** Resolved issues in the session page.
- ✅ **Stabilize the Vitest test suite:** All unit tests now pass without warnings.
- 🟡 **Update E2E tests for v3 transcription flow:** Currently blocked by test environment issues.
- 🔴 **Add full unit test coverage for `CloudAssemblyAI.js`:** Target ≥80% coverage for core logic.
- 🔴 **Add structured logging:** Implement for both frontend and backend.
- 🔴 **Reinstate session saving & analytics:** Ensure new v3 transcripts are stored correctly.

### 🚧 Should-Have (Tech Debt)

- ✅ **Improve toast notification styling:** Toasts are now pill-shaped with appropriate styling.
- ✅ **Improve loading/waiting state feedback:** The transcript panel now provides clearer UI feedback.
- 🔴 **Create Troubleshooting Guide:** Add error recovery steps to the documentation.

---

## Phase 2: User Validation & Polish

*This phase is about confirming the core feature set works as expected and polishing the user experience before wider release.*

### 🎯 Must-Have

- 🔴 **Deploy & confirm live transcript UI works:** Ensure text appears within 2 seconds of speech in a live environment.
- 🔴 **Remove all temporary `console.log`s:** Clean up the codebase for production. *(Note: This is required, but will be handled after all other 'must-have' features are implemented.)*

### 🚧 Should-Have (Tech Debt)

- 🔴 **Add more UX states:** For error, loading, and empty transcript scenarios.
- 🔴 **Improve Accessibility:** Use an ARIA live region for the transcript so screen readers can announce new lines.
- 🔴 **Add Deno unit tests for the token endpoint:** Ensure the `assemblyai-token` function is fully covered.
- 🔴 **Add a soak test:** Create a test that runs for 1-minute with continuous audio to check for memory leaks or hangs.

---

## Phase 3: Extensibility & Future-Proofing

*This phase focuses on long-term architecture, scalability, and preparing for future feature development.*

### 🎯 Must-Have

- 🔴 **Reintroduce `TranscriptionService` abstraction:** Place both cloud and local modes behind a single, unified service layer.
- 🔴 **Implement WebSocket reconnect logic:** Add heartbeat and exponential backoff for a more resilient connection.

### 🌱 Could-Have (Future Enhancements)

- 🔴 **Add a Jitter Buffer & Audio Resampling Guard:** To gracefully handle unstable microphone inputs.
- 🔴 **Implement Stripe "Pro Mode" Flag:** For feature gating and usage-based billing.
- 🔴 **Set up Multi-Env CI/CD:** With preview deployments for staging and production.
