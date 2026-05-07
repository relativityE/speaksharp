**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18 
**Last Updated:** 2026-05-06

# Release Risk Tracker (Operational Roadmap)

This document tracks identified risks and their impact on the 12-hour launch window. It replaces feature-oriented roadmaps during the stabilization phase.

---

## 🚦 Operational Risk Matrix

| Area | Status | Risk | Launch Impact | Deferred? |
| :--- | :--- | :--- | :--- | :--- |
| **Quota Gate** | 🟡 FIX APPLIED / VALIDATION PENDING | Fail-closed quota and usage-token fixes applied locally; deploy/test evidence pending | **Critical**: Revenue leakage | No |
| **Promo Abuse Guard** | 🟡 FIX APPLIED / VALIDATION PENDING | DB-backed promo attempt throttling applied locally; deploy/test evidence pending | **P0**: Tester promo access can be brute-forced without this | No |
| **Stripe Webhook**| 🟡 PENDING | Live mode end-to-end unverified | **P0**: Users cannot upgrade | No |
| **Safari Mic** | 🟡 PENDING | Potential silent failure on resume | **P1**: Degraded mobile UX | Yes |
| **Sentry Ingest** | 🟡 PENDING | Live project ingestion untested | **High**: Blind to launch errors | No |
| **GitHub Canary** | 🟡 FIX APPLIED / RERUN PENDING | Deploy smoke helper updated from stale `/log-in` route to `/auth/signin`; GitHub run evidence pending | **P1**: Cannot trust deployed main-branch smoke until rerun passes | No |
| **STT Benchmarks** | 🟡 FIX APPLIED / RERUN PENDING | Benchmark workflow harness aligned to pnpm/package scripts/current specs; WER evidence pending | **P1**: Cannot validate accuracy ceilings until rerun succeeds | No |
| **AI Parsing** | 🔴 BLOCKED | Blind JSON parsing in suggestions | **P1**: 500 error on Analytics | No |
| **WPM Accuracy** | 🟡 PENDING | Rolling window pollution bug | **P2**: Minor metric glitch | Yes |

---

## 📅 Pre-Launch Hardening (12-Hour Sprint)

1. **Fix Fail-Open Quota**: Modify `check-usage-limit` to return `403/503` on error.
2. **Harden AI Suggestions**: Add schema validation/safe-parse to Gemini response handling.
3. **Stripe Verification**: Complete a live $0.50 transaction to verify webhook parity.
4. **Env Verification**: Complete the [LAUNCH_ENV_CHECKLIST.md](./LAUNCH_ENV_CHECKLIST.md).
5. **Canary Repair**: Align `canaryLogin` with the real sign-in route, run GitHub `canary.yml`, and save run evidence.
6. **Benchmark Workflow Repair**: Remove stale pnpm 9 pins from `.github/workflows/benchmarks.yml`, rerun both benchmark jobs, and save WER evidence.

---

## 🛡️ Launch Boundary (Explicitly Deferred)
- Architecture Elegance & Refactoring.
- High-concurrency performance tuning.
- Visual polish and non-critical UI transitions.
- Multi-tab synchronization features.
