**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18 
**Last Updated:** 2026-05-07

# Operational Architecture Invariants

This document defines the structural invariants and authoritative sources of truth for the SpeakSharp platform. These rules govern system behavior and take precedence over design patterns or implementation preferences.

---

## 🏛️ Authoritative Sources of Truth

| Domain | Authoritative Source | Advisory Source (Non-Truth) |
| :--- | :--- | :--- |
| **Billing Limits** | Postgres Migration Schema + RPC Logic | Frontend Constants / Roadmap |
| **Transcript State** | `useSessionStore` and same-session client memory | Component Local State |
| **Session History** | DB `sessions` table metadata, counts, custom words, filler words, AI suggestions, engine/mode fields | Full transcript persistence |
| **Quota Enforcement** | Edge Function + `check_usage_limit` RPC | Frontend Pre-checks |
| **Session Lifecycle** | `TranscriptionFSM` State | Browser Mount/Unmount Events |

---

## 🛡️ Structural Invariants

### 1. Session Invariant
> **Only one active transcription session per browser tab.**
- Distributed mutex (`localStorage`) MUST prevent session start if a lock is held by another context.

### 2. FSM Invariant
> **Transcription cannot enter RECORDING before engine initialization succeeds.**
- The finite state machine MUST gate the recording pulse behind a verified `READY` engine handshake.

### 3. Billing Invariant
> **Quota enforcement must fail closed.**
- If the usage check service is unreachable, the system MUST deny the start of a new metered session.
- Private STT MUST NOT silently fail over to Cloud STT because that changes both the user's privacy posture and the product's variable cost. Cloud may only be entered by explicit user selection.

### 4. Data Invariant
> **Final transcripts are append-only and monotonic.**
- Post-processing logic MUST ensures that transcript segments are ordered by absolute timestamp and are never overwritten by late partials.
- Full transcript text MUST NOT be persisted to Supabase. Persisted session records store privacy-preserving metadata and analysis artifacts; PDFs/reports are generated from active client-side transcript state.

### 5. Subscription Invariant
> **Unmount detaches listeners but never destroys active sessions.**
- Component unmounting MUST ONLY detach UI listeners. The active transcription service MUST remain alive until an explicit termination event.

---

## 🏗️ Operational Components

### High-Fidelity Signal Path
- **e2eProbe.ts**: The single authoritative source for internal state telemetry.
- **AnalyticsBuffer.ts**: Ensures telemetry never blocks the UI thread or readiness signals.

### Resource Protocol (Check-Then-Act)
- All heavy resources (Offline Models) MUST be probed for availability before acquisition.
- Acquisition MUST be triggered by explicit user intent, not background automation.
- The Private STT ladder is WebGPU -> CPU/Transformers.js -> Native after Private failure. Cloud is not part of that ladder.

### Edge Function Perimeter
- Public Edge Functions MUST use the shared request-aware CORS helper unless a documented exception exists.
- Secrets SHOULD be loaded lazily inside handlers or guarded with actionable error responses; module-scope non-null assertions create cold-start crash risk.
