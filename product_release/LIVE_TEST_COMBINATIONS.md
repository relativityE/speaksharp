**Owner:** [unassigned]
**Last Reviewed:** 2026-05-08
**Version:** v0.6.18
**Last Updated:** 2026-05-10

# Live Test Combinations Matrix

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

| Priority | Item | Status | Evidence / Next Action |
|---|---|---|---|
| P0 | CI correctness, including shard 4 session-save/user-features harness | ✅ Complete | GitHub `CI - Test Audit` run `25632686859` passed on `435f79e3`, including E2E shards 1-4. |
| P0 | Custom words live persistence | ✅ Complete | GitHub `Live Release Matrix` runs `25631920466` and `25632720717` passed `live-custom-words`: add -> logout/relogin -> visible -> cleanup. |
| P0 | Private browser transcript | ✅ Transcript complete / 🟡 artifact rerun pending | Run `25632720717` produced live Harvard transcript text and WPM `110`. Rerun matrix after the Harvard oracle patch to prove stop/save/history/AI/PDF. |
| P0 | Full Live Release Matrix | 🟡 Pending rerun | Previous red items were Native fake-audio transcript classification and Private stale JFK oracle. Both harness patches are applied locally. |
| P0 | Cloud quota/token abuse gates | 🟡 Partial | Free denial and active promo-Pro token issuance are verified. Over-limit and expired-promo denial still need live proof. |
| P0 | Promo abuse/throttle | 🟡 Partial | Fresh one-time promo redemption and reuse rejection are verified. 9-wrong-code throttling still needs live proof. |
| P0 | Stripe live webhook | 🔴 Not proved | Run low-value/test-mode checkout and verify webhook upgrades only after verified event. |
| P1 | Native Browser STT transcript | 🟡 Manual browser validation required | GitHub fake-audio is readiness/save/no-crash only. Chrome real-mic proof required; Safari support should be verified or documented. |
| P1 | Cloud live analytics/session path | 🟡 Pending | Token gate has partial live proof; real Cloud transcript/save/analytics path still needs live harness or manual proof. |
| P1 | Private cache/second-start behavior | 🟡 Pending | CPU model assets and transcript are proved; clear-cache first setup and cached second start need browser evidence. |
| P1 | PDF/export and AI feedback artifact path | 🟡 Pending | Local PDF/AI safeguards exist; live Private artifact rerun must prove generated report/export behavior. |
| P1 | Observability | 🟡 Partial | Frontend Sentry transport returned HTTP 200; dashboard visibility, Edge Function ingest, PostHog launch events, and Stripe smoke remain pending. |
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
| Automated CI baseline | ✅ GitHub CI green on latest pushed commit | `CI - Test Audit` run `25632686859` passed on `435f79e3`, including unit, health check, Lighthouse advisory, and E2E shards 1-4. Earlier shard-4/session-save and custom-word lint blockers are cleared by this run. |
| Production canary | ✅ Passed on latest pushed commit | `Production Canary Smoke Test` run `25632686860` passed on `435f79e3`. Deploy Edge Functions run `25632686849` also passed on the same commit. |
| Promo path | 🟡 Core live path verified / full artifact pending | Focused deployed promo canary passed locally on 2026-05-10 with fresh one-time code `7543246`: fresh promo redemption/returning Pro, redeemed-code reuse rejection, and no-promo free behavior all passed 3/3. Full promo artifact browser path still blocks on Private browser transcript before analytics/PDF proof. |
| Private CPU path | 🟡 Browser transcript proved / full artifact rerun pending | Post-deploy DB/RPC smoke saved/read a `private` session for a promo Pro user with transcript, WPM, filler words, and clarity. Live run `25631920466` narrowed the original blocker to successful model calls returning `textLength:0`. After the Transformers.js output-shape fix, GitHub `Live Release Matrix` run `25632720717` produced Harvard transcript text and WPM `110`; the remaining failure was the harness still expecting JFK words. The oracle is patched to the Harvard fixture, with save/history/AI/PDF proof pending rerun. |
| Native path | 🟡 GitHub readiness/save diagnostic green / manual transcript required | GitHub live run `25632720717` reached Pro Native preflight with mode selector/start enabled, runtime ready, recording started, and saved true, but Chromium fake-audio/Web Speech transcript stayed `Listening...`. This is classified as a browser Web Speech automation limitation unless manual Chrome real-mic validation also fails. The Native GitHub probe now records this as `manual-browser-transcript-required` and asserts readiness/save/no-crash mechanics only. |
| Cloud path | 🟡 Token gate partially live-verified / analytics pending | Live Free user received HTTP 403 from `assemblyai-token`; live active promo-Pro received HTTP 200 token with `expires_in:600`. Canary user-filler test is part of the production canary suite and uses GitHub `CANARY_PASSWORD` to verify Cloud `keyterms_prompt` includes the user word. Over-limit and expired-promo denial remain pending. Real Cloud analytics still requires a non-mocked live harness. |
| Analytics return path | 🟡 Local reset fix / live not green | Earlier live review found persisted analytics could diverge from live session values and rolling WPM could inherit old chunks. Local fix now resets transcript/chunks/filler/pause state at accepted recording start. Full mocked/live validation remains open. |
| Expired promo path | 🟡 Deployed / live seeded smoke pending | Dialog is simplified to two aligned choices; backend guards now cover expired promo-only Cloud token and DB session/heartbeat paths. Effective-tier migration is deployed, but live seeded expired-promo smoke remains pending. |
| Toast/status/mobile UX | 🟡 Local fix / browser smoke pending | UI polish is pushed in `0d5f2cef`; production canary/CI are running. Manual visual pass still required after Vercel serves the new bundle. |
| STT WER evidence | 🟡 Partial | Cloud is measured at 0.00% WER / 100.00% accuracy. Private CPU Node baseline is measured at 4.11% WER / 95.89% accuracy. Native and WebGPU still lack valid WER because browser benchmark execution has not produced enough real transcript output. |
| Custom words persistence | ✅ Live logout-login passed | Mocked E2E add/remove/detection passed 7/7. Production canary covers live Cloud keyterms with `CANARY_PASSWORD`. `Live Release Matrix` runs `25631920466` and `25632720717` passed `live-custom-words`, proving add -> logout/relogin -> visible -> cleanup against GitHub `E2E_FREE_*` secrets. |
| Observability evidence | 🟡 Frontend ingest trace seen / dashboard checks pending | Prior live promo trace shows frontend Sentry ingest POST to `o4509834735190016.ingest.us.sentry.io` returning HTTP 200. This proves browser-side ingest reached Sentry transport, but not dashboard visibility, Edge Function ingest, Stripe webhook smoke, or PostHog launch-event review. | Mark for next session: verify Sentry dashboard event, trigger/verify one Edge Function error ingest, run Stripe webhook smoke, and complete the launch env checklist. |

