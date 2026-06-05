# SpeakSharp Current Workboard

This file is the live coordination board. Keep it small, current, and branch-based.
Backlog priority belongs in `product_release/BACKLOG.md`; evidence belongs in the STT reports.

> **Fast dev⇄test loop:** `product_release/STT_PING.md` (append-only, one line per signal — the
> current ball-in-court per ID). Read it FIRST each turn. This board is the durable index; the
> reports hold evidence. Do not rewrite each other's cells — append a ping line instead.

## Integration Baseline

```text
INTEGRATION_MAIN: origin/main (latest pushed integration baseline; exact SHA via `git rev-parse --short origin/main`)
MERGE_LOCK: free
UPDATED_AT: 2026-06-05T06:08Z
UPDATED_BY: test-release-agent / Codex
```

`main` is the stable integration/evidence baseline. Agents should not experiment directly on
`main`. Work happens in independent branches/worktrees; only final integration is serialized.
Branch/proof rows keep exact base or artifact SHAs where they matter.

## Active Branches And Proofs

| ID | Priority | Owner | Branch / SHA | Base SHA | Status | Purpose | Merge Gate / Next Action |
|---|---|---|---|---|---|---|---|
| STT-P5 | P0 | dev-agent → test-release-agent | `dev/private-vad-silero-main@b88b027f`; tested as `test/stt-p5-vad-rerun@b88b027f` | `main@63509d0a` | still blocked / VAD falls back to RMS | VAD engine: Silero VAD via the **existing onnxruntime-web** injected at the `PrivateWhisper` onset gate behind `?privateVad=1` / `window.__PRIVATE_VAD_PROTOTYPE__`. Off by default. | **TEST RESULT (2026-06-05):** static gates passed (`PrivateWhisper` 43/43, `privateVadFlag` 6/6, tsc clean). Corrected test harness to carry `STT_PRIVATE_VAD=1` into `/session?privateVad=1` (`/private/tmp/stt-p5-harness-vad-flag.patch`). Browser proof reached save, but Silero still did **not** run: artifact reports `vadEnabled:true`, `vadFellBackToRms:true`, `vadRuntimeVersion:null`, `vadMeanSpeechProb:null`, `vadSpeechSegments:[]`. `/onnxruntime/*.wasm` now serves `application/wasm`, but ORT also fetches `/onnxruntime/ort-wasm-simd-threaded.jsep.mjs?import`, which returns SPA HTML / aborts. **Next @dev-agent:** copy/serve ORT's `.mjs` glue assets too or configure ORT so it does not request the threaded JSEP module; then ask @test-release-agent to rerun. Artifacts: `/private/tmp/stt-p5-rms-h1_6.json`, `/private/tmp/stt-p5-vad-h1_6-telemetry.json`. |
| STT-P6 | **P0 — TOP PRIORITY (Private accuracy lever)** | dev-agent → test-release-agent → product | `dev/private-model-eval-main@4105f475`; tested as `test/stt-p6-enriched-rc@4105f475` | `main@0100b582` | enriched proof complete / product decision | Model-eval: flag-selected Private model (`whisper-tiny.en` default / `whisper-base.en` / `whisper-small.en`) threaded through worker `init`, behind `?privateModel=` / `STT_PRIVATE_MODEL=...`. Off by default. | **UPDATED RESULT (2026-06-05):** enriched telemetry confirms `whisper-base.en`, `selectionSource=window`, `fallbackPath=remote-only`, `cloudFallbackAttempted:false`. Base fixes `h1_6` (`87.5%` → `100%`) and holds h1_2/h1_8/h1_10 at `100%`, but **does not fix the filler/human-proxy failure** (`conv_01` remains `85.71%`, misses leading `Um`, `um=0`) and is too slow for long-form default CPU use (Washington same `99.48%` as tiny, but first text `2822` → `8277 ms`; trace shows base drain `10115 ms` + decode `48020 ms`, artifact finalize field `123159 ms`). **Recommendation:** do not make base the default Private release model; keep tiny as quick default, consider base only as explicit opt-in "higher accuracy / slower local model" after human-script proof and UX copy. See PRIVATE_STT `## TEST → PRODUCT/DEV: STT-P6 enriched base.en RC proof`. |
| STT-P7 | P0 | dev-agent | `dev/stt-p7-soft-frozen-trace@30eb264a`; tested as `test/stt-p7-current-main-smoke@f98987c3` | `main@2638e604` | injected smoke passed / human proof pending | Private mic-start reliability: human proof hit `RECORDING_LIFECYCLE_FAIL` ~857 ms after `RECORDING` + `Heartbeat Failure Escalated`; user saw mic-click errors/**toasts** before recording worked. | Current-main+P7 test branch served on canonical `localhost:5174` with real auth/runtime proof. Focused unit/type proof passed: 10/10 watchdog/trace tests + frontend typecheck. Injected Private-start smoke passed: recording reached `RECORDING`, stopped, saved, no `RECORDING_LIFECYCLE_FAIL`, no "Engine Frozen" toast, `environmentProof.source=app-runtime-config`, `releaseProofEligible=true`. Artifact trace: `/private/tmp/stt-p7-private-smoke-current/.../trace.zip`. Remaining: test helper did not capture `__PRIVATE_HEARTBEAT_TRACE__`; next human Private proof should confirm no false mic-click/toast and capture heartbeat trace if available. |
| STT-E1 | P0 | test-release-agent | `main@e890716f` | `main@6eaa4ba6` | done | Release-proof environment preflight for Native/Private/Cloud STT evidence. | **MERGED:** shared benchmark snapshots now emit `environmentProof`; Cloud/app-path and Pro STT matrix hard-stop release proof unless `localhost:5174` + real auth; manual Native and manual STT corpus launchers no longer load `.env.test`, default to `5174`, and write INVALID artifacts before recording when the environment is wrong. |
| STT-P1 | P0 | test-release-agent → dev-agent | `dev/stt-p1-filler-recount@c5b55f5b`; tested as `test/stt-p1-filler-recount@c5b55f5b` | `main@cf4886be` | fixed / proof passed | Private current-main filler metric proof | **PASS:** standalone filler recount fix works. `conv_01` saved `Um, basically, we should literally like, wait.` with WER `0`, accuracy `100%`, and `observedFillers`: `um=1`, `basically=1`, `literally=1`, `like=1`. Detail transcript matched. Valid `5174` real-auth `environmentProof`. Artifact `/private/tmp/stt-p1-filler-recount-conv_01.json`. |
| STT-P1D | P1 | dev-agent | `dev/private-live-draft-dedup@5d7d7f89`; tested as `test/private-p1d-current-main@112bb51e`; `dev/private-p1d-complete@e77b544c` tested as `test/private-p1d-complete-proof@f094f23e` | `main@cc630d3e` / `main@63509d0a` | partial improvement / still not release-ready | Private live-draft repetition + stale filler count (from `conv_01` diagnostic) | **LATEST TEST RESULT:** `dev/private-p1d-complete` focused tests passed (`PrivateWhisper` 45/45 + typecheck) and injected browser proof passed loose word/filler checks, but the saved transcript is still not customer-acceptable. Truth: `Um. Basically, we should literally like, wait.` Saved: `Basically, we should literally like, "Wait, um, basically."` It removes the long doubled phrase but drops/moves the opening `Um` and appends `um, basically` at the end; `saveCandidateReason=service_result`, length 59, wordCount 8. Filler rows improved (`um=3`, basically=3, like=2, literally=2), but final transcript quality is still wrong. **Next @dev-agent:** do not merge P1D complete as green. Either refine final-candidate repetition collapse to preserve first occurrence/order, or classify this as unavoidable decode error and route to P5/P6/model/VAD. See PRIVATE_STT `## TEST → DEV: STT-P1D complete proof`. **DEV RESPONSE (2026-06-04, `dev/private-p1d-complete@f846d560`): REVERTED the 2× collapse; classifying this as a model decode error → route to STT-P6/model + STT-P5/VAD.** Two independent reasons converge: (1) **data integrity** — a 2× verbatim repeat is indistinguishable at the text level from a user genuinely re-saying a phrase after a misspeak, so collapsing it would silently DELETE real user speech (product owner flagged real recordings like this); (2) **your proof** — even when it removed the doubled phrase the output was still wrong (dropped `Um`, reordered). Text-level collapse is therefore both lossy and insufficient. Restored the conservative pre-existing behavior (collapse only **3+** verbatim repeats, ~never natural speech); the **filler-count fix + live-draft display dedup are kept** (filler half passes). The Private garbling/repetition is a **whisper-tiny model-quality** problem, not a text-cleanup problem → it belongs to the STT-P6 bigger-model A/B (primary) and STT-P5 VAD. A non-lossy text guard is only feasible with decode **timestamps** (collapse only when a repeat maps to the SAME audio span); deferred unless product wants it. |
| STT-P8 | P1 | dev-agent → test-release-agent | `dev/private-resampler-parity@58d9ba7d`; tested as `test/stt-p8-current-main@a38dd948` and `test/stt-p8-extended@3341ee32` | `main@ef13a20b` / `main@4292022a` | extended A/B: safe but no WER lift proven | Private capture **resampler parity** — close app(63.22%) < drop-in accuracy gap (Open Blocker P0 / F2-#37) | **UPDATED TEST RESULT:** focused tests/typecheck still pass (`utils` 72/72 + tsc). Prior A/B on `conv_01` and `h1_6` showed no WER lift. Extended A/B on `h1_8` and `h1_10` also showed no WER lift because both box and linear reached `100%` WER `0`; telemetry confirmed flag toggled and journey/detail passed. **Next @dev-agent/test:** P8 remains safe but not proven as the accuracy lever. Do not merge as an accuracy fix without harder evidence (human script, Washington/long, or the original low-parity exact buffer). See PRIVATE_STT `## TEST → DEV: STT-P8 extended A/B`. |
| STT-N1 | P0 | test-release-agent | `test/proof-native-human` or human artifacts | `main@18299067` | ready | Native real Chrome mic re-proof | Capture `saveCandidate`, formatter telemetry, trust trace, detail transcript, truecasing/readability. |
| STT-V4 | P1 | test-release-agent → dev-agent | app path: `actions@de0e6f1e` run `26966053435` / `actions@18299067` run `26966654691`; standalone latest `test/stt-v4r-exact-contract@b9f6448c` | listed runs / `dev/v4-recovery@b9f6448c` | runtime-blocked / handed back to dev | Private v4 containment + standalone recovery probe | App path produced empty `saveCandidate` / zero saved words. Latest standalone exact-contract probe still failed all WASM cells with `threads=1`, `proxy=false`: fp32/q8 and q8/q8 fail session creation with missing decoder quantization scale; fp32/q4 reproduces `invalid data location: undefined for input "a"`. Artifacts `/private/tmp/stt-v4r-b9-q8-result.json`, `/private/tmp/stt-v4r-b9-a2-matrix.json`. Keep v4 off release A/B. **Next @dev-agent:** treat as v4/onnx-community/ORT browser runtime compatibility; if exact versions are required on every failure, populate `transformersVersion`/`onnxRuntimeVersion` before ORT session creation because b9 emitted those fields blank. |
| STT-C1 | P2 | test-release-agent | `test/proof-cloud-baseline` | latest main when resumed | deferred | Cloud richer baseline proof | Defer until Native/Private blockers move. Baseline only; keyterms/default-filler A/B is stopped. |
| CFG-1 | P0 | dev-agent + test-release-agent | `main@7152c5c8` | `main@078b1a9a` | verified / merged | Config discipline: single `APP_MODES` source of truth + startup banner + app-published `window.__APP_RUNTIME_CONFIG__`, with proof helpers reading that runtime config before any Native/Private/Cloud release proof. | **MERGED + VERIFIED:** shared benchmark preflight now prefers `window.__APP_RUNTIME_CONFIG__` (`source: app-runtime-config`) and falls back only for older branches. Test-agent rerun: CFG unit tests `7/7`, helper-file compile clean, `pnpm dev:test` printed mocked-diagnostics-only banner. Browser runtime proof: `5173/session` publishes `port=5173`, `authMode=mock`, `mockAuth=true`, `supabaseUrl=https://mock.supabase.co`, `releaseProofEligible=false`; active `5174/session` publishes `port=5174`, `authMode=real`, `mockAuth=false`, real Supabase URL, `releaseProofEligible=true`. Cloud is covered because `tests/live/cloud-artifact.live.spec.ts` calls `assertManualReleaseProofEnvironment`. |
| UX-NAV-1 | P1 | @dev-agent | TBD | `main@1784adfd` | new / dev-needed | Hard navigation while Private recording loses partial session. | Browser probe on canonical `5174` real auth: hard `page.goto('/analytics')` while Private recording landed on Analytics with no saved session/history and logged React `Maximum update depth exceeded`. Comparator: in-app Analytics nav with confirm accepted stopped/saved correctly. Artifacts: `/private/tmp/ux-private-navigation-interruption.json`, `/private/tmp/ux-private-spa-navigation-accept-dialog.json`. **Next @dev-agent:** decide/fix hard-nav/reload behavior: block reliably, persist/recover a local draft, or save before route replacement; add regression that no partial recording is lost and no max-depth warning fires. |
| UX-FSM-1 | P1 | @dev-agent | TBD | `main@1784adfd` | new / dev-needed | Rapid Private Record/Stop emits React max-depth warnings. | Browser rapid-click probe (5 short Private cycles) recovered to `READY`, `data-recording=false`, no engine-frozen toast, but emitted 4 `Maximum update depth exceeded` console errors. Artifact: `/private/tmp/ux-private-rapid-start-stop.json`. **Next @dev-agent:** root-cause the render-loop/update dependency during fast start/stop cleanup and add regression that rapid cycles have zero max-depth warnings and no zombie `RECORDING`/`STOPPING`. |
| UX-MUTEX-1 | P1 | test-release-agent | `test/ux-release-proof-sweep@1784adfd` | `main@1784adfd` | passed | Browser multi-tab session mutex proof. | PASS: tab1 stayed recording; tab2 attempt showed `Active session in another tab`, `data-recording=false`, no page errors. Artifact `/private/tmp/ux-multitab-session-mutex.json`. No dev action unless later user-facing copy polish is requested. |
| UX-ENTITLEMENT-1 | P1 | test-release-agent | `test/ux-release-proof-sweep-2@e44f8afd` | `main@e44f8afd` | passed | Trial/free/pro entitlement and STT policy proof. | PASS: focused Vitest entitlement proof passed 5 files / 76 tests across subscription tiers, transcription policy, session lifecycle, LiveRecordingCard, and free-plan support. Trial/private and Cloud gating logic are covered. |
| UX-DAST-LOCAL | P1 | test-release-agent | `test/ux-release-proof-sweep-2@e44f8afd` | `main@e44f8afd` | passed | Local DAST release gate. | PASS: `pnpm run rc:dast:local` built test mode and passed 18/18 Playwright checks covering primary journey, user features/PDF, entitlement, error states, and analytics truth. Direct one-off Playwright without build was marked INVALID, not a product failure. |
| RC-LIVE-ENV | P0 | product/ops → test-release-agent | `main@21c5abd7` | `main@21c5abd7` | blocked / missing env | Live DAST production proof. | `pnpm run rc:dast:live` stopped at preflight before browser execution because required live proof inputs are absent: `BASE_URL`, Supabase URL/anon/service-role keys, Free/Pro test credentials, and `STRIPE_WEBHOOK_SECRET`. This is not app-path proof; open-beta live release evidence remains blocked until env is supplied. |
| RC-LH-1 | P1 | @dev-agent | TBD | `main@21c5abd7` | new / dev-needed | Product gate Lighthouse cannot paint the test preview. | `pnpm run rc:gate:1:product` ran full `ci:local`: code quality passed, E2E passed 33/33, CI report recorded no unit failure names and 100% passing rate, but final status failed because Lighthouse returned `NO_FCP`. Reproduction on `pnpm exec vite preview --port 4173` showed loader stuck, `data-app-visible-ready=false`, and console error `Mock auth is not available from the runtime app...`. **Next @dev-agent:** make the Lighthouse/product gate use the centralized E2E harness/mock-auth bridge or a valid preview route so the app paints without weakening environment discipline. |
| RC-GATE2-SAST | P1 | test-release-agent | `main@da09b2c6` | `main@da09b2c6` | passed | Static security/hardening gate. | PASS on current main: `pnpm run rc:gate:2:sast` passed quality/lint/typecheck/no-eslint-disable, frontend provider-secret scan, production-hardening scan, Edge tests 11 files/73 steps, and focused Vitest 8 files/78 tests. No dev action. |
| RC-SCA-1 | P1 | @dev-agent | TBD | `main@da09b2c6` | new / dev-needed | Dependency audit release gate fails on critical Vitest advisory. | `pnpm run rc:gate:4:sca` fails current main: critical `vitest <4.1.0` advisory GHSA-5xrq-8626-4rwp ("When Vitest UI server is listening, arbitrary file can be read and executed"), 82 audit findings total. **Next @dev-agent:** upgrade/pin the Vitest stack to a patched version or remove/disable the vulnerable UI exposure, then rerun `pnpm run rc:gate:4:sca` plus the unit/front-end suites. |
| RC-UX-SMOKE | P1 | test-release-agent | `main@da09b2c6` | `main@da09b2c6` | passed | Current-main UX smoke gate. | PASS: `pnpm run rc:gate:5:ux` built test mode and passed 14/14 Playwright checks after valid unsandboxed E2E server start. A sandboxed attempt failed preview bind with EPERM and was rejected as invalid evidence, not a product failure. |
| PROD-CONFIG-1 | P0 | @dev-agent + product-ops → test-release-agent | `main@1ca658a1`; branch proof `dev/beta-closeout@a8067a4b` | `main@1ca658a1` | fail / deploy-proof blocked | Vercel production runtime config closeout: release SHA, real auth, Stripe key class, no mock/test mode. | Live production probe `https://speaksharp-public.vercel.app` returned HTTP 200, `authMode=real`, `mockAuth=false`, real Supabase URL, and `releaseProofEligible=true`. **FAIL:** live runtime does not expose release SHA/build commit and does not expose `stripeKeyClass`; production bundle `/assets/main-B_f09iBZ-1780638351825.js` lacks `stripeKeyClass`. Dev branch adds `stripeKeyClass`; production must deploy it and expose a release/build identifier. Then test-release-agent verifies `stripeKeyClass === "live"` and records the SHA. |
| PRIVACY-OBS-1 | P1 | test-release-agent + @dev-agent | `main@1ca658a1`; branch proof `dev/beta-closeout@a8067a4b` | `main@1ca658a1` | pass with deploy-pending caveat | Sentry/PostHog privacy closeout: no transcript/audio in events. | Production runtime/bundle check: Sentry uses `sendDefaultPii=false` and console breadcrumbs are scrubbed; PostHog runs with `autocapture=false`, `capture_pageview=false`, `capture_performance=false`, `disable_session_recording=true`; SAST/Edge tests passed. **Caveat:** current production still contains the old raw background-toast string; `dev/beta-closeout@a8067a4b` masks user-facing raw messages and passed focused tests, but needs merge/deploy before live proof. |
| FEEDBACK-1 | P1 | test-release-agent + product/@dev-agent | `test/beta-verification-closeout@1ca658a1` | `main@1ca658a1` | fallback improved / product decision | Beta feedback path: issue report submission, required metadata, transcript/audio opt-in only. | No in-app issue-report submit path was found in production. GitHub tester-feedback fallback exists; test-release-agent branch strengthens it with required URL, release/build identifier, browser/device, plan, STT mode, optional session/Sentry IDs, and explicit transcript/audio opt-in fields. Product must decide whether strengthened GitHub fallback is enough for controlled beta or whether @dev-agent should add an in-app Report issue path. |

## Assignment Notification Protocol

This board is the notification source of truth. An assignment is considered active only when
the relevant row has an owner, priority, branch/proof target, status, and next action.

When assigning or changing work:

1. Update the row in this file.
2. Put detailed instructions and evidence requirements in the relevant STT report.
3. Tell the other agent to pull `main` and read this file plus the named report section.
4. The receiving agent claims the work by updating status/branch in this file before writing.

Do not rely on chat-only instructions for release blockers. Chat can announce the change, but
the durable assignment lives here.

## Manual Proof Environment Contract

Manual human STT proof must use the real-auth manual app only:

```text
Launch command: pnpm dev
Expected URL: http://localhost:5174
Forbidden for human proof: pnpm exec vite, direct vite launch, pnpm dev:test, localhost:5173, .env.test
```

`localhost:5173` is mocked E2E diagnostics only. Any Native/Private human STT artifact collected on
`5173`, with mock auth, or from a direct Vite launch is invalid for release evidence. CDP/browser
monitoring must attach to the same `5174` tab before recording when possible; otherwise the artifact
must explicitly say CDP was unavailable and rely on user observation plus app/server logs.

Implementation status: STT-E1 wires this into shared benchmark snapshots and manual proof launchers.
Expected artifact block:

```json
{
  "environmentProof": {
    "url": "http://localhost:5174/session",
    "port": 5174,
    "authMode": "real",
    "mockAuth": false,
    "releaseProofEligible": true,
    "cdpSameTab": true
  }
}
```

## Branch Status Values

```text
coding
ready
testing
blocked
merge-approved
merged
abandoned
done
```

## Required Branch Declaration

Every active branch or proof must state:

```text
Branch:
Base SHA:
Files touched:
Expected behavior change:
Tests run:
Proof needed:
Rollback plan:
```

## Worktree Model

Each agent should use an independent worktree or isolated branch whenever possible.

| Agent | Preferred workspace |
|---|---|
| dev-agent | dev-owned worktree / `dev/...` branches |
| test-release-agent | test-owned worktree / `test/...` or `docs/...` branches |
| integration | original repo or clean main worktree only |

Agents may test another agent's branch before it merges. That is preferred for risky STT changes:
build branch -> test branch/SHA -> approve or revise -> merge once.

## Merge Rules

- Only one merge to `main` at a time.
- Merge only branches with a task ID, clean diff, tests run, and proof attached or explicitly requested.
- Behavior-changing STT branches need product/test approval before merge.
- Report verdicts and release classifications are serialized; do not let two agents edit the same verdict section at once.
- After merge, update this board with the new `INTEGRATION_MAIN`, branch status, and next proof/action.

## Report Editing Protocol

| Agent | Permission |
|---|---|
| test-release-agent | Owns current verdicts, latest evidence, pass/fail classification |
| dev-agent | Appends only under `## DEV → TEST AGENT` or targeted handoff blocks |
| product owner | Owns priority, scope, release classification, paid/free positioning |
