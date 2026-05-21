**Owner:** [unassigned]
**Last Reviewed:** 2026-05-19
**Version:** v0.6.19-rc0
**Last Updated:** 2026-05-19

# Release Risk Tracker (Operational Roadmap)

<!-- PRODUCT_RELEASE_SYNC_START -->

## Current Evidence Snapshot (2026-05-19)

| Item | Current Status |
|---|---|
| Controlled desktop tester release | GO WITH LIMITATIONS; see `RELEASE_DECISION.md` and `TESTER_RELEASE_MATRIX.md`. |
| Broad public launch | NO-GO until remaining public-launch gates are proven; see `PUBLIC_LAUNCH_LEDGER.md`. |
| Latest release evidence commit | `69ad3f13` (`Fix E2E final transcript projection`). |
| CI/Test Audit | PASS: GitHub run `25994869503` on `main`. |
| Production canary | PASS: GitHub run `26085357729` on `main` schedule; push canary `25994869500` also passed. |
| Edge Function deploy | PASS: GitHub run `25994869506` on `main`. |
| Scheduled soak | PASS: GitHub run `26083232887` on `main`. |
| Lighthouse release scores | Performance 98, Accessibility 94, Best Practices 100, SEO 100. |
| Artifact action runtime | Node 20 artifact warning resolved by upgrading `actions/upload-artifact` to `v6` and `actions/download-artifact` to `v7`. |
| Tester instructions | Use `SOFT_RELEASE_TESTER_INSTRUCTIONS.md`: fresh account, one-use 60-minute promo, Private STT first, Cloud optional, save/history check required. |
| Documentation rule | This snapshot supersedes older run IDs or stale status tables lower in this file until those sections are next deeply reconciled. |

<!-- PRODUCT_RELEASE_SYNC_END -->

This document tracks identified risks and their impact on the 12-hour launch window. It replaces feature-oriented roadmaps during the stabilization phase.

---

## 🚦 Operational Risk Matrix

| Area | Status | Risk | Launch Impact | Deferred? |
| :--- | :--- | :--- | :--- | :--- |
| **Quota Gate** | ✅ CONTROLLED/PUBLIC LEDGER EVIDENCE GREEN | Fail-closed quota and usage-token behavior are covered by current release evidence; keep regression coverage in CI. | **Critical**: Revenue leakage if regressed | No |
| **Promo Abuse Guard** | ✅ PUBLIC PROMO LIFECYCLE PASS | Public promo redemption/reuse and expired promo downgrade evidence are recorded in `PUBLIC_LAUNCH_LEDGER.md`. | **P0**: Tester promo access can be brute-forced without this | No |
| **Stripe Webhook**| 🟡 TEST-MODE PASS / LIVE KEYS PENDING | Test-mode checkout/webhook entitlement evidence is recorded; live `cs_live_...` checkout and live webhook propagation remain public-launch blockers. | **P0**: Users cannot upgrade | No |
| **Safari Mic** | 🟡 PENDING | Potential silent failure on resume | **P1**: Degraded mobile UX | Yes |
| **Sentry Ingest** | ✅ OBSERVABILITY API SMOKE PASS | Frontend, Edge, and PostHog provider readback evidence is recorded in `PUBLIC_LAUNCH_LEDGER.md`. | **High**: Blind to launch errors if regressed | No |
| **Usage/Promo Edge CORS** | 🟡 CI/DEPLOY GREEN / HEADER VALIDATION PENDING | `check-usage-limit` and `apply-promo` both use the shared request-aware CORS helper; Edge Function deploy is green, but deployed header validation should be rechecked after each Edge deploy. | **P1**: JWT still required, but attack surface should match other Edge Functions | No |
| **Stripe Secret Init** | 🟡 CI/DEPLOY GREEN / LIVE WEBHOOK PENDING | Webhook runtime now lazily validates secrets inside the served handler and returns actionable config errors instead of module-scope crashes; deploy evidence is green, but live webhook/env smoke is pending | **P2/P1 if env missing**: live validation pending | No |
| **GitHub Canary** | ✅ PASSING | Production canary passed on `main` in scheduled run `26085357729`; CI/Test Audit `25994869503`, Edge Function deploy `25994869506`, and scheduled soak `26083232887` are also green. | **P1**: Keep this green after every deploy | No |
| **STT Benchmarks** | 🟡 PUBLIC CLAIMS LIMITED | Cloud and Private evidence exists, but Native/WebGPU benchmark claims remain limited. User-facing comparison must continue to say "not benchmarked" where evidence is missing. | **P1 only if benchmark claims are marketed** | Yes |
| **Private Model Cache/Progress** | ✅ CONTROLLED TESTER PASS | Private remains the primary validated Pro path for controlled testers; public ledger records Private artifact evidence. | **P1**: Required for Private STT first-use/second-use trust | No |
| **Theme / Toast UX** | ✅ CONTROLLED TESTER PASS / P2 POLISH REMAINS | Desktop status/toast/session stability passed controlled burn-down; further visual tuning is post-release unless a new blocker is observed. | **P2**: Polish after tester release | Yes |
| **AI Parsing** | ✅ PUBLIC LEDGER PASS | AI feedback provider evidence and graceful fallback expectations are recorded in `PUBLIC_LAUNCH_LEDGER.md`. | **P1**: Avoids 500 error on Analytics if regressed | No |
| **Pro Session Warning** | 🟡 FIX APPLIED / VALIDATION PENDING | Pro users with finite daily remaining time now receive the 5-minute warning; local hook test passes | **P1**: Prevents paid-user surprise at daily cap | No |
| **WPM Accuracy** | 🟡 CONTROLLER GUARDED / STORE INVARIANT OPEN | Normal recording starts clear transcript, filler data, chunks, pause metrics, elapsed time, and saved-state through `SpeechRuntimeController.resetAnalysisStateForNewRecording()`. The lower-level store `startSession()` action does not clear chunks by itself, so keep a P2 follow-up to make the reset invariant explicit at the store boundary or cover rapid back-to-back sessions with a regression test. | **P2**: Minor metric glitch if a non-controller path starts recording | Yes |
| **PDF Export Branding** | ✅ PUBLIC LEDGER PASS | PDF artifact proof is recorded in `PUBLIC_LAUNCH_LEDGER.md`; Basic and Pro exports must retain the large SpeakSharp watermark. | **P1**: Validate export UX before launch | No |
| **Constraint Validation Sweep** | 🟡 PLANNED | New non-negative constraints are `NOT VALID`; old bad rows require one-time audit query | **P2**: Existing data hygiene | Yes |
| **Production Store Warning** | 🟡 FIX APPLIED / VALIDATION PENDING | Store creation warning is gated behind dev mode | **P2**: Console polish/noise | Yes |

