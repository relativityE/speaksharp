**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18
**Last Updated:** 2026-05-09

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
- [x] Unit tests pass locally: `pnpm ci:unit` green with `106` files, `627 passed | 1 todo`. GitHub CI rerun pending after current push.
- [x] Mocked E2E tests pass locally: `pnpm test:e2e` green with `40 passed`, `0 failed`, `0 flaky`. GitHub CI rerun pending after current push.
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
| **Private Download & Cache** | Missing model shows explicit setup/download/progress, then reuses browser cache on later starts. | Code now probes Whisper Turbo's real IndexedDB model stores and normalizes progress values for UI display. A 2026-05-08 live promo browser test exposed a stale error hold on first-use cache miss; hotfix allows `FAILED -> DOWNLOAD_REQUIRED`, shows expected one-time setup copy, reports percent progress, and updates to cached/ready when complete. Follow-up live testing found the bundled CPU ONNX fallback file was a 15-byte `Entry not found` placeholder; the same-origin CPU bundle now includes the verified split Transformers.js ONNX files (`encoder_model_quantized.onnx` and `decoder_model_merged_quantized.onnx`) plus tokenizer/config metadata. Local `@xenova/transformers` pipeline load succeeds with `allowRemoteModels=false`. Latest code also fixes the null progress-callback crash and routes Private mode through `PrivateWhisper` so mic frames reach the local engine. CI does not prove real browser model-source/cache behavior. | 🟡 FIX APPLIED / LIVE TRANSCRIPT VALIDATION PENDING | Deploy current fix, then headed Chrome validation with cache clear, first setup, second cached start, live transcript, save, and history readback. |
| **Private Engine Policy** | For launch, Private defaults to CPU/Transformers.js for deterministic first-use behavior. WebGPU/WhisperTurbo is an accelerated path only after support is verified or explicitly selected for validation. Native is an explicit recovery/baseline option after Private cannot run. | Unit tests were updated to reflect CPU-first default and explicit WebGPU override. Local browser validation has proven same-origin CPU model assets load; live transcript validation is still pending. | 🟡 FIX APPLIED / LIVE TRANSCRIPT VALIDATION PENDING | Validate CPU-first Private path end-to-end; separately validate explicit WebGPU path as manual/hardware evidence; verify no silent Cloud fallback. |
| **Cloud STT** | Pro users may explicitly choose Cloud as a first-class option. | Auth/pro gating exists; usage-aware token issuance fix is applied locally. | 🟡 VALIDATION PENDING | Verify over-limit denial and successful Pro token issuance after deploy. |
| **Transcript Propagation** | Live transcript updates and `TRANSCRIPT_PULSE` telemetry come from the same successful path. | Recent SpeechRuntime fixes target this path. Local `pnpm ci:unit` is green (`106` files, `627 passed | 1 todo`), focused flaky-area E2E is green (`17/17`), and full mocked E2E is green (`40/40`, `0 flaky`). Latest pushed GitHub CI is red until current fixes are pushed and rerun. | 🟡 LOCAL GREEN / GITHUB VALIDATION PENDING | Push current fixes, review latest `CI - Test Audit`, and spot-check browser console during manual session. |
| **Session Persistence** | Finalized sessions persist the full coaching-analysis snapshot needed for returning-user comparison: transcript, duration, total words, WPM, clarity, filler/custom word counts, pause metrics, AI suggestions, engine metadata, and optional ground-truth/WER fields. | Code now writes richer stop-session analysis and reloads the full analysis field set; targeted unit tests pass. | 🟡 FIX APPLIED / LIVE VALIDATION PENDING | Verify live save/read after Native, Private, and Cloud sessions. |
| **Analytics** | WPM, clarity, filler words, pause/session history, WER-ready fields, and trends are computed from saved data and available for comparison when the user returns. | Analytics UI E2E passed; analysis persistence contract unit tests pass; WPM rolling-window issue remains P2. | 🟡 FIX APPLIED / LIVE VALIDATION PENDING | Browser-test session-over-session analytics after logout/login and accept/defer WPM P2 explicitly. |
| **Custom/User Words** | User words persist to Supabase, are available next session, are saved into per-session analysis snapshots, and Cloud receives boost words when explicitly selected. | Add/remove/detection E2E passed; per-session custom word snapshot now persists on stop. | 🟡 FIX APPLIED / LIVE VALIDATION PENDING | Live Pro test: add word, refresh/login, record Native/Private/Cloud session, verify persistence and keyterms behavior. |
| **PDF Export** | Exported PDF reflects current client-side transcript/report state and persisted metrics. Free/basic users may export without a count limit. All tiers, including Pro, receive SpeakSharp-branded/watermarked PDFs. | PDF generation is client-side; watermark behavior is covered by E2E signal and still needs browser inspection. | 🟡 PENDING | Export a saved/current Free/basic and Pro session; inspect transcript/metrics and watermark behavior. |
| **Promo Pro Access** | Promo code grants select tester Pro access for the intended duration. Every promo code is one-time use; a redeemed code must not succeed again, even for the same user during the active promo window. | Mocked promo E2E passes valid promo, invalid inline error, and invalid-with-valid-credentials fallback. DB-backed attempt throttling and one-time redemption are deployed. Production promo canary passed new-user redemption, reuse rejection, and no-promo baseline; visible browser test also redeemed a live promo and landed in Pro. | 🟢 LIVE SMOKE PASSED / TESTER QA IN PROGRESS | Continue live tester QA with fresh one-time codes; keep code duration short for external testers. |
| **Billing Upgrade** | Stripe checkout upgrades user only after verified webhook. | Stripe flow has tests; live webhook/env verification pending. | 🟡 PENDING | Complete live low-value transaction and webhook smoke. |
| **Future Basic Tier** | Free -> Basic turns the baseline tier into a paid plan after MVP stabilization. | Deferred by release policy; Stripe test-mode prices can exercise checkout without real charges, but the app still needs coordinated copy, DB/Edge Function semantics, tests, and live Price ID configuration. | ⚪ DEFERRED | Revisit only after MVP test-release baseline is green, tagged, and impounded. |
| **Usage Quotas** | Usage limits protect users and business costs and fail closed on uncertainty. | Local fixes now cover fail-closed usage checks, usage-aware Cloud token issuance, and negative-duration DB guards. | 🟡 VALIDATION PENDING | Run targeted tests, deploy migration/functions, and verify over-limit denial on live infrastructure. |
| **Accuracy Benchmarks** | Accuracy claims are backed by `.wav` plus ground-truth WER runs. | Workflow harness fixes applied locally for pnpm version, AssemblyAI command, browser benchmark specs, and canonical `tests/STT_BENCHMARKS.json` path. | 🟡 GITHUB RERUN PENDING | Rerun AssemblyAI/browser benchmarks and record WER. |
| **Observability** | Sentry/PostHog capture launch-relevant frontend/backend events. | Instrumentation exists; live project ingest is pending. | 🟡 PENDING | Send frontend error, Edge Function error, and key product analytics events. |
| **GitHub Canary Deploy Smoke** | Main-branch GitHub canary proves deployed auth/session/analytics path against real infrastructure. | GitHub production canary is passing on main after the `/auth/signin` route fix; latest observed scheduled run also passed. | ✅ PASSING | Keep as required post-deploy smoke; investigate immediately if it regresses. |
| **Session Status UX** | Users see one clear status/progress surface, with no internal FSM/debug toasts obscuring the primary flow. | 2026-05-08 live browser testing found an internal `Sync: DOWNLOAD_REQUIRED` toast covering the Private model CTA; hotfix removes the internal sync toast path. Live testing also found the CTA disappears while setup is stuck initializing; hotfix restores `download-required` with retry copy when Private setup does not complete. Promo-expired copy no longer hardcodes "30-minute" access because promo duration varies. 2026-05-09 visible-browser testing found `Continue as Free` did not dismiss the expired-promo modal; local fix adds current-session dismissal and targeted component coverage passes. Overall layout still needs a focused UX pass after functional Private validation. | 🟡 HOTFIX APPLIED / UX PASS NEEDED | Verify no sync toast after deploy; verify failed setup returns the download CTA; verify expired promo dialog can be dismissed; redesign status/download/progress surfaces before wider tester rollout. |

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
| Private model cache/progress | Hotfix in progress for current checkpoint. | `ModelManager` probes Whisper Turbo IndexedDB stores; store progress normalization clamps `0..1` and `0..100` inputs to UI percent. 2026-05-08 browser testing found stale error state on first-use cache miss and a later stuck `Initializing engine...` state after failed Private setup; targeted local tests for FSM/TranscriptionService/TransformersJS pass after retry-state fix. CPU/Transformers.js same-origin model assets are now locally load-proven, Private now routes through `PrivateWhisper`, and launch policy is CPU-first with explicit WebGPU validation. | Push current fix, deploy, then perform headed browser cache/download/transcript validation. |
| Session analysis persistence | Code fix local, pending push in current checkpoint. | `storage.test.ts` and `SttSafeguards.test.ts` pass; selectors reload transcript, WER, pause, AI, custom-word, and engine metadata fields. | Push, run CI, and live-test returning-user comparison. |
| Promo tester flow | Mocked and live smoke passing; current deployment still needs latest local fixes. | `promo-admin-journey.e2e.spec.ts` is aligned to profile hydration for entitlement assertions instead of engine readiness; full local mocked E2E now passes `40/40` with `0 flaky`. `PROMO_GEN_ADMIN_SECRET` is present in GitHub secrets; manual generator workflow generated one-time live codes; production promo canary verified redemption, reuse rejection, and no-promo baseline. | Push current fixes, continue live user QA with fresh one-time codes, and document bugs found during tester sessions. |
| Local release test gate | Local green after readiness and mock-mic fixes. | `pnpm ci:unit` passed (`106` files, `627 passed | 1 todo`); `pnpm test:e2e` passed (`40 passed`, `0 flaky`); targeted promo expired component tests passed (`15/15`); frontend typecheck is clean. | Push current fixes, review GitHub CI and production canary after deploy. |

---

## Release Readiness Reconciliation

| Claim | Source | Runtime Evidence | Verdict | Action |
|---|---|---|---|---|
| Usage enforcement resolved | Roadmap / prior status docs | Local code now fails closed on `check_usage_limit` RPC/internal uncertainty; full gate evidence pending. | Validation pending | Run targeted tests and deployed Edge Function smoke. |
| Cloud STT access is protected | Architecture / prior status docs | Local code now checks usage eligibility before AssemblyAI token issuance; full gate evidence pending. | Validation pending | Run over-limit/pro-token smoke after deploy. |
| Negative duration abuse is blocked | RPC session guard | Forward migration adds table constraints and write-path guards for `update_user_usage` and `heartbeat_session`. | Validation pending | Apply migration and verify negative increments are rejected. |
| Promo redemption is secure | Promo migration notes | Redemption is atomic; local fix adds DB-backed failed-attempt throttling by user/IP. | Validation pending | Deploy migration/function and verify throttling behavior. |
| CI validates STT flows | CI evidence | CI validates mocked orchestration; real mic, WebGPU, Safari, hardware behavior, and first-use Private model setup require manual/live validation. | Partially true | Complete manual hardware checklist and production browser Private transcript test. |
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
