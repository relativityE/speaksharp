**Owner:** [unassigned]
**Last Reviewed:** 2026-05-15
**Version:** v0.6.19-rc0
**Last Updated:** 2026-05-15

# Live Test Combinations Matrix

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

This matrix defines the production-browser validation surface for MVP test release. CI proves mocked orchestration; this matrix proves real user behavior against deployed infrastructure, real browser capabilities, real auth, and real persistence.

## Release Rule

A path is green only when all required checks pass:

1. User can reach the path with the expected tier/entitlement.
2. Recording starts and stops through explicit user action.
3. Transcript or explicit no-speech state is shown.
4. Session save completes or a clear recoverable error is shown.
5. Returning-user view can load the saved analysis state.
6. Analytics/export behavior matches the tier and STT mode.

## Current Launch Leftovers

### 2026-05-11 Handoff: Cloud/Pro Blocker Busting

| Gate | Status | Evidence | Next Action |
|---|---|---|---|
| Cloud mode authority | ✅ Fixed | Commit `cafcad8f` preserves explicit Cloud selection during late profile/policy sync. Focused Cloud traces after the fix show Cloud stays selected through Start. | Keep `PRE_START_MODE_STATE` assertion in the live artifact harness. |
| Cloud transport | ✅ Proved | Run `25687338083` trace: Cloud WebSocket opened, mic frames forwarded, audio chunks sent, and AssemblyAI emitted `Turn` transcript messages up to `textLength:71`. | Do not revisit token, WebSocket, chunking, or WER unless a future trace regresses this gate. |
| Cloud session creation gate | ✅ Patch deployed / needs full-path rerun | Commit `1b9d1667` adds migration `20260511100000_expire_stale_active_sessions.sql`; migration workflow `25687248801` succeeded. The next focused Cloud run moved past the prior generic `Usage limit exceeded`/stale active-session bucket. | Keep exact usage error logging. If this regresses, use the session-creation decision table before changing Cloud STT. |
| Cloud stop/save | ✅ Product path proved / harness rerun needed | Commit `5ab21c00` preserved latest streaming partial transcript when no final transcript exists. Focused Cloud run `25689485321` then printed `LIVE_PRO_STT_ARTIFACT_EVIDENCE` with transcript preview `A stale smell of old beer`, analytics detail `/analytics/408be035-ed2f-4603-933a-84fe35545741`, Gemini HTTP 200, and parsed transcript-bearing PDF `session_20260511_e62369e1_ef68_417b_a303_f3e0c2eba441.pdf`. The workflow concluded red only because the `afterEach` cleanup waited for the session mode selector after navigation to analytics. | Push the bounded cleanup fix and rerun `Pro STT Artifact Matrix` with `mode=cloud`; require a green workflow before broad tester share. |
| Cloud analytics/AI/PDF | ✅ Evidence printed / green workflow pending | Run `25689485321` reached analytics detail, returned live Gemini suggestions, exported a PDF, and parsed PDF text containing transcript words. | Treat as strong product evidence but not a release-green CI gate until the Cloud-only rerun exits green after the harness cleanup patch. |
| Cloud de-scope boundary | 🟡 Adopted | Cloud is no longer an open-ended sink: it gets one focused post-harness rerun. | If the next Cloud rerun fails in the product path, patch only the mapped row once; if it fails again after that targeted cycle, remove Cloud from tester instructions and proceed Private-first if non-Cloud gates are green. |
| Private Pro | ✅ Strongest Pro path | Run `25634578516` proved Private transcript/save/history/Gemini/PDF. Run `25642824527` proved first-start cache, second-start reuse, no second download prompt, and second recording start/stop. | Keep Private in release reruns; no open P0 after current evidence. |
| Native | 🟡 Manual Chrome proof required | GitHub fake audio is not valid evidence for Web Speech transcript. Automated Native remains readiness/save/no-crash only. | Manual desktop Chrome: real mic, Pro login, select Native, speak 10-15 seconds, observe transcript, Stop/Save, history/analytics. Verify Safari support or document limitation. |

#### Cloud Decision Table Result

