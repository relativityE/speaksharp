# SpeakSharp Product Requirements Document

**Version 6.25** | **Last Updated: August 28, 2025**

## 1. Executive Summary

SpeakSharp is a **privacy-first, real-time speech analysis tool** designed as a modern, serverless SaaS web application. Its architecture is strategically aligned with the core product goal: to provide instant, on-device feedback that helps users improve their public speaking skills, while rigorously protecting their privacy.

The system is built for speed, both in user experience and development velocity. It leverages a **React (Vite)** frontend for a highly interactive UI and **Supabase** as an all-in-one backend for data, authentication, and user management.


## 2. Recent Updates (v6.25)
*August 28, 2025*
- **Full End-to-End Stability**: Resolved critical bugs related to state management, component lifecycle, and navigation that affected the core user flow.
- **Test Suite Revamp**: Overhauled the entire test suite. Fixed all failing tests, resolved all console warnings (`act`, `forwardRef`), and added a new suite of unit tests for the cloud transcription service. The test suite is now stable and reliable.
- **Improved UX**: The transcript panel now provides clearer feedback to the user about the microphone state.

---

## 3. Known Issues
- **[RESOLVED] All Critical Stability Issues:** A comprehensive series of fixes have been implemented to address all known critical bugs, including:
  - **Cloud Transcription Initialization:** Fixed incorrect client-side message parsing for the AssemblyAI v3 API.
  - **Vitest Suite Instability:** Corrected asynchronous test patterns and flawed mocks.
  - **E2E Test Environment:** Implemented a robust, "iron-clad" testing strategy to resolve a persistent rendering failure. The root cause was identified as third-party SDKs blocking the initial render. The fix involved creating a `testEnv.ts` shim to provide no-op versions of these SDKs during testing, ensuring a deterministic and stable E2E environment.
- **On-Device Transcription Needs Polish:** The `LocalWhisper` provider in `TranscriptionService` is a functional implementation using Transformers.js. However, it may require further UI/UX polishing for model loading feedback and error handling before it is production-ready.

---

## 4. Development Roadmap
This roadmap has been updated to track the stabilization and enhancement of the AssemblyAI v3 streaming transcription feature. The canonical source for this plan is [`PROJECT_BOARD.md`](./PROJECT_BOARD.md).

---

## 5. Software Quality Metrics

This section tracks key software quality metrics for the project. These are baseline measurements taken on August 26, 2025.

| Metric                        | Current Value | Industry Standard | Notes                                           |
| ----------------------------- | ------------- | ----------------- | ----------------------------------------------- |
| **Test Coverage (Lines)**     | `42.99%`      | `70-80%`          | Percentage of code lines executed by tests.     |
| **Code Bloat (Uncovered Code)** | `57.01%`      | `N/A`             | Percentage of code lines not covered by tests.  |
---

## 6. Metrics and Success Criteria

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
