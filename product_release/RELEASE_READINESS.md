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

- [ ] P0 quota fail-open fixed. Code fix is in `9dff649`; GitHub CI and deploy workflows are green, but live fail-closed smoke is still pending.
- [ ] P0 Cloud token issuance checks usage limits before minting paid tokens. Code fix is in `9dff649`; GitHub CI and Edge Function deploy are green, but live Pro/over-limit token smoke is still pending.
- [ ] P0 usage RPCs reject negative abuse-path increments. Forward migration is present; deploy workflow evidence is green, but negative-increment smoke is still pending.
- [ ] P0 promo redemption has brute-force protection. Code and migration fixes are present; GitHub CI/deploy evidence is green, but current live throttling/reuse smoke is still pending.
- [x] Unit tests and mocked E2E are green in GitHub `CI - Test Audit` on `9dff649` (`exclude forensic probes from release e2e`, run `25602605844`).
- [x] Production deploy smoke is green: `canary.yml` passed on `9dff649` (run `25602605839`) and `deploy-edge-functions.yml` passed on the same push (run `25602605834`).
- [ ] Live promo entitlement path is retested after DB policy migration. Entitlement worked, and the Private CPU model was served/initialized, but Private save failed with `engine_not_allowed_for_tier`; deploy/retest `backend/supabase/migrations/20260509000000_allow_private_engine_for_pro.sql`.
- [ ] Expired promo user trap fix is deployed and verified. Local fix dismisses `Continue as Free`, but production still needs deploy/live verification.
- [ ] Expired promo backend entitlement is fail-closed across Pro-only paths. Local fixes now guard AssemblyAI token issuance and add DB effective-tier migration `backend/supabase/migrations/20260509010000_enforce_effective_promo_tier.sql`; deploy/live smoke pending.
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
| **Q1** | **Pro Session Warning UI** | UX | 🟡 CI GREEN / LIVE VALIDATION PENDING |
| **Q2** | **Safe LLM JSON Parsing** | Reliability| 🟡 CI/DEPLOY GREEN / LIVE VALIDATION PENDING |
| **Q3** | **Lighthouse SEO Score > 90** | Marketing | ✅ READY (91 local audit) |
| **Q4** | **Lighthouse Perf Score Policy**| Performance| 🟡 CI GREEN / POLICY ADVISORY (90 remains target; performance assertion is advisory for MVP) |
| **Q5** | **Request-Aware CORS on Usage Edge Function** | Security | 🟡 CI/DEPLOY GREEN / HEADER VALIDATION PENDING |

---

## Feature Validation Status Matrix

This matrix tracks user-visible feature readiness. A feature is not release-ready until code behavior, automated evidence, and required manual validation agree.

