**Owner:** [unassigned]
**Last Reviewed:** 2026-05-26
**Version:** v0.6.19-rc0
**Last Updated:** 2026-05-26

# Release Risk Tracker (Operational Roadmap)

> Roadmap/risk contract, not release status.
> Current ship posture, blockers, and latest run IDs live only in `RELEASE_STATUS.md`.

This document tracks identified risks and their impact on the 12-hour launch window. It replaces feature-oriented roadmaps during the stabilization phase.

---

## 🚦 Operational Risk Matrix

| Area | Status | Risk | Launch Impact | Deferred? |
| :--- | :--- | :--- | :--- | :--- |
| **Quota Gate** | ✅ CONTROLLED/PUBLIC LEDGER EVIDENCE GREEN | Fail-closed quota and usage-token behavior are covered by current release evidence; keep regression coverage in CI. | **Critical**: Revenue leakage if regressed | No |
| **Private Sample Guard** | 🟡 UPDATED POLICY / PROOF PENDING | Public trial lifecycle is superseded by one server-backed Private sample for Free users. | **P0**: Private sample access can leak if server enforcement regresses | No |
| **Stripe Webhook**| 🟡 TEST-MODE PASS / LIVE KEYS PENDING | Test-mode checkout/webhook entitlement evidence is recorded; live `cs_live_...` checkout and live webhook propagation remain public-launch blockers. | **P0**: Users cannot upgrade | No |
| **Safari Mic** | 🟡 PENDING | Potential silent failure on resume | **P1**: Degraded mobile UX | Yes |
| **Sentry Ingest** | ✅ OBSERVABILITY API SMOKE PASS | Frontend, Edge, and PostHog provider readback evidence is recorded in `PUBLIC_LAUNCH_LEDGER.md`. | **High**: Blind to launch errors if regressed | No |
| **Usage Edge CORS** | 🟡 CI/DEPLOY GREEN / HEADER VALIDATION PENDING | `check-usage-limit` uses the shared request-aware CORS helper; Edge Function deploy is green, but deployed header validation should be rechecked after each Edge deploy. | **P1**: JWT still required, but attack surface should match other Edge Functions | No |
| **Stripe Secret Init** | 🟢 JOURNEY PROVEN (TEST) / LIVE = OPS CUTOVER | Checkout→webhook→billing-portal journey is proven with Stripe TEST-mode keys (the accepted proof per `RELEASE_CLOSEOUT_LEDGER.md` §D); webhook runtime lazily validates secrets and fails closed. Going live is an **Ops config cutover** (swap to `sk_live`/`pk_live`/live `whsec`/live price IDs + register the live webhook + verify `stripeKeyClass==="live"`), **not** a pending Dev/QA proof. | **P2 (ops launch-day)**: live key swap, no money-test | No |
| **GitHub Canary** | 🟡 CURRENT RUNS MUST BE READ FROM STATUS SSOT | Canary/CI/RC evidence changes frequently and must not be copied here. Use `RELEASE_STATUS.md` for current workflow posture. | **P1**: Keep this green after every deploy | No |
| **STT Benchmarks** | 🟡 PUBLIC CLAIMS LIMITED | Private v2, Private v4, and Cloud are the benchmarkable engines in our control. Native Browser STT is browser-dependent convenience STT and must not be marketed as corpus/WER validated unless the exact browser audio route is separately proven. | **P1 only if benchmark claims are marketed** | Yes |
| **Private Model Cache/Progress** | ✅ CONTROLLED TESTER PASS | Private remains the primary validated Pro path for controlled testers; public ledger records Private artifact evidence. | **P1**: Required for Private STT first-use/second-use trust | No |
| **Private STT Processing Bridge** | 🟡 BACKLOG AFTER FINAL ACCURACY PROOF | Consider showing an explicit listening/processing state while local Whisper is converging, so users know transcription is still working during v2 CPU/WASM latency. Do not use this to mask bad final transcripts; only ship after final phrase/stop decode accuracy is trusted. | **P1**: UX polish after Private final text accuracy/timing is verified | No |
| **Theme / Toast UX** | ✅ CONTROLLED TESTER PASS / P2 POLISH REMAINS | Desktop status/toast/session stability passed controlled burn-down; further visual tuning is post-release unless a new blocker is observed. | **P2**: Polish after tester release | Yes |
| **AI Parsing** | ✅ PUBLIC LEDGER PASS | AI feedback provider evidence and graceful fallback expectations are recorded in `PUBLIC_LAUNCH_LEDGER.md`. | **P1**: Avoids 500 error on Analytics if regressed | No |
| **Pro Session Warning** | 🟡 FIX APPLIED / VALIDATION PENDING | Pro users with finite daily remaining time now receive the 5-minute warning; local hook test passes | **P1**: Prevents paid-user surprise at daily cap | No |
| **WPM Accuracy** | 🟡 CONTROLLER GUARDED / STORE INVARIANT OPEN | Normal recording starts clear transcript, filler data, chunks, pause metrics, elapsed time, and saved-state through `SpeechRuntimeController.resetAnalysisStateForNewRecording()`. The lower-level store `startSession()` action does not clear chunks by itself, so keep a P2 follow-up to make the reset invariant explicit at the store boundary or cover rapid back-to-back sessions with a regression test. | **P2**: Minor metric glitch if a non-controller path starts recording | Yes |
| **PDF Export Branding** | ✅ PUBLIC LEDGER PASS | PDF artifact proof is recorded in `PUBLIC_LAUNCH_LEDGER.md`; Free and Pro exports must retain the large SpeakSharp watermark. | **P1**: Validate export UX before launch | No |
| **Constraint Validation Sweep** | 🟡 PLANNED | New non-negative constraints are `NOT VALID`; old bad rows require one-time audit query | **P2**: Existing data hygiene | Yes |
| **Production Store Warning** | 🟡 FIX APPLIED / VALIDATION PENDING | Store creation warning is gated behind dev mode | **P2**: Console polish/noise | Yes |

