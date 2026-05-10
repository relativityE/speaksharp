**Owner:** [unassigned]
**Last Reviewed:** 2026-05-06
**Version:** v0.6.18
**Last Updated:** 2026-05-10

# Release Readiness Checklist (Launch Gate)

This document serves as the final authoritative gate for the SpeakSharp production launch. All P0 and P1 items must be marked ✅ before the verdict transitions to **READY**.

## 🔴 Current Verdict: BLOCKED

## Final Launch Gate

Launch status: **NOT READY**

### Required Before Launch

- [ ] P0 quota fail-open fixed. Code is deployed; live unauthenticated structured-deny and authenticated Free happy path are verified, but RPC/DB-error fail-closed simulation remains pending.
- [ ] P0 Cloud token issuance checks usage limits before minting paid tokens. Live Free denial and active promo-Pro token issuance are verified; over-limit and expired-promo denial remain pending.
- [x] P0 usage RPCs reject negative abuse-path increments. Live `update_user_usage(-100, 'native')` returned `invalid_duration` after deploy.
- [ ] P0 promo redemption has brute-force protection. Live fresh one-time promo redemption and reuse rejection are verified; 9-wrong-code throttling remains pending.
- [ ] Unit tests and mocked E2E are green in the latest GitHub `CI - Test Audit`: latest pushed run `25623359127` on `e177bc7c` is still running, but shard 4 has already failed. Logs are unavailable until the run completes. Focused local validation for the shard-4 user-features fix passed 7/7 before push, so inspect the completed shard-4 logs before patching.
- [x] Production deploy smoke is green on the latest pushed commit: Edge Function deploy run `25623359118` passed on `e177bc7c`; `Production Canary Smoke Test` run `25623359125` passed on the same commit.
- [x] Live promo entitlement path is retested after DB policy migration at the DB/RPC layer. A promo Pro user can save/read a `private` session with transcript, WPM, filler words, and clarity persisted. Browser Private audio transcript remains pending, but the invalid live Playwright fixture has been removed and live configs now point to the real app-contained Harvard WAV fixture.
- [ ] Expired promo user trap fix is deployed and verified. Local fix dismisses `Continue as Free`, but production still needs deploy/live verification.
- [ ] Expired promo backend entitlement is fail-closed across Pro-only paths. Effective-tier migration is deployed; seeded expired-promo live smoke remains pending.
- [ ] Stripe live webhook verified.
- [ ] Sentry live ingest verified. Frontend transport evidence exists from the live promo trace: POST to the Sentry ingest host returned HTTP 200. Dashboard visibility, Edge Function ingest, and PostHog launch-event review remain pending.
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
| **G3** | **Non-Negative Duration Constraint**| Integrity | ✅ **LIVE NEGATIVE-DURATION SMOKE PASSED** |
| **G4** | **Promo Rate Limiting** | Security | 🟡 **ONE-TIME/REUSE VERIFIED / THROTTLE PENDING** |
| **G5** | **Production Secret Audit** | Security | 🟡 IN REVIEW |

---

## 📈 Quality & Performance Gates (P1)

| ID | Requirement | Category | Status |
| :--- | :--- | :--- | :--- |
| **Q1** | **Pro Session Warning UI** | UX | 🟡 CI GREEN / LIVE VALIDATION PENDING |
| **Q2** | **Safe LLM JSON Parsing** | Reliability| 🟡 LOCAL FALLBACK HARDENED / LIVE VALIDATION PENDING |
| **Q3** | **Lighthouse SEO Score > 90** | Marketing | ✅ READY (91 local audit) |
| **Q4** | **Lighthouse Perf Score Policy**| Performance| 🟡 CI GREEN / POLICY ADVISORY (90 remains target; performance assertion is advisory for MVP) |
| **Q5** | **Request-Aware CORS on Usage Edge Function** | Security | ✅ LIVE HEADER VALIDATED |

---

## Feature Validation Status Matrix

This matrix tracks user-visible feature readiness. A feature is not release-ready until code behavior, automated evidence, and required manual validation agree.