| Evidence Row | Latest Observed Result | Meaning | Fix Direction |
|---|---|---|---|
| `CLOUD_WS_CLOSE` before Stop with non-manual close | Not observed in latest failing run. | Not the active blocker. | No WebSocket lifecycle patch. |
| `CLOUD_WS_CLOSE` after Stop with `isManualStop=false` | Not observed in latest failing run. | Not the active blocker. | No manual-stop ordering patch. |
| `FAILED_VISIBLE` heartbeat/watchdog while transcript exists | Not observed in latest failing run. | Not the active blocker. | No watchdog policy patch. |
| Stop entry shows `TERMINATED` and transcript exists | Not observed. Stop entry was `controllerState: RECORDING`, `serviceState: RECORDING`. | Stop path was reachable. | No save-from-terminated patch yet. |
| Save decision `willSave=false` due state mismatch | Not observed. Reason was `empty_transcript`, not state. | State gate is not the latest blocker. | No runtime-state save-gate patch. |
| Provider transcript received but save transcript length is 0 | ✅ Observed. AssemblyAI `Turn` text reached `textLength:71`, but `CLOUD_SAVE_DECISION` had `empty_transcript`. | Finalization source mismatch: visible provider partials were not used as save transcript. | Patch finalization to use authoritative latest service partial when no provider final exists. |
| Cloud provider sends error payload | Not observed in latest failing run. | Provider did not reject this run. | No provider/API escalation from this evidence. |