| Feature Area | User Promise | Current Evidence | Status | Required Before Test Release |
|---|---|---|---|---|
| **Native STT** | Free/basic browser transcription can start, stop, save, and analyze a session. | Mocked E2E covers the primary journey; manual mic behavior is not yet complete. | 🟡 PENDING | Complete Chrome/Safari/Firefox/iPhone mic checklist. |
| **Private STT Default** | Pro users see Private as the recommended/default STT mode. | Recent STT UX work orders Private first; mocked E2E covers orchestration. | 🟡 PENDING | Browser-test new Pro/promo user landing state. |
| **Private Download & Cache** | Missing model shows explicit setup/download/progress, then reuses browser cache on later starts. | Code now probes Whisper Turbo's real IndexedDB model stores and normalizes progress values for UI display. A 2026-05-08 live promo browser test exposed a stale error hold on first-use cache miss; hotfix allows `FAILED -> DOWNLOAD_REQUIRED`, shows expected one-time setup copy, reports percent progress, and updates to cached/ready when complete. Follow-up live testing found the bundled CPU ONNX fallback file was a 15-byte `Entry not found` placeholder; the same-origin CPU bundle now includes the verified split Transformers.js ONNX files (`encoder_model_quantized.onnx` and `decoder_model_merged_quantized.onnx`) plus tokenizer/config metadata. Local `@xenova/transformers` pipeline load succeeds with `allowRemoteModels=false`. Latest live promo testing proved the Private CPU model is served and initializes, but transcript/save/history are not yet proven because save failed on the DB engine policy. | 🟡 MODEL SERVED / SAVE RETEST PENDING | Deploy/retest `backend/supabase/migrations/20260509000000_allow_private_engine_for_pro.sql`, then headed Chrome validation with cache clear, first setup, second cached start, live transcript, save, and history readback. |
| **Private Engine Policy** | For launch, Private defaults to CPU/Transformers.js for deterministic first-use behavior. WebGPU/WhisperTurbo is an accelerated path only after support is verified or explicitly selected for validation. Native is an explicit recovery/baseline option after Private cannot run. | Unit tests were updated to reflect CPU-first default and explicit WebGPU override. Local browser validation has proven same-origin CPU model assets load; live promo testing proved the model is served/initialized, but the deployed DB currently rejects Private save for Pro with `engine_not_allowed_for_tier`. | 🟡 MIGRATION PENDING / LIVE RETEST REQUIRED | Deploy/retest `20260509000000_allow_private_engine_for_pro.sql`; then validate CPU-first Private transcript/save/history end-to-end, separately validate explicit WebGPU path as manual/hardware evidence, and verify no silent Cloud fallback. |
| **Cloud STT** | Pro users may explicitly choose Cloud as a first-class option. | Auth/pro gating exists; usage-aware token issuance fix is applied locally. AssemblyAI token issuance now denies expired promo-only users before minting paid tokens; DB effective-tier migration covers session/heartbeat paths. | 🟡 LOCAL PATCH / LIVE VALIDATION PENDING | Verify active Pro token issuance, over-limit denial, free denial, and expired promo denial after deploy. |
| **Transcript Propagation** | Live transcript updates and `TRANSCRIPT_PULSE` telemetry come from the same successful path. | Recent SpeechRuntime fixes target this path. GitHub `CI - Test Audit` is green on `9dff649`, including the mocked E2E gate. CI still does not prove real microphone/live transcript behavior. | 🟡 CI GREEN / LIVE VALIDATION PENDING | Spot-check browser console during manual/live sessions and keep the live feature matrix pending until transcript/save/history proof exists. |
| **Session Persistence** | Finalized sessions persist the full coaching-analysis snapshot needed for returning-user comparison: transcript, duration, total words, WPM, clarity, filler/custom word counts, pause metrics, AI suggestions, engine metadata, and optional ground-truth/WER fields. | Code now writes richer stop-session analysis and reloads the full analysis field set; targeted unit tests pass. | 🟡 FIX APPLIED / LIVE VALIDATION PENDING | Verify live save/read after Native, Private, and Cloud sessions. |
| **Analytics** | WPM, clarity, filler words, pause/session history, WER-ready fields, and trends are computed from saved data and available for comparison when the user returns. | GitHub CI is green on `9dff649`. A newer local analytics correctness patch preserves persisted WPM/clarity values for comparisons instead of recalculating from legacy fields, but that patch is not yet part of pushed green evidence. WPM rolling-window issue remains P2. | 🟡 LOCAL PATCH / LIVE VALIDATION PENDING | Test the local analytics correctness patch, then browser-test session-over-session analytics after logout/login and accept/defer WPM P2 explicitly. |
| **Custom/User Words** | User words persist to Supabase, are available next session, are saved into per-session analysis snapshots, and Cloud receives boost words when explicitly selected. | Add/remove/detection E2E passed; per-session custom word snapshot now persists on stop. | 🟡 FIX APPLIED / LIVE VALIDATION PENDING | Live Pro test: add word, refresh/login, record Native/Private/Cloud session, verify persistence and keyterms behavior. |
| **PDF Export** | Exported PDF reflects current client-side transcript/report state and persisted metrics. Free/basic users may export without a count limit. All tiers, including Pro, receive SpeakSharp-branded/watermarked PDFs. | PDF generation is client-side. Local PDF proof has been improved to inspect generated PDF text and assert watermark commands for Free and Pro exports, but browser/live inspection remains pending. | 🟡 LOCAL PROOF IMPROVED / LIVE VALIDATION PENDING | Export a saved/current Free/basic and Pro session; inspect transcript/metrics and watermark behavior. |
| **Promo Pro Access** | Promo code grants select tester Pro access for the intended duration. Every promo code is one-time use; a redeemed code must not succeed again, even for the same user during the active promo window. Expired promo users must have an escape path and must not retain stale Pro-only backend access. | GitHub CI, Edge Function deploy, and production canary are green on `9dff649`. Live promo entitlement worked, proving the tester received Pro access, but the Private artifact path did not complete because DB save failed with `engine_not_allowed_for_tier`. UI fix for the expired promo trap is local; backend Cloud token and DB effective-tier fixes are local. | 🟡 LOCAL FIXES / DEPLOY + LIVE RETEST PENDING | Deploy/retest `20260509000000_allow_private_engine_for_pro.sql` and `20260509010000_enforce_effective_promo_tier.sql`, then rerun the live promo artifact path with a fresh one-time code and verify Private transcript, save, analytics, AI feedback, PDF export, reuse rejection, and expired-promo denial. |
| **Billing Upgrade** | Stripe checkout upgrades user only after verified webhook. | Stripe flow has tests; live webhook/env verification pending. | 🟡 PENDING | Complete live low-value transaction and webhook smoke. |
| **Future Basic Tier** | Free -> Basic turns the baseline tier into a paid plan after MVP stabilization. | Deferred by release policy; Stripe test-mode prices can exercise checkout without real charges, but the app still needs coordinated copy, DB/Edge Function semantics, tests, and live Price ID configuration. | ⚪ DEFERRED | Revisit only after MVP test-release baseline is green, tagged, and impounded. |
| **Usage Quotas** | Usage limits protect users and business costs and fail closed on uncertainty. | Local fixes now cover fail-closed usage checks, usage-aware Cloud token issuance, and negative-duration DB guards. | 🟡 VALIDATION PENDING | Run targeted tests, deploy migration/functions, and verify over-limit denial on live infrastructure. |
| **Accuracy Benchmarks** | Accuracy claims are backed by `.wav` plus ground-truth WER runs before they appear as user-facing comparisons. | Benchmark harnesses exist, but the current manifest is not release-grade: Cloud has no history, Native has no numeric WER, and Private CPU history conflicts with `expectedAccuracy`. The browser fixture/reference mapping has a local fix so generated and committed Harvard benchmark WAVs use the same text as the WER ground truth. The user-facing comparison component now shows "not benchmarked" instead of fallback ceilings when current WER evidence is missing. Local Native WER attempt did not produce enough transcript for a valid score; local Private CPU WER attempt was blocked by mock `.env.test` credentials (`Invalid API key`). | 🔴 BLOCKED / TRUTHFUL UI PATCH LOCAL | Rerun Cloud/Native/Private CPU WER with real benchmark credentials/secrets, optionally run WebGPU as acceleration evidence, and record current WER before advertising benchmark ceilings. |
| **Observability** | Sentry/PostHog capture launch-relevant frontend/backend events. | Instrumentation exists; live project ingest is pending. | 🟡 PENDING | Send frontend error, Edge Function error, and key product analytics events. |
| **GitHub Canary Deploy Smoke** | Main-branch GitHub canary proves deployed auth/session/analytics path against real infrastructure. | GitHub production canary passed on `9dff649` (`exclude forensic probes from release e2e`, run `25602605839`); Edge Function deploy passed on the same push (`25602605834`). | ✅ PASSING | Keep as required post-deploy smoke; investigate immediately if it regresses. |
| **Session Status UX** | Users see one clear status/progress surface, with no internal FSM/debug toasts obscuring the primary flow. | 2026-05-08 live browser testing found an internal `Sync: DOWNLOAD_REQUIRED` toast covering the Private model CTA; hotfix removes the internal sync toast path. Live testing also found the CTA disappears while setup is stuck initializing; hotfix restores `download-required` with retry copy when Private setup does not complete. Promo-expired copy no longer hardcodes "30-minute" access because promo duration varies. 2026-05-09 visible-browser testing found `Continue as Free` did not dismiss the expired-promo modal, trapping expired promo users; local fix adds current-session dismissal and targeted component coverage passes, but deploy/live verification is pending. A focused UX review also found all toast severities were amber and the authenticated shell was visually noisy; local polish now separates toast severity colors, reduces global glow/grid intensity, and normalizes card borders while keeping amber as the brand/action color. | 🟡 LOCAL FIX / DEPLOY VERIFICATION PENDING | Verify no sync toast after deploy; verify failed setup returns the download CTA; verify expired promo dialog can be dismissed; visually smoke-test status/toast behavior before wider tester rollout. |

