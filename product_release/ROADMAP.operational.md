**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18 
**Last Updated:** 2026-05-09

# Release Risk Tracker (Operational Roadmap)

This document tracks identified risks and their impact on the 12-hour launch window. It replaces feature-oriented roadmaps during the stabilization phase.

---

## 🚦 Operational Risk Matrix

| Area | Status | Risk | Launch Impact | Deferred? |
| :--- | :--- | :--- | :--- | :--- |
| **Quota Gate** | 🟡 CI/DEPLOY GREEN / LIVE VALIDATION PENDING | Fail-closed quota and usage-token fixes are in `9dff649`; GitHub CI and Edge Function deploy are green, but live fail-closed/token smoke is pending | **Critical**: Revenue leakage | No |
| **Promo Abuse Guard** | 🟡 CI/DEPLOY GREEN / LIVE VALIDATION PENDING | DB-backed promo attempt throttling is present; GitHub CI/deploy evidence is green, but live throttling/reuse smoke is pending | **P0**: Tester promo access can be brute-forced without this | No |
| **Stripe Webhook**| 🟡 PENDING | Live mode end-to-end unverified | **P0**: Users cannot upgrade | No |
| **Safari Mic** | 🟡 PENDING | Potential silent failure on resume | **P1**: Degraded mobile UX | Yes |
| **Sentry Ingest** | 🟡 PENDING | Live project ingestion untested | **High**: Blind to launch errors | No |
| **Usage Edge CORS** | 🟡 CI/DEPLOY GREEN / HEADER VALIDATION PENDING | `check-usage-limit` now uses the shared request-aware CORS helper; Edge Function deploy is green, but deployed header validation is pending | **P1**: JWT still required, but attack surface should match other Edge Functions | No |
| **Stripe Secret Init** | 🟡 CI/DEPLOY GREEN / LIVE WEBHOOK PENDING | Webhook runtime now lazily validates secrets inside the served handler and returns actionable config errors instead of module-scope crashes; deploy evidence is green, but live webhook/env smoke is pending | **P2/P1 if env missing**: live validation pending | No |
| **GitHub Canary** | ✅ PASSING | Deploy smoke helper updated from stale `/log-in` route to `/auth/signin`; production canary passed on `9dff649` | **P1**: Keep this green after every deploy | No |
| **STT Benchmarks** | 🔴 BLOCKED / TRUTHFUL UI PATCH LOCAL | Benchmark workflow harness exists, but current manifest data is stale/incomplete and browser benchmark audio/reference mapping must be corrected before WER values can be trusted | **P0 for user-facing benchmark claims / P1 for controlled tester release if hidden as not benchmarked** | No |
| **Private Model Cache/Progress** | 🟡 FIX APPLIED / LIVE TRANSCRIPT VALIDATION PENDING | Launch policy is CPU/Transformers.js first for deterministic Private setup; WebGPU/WhisperTurbo is an accelerated validation path. CPU model assets are locally load-proven and progress/cache fixes are applied, but live transcript/save/history proof is pending. | **P1**: Required for Private STT first-use/second-use trust | No |
| **Theme / Toast UX** | 🟡 LOCAL POLISH / VISUAL SMOKE PENDING | UI review kept amber as the brand/action color but found severity states, card borders, and the dark glow/grid were too visually noisy; local polish separates toast severity colors, softens shell effects, and normalizes card borders | **P1**: Prevents tester confusion during status/progress flows | No |
| **AI Parsing** | 🟡 CI/DEPLOY GREEN / LIVE VALIDATION PENDING | Malformed LLM JSON now returns safe fallback suggestions; GitHub CI/deploy evidence is green, but live suggestion smoke is pending | **P1**: Avoids 500 error on Analytics | No |
| **Pro Session Warning** | 🟡 FIX APPLIED / VALIDATION PENDING | Pro users with finite daily remaining time now receive the 5-minute warning; local hook test passes | **P1**: Prevents paid-user surprise at daily cap | No |
| **WPM Accuracy** | 🟡 PENDING | Rolling window pollution bug | **P2**: Minor metric glitch | Yes |
| **PDF Export Branding** | 🟡 LOCAL PROOF IMPROVED / LIVE VALIDATION PENDING | Free/basic monthly export counting is intentionally removed; local PDF proof now inspects generated PDF text and watermark commands for Free and Pro, but browser/live export inspection is pending | **P1**: Validate export UX before launch | No |
| **Constraint Validation Sweep** | 🟡 PLANNED | New non-negative constraints are `NOT VALID`; old bad rows require one-time audit query | **P2**: Existing data hygiene | Yes |
| **Production Store Warning** | 🟡 FIX APPLIED / VALIDATION PENDING | Store creation warning is gated behind dev mode | **P2**: Console polish/noise | Yes |

---

## 📅 Pre-Launch Hardening (12-Hour Sprint)

1. **Validate Fail-Closed Quota**: Verify the deployed `check-usage-limit` function returns fail-closed responses on RPC/internal uncertainty.
2. **Validate AI Suggestions**: Verify the deployed Gemini suggestion path returns safe fallback output on malformed responses and does not 500 the analytics page.
3. **Stripe Verification**: Complete a live $0.50 transaction to verify webhook parity.
4. **Env Verification**: Complete the [LAUNCH_ENV_CHECKLIST.md](./LAUNCH_ENV_CHECKLIST.md).
5. **Canary Maintenance**: Keep GitHub `canary.yml` green after deploys; latest green evidence is `9dff649`.
6. **Benchmark Workflow Repair**: Remove stale pnpm 9 pins from `.github/workflows/benchmarks.yml`, rerun both benchmark jobs, and save WER evidence.
7. **Usage Edge CORS**: Deploy and verify `check-usage-limit` returns request-aware CORS headers for allowed production origins.
8. **Live Deployment Validation**: Deploy the two quota/promo migrations and updated Edge Functions, then run smoke tests for usage denial, Cloud token issuance, promo throttling, Stripe webhook, and Sentry ingest.
9. **Private STT CPU-First Validation**: In headed Chrome, clear origin storage, run Private CPU setup/download, verify progress/status, record live transcript, save session, restart, and confirm cached second start without false `DOWNLOAD_REQUIRED`.
10. **Private STT WebGPU Validation**: Separately validate the explicit WebGPU/WhisperTurbo accelerated path on supported hardware. This is release evidence for acceleration, not the launch-critical first-use path.

---

## 🛡️ Launch Boundary (Explicitly Deferred)
- Architecture Elegance & Refactoring.
- High-concurrency performance tuning.
- Visual polish and non-critical UI transitions.
- Multi-tab synchronization features.
- Free -> Basic migration and pricing rename until after the MVP test-release baseline is green, tagged, and impounded. Stripe test-mode prices can validate a future paid Basic checkout without real charges, but Basic still requires app copy, DB/Edge Function semantics, tests, and live Price ID alignment before production use.