| Priority | Item | Status | Evidence / Next Action |
|---|---|---|---|
| P0 | CI correctness, including shard 4 session-save/user-features harness | ✅ Complete | GitHub `CI - Test Audit` run `25944598514` passed on `main`, including the current unit/E2E/Lighthouse/SQM gate. |
| P0 | Custom words live persistence | ✅ Complete | GitHub `Live Release Matrix` runs `25631920466` and `25632720717` passed `live-custom-words`: add -> logout/relogin -> visible -> cleanup. |
| P0 | Private browser transcript + artifact path | ✅ Complete | Run `25634578516` passed `live-promo-private-artifact` on `310ded8d`: fresh promo Pro signup, Private CPU transcript, stop/save, analytics history, real Gemini AI feedback, and real PDF export artifact. PDF proof: `session_20260510_170412_cc4d4704_9417_485f_8a30_fd0dcac007a1.pdf`, parsed `textLength: 733`, `textIncludesTranscript: true`. |
| P0 | Pro STT artifact matrix across Private, Cloud, and Native | 🔴 Cloud stop/save blocker under trace | Current launch gate now requires every STT mode to prove the same user artifact path: record with Harvard fake audio, wait for non-placeholder fixture transcript, stop, expect `Session saved`, open analytics detail, request AI feedback through the live Edge Function, and export a timestamp/user PDF whose parsed text contains the transcript. Added `tests/live/pro-stt-artifact-matrix.live.spec.ts` and manual-dispatch workflow `Pro STT Artifact Matrix`. Commit `bd17ed50` added focused workflow input `mode=all/private/cloud/native`: `all` runs the full matrix, `private`/`cloud`/`native` run one mode independently. Full run `25644204999` failed on the first Private row with placeholder transcript (`words appear here...`), so Cloud and Native did not run there. Focused Cloud-only runs `25644479281` and `25644849002` reached/appeared to pass the transcript wait but still failed stop/save; analytics, AI feedback, and PDF were not reached. Current patch adds narrow Cloud lifecycle traces for the next focused `mode=cloud` rerun: `CLOUD_LIFECYCLE_FAIL`, `CLOUD_WS_CLOSE`, `CLOUD_WS_ERROR`, `CLOUD_STOP_ENTRY`, and `CLOUD_SAVE_DECISION`. |
| P0 | Full Live Release Matrix | 🔴 Failed, narrowed | Run `25634760761` failed only `live-cloud-artifact`. Green in the same run: `generate-promo`, `live-native-preflight`, `live-stripe-webhook-readiness`, `live-custom-words`, `live-stripe-checkout-readiness`, `live-cloud-token-gates`, and `live-promo-private-artifact`. |
| P0 | Cloud quota/token abuse gates | ✅ Complete | Run `25634760761` passed `live-cloud-token-gates`, covering the live Cloud token gate matrix including denial cases and active Pro token issuance. Keep in release reruns. |
| P0 | Promo abuse/throttle | ✅ Complete | Run `25635969309` passed `live-promo-throttle` on `82a5c521`: 9 wrong-code attempts returned statuses `[400,400,400,400,400,400,400,400,429]` with final error `Too many promo attempts. Please try again later.` |
| P0 | Stripe live webhook | ✅ Complete | Deploy run `25635957996` deployed async Stripe signature verification to Supabase project `yxlapjuovrsvjswkwnrk`. Run `25635969309` passed `live-stripe-webhook-readiness`: unsigned event returned HTTP 400 `STRIPE_WEBHOOK_INVALID`; signed no-op event returned `status:200`, `received:true`, `errorCode:null`. |
| P1 | Native Browser STT transcript | 🟡 Manual browser validation required | GitHub fake-audio is readiness/save/no-crash only. Chrome real-mic proof required; Safari support should be verified or documented. |
| P1 | Cloud live analytics/session path | 🔴 Product artifact path pending / stale active-session gate patch pending deploy | Latest Cloud evidence moved through several buckets: run `25643057818` proved token 200/WebSocket open but failed on AssemblyAI 3007 tiny-chunk input duration; commit `da94963d` fixed Cloud PCM chunking to 100 ms / 1600 samples. Run `25643435705` then produced real Harvard transcript text but stopped before the 5 second save policy. Run `25643916971` failed before transcription because the Cloud selector raced Pro policy sync. Full artifact matrix run `25644204999` did not evaluate Cloud because Private failed first. Focused Cloud-only run `25644479281` selected Cloud, forwarded mic frames, sent 51 audio chunks, and got past transcript wait, but runtime transitioned `FAILED_VISIBLE -> TERMINATED` before save; UI status stayed `Ready` instead of `Session saved`. Commit `112be007` added Cloud audio-frame heartbeat liveness, but focused rerun `25644849002` still failed at stop/save. Trace run `25669654077` showed a mode-authority race where Cloud was overwritten by Private before Start; commit `cafcad8f` preserves the selected mode through profile policy sync. Focused runs `25674605833` and `25674902266` then proved Cloud stayed active, WebSocket opened, audio frames/chunks flowed, and AssemblyAI emitted transcript `Turn` messages, but initial session creation failed with `Usage limit exceeded`; the RPC also uses that generic flag for `max_concurrent_sessions_reached`. Migration `20260511100000_expire_stale_active_sessions.sql` expires old active rows and counts only unexpired active sessions before enforcing concurrency. |
| P1 | Private cache/second-start behavior | ✅ Complete | GitHub `Private Cache Live Smoke` run `25642824527` passed: first start populated `transformers-cache` with seven model keys, second start reused cache without a download prompt, and recording start/stop succeeded. |
| P1 | PDF/export and AI feedback artifact path | ✅ Complete | Run `25634578516` passed `live-promo-private-artifact`. `GET_AI_SUGGESTIONS_LIVE_RESPONSE` returned HTTP 200 with content-specific AI suggestions and no degraded marker, proving the Supabase `GEMINI_API_KEY` path. Playwright captured a real download and uploaded `session_20260510_170412_cc4d4704_9417_485f_8a30_fd0dcac007a1.pdf`; parsed PDF text includes `SpeakSharp Session Report`, `Transcript`, and Harvard fixture transcript words. |
| P1 | Observability | 🟡 Partial | Frontend Sentry transport returned HTTP 200, and Stripe checkout/webhook readiness is now live-proved in run `25635969309`. Sentry dashboard visibility, Edge Function Sentry/backend ingest, and PostHog launch events remain pending. Sentry is not fully tested yet. |
| P2 | CI runtime optimization | 🟡 Backlog | Latest CI is green but about 11 minutes; split/shard unit coverage after launch blockers are cleared. |
| P2 | WebGPU WER/acceleration claim | 🟡 Backlog | CPU Private and Cloud WER have evidence; WebGPU remains hardware-specific and should not be advertised until headed hardware proof exists. |
| P2 | Constraint/data hygiene sweep | 🟡 Backlog | Run production audit for existing rows after current launch blockers are cleared. |

## Tier × STT Mode Matrix

