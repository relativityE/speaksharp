**Owner:** [unassigned]
**Last Reviewed:** 2026-05-15
**Version:** v0.6.18 
**Last Updated:** 2026-05-15

# Release Risk Tracker (Operational Roadmap)

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
| **Usage Edge CORS** | 🟡 CI/DEPLOY GREEN / HEADER VALIDATION PENDING | `check-usage-limit` now uses the shared request-aware CORS helper; Edge Function deploy is green, but deployed header validation is pending | **P1**: JWT still required, but attack surface should match other Edge Functions | No |
| **Stripe Secret Init** | 🟡 CI/DEPLOY GREEN / LIVE WEBHOOK PENDING | Webhook runtime now lazily validates secrets inside the served handler and returns actionable config errors instead of module-scope crashes; deploy evidence is green, but live webhook/env smoke is pending | **P2/P1 if env missing**: live validation pending | No |
| **GitHub Canary** | ✅ PASSING | Production canary passed on `main` in run `25944598537`; CI/Test Audit and Edge Function deploy are also green on `main`. | **P1**: Keep this green after every deploy | No |
| **STT Benchmarks** | 🟡 PUBLIC CLAIMS LIMITED | Cloud and Private evidence exists, but Native/WebGPU benchmark claims remain limited. User-facing comparison must continue to say "not benchmarked" where evidence is missing. | **P1 only if benchmark claims are marketed** | Yes |
| **Private Model Cache/Progress** | ✅ CONTROLLED TESTER PASS | Private remains the primary validated Pro path for controlled testers; public ledger records Private artifact evidence. | **P1**: Required for Private STT first-use/second-use trust | No |
| **Theme / Toast UX** | ✅ CONTROLLED TESTER PASS / P2 POLISH REMAINS | Desktop status/toast/session stability passed controlled burn-down; further visual tuning is post-release unless a new blocker is observed. | **P2**: Polish after tester release | Yes |
| **AI Parsing** | ✅ PUBLIC LEDGER PASS | AI feedback provider evidence and graceful fallback expectations are recorded in `PUBLIC_LAUNCH_LEDGER.md`. | **P1**: Avoids 500 error on Analytics if regressed | No |
| **Pro Session Warning** | 🟡 FIX APPLIED / VALIDATION PENDING | Pro users with finite daily remaining time now receive the 5-minute warning; local hook test passes | **P1**: Prevents paid-user surprise at daily cap | No |
| **WPM Accuracy** | 🟡 PENDING | Rolling window pollution bug | **P2**: Minor metric glitch | Yes |
| **PDF Export Branding** | ✅ PUBLIC LEDGER PASS | PDF artifact proof is recorded in `PUBLIC_LAUNCH_LEDGER.md`; Basic and Pro exports must retain the large SpeakSharp watermark. | **P1**: Validate export UX before launch | No |
| **Constraint Validation Sweep** | 🟡 PLANNED | New non-negative constraints are `NOT VALID`; old bad rows require one-time audit query | **P2**: Existing data hygiene | Yes |
| **Production Store Warning** | 🟡 FIX APPLIED / VALIDATION PENDING | Store creation warning is gated behind dev mode | **P2**: Console polish/noise | Yes |

---

## 📅 Pre-Launch Hardening (12-Hour Sprint)

1. **Validate Fail-Closed Quota**: Verify the deployed `check-usage-limit` function returns fail-closed responses on RPC/internal uncertainty.
2. **Validate AI Suggestions**: Verify the deployed Gemini suggestion path returns safe fallback output on malformed responses and does not 500 the analytics page.
3. **Stripe Verification**: Complete a live $0.50 transaction to verify webhook parity.
4. **Env Verification**: Complete the [LAUNCH_ENV_CHECKLIST.md](./LAUNCH_ENV_CHECKLIST.md).
5. **Canary Maintenance**: Keep GitHub `canary.yml` green after deploys; latest green evidence is `56ce972`.
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
