**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18
**Last Updated:** 2026-05-08

# Release Readiness Checklist (Launch Gate)

This document serves as the final authoritative gate for the SpeakSharp production launch. All P0 and P1 items must be marked ✅ before the verdict transitions to **READY**.

## 🔴 Current Verdict: BLOCKED

## Final Launch Gate

Launch status: **NOT READY**

### Required Before Launch

- [ ] P0 quota fail-open fixed. Code fix applied locally; GitHub/deploy validation pending.
- [ ] P0 Cloud token issuance checks usage limits before minting paid tokens. Code fix applied locally; GitHub/deploy validation pending.
- [ ] P0 usage RPCs reject negative abuse-path increments. Forward migration added locally; migration validation pending.
- [ ] P0 promo redemption has brute-force protection. Code fix applied locally; migration/deploy validation pending.
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
| **G4** | **Promo Rate Limiting** | Security | 🟡 **FIX APPLIED / VALIDATION PENDING** |
| **G5** | **Production Secret Audit** | Security | 🟡 IN REVIEW |

---

## 📈 Quality & Performance Gates (P1)

| ID | Requirement | Category | Status |
| :--- | :--- | :--- | :--- |
| **Q1** | **Pro Session Warning UI** | UX | 🟡 **FIX APPLIED / VALIDATION PENDING** |
| **Q2** | **Safe LLM JSON Parsing** | Reliability| 🟡 **FIX APPLIED / VALIDATION PENDING** |
| **Q3** | **Lighthouse SEO Score > 90** | Marketing | ✅ READY (91 local audit) |
| **Q4** | **Lighthouse Perf Score Policy**| Performance| 🟡 FIX APPLIED / GITHUB RERUN PENDING (90 remains target; performance assertion is advisory for MVP) |
| **Q5** | **Request-Aware CORS on Usage Edge Function** | Security | 🟡 **FIX APPLIED / VALIDATION PENDING** |

---

## Feature Validation Status Matrix

This matrix tracks user-visible feature readiness. A feature is not release-ready until code behavior, automated evidence, and required manual validation agree.