| User/Tier | Native STT | Private CPU STT | Private WebGPU STT | Cloud STT | Required Before Test Release |
|---|---|---|---|---|---|
| Anonymous visitor | Not required; CTA should route to auth/pricing | Not available | Not available | Not available | Verify no unauthenticated recording path. |
| Free legacy user | Start/stop/save allowed within quota until Basic migration | Pro-gated with clear upgrade/promo path | Pro-gated with clear upgrade/promo path | Pro-gated with clear upgrade/promo path | Validate legacy behavior until Free -> Basic migration is intentionally executed. This migration is parked until current bugs are cleared, then becomes a pre-human-tester business gate. |
| Basic future user | Start/stop/save allowed within paid baseline quota | Pro-gated with clear upgrade/promo path | Pro-gated with clear upgrade/promo path | Pro-gated with clear upgrade/promo path | Parked until live STT, analytics, promo, and CI gates are flat; then implement before broad human tester rollout. |
| Promo Pro tester | Start/stop/save allowed | Required: CPU-first setup, transcript, save, history | Manual accelerated-path evidence only | Explicitly selectable; token must be usage-gated | Primary human tester route. |
| Paid Pro user | Start/stop/save allowed | Required: CPU-first setup, transcript, save, history | Manual accelerated-path evidence only | Explicitly selectable; token must be usage-gated | Required before charging real users. |
| Expired promo user | Continue as baseline tier or enter new promo/upgrade | Blocked with clear expired-promo copy | Blocked with clear expired-promo copy | Blocked with clear expired-promo copy | Verify no stale Pro access. |
| Over-quota user | Blocked fail-closed | Private local path may be allowed only if product policy says quota permits; otherwise block consistently | Same as Private CPU | Token denied before paid Cloud cost | Verify quota messaging and fail-closed behavior. |

## Private STT Cache/Setup Matrix

| State | Expected Behavior | Required Evidence |
|---|---|---|
| First use, no cached CPU assets | Show explicit setup/download/progress state; initialize CPU/Transformers.js from same-origin assets; no silent Cloud switch. | Clear origin storage, start Private, capture progress/status, observe ready state. |
| Second use, CPU assets cached | Do not show a required download CTA; initialize from browser cache and allow recording. | Reload/login again, select Private, confirm faster ready path and recording. |
| WebGPU available | WebGPU/WhisperTurbo may be explicitly validated as acceleration; it must start quickly or fail fast. | Headed Chrome hardware run with explicit WebGPU path. |
| WebGPU unavailable/slow | CPU path proceeds without making the user wait on WebGPU. | Disable WebGPU/GPU and confirm CPU path. |
| Private setup failure | Show retry/recovery copy; present Native/Cloud only as explicit user choices. | Simulate missing asset or blocked model request. |

## Browser × Hardware Matrix

| Browser/Device | Native | Private CPU | Private WebGPU | Cloud | Required Before Test Release |
|---|---|---|---|---|---|
| Desktop Chrome | Required | Required | Manual acceleration evidence | Required for Pro | Yes |
| Desktop Safari | Required if supported; otherwise clear compatibility copy | Best-effort | Not required | Required if Cloud supported | Yes for mic/error UX |
| Firefox | Compatibility behavior required | Best-effort | Not required | Best-effort | Yes for unsupported messaging |
| iPhone Safari | Auth and mic permission behavior required | Not launch-critical | Not required | Best-effort | Yes for mobile trust |
| Bluetooth/external mic | Start/recover behavior required | Same session behavior as selected engine | Not required | Same session behavior as selected engine | Yes for recovery UX |

## Feature Combination Checks

| Feature | Native | Private CPU | Private WebGPU | Cloud |
|---|---|---|---|---|
| Live transcript appears | Required | Required | Required for acceleration claim | Required |
| Filler words counted | Required | Required | Required for acceleration claim | Required |
| Custom words persist to next session | Required | Required | Not separate if CPU passes | Required |
| Cloud keyterms boost | N/A | N/A | N/A | Required |
| WPM/clarity/pause analytics | Required | Required | Not separate if CPU passes | Required |
| Session-over-session comparison | Required | Required | Not separate if CPU passes | Required |
| PDF export with watermark | Required | Required | Not separate if CPU passes | Required |
| WER benchmark evidence | 🟡 Manual browser transcript proof required before WER; GitHub fake-audio is readiness-only | ✅ Private CPU measured at 4.11% WER / 95.89% accuracy | Required for acceleration claim; no valid WebGPU WER yet | ✅ Cloud measured at 0.00% WER / 100.00% accuracy |

### STT Benchmark Truth Status (2026-05-10)

