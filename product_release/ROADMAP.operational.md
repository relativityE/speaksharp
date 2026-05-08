**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18 
**Last Updated:** 2026-05-08

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
| **Usage Edge CORS** | 🟡 FIX APPLIED / VALIDATION PENDING | `check-usage-limit` now uses the shared request-aware CORS helper; deploy header validation pending | **P1**: JWT still required, but attack surface should match other Edge Functions | No |
| **Stripe Secret Init** | 🟡 FIX APPLIED / VALIDATION PENDING | Webhook runtime now lazily validates secrets inside the served handler and returns actionable config errors instead of module-scope crashes | **P2/P1 if env missing**: deploy validation pending | No |
| **GitHub Canary** | 🟡 FIX APPLIED / RERUN PENDING | Deploy smoke helper updated from stale `/log-in` route to `/auth/signin`; GitHub run evidence pending | **P1**: Cannot trust deployed main-branch smoke until rerun passes | No |
| **STT Benchmarks** | 🟡 FIX APPLIED / RERUN PENDING | Benchmark workflow harness aligned to pnpm/package scripts/current specs; WER evidence pending | **P1**: Cannot validate accuracy ceilings until rerun succeeds | No |
| **Private Model Cache/Progress** | 🟡 FIX APPLIED / BROWSER VALIDATION PENDING | Whisper Turbo availability now checks IndexedDB model stores and progress is normalized to UI percent; headed browser proof pending | **P1**: Required for Private STT first-use/second-use trust | No |
| **AI Parsing** | 🟡 FIX APPLIED / VALIDATION PENDING | Malformed LLM JSON now returns safe fallback suggestions locally; deploy evidence pending | **P1**: Avoids 500 error on Analytics | No |
| **Pro Session Warning** | 🟡 FIX APPLIED / VALIDATION PENDING | Pro users with finite daily remaining time now receive the 5-minute warning; local hook test passes | **P1**: Prevents paid-user surprise at daily cap | No |
| **WPM Accuracy** | 🟡 PENDING | Rolling window pollution bug | **P2**: Minor metric glitch | Yes |
| **PDF Export Branding** | 🟡 FIX APPLIED / VALIDATION PENDING | Free/basic monthly export counting is intentionally removed; all exported PDFs remain SpeakSharp-branded/watermarked, including Pro | **P1**: Validate export UX before launch | No |
| **Constraint Validation Sweep** | 🟡 PLANNED | New non-negative constraints are `NOT VALID`; old bad rows require one-time audit query | **P2**: Existing data hygiene | Yes |
| **Production Store Warning** | 🟡 FIX APPLIED / VALIDATION PENDING | Store creation warning is gated behind dev mode | **P2**: Console polish/noise | Yes |

---

## 📅 Pre-Launch Hardening (12-Hour Sprint)

1. **Fix Fail-Open Quota**: Modify `check-usage-limit` to return `403/503` on error.
2. **Harden AI Suggestions**: Add schema validation/safe-parse to Gemini response handling.
3. **Stripe Verification**: Complete a live $0.50 transaction to verify webhook parity.
4. **Env Verification**: Complete the [LAUNCH_ENV_CHECKLIST.md](./LAUNCH_ENV_CHECKLIST.md).
5. **Canary Repair**: Align `canaryLogin` with the real sign-in route, run GitHub `canary.yml`, and save run evidence.
6. **Benchmark Workflow Repair**: Remove stale pnpm 9 pins from `.github/workflows/benchmarks.yml`, rerun both benchmark jobs, and save WER evidence.
7. **Usage Edge CORS**: Deploy and verify `check-usage-limit` returns request-aware CORS headers for allowed production origins.
8. **Live Deployment Validation**: Deploy the two quota/promo migrations and updated Edge Functions, then run smoke tests for usage denial, Cloud token issuance, promo throttling, Stripe webhook, and Sentry ingest.
9. **Private STT Cache Validation**: In headed Chrome, clear origin storage, run Private download, verify progress, restart, and confirm cached second start without false `DOWNLOAD_REQUIRED`.

---

## 🛡️ Launch Boundary (Explicitly Deferred)
- Architecture Elegance & Refactoring.
- High-concurrency performance tuning.
- Visual polish and non-critical UI transitions.
- Multi-tab synchronization features.
- Free -> Basic migration and pricing rename until after the MVP test-release baseline is green, tagged, and impounded. Stripe test-mode prices can validate a future paid Basic checkout without real charges, but Basic still requires app copy, DB/Edge Function semantics, tests, and live Price ID alignment before production use.