### Latest Local Fix Status (2026-05-09)

| Area | Current State | Local Evidence | Still Required |
|---|---|---|---|
| Quota fail-closed | Code fix present in `9dff649`; GitHub CI and Edge Function deploy are green. | `CI - Test Audit` run `25602605844` passed; Edge Function deploy run `25602605834` passed. | Live Edge Function fail-closed validation. |
| Cloud token usage gate | Code fix present in `9dff649`; GitHub CI and Edge Function deploy are green. | `CI - Test Audit` run `25602605844` passed; deploy run `25602605834` passed. | Live Pro/over-limit token smoke. |
| Negative duration guards | Forward migration present; deploy workflow evidence is green. | Supabase migration deploy manual runs `25576997106` and `25573238473` passed on 2026-05-08; current CI is green on `9dff649`. | Verify negative increments reject against the deployed database. |
| Promo brute-force | Code + migration present; GitHub CI/deploy evidence is green. | `CI - Test Audit` run `25602605844` passed; Edge Function deploy run `25602605834` passed. | Verify live throttling/reuse on the current deployment. |
| Canary harness | Code fix present for login route and production origin guard. | Production canary passed on `9dff649` in run `25602605839`. | Keep monitoring canary after each deploy. |
| AI suggestion parsing | Code fix present in `9dff649`; GitHub CI/deploy evidence is green. | `CI - Test Audit` run `25602605844` passed; Edge Function deploy run `25602605834` passed. | Live AI suggestion smoke. |
| Pro warning UI | Code fix present in `9dff649`; GitHub CI is green. | `CI - Test Audit` run `25602605844` passed. | Live/manual warning behavior validation. |
| Request-aware CORS | Code fix present in `9dff649`; GitHub CI and Edge Function deploy are green. | `check-usage-limit` uses shared request-aware `corsHeaders(req)`; Edge Function deploy run `25602605834` passed. | Verify deployed Edge Function CORS headers. |
| Private model cache/progress | CPU model served/initialized live; save retest pending after DB migration. | `ModelManager` probes Whisper Turbo IndexedDB stores; store progress normalization clamps `0..1` and `0..100` inputs to UI percent. CPU/Transformers.js same-origin model assets are locally load-proven, Private routes through `PrivateWhisper`, and launch policy is CPU-first with explicit WebGPU validation. Latest live promo run reached served/initialized Private CPU model state, but save failed with `engine_not_allowed_for_tier`. | Deploy/retest `backend/supabase/migrations/20260509000000_allow_private_engine_for_pro.sql`, then prove live transcript/save/history. |
| Session analysis persistence | Code fix present in `9dff649`; GitHub CI is green. | `CI - Test Audit` run `25602605844` passed; selectors reload transcript, WER, pause, AI, custom-word, and engine metadata fields. | Live-test returning-user comparison. |
| Promo tester flow | Entitlement worked; Private save blocked by DB engine policy; expired-promo escape and backend expiry checks are locally fixed but pending deploy/retest. | `CI - Test Audit` is green on `9dff649`; production canary passed on the same push. Live promo entitlement granted Pro access, but Private artifact validation stopped at save with `engine_not_allowed_for_tier`; migration `20260509000000_allow_private_engine_for_pro.sql` is pending deploy/retest. Local UI fix adds `Switch account`; AssemblyAI token fix denies expired promo-only Cloud access; DB effective-tier migration `20260509010000_enforce_effective_promo_tier.sql` treats expired promo-only users as Free for session/heartbeat paths. | Deploy/retest the migrations, rerun with a fresh one-time code, continue live user QA, and document bugs found during tester sessions. |
| Local release test gate | GitHub release gate is green on `9dff649`; local patch evidence has moved ahead for PDF, analytics, benchmark truth, UI polish, and Edge Function tests. | `CI - Test Audit` run `25602605844` passed; production canary run `25602605839` passed; Edge Function deploy run `25602605834` passed. Local `deno test --allow-env --allow-net backend/supabase/functions` passed 8 files / 36 steps. Local-only follow-up work adds `pnpm test:edge` to CI and improves PDF/analytics correctness, but latest GitHub evidence is pending. | Keep live feature matrix pending until deployed browser validation proves Native/Private/Cloud transcript, save, analytics, and export paths. |

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