| Feature Area | User Promise | Current Evidence | Status | Required Before Test Release |
|---|---|---|---|---|
| **Native STT** | Free/basic browser transcription can start, stop, save, and analyze a session. | Mocked E2E covers the primary journey; manual mic behavior is not yet complete. | 🟡 PENDING | Complete Chrome/Safari/Firefox/iPhone mic checklist. |
| **Private STT Default** | Pro users see Private as the recommended/default STT mode. | Recent STT UX work orders Private first; mocked E2E covers orchestration. | 🟡 PENDING | Browser-test new Pro/promo user landing state. |
| **Private Download & Cache** | Missing model shows explicit setup/download/progress, then reuses browser cache on later starts. | Code now probes Whisper Turbo's real IndexedDB model stores and normalizes progress values for UI display. The same-origin CPU bundle includes verified split Transformers.js ONNX files plus tokenizer/config metadata. Local `@xenova/transformers` pipeline load succeeds with `allowRemoteModels=false`. Post-deploy DB/RPC smoke verified a promo Pro user can save/read a `private` session with transcript, WPM, filler words, and clarity. The invalid `tests/fixtures/10sec.wav` HTML fixture has been removed; live configs now inject `tests/fixtures/harvard_benchmark_16k.wav`. | 🟡 DB SAVE VERIFIED / BROWSER TRANSCRIPT PENDING | Run headed Chrome/Playwright validation with cache clear, first setup, second cached start, live transcript, save, and history readback. |
| **Private Engine Policy** | For launch, Private defaults to CPU/Transformers.js for deterministic first-use behavior. WebGPU/WhisperTurbo is an accelerated path only after support is verified or explicitly selected for validation. Native is an explicit recovery/baseline option after Private cannot run. | Unit tests reflect CPU-first default and explicit WebGPU override. Post-deploy DB/RPC smoke proved Pro promo users can save `engine='private'`; previous `engine_not_allowed_for_tier` blocker is cleared at the database layer. | 🟡 DB POLICY VERIFIED / BROWSER TRANSCRIPT PENDING | Validate CPU-first Private transcript/save/history end-to-end in a real browser, separately validate explicit WebGPU path as manual/hardware evidence, and verify no silent Cloud fallback. |
| **Cloud STT** | Pro users may explicitly choose Cloud as a first-class option. | Live Free denial returned HTTP 403; live active promo-Pro token request returned HTTP 200 with a 600-second token. AssemblyAI token issuance also contains expired promo-only denial logic, and DB effective-tier migration is deployed. | 🟡 FREE/PRO VERIFIED / OVER-LIMIT + EXPIRED PENDING | Verify over-limit denial and seeded expired-promo denial. |
| **Transcript Propagation** | Live transcript updates and `TRANSCRIPT_PULSE` telemetry come from the same successful path. | Recent SpeechRuntime fixes target this path. GitHub `CI - Test Audit` is green on `56ce972`, including the mocked E2E gate. CI still does not prove real microphone/live transcript behavior. | 🟡 CI GREEN / LIVE VALIDATION PENDING | Spot-check browser console during manual/live sessions and keep the live feature matrix pending until transcript/save/history proof exists. |
| **Session Persistence** | Finalized sessions persist the full coaching-analysis snapshot needed for returning-user comparison: transcript, duration, total words, WPM, clarity, filler/custom word counts, pause metrics, AI suggestions, engine metadata, and optional ground-truth/WER fields. | Code now writes richer stop-session analysis and reloads the full analysis field set; targeted unit tests pass. | 🟡 FIX APPLIED / LIVE VALIDATION PENDING | Verify live save/read after Native, Private, and Cloud sessions. |
| **Analytics** | WPM, clarity, filler words, pause/session history, WER-ready fields, and trends are computed from saved data and available for comparison when the user returns. | Local analytics fixes preserve persisted WPM/clarity values for comparisons, pump mic frames to analytics for non-Private modes, and reset transcript/chunks/filler/pause state at accepted recording start so rapid back-to-back sessions do not inherit rolling WPM state. `pnpm ci:unit` passes. | 🟡 LOCAL PATCH / LIVE VALIDATION PENDING | Browser-test Native/Cloud/Private sessions and verify WPM, clarity, filler, custom-word, and pause numbers change with input, then save/reload for session-over-session comparison. |
| **Custom/User Words** | User words persist to Supabase, are available next session, are saved into per-session analysis snapshots, and Cloud receives boost words when explicitly selected. | Mocked add/remove/detection E2E passed locally on 2026-05-10 (`tests/e2e/user-filler-words.e2e.spec.ts`, 7/7 including infra probe). Cloud unit coverage confirms `keyterms_prompt` is included only when Cloud starts with user words and omitted without user words. The production canary suite includes a live `user-filler-words.canary.spec.ts` path using GitHub `CANARY_PASSWORD` to verify Cloud `keyterms_prompt` contains the user word. Local `.env*` files do not expose `E2E_FREE_EMAIL`/`E2E_FREE_PASSWORD`, so logout/login persistence needs a GitHub-secret-backed run next session. | 🟡 MOCKED + CLOUD CANARY PASS / LIVE LOGOUT-LOGIN PENDING | Next session: add/run a GitHub manual workflow for `VITE_USE_LIVE_DB=true tests/live/user-filler-words-persistence.live.spec.ts` using `E2E_FREE_EMAIL` and `E2E_FREE_PASSWORD`; then record add word -> logout/relogin -> word persists -> cleanup. |
| **PDF Export** | Exported PDF reflects current client-side transcript/report state and persisted metrics. Free/basic users may export without a count limit. All tiers, including Pro, receive SpeakSharp-branded/watermarked PDFs. | PDF generation is client-side. Local PDF proof has been improved to inspect generated PDF text and assert watermark commands for Free and Pro exports, but browser/live inspection remains pending. | 🟡 LOCAL PROOF IMPROVED / LIVE VALIDATION PENDING | Export a saved/current Free/basic and Pro session; inspect transcript/metrics and watermark behavior. |
| **Promo Pro Access** | Promo code grants select tester Pro access for the intended duration. Every promo code is one-time use; a redeemed code must not succeed again, even for the same user during the active promo window. Expired promo users must have an escape path and must not retain stale Pro-only backend access. | Post-deploy generated promo `1193119` granted Pro access and was rejected on reuse; generated promo `4132867` granted Pro access through the Edge Function. Post-deploy DB/RPC smoke proved the same promo-Pro class can save/read Private sessions. Focused deployed promo canary passed locally on 2026-05-10 with fresh code `7543246`: fresh redemption/returning Pro, reuse rejection, and no-promo free behavior passed 3/3 after allowlisting known benign Private startup diagnostics. | 🟡 CORE LIVE PATH VERIFIED / FULL BROWSER ARTIFACT PENDING | Commit/push the promo canary diagnostics patch, then rerun the browser artifact path after Private browser transcript is fixed to verify analytics, AI feedback, PDF export, and expired-promo denial. |
| **Billing Upgrade** | Stripe checkout upgrades user only after verified webhook. | Stripe flow has tests; live webhook/env verification pending. | 🟡 PENDING | Complete live low-value transaction and webhook smoke. |
| **Future Basic Tier** | Free -> Basic turns the baseline tier into a paid plan after MVP stabilization. | Parked until current product bugs are cleared. User preference is no long-lived non-paying baseline before first human testers, but this migration should not start until live STT, analytics, promo, and CI gates are flat. Stripe test-mode prices can exercise checkout without real charges, but the app still needs coordinated copy, DB/Edge Function semantics, tests, and live Price ID configuration. | ⚪ PARKED / PRE-TESTER BUSINESS GATE | Revisit after current P0/P1 bugs are cleared and before first broad human tester rollout. |
| **Usage Quotas** | Usage limits protect users and business costs and fail closed on uncertainty. | Local fixes now cover fail-closed usage checks, usage-aware Cloud token issuance, and negative-duration DB guards. | 🟡 VALIDATION PENDING | Run targeted tests, deploy migration/functions, and verify over-limit denial on live infrastructure. |
| **Accuracy Benchmarks** | Accuracy claims are backed by `.wav` plus ground-truth WER runs before they appear as user-facing comparisons. | Cloud is benchmarked in GitHub run `25622187317` at 0.00% WER / 100.00% accuracy across 10 Harvard fixtures. Private CPU is benchmarked locally with repo Harvard WAV fixtures at 4.11% WER / 95.89% accuracy using `TransformersJS whisper-tiny.en (Node CPU)`. Browser live benchmark harness now defaults to real/live mode instead of mock E2E mode, but Native still produced insufficient transcript for a valid WER and WebGPU remains unmeasured. The user-facing comparison component shows "not benchmarked" when current WER evidence is missing. | 🟡 PARTIAL BENCHMARK EVIDENCE | Record Cloud history in `tests/STT_BENCHMARKS.json`, keep Private CPU baseline, and continue Native/WebGPU browser evidence work before advertising those ceilings. |
| **Observability** | Sentry/PostHog capture launch-relevant frontend/backend events. | Instrumentation exists. Live promo trace shows frontend Sentry transport reached the live ingest endpoint with HTTP 200, which is partial evidence only. Local mixed-environment Vitest command is not evidence because frontend Sentry tests require jsdom/Vite aliases and Edge Function tests run under Deno. | 🟡 FRONTEND TRANSPORT SEEN / DASHBOARD + EDGE PENDING | Next session: verify the event appears in Sentry dashboard, trigger one Edge Function error/log ingest, verify PostHog launch events, run Stripe webhook smoke, and complete the launch env checklist. |
| **GitHub Canary Deploy Smoke** | Main-branch GitHub canary proves deployed auth/session/analytics path against real infrastructure. | GitHub production canary passed on `56ce972` (run `25610699109`); Edge Function deploy passed on the same push (run `25610699101`). | ✅ PASSING | Keep as required post-deploy smoke; investigate immediately if it regresses. |
| **Session Status UX** | Users see one clear status/progress surface, with no internal FSM/debug toasts obscuring the primary flow. | 2026-05-08 live browser testing found an internal `Sync: DOWNLOAD_REQUIRED` toast covering the Private model CTA; hotfix removes the internal sync toast path. Live testing also found the CTA disappears while setup is stuck initializing; hotfix restores `download-required` with retry copy when Private setup does not complete. Promo-expired copy no longer hardcodes "30-minute" access because promo duration varies. 2026-05-09 visible-browser testing found `Continue as Free` did not dismiss the expired-promo modal, trapping expired promo users. Current local fix simplifies the expired-promo dialog to two aligned choices only: Continue as Free or Upgrade to Pro. A focused UX review found toasts/status/chrome were too visually noisy. Current local patch keeps toasts top-right but constrains width and offsets below the nav, raises dialogs above toasts, hides the global mobile nav on `/session`, adds mobile bottom padding for the recording action bar, lightens the slate shell/grid, normalizes card/status surfaces, replaces clashing green status accents with quieter teal success, and keeps amber as the brand/action color across landing/auth/session/analytics/pricing. | 🟡 LOCAL FIX / DEPLOY VERIFICATION PENDING | Verify no sync toast after deploy; verify failed setup returns the download CTA; verify expired promo dialog can be dismissed; visually smoke-test status/toast behavior before wider tester rollout. |
| **CI Audit Runtime** | Required CI gives fast enough feedback to unblock next-day release fixes without hiding correctness failures. | Latest `CI - Test Audit` run exceeded 7 minutes before final report. Unit execution took about 3m43s and E2E shards wait behind it. | 🟡 PROMOTED RELEASE-VELOCITY WORK | After the current shard-4 correctness failure is fixed, shard/split unit coverage by domain or package and preserve a single aggregate required result. |

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
| Request-aware CORS | Usage Edge Function is deployed and live header validated; promo Edge Function hardening is locally fixed. | `check-usage-limit` OPTIONS with production origin returned `Access-Control-Allow-Origin: https://speaksharp-public.vercel.app`. `apply-promo` now uses the shared request-aware CORS helper locally; `deno check` and `pnpm test:edge` pass. | Push/deploy Edge Functions and verify `apply-promo` production OPTIONS no longer returns wildcard CORS. |
| Private model cache/progress | DB/RPC private save/readback verified; browser audio validation pending. | `ModelManager` probes Whisper Turbo IndexedDB stores; store progress normalization clamps `0..1` and `0..100` inputs to UI percent. CPU/Transformers.js same-origin model assets are locally load-proven, Private routes through `PrivateWhisper`, and launch policy is CPU-first with explicit WebGPU validation. Live DB/RPC smoke saved/read `engine='private'` with transcript, WPM, filler words, and clarity. Live Playwright configs now point to the real Harvard WAV fixture. | Prove browser transcript/cache behavior with headed Chrome or GitHub/live runner. |
| Session analysis persistence | Code fix present; GitHub CI is green on `56ce972`. | `CI - Test Audit` run `25610699098` passed; selectors reload transcript, WER, pause, AI, custom-word, and engine metadata fields. | Live-test returning-user comparison. |
| Promo tester flow | Core entitlement and DB Private save/readback are live-verified; full browser artifact path remains pending. | Promo `1193119` granted Pro and was rejected on reuse; promo `4132867` granted Pro through `apply-promo`; DB/RPC smoke saved/read a Private session after the deployed policy migration. Full promo canary failed only because benign ONNX/model warnings were treated as fatal diagnostics after Pro assertions passed. | Fix live audio fixture and diagnostics allowlist, then rerun the browser artifact path and expired-promo seeded smoke. |
| Local release test gate | Latest deploy/canary gates are green; latest GitHub CI audit is running. | Edge Function deploy run `25623359118` passed on `e177bc7c`; production canary run `25623359125` passed on the same commit. `CI - Test Audit` run `25623359127` is still in progress. Focused local validation for the shard-4 user-features fix passed 7/7. | Wait for CI result, then keep live feature matrix pending until deployed browser validation proves Native/Private/Cloud transcript, save, analytics, and export paths. |

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
| **D2** | **WPM Rolling Window Fix** | Logic Accuracy | 🟡 LOCAL FIX / LIVE VALIDATION PENDING |
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