---

## 📅 Pre-Launch Hardening (12-Hour Sprint)

1. **Validate Fail-Closed Quota**: Verify the deployed `check-usage-limit` function returns fail-closed responses on RPC/internal uncertainty.
2. **Validate AI Suggestions**: Verify the deployed Gemini suggestion path returns safe fallback output on malformed responses and does not 500 the analytics page.
3. **Stripe Verification**: Complete a live $0.50 transaction to verify webhook parity.
4. **Env Verification**: Complete the [LAUNCH_ENV_CHECKLIST.md](./LAUNCH_ENV_CHECKLIST.md).
5. **Canary Maintenance**: Keep GitHub canary and soak green after deploys; latest green evidence is `69ad3f13` plus scheduled May 19 canary/soak.
6. **Benchmark Workflow Boundary**: Keep user-facing benchmark claims limited. The `STT Ceiling Benchmarks` workflow is currently not launch evidence for Native/WebGPU claims.
7. **Usage/Promo Edge CORS**: Verify `check-usage-limit` and `apply-promo` return request-aware CORS headers for allowed production origins after Edge deploys.
8. **Soft Release Tester Setup**: Use `SOFT_RELEASE_TESTER_INSTRUCTIONS.md`; generate one one-use 60-minute promo per tester with `pnpm generate-promo`.
9. **Production Env Flag Check**: Confirm Vercel production does not set `VITE_TEST_MODE` or E2E/test flags before sending tester invites.
10. **Private STT CPU-First Validation**: Ask testers to start with Private STT, then verify live transcript, analytics, save/history/detail, and cached second start where possible.
11. **Private STT WebGPU Validation**: Separately validate the explicit WebGPU/WhisperTurbo accelerated path on supported hardware. This is release evidence for acceleration, not the launch-critical first-use path.

---

## 🛡️ Launch Boundary (Explicitly Deferred)
- Architecture Elegance & Refactoring.
- High-concurrency performance tuning.
- Visual polish and non-critical UI transitions.
- Multi-tab synchronization features.
- Paid Basic pricing work remains deferred. The internal unpaid baseline tier cutover to `basic` is no longer deferred and must be deployed and smoke-tested before tester launch resumes.