| Engine | Current User-Facing Status | Known Blocker | Required Evidence |
|---|---|---|---|
| Cloud / AssemblyAI | ✅ Benchmark-backed. | GitHub `STT Ceiling Benchmarks` run `25622187317` succeeded for AssemblyAI across 10 Harvard fixtures with 0.00% WER / 100.00% accuracy. Workflow was run with `write_results=false`, so the repo manifest still needs a recorded history entry before user-facing benchmark display relies on it. | Commit/record the benchmark history entry or rerun with `write_results=true`. |
| Native Browser | Must show "not benchmarked" until manual browser transcript proof exists. | Browser benchmark now runs in real/live mode and starts recording, but Chromium fake-audio/Web Speech produced only placeholder/insufficient transcript, so no meaningful WER can be recorded. GitHub `Live Release Matrix` run `25632720717` proved Pro readiness/start/save mechanics but not transcript text. | Manual Chrome desktop real-mic run: Pro login, Native selected, mic grant, 10-15 seconds speech, transcript appears live, stop/save, history and analytics update. Safari should be verified or documented as limited. |
| Private CPU / Transformers.js | ✅ Benchmark-backed for Node CPU baseline. | Local `pnpm benchmark:whisper` succeeded with real repo Harvard WAV fixtures: 4.11% WER / 95.89% accuracy using `TransformersJS whisper-tiny.en (Node CPU)`. Browser CPU path still needs live proof because the browser benchmark account/harness was previously blocked by test/mock mode and Pro entitlement. | Keep Node CPU baseline recorded; run browser Private CPU transcript/save/cache proof with a Pro/promo account before claiming browser Private fully green. |
| Private WebGPU / WhisperTurbo | Acceleration evidence only; not launch-blocking if CPU path is green. | Harness now uses authoritative `<html>` readiness anchors instead of stale `body[data-stt-engine]`, but WebGPU still lacks a valid WER run. Hardware/browser-specific results cannot be generalized to all users. | Headed local WebGPU run on supported hardware, recorded as acceleration evidence rather than a blanket Private ceiling. |

## Current Status

| Area | Status | Notes |
|---|---|---|
| Automated CI baseline | 🟡 Latest running / prior green | `CI - Test Audit` run `25634361733` passed on `0f185663`. Latest run `25634936490` on `84206638` is in progress. |
| Production canary | ✅ Latest green | `Production Canary Smoke Test` run `25634758103` passed on `e86e22da`. Run `25634936509` on `84206638` is in progress. |
| Promo path | ✅ Live artifact path complete | Run `25634578516` passed `live-promo-private-artifact`: one-time promo Pro signup, Private transcript, stop/save/history, real Gemini AI feedback, and timestamped PDF artifact export. |
| Private CPU path | ✅ Browser artifact path complete | Run `25634578516` produced Private CPU transcript, analytics/history, real Gemini AI feedback, and parsed PDF artifact text. Run `25642824527` proved Private cache first-start/second-start reuse without a second download prompt. |
| Native path | 🟡 GitHub readiness/save diagnostic green / manual transcript required | GitHub live run `25632720717` reached Pro Native preflight with mode selector/start enabled, runtime ready, recording started, and saved true, but Chromium fake-audio/Web Speech transcript stayed `Listening...`. This is classified as a browser Web Speech automation limitation unless manual Chrome real-mic validation also fails. The Native GitHub probe now records this as `manual-browser-transcript-required` and asserts readiness/save/no-crash mechanics only. |
| Cloud path | 🔴 Token gates + WER green / save path patch pending deploy | Run `25634760761` passed `live-cloud-token-gates`. GitHub `STT Ceiling Benchmarks` run `25643746457`, job `75268546634`, proved AssemblyAI WER at `0.00%` across all 10 Harvard WAV fixtures. Focused Cloud-only run `25644479281` proved the run can reach Cloud transcript/audio-chunk activity but failed at stop/save because the runtime watchdog terminated the engine before save. Local patch treats Cloud audio frames as heartbeat activity; focused unit test `CloudAssemblyAI.test.ts` passes 11/11. Cloud remains red until focused `mode=cloud` proves save, analytics, AI, and PDF after deploy. |
| Analytics return path | 🟡 Shared metrics patch pushed / live recheck pending | Earlier live review found persisted analytics could diverge from live session values and rolling WPM could inherit old chunks. Commits `479edda3` and `7790988d` centralize WPM/clarity/filler calculations, preserve persisted values when available, align filler totals with live highlighting, prevent stop-time duplicate transcript appends, and repair the mock transcript health-check path. Production canary run `25993614589` passed; CI run `25993614584` is the current audit run for the follow-up. |
| Expired promo path | 🟡 Deployed / live seeded smoke pending | Dialog is simplified to two aligned choices; backend guards now cover expired promo-only Cloud token and DB session/heartbeat paths. Effective-tier migration is deployed, but live seeded expired-promo smoke remains pending. |
| Toast/status/mobile UX | 🟡 Local fix / browser smoke pending | UI polish is pushed in `0d5f2cef`; production canary/CI are running. Manual visual pass still required after Vercel serves the new bundle. |
| STT WER evidence | 🟡 Partial | Cloud/AssemblyAI is measured at 0.00% WER / 100.00% accuracy in GitHub run `25643746457`, job `75268546634`, using Harvard WAV + truth text. Private CPU Node baseline is measured at 4.11% WER / 95.89% accuracy. Native and WebGPU still lack valid WER because browser benchmark execution has not produced enough real transcript output. |
| Custom words persistence | ✅ Live logout-login passed | Mocked E2E add/remove/detection passed 7/7. Production canary covers live Cloud keyterms with `CANARY_PASSWORD`. `Live Release Matrix` run `25634578516` passed `live-custom-words`, proving add -> logout/relogin -> visible -> cleanup against GitHub `E2E_FREE_*` secrets on the latest live matrix. |
| Observability evidence | 🟡 Frontend ingest + Stripe test smoke seen / dashboard checks pending | Prior live promo trace shows frontend Sentry ingest POST to `o4509834735190016.ingest.us.sentry.io` returning HTTP 200. Run `25634760761` re-proved Stripe test-mode checkout/webhook readiness. Signed Stripe webhook proof is patched to send raw bytes and needs rerun. Still pending: Sentry dashboard visibility, Edge Function ingest, and PostHog launch-event review. |

