**Owner:** [unassigned]
**Last Reviewed:** 2026-05-19
**Version:** v0.6.18
**Last Updated:** 2026-05-19

# Release Readiness Checklist (Launch Gate)

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

This document serves as the final authoritative gate for the SpeakSharp production launch. Controlled tester readiness and broad public launch readiness are intentionally separated.

## 🟡 Current Verdict: Controlled Tester GO WITH LIMITATIONS / Public Launch NO-GO

## Final Launch Gate

Controlled tester status: **GO WITH LIMITATIONS**

Public launch status: **NO-GO**

### Required Before Launch

- [x] Controlled desktop tester release packet is green with documented limitations.
- [x] CI/Test Audit is green on `main`: run `25994869503`.
- [x] Production canary is green on `main`: scheduled run `26085357729`; push run `25994869500`.
- [x] Edge Function deploy is green on `main`: run `25994869506`.
- [x] Scheduled soak is green on `main`: run `26083232887`.
- [x] Lighthouse release scores meet the current floor: Performance 98, Accessibility 94, Best Practices 100, SEO 100.
- [x] GitHub artifact action Node 20 warning is resolved by commit `1066ba6d`.
- [x] Public signup, public Basic first-use, promo, AI, PDF, mobile viewport, and observability gates have current public-launch evidence in `PUBLIC_LAUNCH_LEDGER.md`.
- [ ] Live production Stripe checkout with `cs_live_...` is proven.
- [ ] Live production Stripe webhook entitlement propagation is proven.
- [ ] Live cancel/failure/downgrade event behavior is proven.
- [x] Physical real-mic Pro Cloud proof is completed: manual Chrome mic session `130bbc6c-5d89-465d-91e6-51f5a5951e34`.
- [ ] Physical mobile-device pass is completed before broad mobile/public traffic is treated as green.
- [ ] Launch environment checklist is completed with final production/live keys.

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
| **G3** | **Non-Negative Duration Constraint**| Integrity | ✅ **LIVE NEGATIVE-DURATION SMOKE PASSED** |
| **G4** | **Promo Rate Limiting** | Security | 🟡 **ONE-TIME/REUSE VERIFIED / THROTTLE PENDING** |
| **G5** | **Production Secret Audit** | Security | 🟡 IN REVIEW |

---

## 📈 Quality & Performance Gates (P1)

| ID | Requirement | Category | Status |
| :--- | :--- | :--- | :--- |
| **Q1** | **Pro Session Warning UI** | UX | 🟡 CI GREEN / LIVE VALIDATION PENDING |
| **Q2** | **Safe LLM JSON Parsing** | Reliability| 🟡 LOCAL FALLBACK HARDENED / LIVE VALIDATION PENDING |
| **Q3** | **Lighthouse SEO Score > 90** | Marketing | ✅ READY (SEO 100) |
| **Q4** | **Lighthouse Perf Score Policy**| Performance| ✅ READY (Performance 98, Accessibility 94, Best Practices 100, SEO 100) |
| **Q5** | **Request-Aware CORS on Usage Edge Function** | Security | ✅ LIVE HEADER VALIDATED |

---

## Feature Validation Status Matrix

This matrix tracks user-visible feature readiness. A feature is not release-ready until code behavior, automated evidence, and required manual validation agree.

