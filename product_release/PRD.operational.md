**Owner:** [unassigned]
**Last Reviewed:** 2026-05-26
**Version:** v0.6.19-rc0
**Last Updated:** 2026-05-26

# SpeakSharp Operational PRD (The Contract)

> Contract document, not release status.
> Current ship posture, blockers, and latest run IDs live only in `RELEASE_STATUS.md`.

This document defines the user-visible guarantees, failure behaviors, and operational constraints that the SpeakSharp platform MUST satisfy for the v0.6.19-rc0 release.

---

## 1. User-Visible Guarantees (The Contract)

### Core Persistence & Reliability
- **Session Analysis Persistence**: Every finalized recording session MUST result in a persisted `sessions` record containing the analysis artifacts needed for returning-user comparison: transcript text, duration, total words, WPM, clarity, filler/custom word counts, pause metrics, AI suggestions when generated, STT engine/mode metadata, and optional ground-truth/WER fields. Transcript storage is required for WER, AI feedback cache, PDF regeneration, and session-over-session coaching until a separate redaction/encryption design is implemented.
- **Quotas Enforced**: Users are strictly capped at their daily and monthly limits (1h/day Basic, 2h/day Pro).
- **Billing Behavior**: Pro features MUST unlock within 10 seconds of a successful Stripe checkout.
- **Export Reliability**: PDF exports MUST reflect the active client-side transcript/report state and persisted session metrics available at export time.
- **Privacy Guarantees**: Private STT audio data MUST NOT leave the user's browser.
- **STT Mode Consent**: Private STT MUST NOT silently switch to Cloud STT. Cloud is a first-class Pro choice, but it requires explicit user selection.
- **Private STT Launch Policy**: Private STT is recommended/default for Pro users, but the v0.6.19-rc0 launch baseline prioritizes deterministic CPU/Transformers.js setup over WebGPU-first probing. WebGPU is an accelerated path only after support is verified; it is not required for first-use success.
- **Cloud Boost**: When the user explicitly selects Cloud STT, user-specific vocabulary/custom words MAY be sent to AssemblyAI as `keyterms_prompt` to improve transcript accuracy for that user.
- **Cloud Streaming Audio Contract**: Cloud STT MUST send AssemblyAI PCM audio chunks between 50 ms and 1000 ms long. At the declared 16 kHz sample rate, this means each binary WebSocket payload MUST contain 800-16000 samples. SpeakSharp uses 100 ms chunks (1600 samples) as the default live-microphone target. Sending raw browser callback frames directly is prohibited because tiny frames can be interpreted by AssemblyAI as invalid input duration and rejected before transcription.

### UX Expectations
- **Supported Browser Positioning**: Chrome desktop is recommended for Browser transcription. Availability and accuracy vary by browser. Edge/Safari/iOS must not be claimed as verified unless a browser-specific proof passes start, transcript, save, history/detail, and analytics.
- **Offline Mode**: Private STT requires an initial download but must function without internet thereafter.
- **CI Reporting**: Local CI/SQM scripts print generated coverage and quality metrics to the console. Markdown coverage tables are not automatically rewritten during local runs.

---

## 2. Failure Behavior (Operational Hardening)

| Scenario | Contracted Behavior |
| :--- | :--- |
| **Quota Service Unavailable** | **Fail-Closed**: No new sessions allowed if limit check fails. |
| **Model Download Failure** | Notify user, show retry/setup status, and present Native or Cloud only as explicit user-selectable alternatives. Do not silently route Private users to Cloud. |
| **WebGPU Unsupported/Slow** | Continue through the launch default CPU/Transformers.js Private path. WebGPU probing must fail fast and must not make a user wait before CPU setup can proceed. |
| **Stripe Webhook Delayed** | Keep user as Basic until confirmed; do not grant optimistic Pro access. |
| **Transcription Silence** | Heartbeat watchdog MUST trigger auto-reconnect or failure state within 8s. |
| **Database Latency** | UI MUST show "Saving..." spinner until RPC confirms persistence. |
| **PDF Export** | Do not block or count PDF exports for Basic/basic users. All exported PDFs, including Pro exports, include SpeakSharp watermarking/branding. |
| **Cloud Chunk Contract Violation** | Treat AssemblyAI `Input Duration Violation` / close code `3007` as an audio chunking defect until proven otherwise. Evidence must include chunk sample counts, WebSocket close code/reason, provider error text, and whether transcript callbacks reached the UI. |

---

## 3. Explicit Non-Goals (Launch Boundary)

- **Bluetooth Handoff**: Microphone switching during an active session is NOT guaranteed.
- **Safari Offline STT**: Performance on mobile Safari is considered experimental (Best Effort).
- **Multi-Tab Sync**: Concurrent recording in multiple tabs is explicitly BLOCKED via mutex.

---

## 4. SLO/SLA Expectations

- **Session Restoration**: 95% of sessions interrupted by refresh should be resumable.
- **Export Durability**: 99.9% success rate for PDF generation from valid active transcript/report state and persisted session metrics.
- **Uptime Assumption**: 99.5% availability for the primary recording path.

---

## 5. Metrics & Success Criteria
- **Conversion Rate**: Target 2% from Basic to Pro.
- **STT Accuracy**: WER < 10% for Private, < 8% for Cloud.
- **Cloud Live Proof**: Cloud release validation requires a live transcript against the canonical `.wav` fixture and matching ground-truth text. Token `200` and WebSocket open are readiness evidence only; success requires non-placeholder transcript text and WER < 8%.
- **Native Benchmark Boundary**: Native Browser STT is browser-dependent convenience STT. It is not a corpus-grade WER benchmark engine unless the exact fake/fixture audio route is separately proven to reach the browser recognizer.
- **Retention**: > 30% Day-7 retention for active practitioners.

---

<!-- SQM:START -->
## 6. Software Quality Metrics

**Last Updated:** 2026-05-15

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
| Total tests             | 706 (677 unit + 29 E2E) |
| Unit tests              | 677   |
| E2E tests (Playwright)  | 29  |
| Passing tests           | 705 (676 unit + 29 E2E)   |
| Failing tests           | 0   |
| Disabled/skipped tests  | 1   |
| Passing unit tests      | 676/677 (99.9%)   |
| Passing E2E tests       | 29/29 (100.0%)   |
| Total runtime           | 4m 28s   |

---

### Coverage Summary

| Metric     | Value |
| ---------- | ----- |
| Statements | 67.62%   |
| Branches   | 74.89%   |
| Functions  | 67.51%   |
| Lines      | 67.62%   |

---

### Code Bloat & Performance

| Metric              | Value |
| ------------------- | ----- |
| Total Source Size   | 49M   |
| Total Project Size  | 2.9G   |
| Initial Chunk Size  | 416K   |
| Code Bloat Index    | 0.82%   |
| Lighthouse Scores   | P: 98, A: 94, BP: 100, SEO: 100 |

---
<!-- SQM:END -->
