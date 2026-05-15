**Owner:** [unassigned]
**Last Reviewed:** 2026-05-15
**Version:** v0.6.18 
**Last Updated:** 2026-05-15

# Operational Architecture Invariants

<!-- PRODUCT_RELEASE_SYNC_START -->

## Current Evidence Snapshot (2026-05-15)

| Item | Current Status |
|---|---|
| Controlled desktop tester release | GO WITH LIMITATIONS; see `RELEASE_DECISION.md` and `TESTER_RELEASE_MATRIX.md`. |
| Broad public launch | NO-GO until remaining public-launch gates are proven; see `PUBLIC_LAUNCH_LEDGER.md`. |
| Latest release evidence commit | `1066ba6d` (`Use Node 24 artifact actions`). |
| CI/Test Audit | PASS: GitHub run `25944598514` on `main`. |
| Production canary | PASS: GitHub run `25944598537` on `main`. |
| Edge Function deploy | PASS: GitHub run `25944598524` on `main`. |
| Lighthouse release scores | Performance 98, Accessibility 94, Best Practices 100, SEO 100. |
| Artifact action runtime | Node 20 artifact warning resolved by upgrading `actions/upload-artifact` to `v6` and `actions/download-artifact` to `v7`. |
| Documentation rule | This snapshot supersedes older run IDs or stale status tables lower in this file until those sections are next deeply reconciled. |

<!-- PRODUCT_RELEASE_SYNC_END -->

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
- For the launch baseline, Private STT MUST use the deterministic CPU/Transformers.js path first, backed by same-origin model assets and browser cache. WebGPU/WhisperTurbo is an accelerated path only after support is confidently verified or explicitly selected for validation.
- Native is an explicit recovery/baseline alternative after Private cannot run. Cloud is not part of the Private ladder and may only be entered by explicit user selection.

### Edge Function Perimeter
- Public Edge Functions MUST use the shared request-aware CORS helper unless a documented exception exists.
- Secrets SHOULD be loaded lazily inside handlers or guarded with actionable error responses; module-scope non-null assertions create cold-start crash risk.