| Feature Area | User Promise | Current Evidence | Status | Required Before Test Release |
|---|---|---|---|---|
| **Native STT** | Free/basic browser transcription can start, stop, save, and analyze a session through the browser's speech implementation. | GitHub `Live Release Matrix` run `25632720717` reached a Pro Native preflight with runtime ready, mode selected, Start enabled, recording started, and session save true. Transcript stayed `Listening...` under Chromium fake-audio, which is now classified as a Web Speech harness limitation unless manual Chrome also fails. | 🟡 MANUAL TRANSCRIPT PROOF REQUIRED | Use GitHub Native only as readiness/save/no-crash evidence. Complete Chrome desktop real-mic transcript/save/history/analytics validation; verify Safari support or document limitation. |
| **All STT Artifact Path** | Private, Cloud, and Native each record a fixture transcript, save, open analytics detail, get AI feedback, and export a transcript-bearing PDF. | Private previously passed this path in run `25634578516`. Cloud-focused run `25689485321` on `5ab21c00` produced the full product artifact evidence: non-placeholder Cloud transcript (`A stale smell of old beer`), analytics detail `/analytics/408be035-ed2f-4603-933a-84fe35545741`, live Gemini response HTTP 200, and parsed PDF `session_20260511_e62369e1_ef68_417b_a303_f3e0c2eba441.pdf` with transcript text. The workflow still concluded red because the `afterEach` cleanup waited for session controls after the test had navigated to analytics; local harness fix bounds that cleanup. Native still requires manual Chrome proof. | 🟡 CLOUD PRODUCT PATH PROVED / HARNESS RERUN REQUIRED | Push the cleanup fix and rerun `Pro STT Artifact Matrix` with `mode=cloud` once. Count Cloud green only when the rerun exits green; if it regresses in the product path, patch one failing row only or de-scope Cloud from tester instructions after the focused cycle. |
| **Private STT Default** | Pro users see Private as the recommended/default STT mode. | Recent STT UX work orders Private first; mocked E2E covers orchestration. | 🟡 PENDING | Browser-test new Pro/promo user landing state. |
| **Private Download & Cache** | Missing model shows explicit setup/download/progress, then reuses browser cache on later starts. | Code now probes Whisper Turbo's real IndexedDB model stores and normalizes progress values for UI display. The same-origin CPU bundle includes verified split Transformers.js ONNX files plus tokenizer/config metadata. Local `@xenova/transformers` pipeline load succeeds with `allowRemoteModels=false`. Run `25634578516` proved Private transcript/save/history/AI/PDF artifact path. Run `25642824527` proved first-start cache population, second-start reuse, no second download prompt, and successful second recording start/stop. | ✅ LIVE ARTIFACT + CACHE PASSED | Keep Private artifact and cache proofs in release reruns. |
| **Private Engine Policy** | For launch, Private defaults to CPU/Transformers.js for deterministic first-use behavior. WebGPU/WhisperTurbo is an accelerated path only after support is verified or explicitly selected for validation. Native is an explicit recovery/baseline option after Private cannot run. | Unit tests reflect CPU-first default and explicit WebGPU override. Post-deploy DB/RPC smoke proved Pro promo users can save `engine='private'`; previous `engine_not_allowed_for_tier` blocker is cleared at the database layer. | 🟡 DB POLICY VERIFIED / BROWSER TRANSCRIPT PENDING | Validate CPU-first Private transcript/save/history end-to-end in a real browser, separately validate explicit WebGPU path as manual/hardware evidence, and verify no silent Cloud fallback. |
| **Cloud STT** | Pro users may explicitly choose Cloud as a first-class option. | Live Cloud token gates have passed, and GitHub `STT Ceiling Benchmarks` run `25643746457`, job `75268546634`, proved AssemblyAI at `0.00%` WER across all 10 Harvard WAV fixtures. Commit `cafcad8f` fixed mode authority, commit `1b9d1667` patched/deployed stale active-session concurrency handling (`Deploy Supabase Migrations` run `25687248801` succeeded), and commit `5ab21c00` preserved latest streaming partial text on stop. Focused Cloud run `25689485321` then reached transcript -> stop/save -> analytics detail -> Gemini -> PDF text. The only remaining Cloud-specific red is a Playwright cleanup timeout after evidence was printed. | 🟡 PRODUCT PATH PROVED / GREEN WORKFLOW RERUN PENDING | Push the harness cleanup fix and rerun `Pro STT Artifact Matrix` with `mode=cloud` once. If the rerun fails before artifact evidence, map to one Cloud row and patch only that row; if it fails again after that focused cycle, de-scope Cloud from tester instructions unless the failure is trivial and already fixed. |
| **Transcript Propagation** | Live transcript updates and `TRANSCRIPT_PULSE` telemetry come from the same successful path. | Current CI/Test Audit run `25994869503` is green on `main`. Public-launch ledger evidence now records Basic first-use PASS, Private/Cloud provider-level artifact evidence, physical real-mic Cloud proof, and PDF/AI proof. | 🟢 CONTROLLED TESTER + PUBLIC CLOUD EVIDENCE GREEN | Keep physical evidence separate from CI/provider-level evidence in future claims. |
| **Session Persistence** | Finalized sessions persist the full coaching-analysis snapshot needed for returning-user comparison: transcript, duration, total words, WPM, clarity, filler/custom word counts, pause metrics, AI suggestions, engine metadata, and optional ground-truth/WER fields. | Stop-session persistence now writes the shared analysis snapshot; targeted unit tests pass. Commit `479edda3` centralized session/page analytics metrics and commit `7790988d` aligned CI expectations with that product truth. | 🟡 FIX PUSHED / LIVE VALIDATION PENDING | Verify live save/read after Native, Private, and Cloud sessions. |
| **Analytics** | WPM, clarity, filler words, pause/session history, WER-ready fields, and trends are computed from the same source as the session page unless new persisted data justifies recalculation. | Session page, Analytics, persistence, PDF-adjacent report state, and tests now use shared metric helpers. Filler totals intentionally match live transcript highlighting, including `like`/`so`, so analytics no longer diverges from what the user saw during the session. Production canary run `25993614589` passed after the push. | 🟡 PATCH DEPLOYED / USER LIVE RECHECK PENDING | Browser-test Native/Cloud/Private sessions and verify WPM, clarity, filler, custom-word, and pause numbers change with input, then save/reload for session-over-session comparison. |
| **Custom/User Words** | User words persist to Supabase, are available next session, are saved into per-session analysis snapshots, and Cloud receives boost words when explicitly selected. | Mocked add/remove/detection E2E passed locally on 2026-05-10 (`tests/e2e/user-filler-words.e2e.spec.ts`, 7/7 including infra probe). Cloud unit coverage confirms `keyterms_prompt` is included only when Cloud starts with user words and omitted without user words. `Live Release Matrix` runs `25631920466` and `25632720717` passed `live-custom-words`, proving add -> logout/relogin -> visible -> cleanup against GitHub `E2E_FREE_*` secrets. The validation lint blocker from the control-character regex is fixed and full unit coverage passes. | ✅ LIVE LOGOUT-LOGIN PASSED | Keep the live matrix green on the next release rerun. |
| **PDF Export** | Exported PDF reflects current client-side transcript/report state and persisted metrics. Free/basic users may export without a count limit. All tiers, including Pro, receive SpeakSharp-branded/watermarked PDFs. | PDF generation is client-side. Local PDF proof has been improved to inspect generated PDF text and assert watermark commands for Free and Pro exports, but browser/live inspection remains pending. | 🟡 LOCAL PROOF IMPROVED / LIVE VALIDATION PENDING | Export a saved/current Free/basic and Pro session; inspect transcript/metrics and watermark behavior. |
| **Promo Pro Access** | Promo code grants select tester Pro access for the intended duration. Every promo code is one-time use; a redeemed code must not succeed again, even for the same user during the active promo window. Expired promo users must have an escape path and must not retain stale Pro-only backend access. | Post-deploy generated promo `1193119` granted Pro access and was rejected on reuse; generated promo `4132867` granted Pro access through the Edge Function. Post-deploy DB/RPC smoke proved the same promo-Pro class can save/read Private sessions. Focused deployed promo canary passed locally on 2026-05-10 with fresh code `7543246`: fresh redemption/returning Pro, reuse rejection, and no-promo free behavior passed 3/3 after allowlisting known benign Private startup diagnostics. GitHub run `25635969309` proved the 9-wrong-code throttle returns HTTP 429 after eight failures. | 🟡 CORE LIVE PATH VERIFIED / FULL BROWSER ARTIFACT PENDING | Rerun the browser artifact path as needed for current Private/Cloud matrix evidence; expired-promo UI/backend denial remains separate pending proof. |
| **Billing Upgrade** | Stripe checkout upgrades user only after verified webhook. | Stripe checkout readiness and signed webhook readiness are live-proved in GitHub run `25635969309` after deploy run `25635957996` deployed async Stripe signature verification. | ✅ WEBHOOK SMOKE PASSING | Keep Stripe checkout/webhook readiness in release reruns; full paid-upgrade transaction remains a pre-real-charge business validation. |
| **Future Basic Tier** | Free -> Basic turns the baseline tier into a paid plan after MVP stabilization. | Parked until current product bugs are cleared. User preference is no long-lived non-paying baseline before first human testers, but this migration should not start until live STT, analytics, promo, and CI gates are flat. Stripe test-mode prices can exercise checkout without real charges, but the app still needs coordinated copy, DB/Edge Function semantics, tests, and live Price ID configuration. | ⚪ PARKED / PRE-TESTER BUSINESS GATE | Revisit after current P0/P1 bugs are cleared and before first broad human tester rollout. |
| **Usage Quotas** | Usage limits protect users and business costs and fail closed on uncertainty. | Local fixes now cover fail-closed usage checks, usage-aware Cloud token issuance, and negative-duration DB guards. | 🟡 VALIDATION PENDING | Run targeted tests, deploy migration/functions, and verify over-limit denial on live infrastructure. |
| **Accuracy Benchmarks** | Accuracy claims are backed by `.wav` plus ground-truth WER runs before they appear as user-facing comparisons. | Cloud is benchmarked in GitHub run `25622187317` at 0.00% WER / 100.00% accuracy across 10 Harvard fixtures. Private CPU is benchmarked locally with repo Harvard WAV fixtures at 4.11% WER / 95.89% accuracy using `TransformersJS whisper-tiny.en (Node CPU)`. Browser live benchmark harness now defaults to real/live mode instead of mock E2E mode, but Native still produced insufficient transcript for a valid WER and WebGPU remains unmeasured. The user-facing comparison component shows "not benchmarked" when current WER evidence is missing. | 🟡 PARTIAL BENCHMARK EVIDENCE | Record Cloud history in `tests/STT_BENCHMARKS.json`, keep Private CPU baseline, and continue Native/WebGPU browser evidence work before advertising those ceilings. |
| **Observability** | Sentry/PostHog capture launch-relevant frontend/backend events. | Instrumentation exists. Live promo trace shows frontend Sentry transport reached the live ingest endpoint with HTTP 200, which is partial evidence only. Stripe checkout/webhook smoke is complete in run `25635969309`. Local mixed-environment Vitest command is not evidence because frontend Sentry tests require jsdom/Vite aliases and Edge Function tests run under Deno. | 🟡 FRONTEND TRANSPORT SEEN / DASHBOARD + EDGE PENDING | Verify the event appears in Sentry dashboard, trigger one Edge Function error/log ingest, verify PostHog launch events, and complete the launch env checklist. |
| **GitHub Canary Deploy Smoke** | Main-branch GitHub canary proves deployed auth/session/analytics path against real infrastructure. | GitHub production canary passed on `main` in scheduled run `26085357729`; push canary `25994869500`, Edge Function deploy `25994869506`, and scheduled soak `26083232887` also passed. | ✅ PASSING | Keep as required post-deploy smoke; investigate immediately if it regresses. |
| **Session Status UX** | Users see one clear status/progress surface, with no internal FSM/debug toasts obscuring the primary flow. | 2026-05-08 live browser testing found an internal `Sync: DOWNLOAD_REQUIRED` toast covering the Private model CTA; hotfix removes the internal sync toast path. Live testing also found the CTA disappears while setup is stuck initializing; hotfix restores `download-required` with retry copy when Private setup does not complete. Promo-expired copy no longer hardcodes "30-minute" access because promo duration varies. 2026-05-09 visible-browser testing found `Continue as Free` did not dismiss the expired-promo modal, trapping expired promo users. Current local fix simplifies the expired-promo dialog to two aligned choices only: Continue as Free or Upgrade to Pro. A focused UX review found toasts/status/chrome were too visually noisy. Current local patch keeps toasts top-right but constrains width and offsets below the nav, raises dialogs above toasts, hides the global mobile nav on `/session`, adds mobile bottom padding for the recording action bar, lightens the slate shell/grid, normalizes card/status surfaces, replaces clashing green status accents with quieter teal success, and keeps amber as the brand/action color across landing/auth/session/analytics/pricing. | 🟡 LOCAL FIX / DEPLOY VERIFICATION PENDING | Verify no sync toast after deploy; verify failed setup returns the download CTA; verify expired promo dialog can be dismissed; visually smoke-test status/toast behavior before wider tester rollout. |
| **CI Audit Runtime** | Required CI gives fast enough feedback to unblock next-day release fixes without hiding correctness failures. | Latest `CI - Test Audit` run `25994869503` passed on `main`; correctness is green. Runtime optimization remains release-velocity work, not a product blocker. | 🟡 PROMOTED RELEASE-VELOCITY WORK | After launch blockers are cleared, shard/split unit coverage by domain or package and preserve a single aggregate required result. |

