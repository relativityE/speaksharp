**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18
**Last Updated:** 2026-05-07

# Release Readiness Checklist (Launch Gate)

This document serves as the final authoritative gate for the SpeakSharp production launch. All P0 and P1 items must be marked ✅ before the verdict transitions to **READY**.

## 🔴 Current Verdict: BLOCKED

## Final Launch Gate

Launch status: **NOT READY**

### Required Before Launch

- [ ] P0 quota fail-open fixed. Code fix applied locally; GitHub/deploy validation pending.
- [ ] P0 Cloud token issuance checks usage limits before minting paid tokens. Code fix applied locally; GitHub/deploy validation pending.
- [ ] P0 usage RPCs reject negative abuse-path increments. Forward migration added locally; migration validation pending.
- [ ] P0 promo redemption has brute-force protection.
- [ ] Unit tests pass.
- [ ] E2E tests pass.
- [ ] Stripe live webhook verified.
- [ ] Sentry live ingest verified.
- [ ] Manual mic checklist completed.
- [ ] Launch env checklist completed.
- [x] Recovery strategy documented.

### Launch Decision Rules

- **READY** only if every required item is checked.
- **CONDITIONAL** only if no P0 remains and all unchecked items have an explicit owner and mitigation.
- **NOT READY** if any P0 remains.

---

## 🛠️ Critical Launch Gates (P0)

| ID | Requirement | Category | Status |
| :--- | :--- | :--- | :--- |
| **G1** | **Fail-Closed Usage Logic** | Financial | 🟡 **FIX APPLIED / VALIDATION PENDING** |
| **G2** | **Usage-Aware Token Issuance** | Revenue | 🟡 **FIX APPLIED / VALIDATION PENDING** |
| **G3** | **Non-Negative Duration Constraint**| Integrity | 🟡 **FIX APPLIED / VALIDATION PENDING** |
| **G4** | **Promo Rate Limiting** | Security | 🔴 **BLOCKED** |
| **G5** | **Production Secret Audit** | Security | 🟡 IN REVIEW |

---

## 📈 Quality & Performance Gates (P1)

| ID | Requirement | Category | Status |
| :--- | :--- | :--- | :--- |
| **Q1** | **Pro Session Warning UI** | UX | 🔴 **BLOCKED** |
| **Q2** | **Safe LLM JSON Parsing** | Reliability| 🔴 **BLOCKED** |
| **Q3** | **Lighthouse SEO Score > 90** | Marketing | ✅ READY (91 local audit) |
| **Q4** | **Lighthouse Perf Score Policy**| Performance| 🟡 FIX APPLIED / GITHUB RERUN PENDING (90 remains target; performance assertion is advisory for MVP) |

---

## Feature Validation Status Matrix

This matrix tracks user-visible feature readiness. A feature is not release-ready until code behavior, automated evidence, and required manual validation agree.