---

## 📅 Pre-Launch Hardening (12-Hour Sprint)

1. **Validate Fail-Closed Quota**: Verify the deployed `check-usage-limit` function returns fail-closed responses on RPC/internal uncertainty.
2. **Validate AI Suggestions**: Verify the deployed Gemini suggestion path returns safe fallback output on malformed responses and does not 500 the analytics page.
3. **Stripe Verification**: Complete a live $0.50 transaction to verify webhook parity.
4. **Env Verification**: Complete the [LAUNCH_ENV_CHECKLIST.md](./LAUNCH_ENV_CHECKLIST.md).
5. **Canary Maintenance**: Keep GitHub canary and soak green after deploys; record changing run IDs only in `RELEASE_STATUS.md`.
6. **Benchmark Workflow Boundary**: Keep user-facing benchmark claims limited to engines with current benchmark evidence. Native Browser STT is not a corpus/WER release benchmark.
7. **Usage Edge CORS**: Verify `check-usage-limit` returns request-aware CORS headers for allowed production origins after Edge deploys.
8. **Soft Release Tester Setup**: Operators follow `INTERNAL_TEST_PROTOCOL.md` (environment rules, entitlement/scope checks, acceptance criteria, the first-time-tester proof); send testers the plain-language `SOFT_RELEASE_TESTER_INSTRUCTIONS.md`. Testers create a fresh account; standard (Browser) mode is free and the Private sample is server-backed.
9. **Production Env Flag Check**: Confirm Vercel production does not set `VITE_TEST_MODE` or E2E/test flags before sending tester invites.
10. **Private STT CPU-First Validation**: Ask testers to start with Private STT, then verify live transcript, analytics, save/history/detail, and cached second start where possible.
11. **Private STT WebGPU Validation**: Separately validate the explicit WebGPU/WhisperTurbo accelerated path on supported hardware. This is release evidence for acceleration, not the launch-critical first-use path.

---

## 🛡️ Launch Boundary (Explicitly Deferred)
- Architecture Elegance & Refactoring.
- High-concurrency performance tuning.
- Visual polish and non-critical UI transitions.
- Multi-tab synchronization features.
- Paid Basic checkout remains deferred. The internal unpaid baseline tier is `free`. Stripe Basic may exist as a $4.99/month future placeholder; app and Edge Function paths must not start Basic checkout before that product decision is reopened.