| Feature Area | User Promise | Current Evidence | Status | Required Before Test Release |
|---|---|---|---|---|
| **Native STT** | Free/basic browser transcription can start, stop, save, and analyze a session. | Mocked E2E covers the primary journey; manual mic behavior is not yet complete. | 🟡 PENDING | Complete Chrome/Safari/Firefox/iPhone mic checklist. |
| **Private STT Default** | Pro users see Private as the recommended/default STT mode. | Recent STT UX work orders Private first; mocked E2E covers orchestration. | 🟡 PENDING | Browser-test new Pro/promo user landing state. |
| **Private Download & Cache** | Missing model shows explicit download/progress, then reuses browser cache on later starts. | Code now probes Whisper Turbo's real IndexedDB model stores and normalizes progress values for UI display; CI does not prove real model-source/cache behavior. | 🟡 FIX APPLIED / BROWSER VALIDATION PENDING | Headed Chrome validation with cache clear, first download, second cached start; confirm model source contract. |
| **Private Engine Ladder** | Private attempts WebGPU, then CPU/Transformers.js, then Native only after Private cannot run. | Architecture and tests cover mocked fallback negotiation; hardware-specific paths are not CI-required. | 🟡 PENDING | Validate WebGPU and forced-CPU paths locally; verify no silent Cloud fallback. |
| **Cloud STT** | Pro users may explicitly choose Cloud as a first-class option. | Auth/pro gating exists; usage-aware token issuance fix is applied locally. | 🟡 VALIDATION PENDING | Verify over-limit denial and successful Pro token issuance after deploy. |
| **Transcript Propagation** | Live transcript updates and `TRANSCRIPT_PULSE` telemetry come from the same successful path. | Recent SpeechRuntime fixes target this path; mocked E2E evidence exists. Latest GitHub CI is running against pushed fixes. | 🟡 GITHUB RERUN PENDING | Review latest `CI - Test Audit`; spot-check browser console during manual session. |
| **Session Persistence** | Finalized sessions persist the full coaching-analysis snapshot needed for returning-user comparison: transcript, duration, total words, WPM, clarity, filler/custom word counts, pause metrics, AI suggestions, engine metadata, and optional ground-truth/WER fields. | Code now writes richer stop-session analysis and reloads the full analysis field set; targeted unit tests pass. | 🟡 FIX APPLIED / LIVE VALIDATION PENDING | Verify live save/read after Native, Private, and Cloud sessions. |
| **Analytics** | WPM, clarity, filler words, pause/session history, WER-ready fields, and trends are computed from saved data and available for comparison when the user returns. | Analytics UI E2E passed; analysis persistence contract unit tests pass; WPM rolling-window issue remains P2. | 🟡 FIX APPLIED / LIVE VALIDATION PENDING | Browser-test session-over-session analytics after logout/login and accept/defer WPM P2 explicitly. |
| **Custom/User Words** | User words persist to Supabase, are available next session, are saved into per-session analysis snapshots, and Cloud receives boost words when explicitly selected. | Add/remove/detection E2E passed; per-session custom word snapshot now persists on stop. | 🟡 FIX APPLIED / LIVE VALIDATION PENDING | Live Pro test: add word, refresh/login, record Native/Private/Cloud session, verify persistence and keyterms behavior. |
| **PDF Export** | Exported PDF reflects current client-side transcript/report state and persisted metrics. Free/basic users may export without a count limit. All tiers, including Pro, receive SpeakSharp-branded/watermarked PDFs. | PDF generation is client-side; watermark behavior is covered by E2E signal and still needs browser inspection. | 🟡 PENDING | Export a saved/current Free/basic and Pro session; inspect transcript/metrics and watermark behavior. |
| **Promo Pro Access** | Promo code grants select tester Pro access for the intended duration. | Mocked promo E2E passes valid promo, invalid inline error, and invalid-with-valid-credentials fallback; DB-backed attempt throttling exists. | 🟡 MOCKED GREEN / LIVE VALIDATION PENDING | Deploy migration/function, verify invalid attempts throttle, then run live promo signup smoke. |
| **Billing Upgrade** | Stripe checkout upgrades user only after verified webhook. | Stripe flow has tests; live webhook/env verification pending. | 🟡 PENDING | Complete live low-value transaction and webhook smoke. |
| **Usage Quotas** | Usage limits protect users and business costs and fail closed on uncertainty. | Local fixes now cover fail-closed usage checks, usage-aware Cloud token issuance, and negative-duration DB guards. | 🟡 VALIDATION PENDING | Run targeted tests, deploy migration/functions, and verify over-limit denial on live infrastructure. |
| **Accuracy Benchmarks** | Accuracy claims are backed by `.wav` plus ground-truth WER runs. | Workflow harness fixes applied locally for pnpm version, AssemblyAI command, browser benchmark specs, and canonical `tests/STT_BENCHMARKS.json` path. | 🟡 GITHUB RERUN PENDING | Rerun AssemblyAI/browser benchmarks and record WER. |
| **Observability** | Sentry/PostHog capture launch-relevant frontend/backend events. | Instrumentation exists; live project ingest is pending. | 🟡 PENDING | Send frontend error, Edge Function error, and key product analytics events. |
| **GitHub Canary Deploy Smoke** | Main-branch GitHub canary proves deployed auth/session/analytics path against real infrastructure. | Local helper fix now navigates to `/auth/signin`; GitHub canary has not rerun yet. | 🟡 GITHUB RERUN PENDING | Run `canary.yml` and attach run evidence. |

### Latest Local Fix Status (2026-05-07)

| Area | Current State | Local Evidence | Still Required |
|---|---|---|---|
| Quota fail-closed | Code fix pushed. | `check-usage-limit` Deno tests pass locally. | GitHub/live Edge Function validation. |
| Cloud token usage gate | Code fix pushed. | Targeted ESLint passed before push. | Live Pro/over-limit token smoke. |
| Negative duration guards | Forward migration pushed. | SQL review complete. | Apply migration and verify negative increments reject. |
| Promo brute-force | Code + migration pushed. | `deno check` and targeted ESLint passed before push. | Deploy migration/function and verify throttling. |
| Canary harness | Code fix pushed for login route and production origin guard. | Targeted ESLint passed before push. | Latest GitHub canary rerun must pass. |
| AI suggestion parsing | Code fix pushed. | `deno test --no-lock --allow-env --allow-net backend/supabase/functions/get-ai-suggestions` passed. | Deploy evidence. |
| Pro warning UI | Code fix local, pending push in current checkpoint. | `vitest ... --coverage.enabled=false frontend/src/hooks/__tests__/useSessionLifecycle.test.tsx` passed; targeted ESLint passed. | Push and review CI. |
| Request-aware CORS | Code fix local, pending push in current checkpoint. | `check-usage-limit` now uses shared request-aware `corsHeaders(req)`; Deno tests pass locally. | Push and verify deployed Edge Function CORS headers. |
| Private model cache/progress | Code fix local, pending push in current checkpoint. | `ModelManager` probes Whisper Turbo IndexedDB stores; store progress normalization clamps `0..1` and `0..100` inputs to UI percent. | Run targeted tests; perform headed browser cache/download validation. |
| Session analysis persistence | Code fix local, pending push in current checkpoint. | `storage.test.ts` and `SttSafeguards.test.ts` pass; selectors reload transcript, WER, pause, AI, custom-word, and engine metadata fields. | Push, run CI, and live-test returning-user comparison. |
| Promo tester flow | Mocked E2E green locally. | `promo-admin-journey.e2e.spec.ts` passed 8/8 including infra probes. | Push, review CI/canary, then run live promo smoke with production secrets. |

