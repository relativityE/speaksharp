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

### 2a. Finalized-Producer Invariant (#982)
> **The "finalized" signal is published exactly once, only at the terminal join, and is session-guarded.**
- Post-save UI (single `StatusNotificationBar`, completion toast, filler disclosure) MUST consume the finalized snapshot published only after the terminal join completes (persist → reconcile → formatter terminal). It MUST NOT react to a mid-finalization or stale buffer, and a signal from a superseded session MUST be discarded.

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

#### Exact-origin CORS contract (`_shared/cors.ts`)
- **Exact allowlist, no matching tricks.** Allowed browser origins are an exact set. Every candidate origin (request `Origin` header AND each `ALLOWED_ORIGIN` entry) is parsed with the WHATWG `URL` parser and reduced to its canonical `URL.origin`; comparison is exact string equality. There is NO `includes`/`endsWith`/`startsWith`/substring/wildcard matching. Only `http:`/`https:` are considered; credentials (userinfo), path, query, fragment, `Origin: null`, multiple/comma-separated values, control characters, and malformed URLs are rejected.
- **Fail-closed rejection.** A browser request whose `Origin` is present but not allowed is rejected with **403** (`origin_not_allowed`) BEFORE any auth, database, provider, Stripe, or token side effect, and receives **no** `Access-Control-Allow-Origin` (never a fallback, never a reflected value). Allowed origins get exactly their own origin echoed plus `Vary: Origin`; approved preflights return **204**, hostile preflights **403**.
- **No-Origin = server-to-server.** A request with NO `Origin` header (Stripe/webhooks, health checks, trusted secret-gated automation) is allowed to proceed and never receives a fabricated `Access-Control-Allow-Origin`. CORS is not authentication — each function keeps its own JWT/secret checks.
- **Built-in allowlist:** the active production host (`https://speaksharp-public.vercel.app`), approved product domains (`https://speaksharp.ai`, `https://www.speaksharp.ai`), and exact local-dev origins (`http://localhost:5173/5174`, `http://127.0.0.1:5173/5174`). No arbitrary localhost ports, no localhost subdomains, no `*.vercel.app`.
- **Preview must be explicit.** Preview deployments are NOT matched by pattern; each must be added as an exact origin — fail closed otherwise.
- **Adding an approved origin safely:** append the precise `scheme://host[:port]` value to the comma-separated `ALLOWED_ORIGIN` env (Supabase Dashboard). Never add a suffix/wildcard; malformed entries are ignored observably (logged) and never allowed. Changing `ALLOWED_ORIGIN` is a configuration action taken outside the code PR.

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
