**Owner:** [unassigned]
**Last Reviewed:** 2026-05-26
**Version:** v0.6.19-rc0
**Last Updated:** 2026-05-26

# Operational Architecture Invariants

> Architecture contract, not release status.
> Current ship posture, blockers, and latest run IDs live only in `RELEASE_STATUS.md`.

This document defines the structural invariants and authoritative sources of truth for the SpeakSharp platform. These rules govern system behavior and take precedence over design patterns or implementation preferences.

---

## 🏛️ Authoritative Sources of Truth

| Domain | Authoritative Source | Advisory Source (Non-Truth) |
| :--- | :--- | :--- |
| **Billing Limits** | Postgres Migration Schema + RPC Logic | Frontend Constants / Roadmap |
| **Transcript State** | `useSessionStore` and same-session client memory | Component Local State |
| **Session History** | DB `sessions` table transcript/analysis snapshot: transcript text, duration, counts, custom words, filler words, pause metrics, AI suggestions, engine/mode fields | Ephemeral UI-only metrics |
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
- Full transcript text MAY be persisted as part of the finalized session analysis snapshot so returning-user coaching, AI feedback caching, PDF regeneration, WER-ready validation, and session comparison have a stable source of truth. Private STT audio MUST remain local to the browser.

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
- For the launch baseline, Private STT MUST use controlled local Transformers.js engines backed by same-origin worker/model assets and browser cache. Private model download MUST remain user initiated.
- Native Browser STT is a browser-dependent convenience path. Chrome desktop uses dictation-style Web Speech configuration; other browsers require browser-specific proof before being marketed as verified.
- Cloud is not part of the Private ladder and may only be entered by explicit user selection.

### Edge Function Perimeter
- Public Edge Functions MUST use the shared request-aware CORS helper unless a documented exception exists.
- Secrets SHOULD be loaded lazily inside handlers or guarded with actionable error responses; module-scope non-null assertions create cold-start crash risk.

### Ops Health Data Path

SpeakSharp ops health is split into a detailed machine record and a simplified operator view:

```text
GitHub Actions generates detailed ops-health.json
        ↓
GitHub uploads ops-health.json and ops-health.md as workflow artifacts
        ↓
Future Vercel protected admin page renders a simplified view from the JSON
```

- GitHub Actions is the credential-backed generator because it can access repository secrets without exposing them to the browser.
- `ops-health.json` is the detailed diagnostic source of truth: status, short evidence, latency, timestamp, run context, and drill-down URL.
- `ops-health.md` is the interim operator summary for GitHub workflow summaries and artifacts.
- A future protected Vercel admin page should render the simple human dashboard from the JSON, not run vendor checks from the browser.
- Vendor secrets MUST remain server-side in GitHub Actions, Supabase, or a future server-side admin endpoint; they MUST NOT be exposed to frontend code.
