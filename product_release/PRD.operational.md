**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18 
**Last Updated:** 2026-05-07

# SpeakSharp Operational PRD (The Contract)

This document defines the user-visible guarantees, failure behaviors, and operational constraints that the SpeakSharp platform MUST satisfy for the v0.6.18 release.

---

## 1. User-Visible Guarantees (The Contract)

### Core Persistence & Reliability
- **Privacy-First Session Persistence**: Every finalized recording session MUST result in a persisted `sessions` record containing metadata, metrics, counts, and analysis artifacts needed for history. Full transcript text MUST NOT be stored in Supabase; it remains in client memory for same-session report/PDF generation.
- **Quotas Enforced**: Users are strictly capped at their daily and monthly limits (1h/day Free, 2h/day Pro).
- **Billing Behavior**: Pro features MUST unlock within 10 seconds of a successful Stripe checkout.
- **Export Reliability**: PDF exports MUST reflect the active client-side transcript/report state and persisted session metrics available at export time.
- **Privacy Guarantees**: Private STT audio data MUST NOT leave the user's browser.
- **STT Mode Consent**: Private STT MUST NOT silently switch to Cloud STT. Cloud is a first-class Pro choice, but it requires explicit user selection.
- **Cloud Boost**: When the user explicitly selects Cloud STT, user-specific vocabulary/custom words MAY be sent to AssemblyAI as `keyterms_prompt` to improve transcript accuracy for that user.

### UX Expectations
- **Supported Browsers**: Chrome (Desktop), Safari (Desktop/iOS).
- **Offline Mode**: Private STT requires an initial download but must function without internet thereafter.
- **CI Reporting**: Local CI/SQM scripts print generated coverage and quality metrics to the console. Markdown coverage tables are not automatically rewritten during local runs.

---

## 2. Failure Behavior (Operational Hardening)

| Scenario | Contracted Behavior |
| :--- | :--- |
| **Quota Service Unavailable** | **Fail-Closed**: No new sessions allowed if limit check fails. |
| **Model Download Failure** | Notify user, allow Private CPU/Native fallback where permitted, or block with retry. Do not silently route Private users to Cloud. |
| **Stripe Webhook Delayed** | Keep user as Free until confirmed; do not grant optimistic Pro access. |
| **Transcription Silence** | Heartbeat watchdog MUST trigger auto-reconnect or failure state within 8s. |
| **Database Latency** | UI MUST show "Saving..." spinner until RPC confirms persistence. |
| **PDF Export** | Do not block or count PDF exports for Free/basic users. All exported PDFs, including Pro exports, include SpeakSharp watermarking/branding. |

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
- **Conversion Rate**: Target 2% from Free to Pro.
- **STT Accuracy**: WER < 10% for Private, < 8% for Cloud.
- **Retention**: > 30% Day-7 retention for active practitioners.