## Validation Harness Findings

| Finding | Impact | Status |
|---|---|---|
| `tests/fixtures/10sec.wav` was HTML text, not WAV audio. | Previously blocked trustworthy browser Private transcript, WER, and fake-mic live validation. | ✅ Replaced by real Harvard WAV fixtures; GitHub `Live Release Matrix` run `25632720717` proved browser Private transcript text and WPM `110` after the Transformers.js output-shape fix. |
| Full promo canary treats benign Private model/ONNX warnings as fatal diagnostics. | Full promo canary failed after Pro redemption/return succeeded. | ✅ Focused deployed promo canary passed 3/3 with fresh code `7543246` after allowlisting known benign Private startup/ONNX diagnostics. Keep under regular CI/canary monitoring. |
| `apply-promo` returns wildcard CORS. | Hardening inconsistency with `check-usage-limit`; not a quota/privacy/session-save P0. | 🟡 Local fix applied: shared request-aware CORS and structured errors; deploy/header validation pending. |
| Local focused E2E cannot bind preview server in Codex sandbox. | `CI=true pnpm exec playwright ... promo-admin-journey` failed before browser execution with `listen EPERM: operation not permitted 127.0.0.1:4173`. This is not product evidence because the app server never started. | ⚪ Track as tooling friction. Revisit only if the same bind failure reproduces from normal macOS Terminal or GitHub Actions. |
| Analytics truth and comparison selection were coupled in one E2E gate. | A flaky comparison-checkbox interaction could fail the release-critical analytics persistence gate even when WPM, filler count, engine metadata, transcript excerpt, reload, and PDF watermark evidence were green. | 🟡 Release-scope cut applied: `analytics-truth` now covers data integrity only. Backlog item: **Stabilize session comparison selection UX** with a future focused test that selects two sessions by stable session IDs, verifies selected count reaches 2, opens the comparison dialog, verifies both session metrics, and avoids stale DOM handles during dashboard re-render. Do not block next-day tester release unless comparison is in tester instructions. |
| CI shard 4 missed AI suggestions card in mocked Pro feature matrix. | Older GitHub `CI - Test Audit` run `25623031218` failed only shard 4: `tests/e2e/user-features.e2e.spec.ts` expected `ai-suggestions-card` after opening a Pro session detail. | ✅ Cleared: current GitHub `CI - Test Audit` run `25944598514` passed on `main`. |
| CI Audit wall-clock is too slow for next-day release iteration. | Current CI/Test Audit is green; runtime remains a release-velocity concern, not a correctness blocker. | 🟡 Promoted: split/shard unit coverage by domain or package after launch blockers are clear. This is release-velocity work, not a reason to weaken the gate. |
| Live promo Pro Private transcript previously stayed at placeholder. | Older deployed live promo artifact test in run `25631920466` reached Pro session and recording active, but transcript remained `Listening...`; trace proved model calls returned empty text. | ✅ Cleared for current controlled/public ledger evidence: Basic first-use, Private artifact, AI, PDF, provider-level Cloud proof, and physical real-mic Cloud proof are recorded in `PUBLIC_LAUNCH_LEDGER.md`. |
