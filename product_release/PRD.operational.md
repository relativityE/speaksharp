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
- **Quotas Enforced**: Users are strictly capped at their daily and monthly limits (1h/day Free, 2h/day Pro).
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
- **Quality Evidence Reporting**: The PRD states product promises. Coverage, Lighthouse, bundle metrics, flaky counts, and stress/endurance evidence live in the operational evidence system, not in dynamically rewritten PRD sections.

---

## 2. Failure Behavior (Operational Hardening)

| Scenario | Contracted Behavior |
| :--- | :--- |
| **Quota Service Unavailable** | **Fail-Closed**: No new sessions allowed if limit check fails. |
| **Model Download Failure** | Notify user, show retry/setup status, and present Native or Cloud only as explicit user-selectable alternatives. Do not silently route Private users to Cloud. |
| **WebGPU Unsupported/Slow** | Continue through the launch default CPU/Transformers.js Private path. WebGPU probing must fail fast and must not make a user wait before CPU setup can proceed. |
| **Stripe Webhook Delayed** | Keep user on Free until confirmed; do not grant optimistic Pro access. |
| **Transcription Silence** | Heartbeat watchdog MUST trigger auto-reconnect or failure state within 8s. |
| **Database Latency** | UI MUST show "Saving..." spinner until RPC confirms persistence. |
| **PDF Export** | Do not block or count PDF exports for Free users. All exported PDFs, including Pro exports, include SpeakSharp watermarking/branding. |
| **Cloud Chunk Contract Violation** | Treat AssemblyAI `Input Duration Violation` / close code `3007` as an audio chunking defect until proven otherwise. Evidence must include chunk sample counts, WebSocket close code/reason, provider error text, and whether transcript callbacks reached the UI. |

---

## 3. Explicit Non-Goals (Launch Boundary)

- **Bluetooth Handoff**: Microphone switching during an active session is NOT guaranteed.
- **Safari Offline STT**: Performance on mobile Safari is considered experimental (Best Effort).
- **Multi-Tab Sync**: Concurrent recording in multiple tabs is explicitly BLOCKED via mutex.

---

## 4. Service-Level Expectations

Service-level definitions, target classification, industry comparisons, evidence sources, and current status live in `SERVICE_LEVELS.operational.md`. This PRD keeps the product-level intent only:

- Sessions interrupted by refresh should be recoverable when enough browser/session state still exists.
- PDF exports should be reliable from valid active transcript/report state and persisted session metrics.
- The primary recording path should remain available enough for controlled soft-release testers to complete the scripted human path.

---

## 5. Metrics & Success Criteria
- **Conversion Rate**: Target 2% from Free to Pro.
- **STT Accuracy**: WER < 10% for Private, < 8% for Cloud.
- **Cloud Live Proof**: Cloud release validation requires a live transcript against the canonical `.wav` fixture and matching ground-truth text. Token `200` and WebSocket open are readiness evidence only; success requires non-placeholder transcript text and WER < 8%.
- **Native Benchmark Boundary**: Native Browser STT is browser-dependent convenience STT. It is not a corpus-grade WER benchmark engine unless the exact fake/fixture audio route is separately proven to reach the browser recognizer.
- **Retention**: > 30% Day-7 retention for active practitioners.

---

## 6. Software Quality Evidence

Software quality targets, evidence taxonomy, raw artifact locations, and generated quality-evidence rules live in `SOFTWARE_QUALITY.operational.md`. Latest generated artifacts are produced under `product_release/evidence/` during CI and uploaded as workflow artifacts; they are not PRD content.