| Feature Area | User Promise | Current Evidence | Status | Required Before Test Release |
|---|---|---|---|---|
| **Native STT** | Free/basic browser transcription can start, stop, save, and analyze a session. | Mocked E2E covers the primary journey; manual mic behavior is not yet complete. | 🟡 PENDING | Complete Chrome/Safari/Firefox/iPhone mic checklist. |
| **Private STT Default** | Pro users see Private as the recommended/default STT mode. | Recent STT UX work orders Private first; mocked E2E covers orchestration. | 🟡 PENDING | Browser-test new Pro/promo user landing state. |
| **Private Download & Cache** | Missing model shows explicit download/progress, then reuses browser cache on later starts. | Manual checklist covers missing-model and cache-reuse cases; CI does not prove real Hugging Face/cache behavior. | 🟡 PENDING | Headed Chrome validation with cache clear, first download, second cached start. |
| **Private Engine Ladder** | Private attempts WebGPU, then CPU/Transformers.js, then Native only after Private cannot run. | Architecture and tests cover mocked fallback negotiation; hardware-specific paths are not CI-required. | 🟡 PENDING | Validate WebGPU and forced-CPU paths locally; verify no silent Cloud fallback. |
| **Cloud STT** | Pro users may explicitly choose Cloud as a first-class option. | Auth/pro gating exists; usage-aware token issuance fix is applied locally. | 🟡 VALIDATION PENDING | Verify over-limit denial and successful Pro token issuance after deploy. |
| **Transcript Propagation** | Live transcript updates and `TRANSCRIPT_PULSE` telemetry come from the same successful path. | Recent SpeechRuntime fixes target this path; mocked E2E evidence exists. | 🟡 PENDING | Re-run full mocked E2E after P0 fixes; spot-check browser console during manual session. |
| **Session Persistence** | Finalized sessions persist transcript, engine, metrics, and history. | DB schema supports transcript/engine persistence; mocked flows cover history. | 🟡 PENDING | Verify live save/read after Native, Private, and Cloud sessions. |
| **Analytics** | WPM, clarity, filler words, pause/session history, and trends are computed from saved data. | Core analytics are covered by mocked tests; WPM rolling-window issue remains P2. | 🟡 PENDING | Browser-test session-over-session analytics and accept/defer WPM P2 explicitly. |
| **Custom/User Words** | User words persist to Supabase and are available next session; Cloud receives boost words. | Changelog indicates persistence and Cloud boost integration; current live behavior unverified. | 🟡 PENDING | Live Pro test: add word, refresh/login, record Cloud session, verify persistence. |
| **PDF Export** | Exported PDF reflects authoritative saved transcript/report data. | PDF export exists and has prior E2E history; live export content not recently validated. | 🟡 PENDING | Export a saved session and inspect transcript/metrics/watermark behavior. |
| **Promo Pro Access** | Promo code grants select tester Pro access for the intended duration. | Promo flow exists; brute-force/rate-limit protection is missing. | 🔴 BLOCKED | Add brute-force protection; run promo signup smoke. |
| **Billing Upgrade** | Stripe checkout upgrades user only after verified webhook. | Stripe flow has tests; live webhook/env verification pending. | 🟡 PENDING | Complete live low-value transaction and webhook smoke. |
| **Usage Quotas** | Usage limits protect users and business costs and fail closed on uncertainty. | Local fixes now cover fail-closed usage checks, usage-aware Cloud token issuance, and negative-duration DB guards. | 🟡 VALIDATION PENDING | Run targeted tests, deploy migration/functions, and verify over-limit denial on live infrastructure. |
| **Accuracy Benchmarks** | Accuracy claims are backed by `.wav` plus ground-truth WER runs. | Workflow harness fixes applied locally for pnpm version, AssemblyAI command, browser benchmark specs, and canonical `tests/STT_BENCHMARKS.json` path. | 🟡 GITHUB RERUN PENDING | Rerun AssemblyAI/browser benchmarks and record WER. |
| **Observability** | Sentry/PostHog capture launch-relevant frontend/backend events. | Instrumentation exists; live project ingest is pending. | 🟡 PENDING | Send frontend error, Edge Function error, and key product analytics events. |
| **GitHub Canary Deploy Smoke** | Main-branch GitHub canary proves deployed auth/session/analytics path against real infrastructure. | Local helper fix now navigates to `/auth/signin`; GitHub canary has not rerun yet. | 🟡 GITHUB RERUN PENDING | Run `canary.yml` and attach run evidence. |

---

## Release Readiness Reconciliation

| Claim | Source | Runtime Evidence | Verdict | Action |
|---|---|---|---|---|
| Usage enforcement resolved | Roadmap / prior status docs | Local code now fails closed on `check_usage_limit` RPC/internal uncertainty; full gate evidence pending. | Validation pending | Run targeted tests and deployed Edge Function smoke. |
| Cloud STT access is protected | Architecture / prior status docs | Local code now checks usage eligibility before AssemblyAI token issuance; full gate evidence pending. | Validation pending | Run over-limit/pro-token smoke after deploy. |
| Negative duration abuse is blocked | RPC session guard | Forward migration adds table constraints and write-path guards for `update_user_usage` and `heartbeat_session`. | Validation pending | Apply migration and verify negative increments are rejected. |
| Promo redemption is secure | Promo migration notes | Redemption is atomic, but apply path has no attempt counter or rate limit. | Partially true | Add brute-force protection. |
| CI validates STT flows | CI evidence | CI validates mocked orchestration; real mic, WebGPU, Safari, and hardware behavior require manual validation. | Partially true | Complete manual hardware checklist. |
| Lighthouse performance ready | Release readiness table | Recent local audit showed Performance varying around 87-90, not 96. | Stale | Re-run release Lighthouse and set launch threshold/policy. |
| Billing ready | Architecture / roadmap | Stripe flow has tests, but live webhook/environment verification remains pending. | Pending | Complete launch environment checklist and live webhook smoke. |

---

## 🏗️ Post-Launch Operational Debt (P2)

| ID | Task | Impact | Status |
| :--- | :--- | :--- | :--- |
| **D1** | **Purge Test-Aware Branches** | Architectural Integrity | 🔴 PLANNED |
| **D2** | **WPM Rolling Window Fix** | Logic Accuracy | 🔴 PLANNED |
| **D3** | **Sync PRD Coverage Table** | Transparency | 🔴 PLANNED |

---

## 📋 Evidence Registry

- **Audit Report**: [release_audit.md](./release_audit.md)
- **Architecture**: [ARCHITECTURE.md](../docs/ARCHITECTURE.md)
- **Product Specs**: [PRD.md](../docs/PRD.md)
- **Infrastructure Probe**: [infra.probe.e2e.spec.ts](../tests/e2e/infra.probe.e2e.spec.ts)

---

## ✍️ Auditor Final Comments
*The core transcription technology is production-grade. The blocking issues are concentrated in the 'Economic Perimeter'—the logic that protects the business from cost overruns and abuse. Resolving these 4-5 backend items will transition the product from a liability to a launchable asset.*