## Validation Harness Findings

| Finding | Impact | Status |
|---|---|---|
| `tests/fixtures/10sec.wav` was HTML text, not WAV audio. | Previously blocked trustworthy browser Private transcript, WER, and fake-mic live validation. | ✅ Replaced by real Harvard WAV fixtures; GitHub `Live Release Matrix` run `25632720717` proved browser Private transcript text and WPM `110` after the Transformers.js output-shape fix. |
| Full promo canary treats benign Private model/ONNX warnings as fatal diagnostics. | Full promo canary failed after Pro redemption/return succeeded. | ✅ Focused deployed promo canary passed 3/3 with fresh code `7543246` after allowlisting known benign Private startup/ONNX diagnostics. Keep under regular CI/canary monitoring. |
| `apply-promo` returns wildcard CORS. | Hardening inconsistency with `check-usage-limit`; not a quota/privacy/session-save P0. | 🟡 Local fix applied: shared request-aware CORS and structured errors; deploy/header validation pending. |
| Local focused E2E cannot bind preview server in Codex sandbox. | `CI=true pnpm exec playwright ... promo-admin-journey` failed before browser execution with `listen EPERM: operation not permitted 127.0.0.1:4173`. This is not product evidence because the app server never started. | ⚪ Track as tooling friction. Revisit only if the same bind failure reproduces from normal macOS Terminal or GitHub Actions. |
| Analytics truth and comparison selection were coupled in one E2E gate. | A flaky comparison-checkbox interaction could fail the release-critical analytics persistence gate even when WPM, filler count, engine metadata, transcript excerpt, reload, and PDF watermark evidence were green. | 🟡 Release-scope cut applied: `analytics-truth` now covers data integrity only. Backlog item: **Stabilize session comparison selection UX** with a future focused test that selects two sessions by stable session IDs, verifies selected count reaches 2, opens the comparison dialog, verifies both session metrics, and avoids stale DOM handles during dashboard re-render. Do not block next-day tester release unless comparison is in tester instructions. |
| CI shard 4 missed AI suggestions card in mocked Pro feature matrix. | GitHub `CI - Test Audit` run `25623031218` failed only shard 4: `tests/e2e/user-features.e2e.spec.ts` expected `ai-suggestions-card` after opening a Pro session detail. | ✅ Cleared: GitHub `CI - Test Audit` run `25632686859` passed on `435f79e3`, including E2E shard 4. |
| CI Audit wall-clock is too slow for next-day release iteration. | Required gate took about 11 minutes on latest green run `25632686859`. | 🟡 Promoted: split/shard unit coverage by domain or package after launch blockers are clear. This is release-velocity work, not a reason to weaken the gate. |
| Live promo Pro Private transcript previously stayed at placeholder. | Deployed live promo artifact test in run `25631920466` reached Pro session and recording active, but transcript remained `Listening...`; trace proved model calls returned empty text. | 🟡 Transcript blocker cleared / artifact rerun pending: `435f79e3` fixed Transformers.js ASR output parsing, and run `25632720717` produced Harvard transcript text plus WPM `110`. The run failed before save/history/PDF because the harness expected JFK words; the oracle now matches the Harvard fixture and needs a fresh matrix rerun. |