### Latest Local Fix Status (2026-05-09)

| Area | Current State | Local Evidence | Still Required |
|---|---|---|---|
| Quota fail-closed | Code fix present; GitHub CI and Edge Function deploy are green on `56ce972`. | `CI - Test Audit` run `25610699098` passed; Edge Function deploy run `25610699101` passed. | Live Edge Function fail-closed validation. |
| Cloud token usage gate | Code fix present; GitHub CI and Edge Function deploy are green on `56ce972`. | `CI - Test Audit` run `25610699098` passed; deploy run `25610699101` passed. | Live Pro/over-limit token smoke. |
| Negative duration guards | Forward migration present; deploy workflow evidence is green. | Supabase migration deploy manual runs `25576997106` and `25573238473` passed on 2026-05-08; current CI is green on `56ce972`. | Verify negative increments reject against the deployed database. |
| Promo brute-force | Code + migration present; GitHub CI/deploy evidence is green on `56ce972`. | `CI - Test Audit` run `25610699098` passed; Edge Function deploy run `25610699101` passed. | Verify live throttling/reuse on the current deployment. |
| Canary harness | Code fix present for login route and production origin guard. | Production canary passed on `56ce972` in run `25610699109`. | Keep monitoring canary after each deploy. |
| AI suggestion parsing | Code fix present; latest local hardening also returns degraded fallback suggestions when Gemini is unavailable, not only when JSON is malformed. | `CI - Test Audit` run `25610699098` passed on the latest push; local `deno test --allow-env --allow-net backend/supabase/functions/get-ai-suggestions` passed 7 steps. | Push/rerun Edge deploy only for changes not included in `56ce972`, then live AI suggestion smoke. |
| Pro warning UI | Code fix present; GitHub CI is green on `56ce972`. | `CI - Test Audit` run `25610699098` passed. | Live/manual warning behavior validation. |
| Request-aware CORS | Usage and promo Edge Functions use the shared request-aware CORS helper; latest Edge Function deploy is green. | `check-usage-limit` OPTIONS with production origin returned `Access-Control-Allow-Origin: https://speaksharp-public.vercel.app`. `apply-promo` imports `corsHeaders(req)` and returns structured internal errors; Edge Function deploy run `25994869506` passed on `69ad3f13`. | Recheck deployed `apply-promo` OPTIONS after Edge deploys. |
| Private model cache/progress | DB/RPC private save/readback verified; browser audio validation pending. | `ModelManager` probes Whisper Turbo IndexedDB stores; store progress normalization clamps `0..1` and `0..100` inputs to UI percent. CPU/Transformers.js same-origin model assets are locally load-proven, Private routes through `PrivateWhisper`, and launch policy is CPU-first with explicit WebGPU validation. Live DB/RPC smoke saved/read `engine='private'` with transcript, WPM, filler words, and clarity. Live trace now reports audio RMS/peak at processor output and model inference start; transcript-presence probes use a 122.514s Harvard speech fixture so warmup cannot exhaust the source before recording evidence. | Prove browser transcript/cache behavior with GitHub/live runner after deploy. |
| Session analysis persistence | Code fix present; GitHub CI is green on `56ce972`. | `CI - Test Audit` run `25610699098` passed; selectors reload transcript, WER, pause, AI, custom-word, and engine metadata fields. | Live-test returning-user comparison. |
| Promo tester flow | Core entitlement and DB Private save/readback are live-verified; full browser artifact path remains pending. | Promo `1193119` granted Pro and was rejected on reuse; promo `4132867` granted Pro through `apply-promo`; DB/RPC smoke saved/read a Private session after the deployed policy migration. Full promo canary failed only because benign ONNX/model warnings were treated as fatal diagnostics after Pro assertions passed. | Fix live audio fixture and diagnostics allowlist, then rerun the browser artifact path and expired-promo seeded smoke. |
| Local release test gate | Deploy/canary/CI/soak gates are green on the latest pushed commit. | CI/Test Audit run `25994869503`, production canary run `25994869500`, Edge Function deploy run `25994869506`, scheduled production canary run `26085357729`, and scheduled soak run `26083232887` passed on `main` after commit `69ad3f13`. Physical real-mic Cloud proof is complete. | Keep public launch NO-GO until live Stripe and physical real-device/mobile caveats are resolved or explicitly scoped out. |