---

## Release Readiness Reconciliation

| Claim | Source | Runtime Evidence | Verdict | Action |
|---|---|---|---|---|
| Usage enforcement resolved | Roadmap / prior status docs | Local code now fails closed on `check_usage_limit` RPC/internal uncertainty; full gate evidence pending. | Validation pending | Run targeted tests and deployed Edge Function smoke. |
| Cloud STT access is protected | Architecture / prior status docs | Local code now checks usage eligibility before AssemblyAI token issuance; full gate evidence pending. | Validation pending | Run over-limit/pro-token smoke after deploy. |
| Negative duration abuse is blocked | RPC session guard | Forward migration adds table constraints and write-path guards for `update_user_usage` and `heartbeat_session`. | Validation pending | Apply migration and verify negative increments are rejected. |
| Promo redemption is secure | Promo migration notes | Redemption is atomic; local fix adds DB-backed failed-attempt throttling by user/IP. | Validation pending | Deploy migration/function and verify throttling behavior. |
| CI validates STT flows | CI evidence | CI validates mocked orchestration; real mic, WebGPU, Safari, and hardware behavior require manual validation. | Partially true | Complete manual hardware checklist. |
| Lighthouse performance ready | Release readiness table | Recent local audit showed Performance varying around 87-90, not 96. | Stale | Re-run release Lighthouse and set launch threshold/policy. |
| Billing ready | Architecture / roadmap | Stripe flow has tests, but live webhook/environment verification remains pending. | Pending | Complete launch environment checklist and live webhook smoke. |
| Full transcript is stored in DB | Runtime code / session RPCs | Current code stores transcript text via session create/finalize so WER, cached AI suggestions, PDF regeneration, and session comparison have source text. | Confirmed runtime truth | Treat transcript persistence as the zero-day coaching contract; revisit redaction/encryption as a post-launch privacy enhancement. |
| PRD coverage table should update locally | Older expectation | `update-prd-metrics.mjs` writes local SQM/coverage output to console. | Clarified | Do not treat stale markdown coverage table as local CI failure. |

---

## 🏗️ Post-Launch Operational Debt (P2)

| ID | Task | Impact | Status |
| :--- | :--- | :--- | :--- |
| **D1** | **Purge Test-Aware Branches** | Architectural Integrity | 🔴 PLANNED |
| **D2** | **WPM Rolling Window Fix** | Logic Accuracy | 🔴 PLANNED |
| **D3** | **Document Console-Based PRD/SQM Metrics Workflow** | Transparency | 🟡 CLARIFIED |
| **D4** | **Validate NOT VALID Constraints Against Existing Data** | Data Integrity | 🔴 PLANNED |
| **D5** | **Gate Store-Creation Console Warning Behind DEV** | Polish | 🟡 FIX APPLIED / VALIDATION PENDING |
| **D6** | **Lazy Stripe Secret Initialization** | Operability | 🟡 FIX APPLIED / VALIDATION PENDING |

---

## 📋 Evidence Registry

- **Audit Report**: [release_audit.md](./release_audit.md)
- **Architecture**: [ARCHITECTURE.md](../docs/ARCHITECTURE.md)
- **Product Specs**: [PRD.md](../docs/PRD.md)
- **Infrastructure Probe**: [infra.probe.e2e.spec.ts](../tests/e2e/infra.probe.e2e.spec.ts)

---

## ✍️ Auditor Final Comments
*The core transcription technology is production-grade. The blocking issues are concentrated in the 'Economic Perimeter'—the logic that protects the business from cost overruns and abuse. Resolving these 4-5 backend items will transition the product from a liability to a launchable asset.*