---

## Release Readiness Reconciliation

| Claim | Source | Runtime Evidence | Verdict | Action |
|---|---|---|---|---|
| Usage enforcement resolved | Roadmap / prior status docs | Local code now fails closed on `check_usage_limit` RPC/internal uncertainty; full gate evidence pending. | Validation pending | Run targeted tests and deployed Edge Function smoke. |
| Cloud STT access is protected | Architecture / prior status docs | Local code now checks usage eligibility before AssemblyAI token issuance; full gate evidence pending. | Validation pending | Run over-limit/pro-token smoke after deploy. |
| Negative duration abuse is blocked | RPC session guard | Forward migration adds table constraints and write-path guards for `update_user_usage` and `heartbeat_session`. | Validation pending | Apply migration and verify negative increments are rejected. |
| Promo redemption is secure | Promo migration notes | Redemption is atomic; local fix adds DB-backed failed-attempt throttling by user/IP. | Validation pending | Deploy migration/function and verify throttling behavior. |
| CI validates STT flows | CI evidence | CI validates mocked orchestration; real mic, WebGPU, Safari, hardware behavior, and first-use Private model setup require manual/live validation. | Partially true | Complete manual hardware checklist and production browser Private transcript test. |
| Lighthouse performance ready | Release readiness table | Current release Lighthouse scores are Performance 98, Accessibility 94, Best Practices 100, SEO 100. | Current | Preserve the release floor in CI/SQM gates. |
| Billing ready | Architecture / roadmap | Stripe flow has tests, but live webhook/environment verification remains pending. | Pending | Complete launch environment checklist and live webhook smoke. |
| Full transcript is stored in DB | Runtime code / session RPCs | Current code stores transcript text via session create/finalize so WER, cached AI suggestions, PDF regeneration, and session comparison have source text. | Confirmed runtime truth | Treat transcript persistence as the zero-day coaching contract; revisit redaction/encryption as a post-launch privacy enhancement. |
| PRD coverage table should update locally | Older expectation | `update-prd-metrics.mjs` writes local SQM/coverage output to console. | Clarified | Do not treat stale markdown coverage table as local CI failure. |

---

## 🏗️ Post-Launch Operational Debt (P2)

| ID | Task | Impact | Status |
| :--- | :--- | :--- | :--- |
| **D1** | **Purge Test-Aware Branches** | Architectural Integrity | 🔴 PLANNED |
| **D2** | **WPM Rolling Window Fix** | Logic Accuracy | 🟡 CONTROLLER GUARDED / STORE INVARIANT OPEN |
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
