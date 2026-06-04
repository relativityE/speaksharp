# Private STT Release Evidence — Current

**Updated:** 2026-06-04T16:53Z
**Scope:** Private v2 local/browser STT, explicit setup consent, accuracy, trust UI, save/history/detail  
**Canonical matrix:** `product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.json`

## Verdict

```text
Private STT: NOT RELEASE-GREEN
```

Explicit local model setup consent is now proven, but the current human transcript is too inaccurate and the detail journey still fails. Product has clarified a stricter bar: Private is not allowed to be "private but worse"; it must become a credible front-door STT path.

## Release-Proof Environment Requirement

Private release proof must run on `localhost:5174` with real auth and explicit user setup consent when a model download is needed. Artifacts must include `environmentProof` and must stop before recording if the target is `5173`, mock auth, `.env.test`, deployed URL, or the wrong browser/CDP target. Injected-audio Private runs can buy down risk, but they must be labeled diagnostic unless they pass this release-proof gate.

## Product Bar — Private Must Be Credible

Private STT must meet or beat the better of:

```text
1. same-model/drop-in Private equivalent
2. Native human Chrome mic baseline
```

Do not classify Private green unless both comparisons are addressed. Privacy copy and trust labels can explain local processing, but they cannot excuse materially worse transcript quality.

Required comparison fields for every Private accuracy/timing change:

```text
app vs drop-in delta
app vs Native baseline delta
WER / accuracy
filler recall and false filler insertion
readability
firstProgressMs / firstDraftMs / finalAtMs / stopFinalizationMs
save/history/detail equality
no Cloud fallback
```

## DEV→TEST Handoff — @test-agent (2026-06-04, owner: dev-agent)

**Re-proof — merged to `main`:**

| @test-agent re-proof | Merge | Verify |
|---|---|---|
| **Private detail transcript empty (#29)** | `72cabe45` | After Stop, `/analytics/:id` → `data-session-detail-transcript` is **non-empty**. Shared root cause with Native: missing `['session', id]` cache invalidation, **not** Private STT. |
| **Private setup CTA size copy (#30)** | `82be4993` | Verify first-time Private setup shows the local model download size, not estimated setup time, and still requires explicit user click before download. |

**v4 containment — @test-agent owns the browser proof (one-time, NOT a fix).** Answer only: *does Private v4 produce any non-empty transcript in the real browser app path?* — not "can we fix it / is it better than v2." Capture in the report: resolved `@huggingface/transformers` version in-worker, model download, provider-ready, record start/stop, decode result, exact failure signature (`invalid data location: undefined for input "a"`), whether `saveCandidate` stays empty, and **no silent Cloud fallback / no polluted v2 path**.
- **DEV dev-half finding (testing-only):** `@huggingface/transformers` is declared at the root package (`^4.2.0`) but not in `frontend/package.json` (which only declares `@xenova/transformers ^2.17.2`). The v4 worker does `await import('@huggingface/transformers')`, so the containment proof should capture the resolved browser-worker version/package path. Per product, do **not** promote v4 as a release dependency unless the browser decode path succeeds.
- **@test-agent records the classification (your call):** if the decode fails as expected, freeze it verbatim — *"Private v4 browser path: confirmed non-release-candidate. Browser lifecycle reaches model-ready/recording, but decode fails with an ONNX Runtime tensor/data-location error and produces no saved transcript. Keep off by default. Do not include in release A/B. Resume only as Phase 3 runtime/model upgrade work after the dependency is pinned and decode succeeds."*

## DEV → TEST: STT-P5 named VAD candidate ready (2026-06-04, owner: dev-agent)

The named VAD prototype flag + onset-gate engine is built and unit-verified on
`dev/private-vad-silero-engine@10ba21ca` (base `01933f91`). **Test the branch pre-merge**
(do not wait for a `main` merge). This satisfies the `## Test-Release Plan — VAD Prototype
Gate` below — run that gate against this branch.

**Enable:** `?privateVad=1` **or** `window.__PRIVATE_VAD_PROTOTYPE__ = true`. Off by default.

**What changed (flag ON only):** Silero VAD speech-probability replaces the RMS energy gate
at the Private **onset** decision; the RMS path is byte-identical when off (PrivateWhisper
43/43, tsc clean). Silence/end-gate VAD is a deliberate **fast-follow** (this iteration is
onset-only). Runtime = **`onnxruntime-web@1.14.0` reused** (NOT `@ricky0123/vad-web`) — no
second ORT, deliberately avoiding the v4 `invalid data location` duplicate-runtime class.

**Browser pre-reqs (must do before the A/B can exercise VAD):**
1. Place `silero_vad.onnx` (~1.8 MB, Silero v5) in `frontend/public/models/`.
2. Declare `onnxruntime-web@1.14.0` in `frontend/package.json` (pins the same version
   `@xenova` already resolves — no new runtime, just a direct import path).
If either is missing, `createSileroVad()` returns null → **automatic RMS fallback**
(telemetry `vadFellBackToRms: true`); the app never breaks.

Test-agent update: the asset/dependency staging issue is superseded by the browser proof below.
The current blocker is ONNX Runtime WASM loading in the browser, not the missing Silero model file.

**Telemetry to capture (`window.__PRIVATE_VAD_TELEMETRY__`):**
`vadEnabled`, `vadModel` (`silero-vad`), `vadRuntime` (`onnxruntime-web`),
`vadRuntimeVersion`, `vadOnsetMs`, `vadMeanSpeechProb`, `vadFellBackToRms`. Plus the usual
`__PRIVATE_TIMING__` (`speechStartOffsetMs`, `retainedPrerollMs`, `peakBufferedSeconds`,
`firstProvisionalAtMs`, `finalizeDecodeMs`).

**Pass/fail (per the bar):** RMS-vs-VAD on the same audio (h1_2/6/8/10, washington_01,
human script, one silence-leading, one low-energy-tail). VAD must **improve or hold**
onset/soft-speech capture + WER + filler recall with **no onset clipping / tail loss** and
no >10% first-progress/finalize regression. Report **app-vs-drop-in** and
**app-vs-Native-baseline** deltas. Do not green VAD on timing alone. `vadFellBackToRms:true`
means the model didn't load — fix the pre-reqs, not the verdict.

## TEST → DEV: STT-P5 browser VAD fallback proof (2026-06-04, owner: dev-agent)

Test branch: `test/stt-p5-current-main@f8abfe96` (`main@63509d0a` +
`dev/private-vad-silero-main` stack). The proof harness now accepts `STT_PRIVATE_VAD=1` and
captures `window.__PRIVATE_VAD_TELEMETRY__`.

Focused static proof passed before browser testing:

- `PrivateWhisper.test.ts` + `privateVadFlag.test.ts`: `49/49`
- `pnpm --dir frontend exec tsc --noEmit`: clean

Browser A/B on `h1_6`:

| Run | Artifact | Accuracy | WER | Transcript | Stop finalization | VAD telemetry |
|---|---|---:|---:|---|---:|---|
| RMS baseline | `/private/tmp/stt-p5-rms-h1_6.json` | `87.5%` | `0.125` | `Day, Like, Told Wild Tales to Frighten Him.` | `2706 ms` | n/a |
| `STT_PRIVATE_VAD=1` | `/private/tmp/stt-p5-vad-h1_6.json` | `87.5%` | `0.125` | `Day, Like, Told Wild Tales to Frighten Him.` | `1983 ms` | `vadFellBackToRms:true`; `vadRuntimeVersion:null`; `vadSpeechSegments:[]`; `vadMeanSpeechProb:null`; `vadOnsetMs:196.6` |

Conclusion: this was **not** a valid Silero-vs-RMS A/B. The flag was set, but the browser path
fell back to RMS. The equal accuracy result only proves the fallback path is safe.

Browser console evidence in the VAD artifact:

```text
wasm streaming compile failed: TypeError: Failed to execute 'compile' on 'WebAssembly':
Incorrect response MIME type. Expected 'application/wasm'.

failed to asynchronously prepare wasm: CompileError: WebAssembly.instantiate():
expected magic word 00 61 73 6d, found 3c 21 64 6f @+0

Aborted(CompileError: WebAssembly.instantiate(): expected magic word 00 61 73 6d,
found 3c 21 64 6f @+0)
```

**Next action for @dev-agent:** fix the ONNX Runtime WASM asset serving/path/MIME for
`onnxruntime-web@1.14.0` before requesting more VAD A/B. The next proof should first confirm:

```text
window.__PRIVATE_VAD_TELEMETRY__.vadFellBackToRms === false
window.__PRIVATE_VAD_TELEMETRY__.vadRuntimeVersion is non-null
window.__PRIVATE_VAD_TELEMETRY__.vadSpeechSegments has entries or speech probability data is populated
```

Likely fix surface: set `ort.env.wasm.wasmPaths` to a public path with the required ORT WASM
binaries, or copy the exact `onnxruntime-web@1.14.0` WASM files into `frontend/public` and verify
Vite serves them with `application/wasm`. Do not classify P5 quality until this telemetry proves
Silero actually ran.

## DEV → TEST: STT-P6 model-eval candidate ready (2026-06-04, owner: dev-agent)

Built + unit-verified on `dev/private-model-eval@25cde3b4` (base `d910a07d`). **Test the branch
pre-merge.** This is the **decode/model-quality lever** the CI 51.7% WER points at — the
companion to STT-P5 (onset VAD). Both flags are independent and can be A/B'd separately or
together.

**Enable (one model per session):** `?privateModel=distil-small.en` or `whisper-base.en`
(or `window.__PRIVATE_MODEL__ = '...'`). Default/absent/unknown → `whisper-tiny.en`
(production, byte-identical). No new dependency; the larger model downloads on demand.

Test-agent update: current-main branch was provided and tested. The default model works; the
larger candidates do not currently reach recording in the browser.

**Candidate matrix (`PRIV_STT_MODELS`):**

| Key | Remote id | Approx download |
|---|---|---|
| `whisper-tiny.en` (default) | `Xenova/whisper-tiny.en` | ~40 MB |
| `whisper-base.en` | `Xenova/whisper-base.en` | ~145 MB |
| `distil-small.en` | `Xenova/distil-small.en` | ~166 MB |

(Remote ids/sizes are best-effort — confirm the actual download + that the model resolves in
the browser worker; if a candidate id is wrong, report it and I'll correct the constant.)

**Telemetry (`window.__PRIVATE_MODEL_TELEMETRY__`):** `model`, `approxMB`, `overridden`,
`loadTimeMs` (read actual load time from the worker `loaded` message). Plus the standard
Private accuracy/timing fields.

**Pass/fail (per the bar):** for each candidate, RMS-default decode on h1_2/6/8/10 +
washington_01 + human script. A larger model **passes** only if its WER/accuracy improvement
over `whisper-tiny.en` **justifies** the extra download/memory/latency (product weighs the
trade). Report **WER/accuracy, download MB, load time, decode latency/RTF**, plus
**app-vs-drop-in** and **app-vs-Native-baseline** deltas. Do not switch the default without
this evidence (no blind switch).

## TEST → DEV: STT-P6 browser model-eval setup proof (2026-06-04, owner: dev-agent)

Test branch: `test/stt-p6-current-main@2c903463` (`main@6a24984c` +
`dev/private-model-eval-main` stack). The proof harness now accepts `STT_PRIVATE_MODEL=...` and
captures `window.__PRIVATE_MODEL_TELEMETRY__`.

Focused static proof passed before browser testing:

- `privateModelFlag.test.ts` + `PrivateSTT.test.ts` + `PrivateWhisper.test.ts`: `63/63`
- `pnpm --dir frontend exec tsc --noEmit`: clean

Browser model proof on `h1_6`:

| Model | Artifact | Result | Accuracy | WER | Key telemetry / error |
|---|---|---|---:|---:|---|
| default `whisper-tiny.en` | `/private/tmp/stt-p6-tiny-h1_6.json` | pass | `87.5%` | `0.125` | `privateModelTelemetry={ model:"whisper-tiny.en", approxMB:40, overridden:false, loadTimeMs:663 }`; runtime `wasm-singlethread` |
| `whisper-base.en` | `/private/tmp/stt-p6-base-h1_6.json` | fail before recording | n/a | n/a | `page.waitForFunction: Timeout 180000ms exceeded`; UI: `Private / Vault Mode could not finish setup`; console: `Model load failed with "Unexpected token <"` |
| `distil-small.en` | `/private/tmp/stt-p6-distil-h1_6.json` | fail before recording | n/a | n/a | Same setup timeout and `Unexpected token '<', "<!doctype "... is not valid JSON` model-load failure |

Representative browser console error from both candidates:

```text
[TransformersJS] Model load failed with "Unexpected token <".
This suggests a 404 error where the server returned index.html instead of the model file.

[TransformersJS] Failed to initialize engine.
errorMessage: Unexpected token '<', "<!doctype "... is not valid JSON

[FSM] Transition: ENGINE_INITIALIZING --(INIT_FAILED)--> INIT_FAILED
```

Conclusion: P6 is **not ready for quality A/B**. The default model still works, but both larger
candidate models fail setup before audio is captured, so there is no WER/RTF comparison yet.

**Next action for @dev-agent:** fix candidate model resolution before asking for more browser
model-eval proof. Either correct the `remoteId` values (`Xenova/whisper-base.en`,
`Xenova/distil-small.en`) / asset URL path, or add a model-manifest preflight that fails quickly
with a named error such as `MODEL_NOT_FOUND` / `MODEL_MANIFEST_INVALID`. The user experience must
not leave Private setup in a disabled mic state for 180 seconds when a candidate model URL resolves
to HTML.

## TEST → DEV: STT-P1 current-main Private proof (2026-06-04, owner: dev-agent)

Current-main proof on `main@cf4886be`.

Artifact: `/private/tmp/stt-p1-current-main-h1_6-conv_01.json`

Environment proof:

```json
{ "port": 5174, "authMode": "real", "mockAuth": false, "releaseProofEligible": true, "cdpSameTab": true }
```

Results:

| Fixture | Journey/detail | Accuracy | WER | Saved/detail transcript | Finding |
|---|---|---:|---:|---|---|
| `h1_6` | pass | `87.5%` | `0.125` | `Day, Like, Told Wild Tales to Frighten Him.` | Accuracy below parity target but save/history/detail are coherent. |
| `conv_01` | pass | `85.71%` | `0.142857` | `Umm, basically, we should literally like, wait.` | Saved transcript is coherent, but filler metric reports `um:0` instead of expected `um:1`. |

Conclusion: current-main Private journey is healthier than earlier contaminated artifacts
(selectedForSave, post-stop transcript, history, and detail match), but SpeakSharp coaching still
under-counts `Umm` as `um`.

**Next action for @dev-agent:** fix final-session filler normalization / metric derivation so
`Umm` counts as `um` in saved-session coaching. The already-tested P1D branch improved filler rows,
but its repetition-collapse output was not green; split or merge only the filler-count fix if safe.

## TEST → DEV: STT-P7 Private mic-start false failure (2026-06-04, owner: dev-agent)

Human proof on the real manual app (`pnpm dev`, `localhost:5174`, real auth) found a
separate user-trust blocker: clicking the Private mic sometimes failed before recording was
usable. Evidence: `/private/tmp/speaksharp-human-private-cdp-20260604.log`.

Relevant sequence:

```text
18:12:37.287 [TranscriptionService] Start requested
18:12:37.320 READY --(ENGINE_STARTED)--> RECORDING
18:12:38.177 [RECORDING_LIFECYCLE_FAIL]
18:12:38.210 [TranscriptionService] Heartbeat Failure Escalated
```

The user saw several mic-click errors/toasts before a later attempt worked. This is **not**
the same as the WER/model/VAD lane and should not block STT-P5/STT-P6 proof design. It is a
startup reliability bug. Suggested code boundary for @dev-agent: `PrivateWhisper` /
`PrivateSTT.getLastHeartbeatTimestamp()` / `SpeechRuntimeController.startWatchdog()`. Patch
must prevent a false stale heartbeat during first start without hiding real worker death.
Add a unit/regression test for a fresh Private start where the wrapper heartbeat is current
but the inner engine heartbeat may be stale, plus an injected-audio smoke proof.

**Fix shipped to `main@d8a3b7d2`:** `SpeechRuntimeController.startWatchdog()` now treats a
zero/invalid first heartbeat as "no pulse yet" for the normal heartbeat window instead of
immediately failing a fresh Private start. If no valid heartbeat arrives within the same
timeout, it still transitions to failed. Verification run by test-release-agent: focused
`watchdog.test.ts` 4/4 and `pnpm --dir frontend exec tsc --noEmit` clean. Remaining proof:
injected Private start smoke and next human Private proof should show no false mic-click
failure/toast.

## DEV → TEST: STT-P7 extension ready (2026-06-04, owner: dev-agent)

Branch `dev/stt-p7-soft-frozen-trace@30eb264a` (base `6eaa4ba6`), **extends** the shipped
`d8a3b7d2`. Test the branch pre-merge.

**Root cause split:** `d8a3b7d2` fixed the **controller** watchdog (the hard
`RECORDING_LIFECYCLE_FAIL`/escalation). But the **`TranscriptionService` soft-"frozen"
watchdog** *also* computed `drift = now − inner_heartbeat`, so a fresh Private start (inner
heartbeat `0` during model warmup) raised a **false "Engine Frozen" warning toast** — the
"mic-click errors/toasts before recording worked" the user reported. `d8a3b7d2` did not touch
this path; this branch fixes it.

**What changed:**
- `TranscriptionService.startWatchdog`: same bounded-grace baseline (measure drift from watchdog
  start until a valid inner pulse arrives) → no false freeze on warmup; a worker that never
  heartbeats still trips (real death intact). Driven by a shared, unit-tested pure function
  `evaluateHeartbeatWatchdog`.
- **Req 6 trace** on BOTH watchdogs: `window.__PRIVATE_HEARTBEAT_TRACE__` = `{ controller, service }`,
  each `{ source: 'inner-heartbeat' | 'watchdog-grace', lastHeartbeat, effectiveLastHeartbeat,
  watchdogStartedAt, driftMs, thresholdMs, hasValidHeartbeat, tripped, at }`.

**Requirements:** 1 ✓ regression (6 cases) · 2 ✓ · 3 ✓ real death intact · 4 ✓ no global silence ·
5 ✓ timeouts unchanged · 6 ✓ trace · 7 → unit done; **injected-audio smoke still open**.

Test-agent note: focused branch proof was re-run (`watchdog.test.ts` +
`heartbeatTrace.test.ts` = 10/10; frontend typecheck clean). The first browser smoke attempt was
**invalid evidence** because it launched direct Vite on `5178` and `/auth/signup` returned blank
404. The valid rerun used a current-main test branch with the P7 fix cherry-picked
(`test/stt-p7-current-main-smoke@f98987c3`) served through canonical `pnpm dev` on
`localhost:5174`.

Valid injected-start smoke result: **passed**. Private reached `RECORDING`, stopped, saved, and the
captured console stream contained no `RECORDING_LIFECYCLE_FAIL` and no "Engine Frozen" toast/error.
Runtime proof was valid (`environmentProof.source=app-runtime-config`, `port=5174`, `authMode=real`,
`mockAuth=false`, `releaseProofEligible=true`). Artifact trace:
`/private/tmp/stt-p7-private-smoke-current/live-tester-b-private-nati-a0965-1-audio-and-detects-fillers-deployed-live-chromium/trace.zip`.
Residual capture gap: this helper does not emit `window.__PRIVATE_HEARTBEAT_TRACE__`, so the next
human Private proof should capture it if available.

**Proof (test-agent):** injected Private-start smoke + next human Private proof must show
**no `RECORDING_LIFECYCLE_FAIL` AND no "Engine Frozen" toast**, and `__PRIVATE_HEARTBEAT_TRACE__`
should read `source: 'watchdog-grace'` during the warmup window then `'inner-heartbeat'` once the
engine pulses. Verify a deliberately-killed worker still trips (no masking).

## Latest Test-Release Result — CI Private Browser Benchmark

Owner: **test-release-agent / Codex**  
Run: GitHub Actions `Controlled STT Benchmarks` / `26966053435`  
Tested head: `de0e6f1e`  
Artifacts: `/private/tmp/private-browser-benchmark-26966053435`

| Engine | Result | Evidence | Release meaning |
| --- | --- | --- | --- |
| Private v2 / TransformersJS CPU | **Failed accuracy gate** | Saved `79` words from an `87`-word Harvard fixture, but WER was `51.72%` / accuracy `48.28%` versus the prior browser ceiling `6.11%` WER. `saveCandidateReason=service_result`; `sessionPersisted=true`; fillers counted in UI. | This is not a setup/auth failure. The app path initialized and saved, but transcript quality is far below parity. Keep Private v2 **not release-green** pending the named accuracy/VAD proof lane. |
| Private v4 worker | **Failed completeness gate** | `saveCandidateReason=empty`; `selectedForSaveLength=0`; `finalWordCount=0`; transcript placeholder remained; no useful text was saved. | Classify v4 as **confirmed browser non-release-candidate** for this cycle. Do not include v4 in release A/B unless a future runtime/model branch proves non-empty browser decode first. |

Notes:

- This run pre-dates the later VAD flag scaffold (`8c7ef391` / `551b1a80`), so it does **not** validate the new flag-off path. It does close the one-time v4 containment question on the pre-VAD browser path.
- The v2 failure is a quality/parity failure, not a saveCandidate extraction issue: the authoritative save candidate and visible transcript agree on the poor transcript.
- The first-text phase still included trust/helper copy in the visible container. Use `data-transcript-text-only` and `saveCandidate.selectedForSave` for transcript-only extraction.

## Latest Test-Release Result — Current-Main Non-Human Validation

Owner: **test-release-agent / Codex**
Head: `82be4993`

| Check | Result | Meaning |
| --- | --- | --- |
| `pnpm typecheck` | passed | Current #30/setup CTA + STT code type-checks. |
| `LiveRecordingCard` + `ModelManager` | `29/29` passed | Setup CTA and model-size source of truth are wired. |
| `LiveRecordingCard` + `StatusNotificationBar` + `privateRuntimePath` | `36/36` passed | Setup/status copy remains private/local only where appropriate. |
| Private timing/service/merge tests | `87/87` passed | `__PRIVATE_TIMING__`, merge/provisional, `PrivateWhisper`, `TranscriptionService`, and session lifecycle contracts remain green. |

This does **not** close the human proof gate. It only clears the current-main non-human smoke before the next Private human/browser proof.

## Current Controlling Proof

Artifacts:

```text
/private/tmp/speaksharp-private-human-20260604-rerun.json
/private/tmp/speaksharp-private-human-20260604-rerun.jsonl
```

| Field | Current result |
| --- | --- |
| Setup consent | user clicked visible `Set Up`; no harness auto-click |
| Recording | started after model ready |
| Save source | `service_result` |
| Reference words | `55` |
| Saved words | `39` |
| Accuracy / WER | `56.36%` / `43.64%` |
| Filler recall | `66.67%`; `um` missed |
| False filler insertions | `0` |
| Detail transcript | empty / not extracted |
| Duplication | no loop in this final transcript |

Saved transcript:

```text
Speak sharp microphone proof starts now. Basically, I want to make one simple point before we move on. Like, the memory transcript should still keep prior sentences, or the final words. Next step is to see or explain's quality.
```

## Latest Diagnostic — Private `conv_01` Injected Mic

Owner: **test-release-agent / Codex**
Artifact: `/private/tmp/private-corpus-conv01-f9b21005.json`
Environment: `localhost:5174`, real auth, `releaseProofEligible=true`; injected mic audio, so this buys down risk but does **not** replace human release proof.

| Field | Result |
| --- | --- |
| Fixture | `conv_01`: `Um. Basically, we should literally like, wait.` |
| First useful text | `2826ms`; first text `Um, basically.` |
| Visible at Stop | `Um, basically. Umm, basically, we should literally like. wait.` |
| Final / saveCandidate | `Umm, basically, we should literally like, wait.` |
| Accuracy / WER | `85.71%` / `14.29%` |
| Stop finalization | `1983ms`; model decode `1515.5ms`; drain wait `383.6ms` |
| Runtime | `transformers-js`, `wasm-singlethread`, `wasmThreadCount=1`, no Cloud fallback |
| Save/history/detail | pass: `sessionPersisted=true`, `historyVisible=true`, `detailVisible=true`; detail matches selected save transcript |
| Trust UI | `Draft transcript` visible during live draft; `Processing speech locally…` visible while stopping; final state cleared |
| Filler metric | fail: expected `um/basically/literally/like`; observed `um:0`, `basically:1`, `literally:1`, `like:1` because final text used `Umm` |

Actionable findings:

1. **@dev-agent / Private live draft quality:** live draft still repeats provisional content before Stop (`Um, basically. Umm, basically...`). Final save is cleaner, so this is live-view trust quality, not saved-data loss in this artifact.
2. **@dev-agent / filler normalization:** `Umm` should count as the user-perceived filler `um` or downgrade transcript-confidence/filler-confidence. Current metric reports `um:0`, which would under-coach a spoken filler. Code clue: `frontend/src/utils/fillerWordUtils.ts` already matches `umm`, so the likely boundary is save/scoring code preferring stale supplied `store.fillerData` over transcript-derived final filler counts (`calculateCoreSessionMetrics()` trusts supplied filler data whenever present).
3. **test-release-agent / Codex:** rerun the same human Private script on current main. This diagnostic suggests #29 detail is fixed in the app path, but only a human proof can close the release gate.

## Open Blockers

| Priority | Blocker | Evidence | Owner |
| --- | --- | --- | --- |
| P0 | Accuracy/parity failure | Expected `the main idea is that every transcript...`; saved `the memory transcript...`. This is semantic STT error, not punctuation. | @dev-agent |
| P0 | Re-proof detail transcript empty (#29) | Prior human proof had `detailTranscript=""`, but current `main` includes cache-invalidation fix `72cabe45`. Verify `/analytics/:id` `data-session-detail-transcript` is non-empty and matches `saveCandidate`. | test-release-agent / Codex |
| P1 | Filler recall below product need | Human proof missed `um`; diagnostic final text used `Umm` and filler counter still reported `um:0`. | @dev-agent / product confidence |
| P1 | Live trust/progress suspect | Human proof had weak live progress; diagnostic live draft repeated provisional content before a cleaner final save. | @dev-agent |

## Product Decisions — Implementation Policy

| Topic | Decision |
| --- | --- |
| Fix-A-v2 | Interim RMS/threshold patch only. It may ship only if focused browser proof improves current proof rows and does not regress h1 guard rows or the human-like script. |
| VAD | Intended architecture direction, but prototype behind a named flag first. Do not replace RMS gating without RMS-vs-VAD browser proof. |
| Segment-level trust | Do not ship cosmetic-only segment trust. Segment work must move toward real segment-level finalization and saved transcript integrity. |
| Private formatter | Deferred for release. No Gemini/server formatter for Private. No second local punctuation model before release unless product separately approves it. Use transcript/readability confidence caveat for now. |
| Model policy | `whisper-tiny.en` remains acceptable only if it meets the product bar. Larger/local models require browser proof of accuracy, timing, download, memory, and setup cost. |
| Setup CTA | Show model size; do not show estimated setup time. CTA should explain that the local speech model is downloaded for in-browser Private transcription and may need setup again if site storage is cleared. |

## Latest Test-Release Result — Decode-Parameter A/B

Owner: **test-release-agent / Codex**  
Branch/proof: `test/private-decode-param-ab-hook`, h1_6 browser worker proof, fake-audio fixture  
Artifacts: `/private/tmp/speaksharp-private-decode-ab-h1_6-real-auth`

| Variant | Decode options | Saved text | Accuracy / WER | Result |
| --- | --- | --- | --- | --- |
| Baseline | current app defaults | `A. Like. Told Wild Tales to Frighten.` | `75.00%` / `25.00%` | Best of this A/B, but still not parity-green. |
| Anti-hallucination | `return_timestamps:true`, `condition_on_previous_text:false`, `compression_ratio_threshold:2.4`, `no_repeat_ngram_size:3`, `temperature:[0,0.2,0.4]` | `They, like, told Wild Tales to Fridonham, they, like. Told Wild Tales To Fridinham.` | `0.00%` / `100.00%` | Rejected. It worsened h1_6 with repetition/substitution. |

Conclusion: reversible decode knobs are **not** the current Private accuracy fix. Keep app defaults while dev investigates the semantic substitution/detail/live-trust blockers.

## Test-Release Plan — VAD Prototype Gate

Owner: **test-release-agent / Codex** to execute only after `@dev-agent` ships an explicit VAD prototype flag.  
Required flag shape: one clear runtime toggle such as `PRIVATE_VAD_PROTOTYPE=1` or a browser hook with the exact candidate thresholds in the artifact. Do not test unlabelled threshold changes.

Fixtures:

```text
h1_1, h1_6, h1_8, h1_10
washington_01
latest Private human script
one silence-leading fixture with >=5s pre-speech silence
one low-energy tail fixture
```

Required metrics per row:

| Phase | Required fields |
| --- | --- |
| Setup | auth/tier, explicit setup click, model status, mic/input route |
| Runtime | `speech_start_detected`, `speechStartOffsetMs`, `retainedPrerollMs`, `peakBufferedSeconds`, `utteranceSeconds`, `lowEnergyPauseTailThreshold`, `silenceThreshold` |
| Timing | `timeToFirstProvisionalMs`, `timeToFirstFinalMs`, `finalizeWaitMs`, `finalizePrepMs`, `finalizeDecodeMs`, RTF |
| Accuracy | WER/accuracy, word completeness, semantic substitutions, filler recall, false filler insertion |
| Journey | visible transcript, `saveCandidate`, history, detail, duplicate detection |

Pass rule: VAD prototype must improve or preserve baseline accuracy on h1_6 and the human script, preserve onset/tail words, preserve fillers, and not regress first progress/finalization timing by more than 10%. Any onset clipping, low-energy tail loss, or worse semantic substitution fails the prototype.

## Trust-Copy Contract

Private may use local language only for actual local processing states.

| State | Required copy |
| --- | --- |
| Recording, no speech yet | `Listening locally…` |
| Speech/activity, no useful words yet | `Processing speech locally…` |
| Visible provisional words | `Draft transcript` |
| Stop/final decode running | `Processing speech locally…` or `Finalizing local transcript…` |
| Final accepted | normal final transcript styling |
| Forbidden | Gemini/server formatter by default; punctuation cleanup that hides semantic substitutions |

## Next Test On Current Main / After Private Candidate

Owner: **test-release-agent / Codex**.

Completed **test-release-agent / Codex** work is recorded in the canonical matrix: decode-parameter A/B, VAD prototype proof plan, session-to-analytics coherence, browser UX sweep, and report hygiene.

Current **test-release-agent / Codex** action:

```text
Rerun the same Private human script on current main to verify #29 detail fix and current Fix-A-v2 behavior, then rerun again after any named VAD/model candidate.
If dev ships a named VAD prototype flag or a new decode candidate, run the predeclared proof gates from the canonical matrix.
```

Coordination protocol: do work on a temporary branch; when complete and verified, merge to `main`, delete the temp branch, and keep reports/backlog updated with the merge commit. Do not leave release fixes stranded on long-lived branches.

Rerun the same human script and capture:

```text
__SPEECH_RUNTIME_DEBUG__().saveCandidate
__PRIVATE_TIMING__
__SS_TRUST_STATE__ / __SS_TRUST_TRACE__
data-session-persisted-id
data-session-detail-transcript
filler rows via data-filler-word/data-filler-count
```

Pass only if setup remains explicit, visible draft text is useful/cumulative before Stop, saved transcript is near drop-in/customer expectation, `um` is not silently missed without confidence downgrade, and detail text matches the authoritative save candidate.

---

## DEV → TEST: STT-P1D live-draft repetition + stale filler count fixed (2026-06-04, owner: dev-agent)

**Branch:** `dev/private-live-draft-dedup@5d7d7f89`  **Base:** `main@7152c5c8`  **Status:** ready for human re-proof. Behavior-changing (display + scoring) → do not merge before test/product approval.

**What the `conv_01` diagnostic showed (both symptoms, one root cause):**
The Private live view doubled the just-committed tail — `Um, basically. Umm, basically, we should literally like. wait.` — and the saved session reported `um:0` even though the saved text contained `Umm`. Root cause: overlapping live provisional decodes (sliding window) re-state the committed tail with different filler spelling.

**Fix 1 — filler count (`um:0` → real count).** Confirmed your code clue. The save/score path (`SpeechRuntimeController`) was passing the live `store.fillerData` (accumulated incrementally, stale across the restatement) into `calculateCoreSessionMetrics`, which *prefers a supplied count over re-counting* (that preference is intentional and is kept — see existing test `uses supplied live filler counts…`). The fix is in the **caller**: it now omits `fillerData` so the persisted/scored count is derived from the **authoritative final transcript** via `countFillerWords`, whose UM regex already normalizes `umm/ummm/uhm → um`. No change to `calculateCoreSessionMetrics` itself.

**Fix 2 — live-draft repetition.** New `dedupeLiveDraftRestatement(committed, interim)` in `liveTranscriptUtils.ts`, applied at the `LiveTranscriptPanel` display projection. Conservative: requires a **≥2-word** overlap within a bounded window, normalizes case/punctuation and filler spelling so `Umm`↔`Um` match, strips the re-stated leading words of the interim, and returns `''` on a full restatement (preserving the prior exact-match dedup). **Display only — the saved whole-utterance final decode is untouched.**

**Files touched:** `SpeechRuntimeController.ts` (filler), `components/session/liveTranscriptUtils.ts` (+helper), `components/session/LiveTranscriptPanel.tsx` (apply), `+` 2 test files.
**Tests run:** frontend `tsc --noEmit` clean; `LiveTranscriptPanel.component.test.tsx` + `sessionAnalysis.test.ts` = **48/48** (added +5 `dedupeLiveDraftRestatement` cases incl. the exact `Um,basically.`/`Umm,basically…` case → `we should literally like. wait.`, and +1 `sessionAnalysis` regression: omitted `fillerData` re-counts `Umm` as `um:1`).
**Rollback:** revert `5d7d7f89` (5 files); no schema/flag/migration.

**Proof recipe (human Private on `localhost:5174`, real auth — re-run the `conv_01` flow):**

```text
1. Pull main, check out dev/private-live-draft-dedup, serve via canonical `pnpm dev` (5174).
   Preflight: window.__APP_RUNTIME_CONFIG__.releaseProofEligible === true.
2. Private → model setup → record conv_01 → watch the LIVE view before Stop:
   PASS = no "Um, basically. Umm, basically…" doubling; the re-stated prefix is gone,
          the genuinely-new continuation remains.
3. Stop → Save → read the saved session filler rows:
   PASS = saved text containing "Umm" reports um >= 1 (data-filler-word="um" / data-filler-count),
          NOT um:0.
4. Confirm no regression to the existing fields:
   __SPEECH_RUNTIME_DEBUG__().saveCandidate, data-session-detail-transcript equality,
   first-text latency, final accuracy ~ prior run (this change does not touch decode).
```

Expect **no** change to saved transcript text or accuracy (display + count-source only). If the live view still doubles, capture the exact committed vs interim strings (`__SS_TRANSCRIPT_TRACE__`) — that would indicate the restatement lives inside a single committed string rather than at the committed/interim boundary, which is a different (commit-path) fix.

## TEST → DEV: STT-P1D current-main injected proof (2026-06-04, owner: dev-agent)

**Branch tested:** `test/private-p1d-current-main@112bb51e` = current `main@cc630d3e`
+ cherry-pick `dev/private-live-draft-dedup@5d7d7f89`.

**Pre-browser proof:**
- `LiveTranscriptPanel.component.test.tsx` + `sessionAnalysis.test.ts`: **48/48 pass**.
- Frontend `tsc --noEmit`: **clean**.

**Browser proof:** `BASE_URL=http://127.0.0.1:5174` with canonical manual real-auth
environment. Playwright initially failed inside the sandbox with macOS MachPort permission;
rerun outside sandbox passed. Artifact trace:
`/private/tmp/stt-p1d-private-smoke-current/live-tester-b-private-nati-a0965-1-audio-and-detects-fillers-deployed-live-chromium/trace.zip`.

**Pass:** the filler-count half improved. Saved filler rows reported:

```json
[
  {"word":"basically","count":3},
  {"word":"um","count":2},
  {"word":"like","count":2},
  {"word":"literally","count":2}
]
```

So the `Umm`/`um` normalization path is no longer `um:0` in this injected proof.

**Fail:** the repetition/content-quality half is still not release-ready.

Truth:

```text
Um. Basically, we should literally like, wait.
```

Visible live text still repeated provisional content:

```text
Draft transcript Text may change before the final transcript is saved.Uhm, basically. we should literally like, way. I, wait, um, basically we should live. Uhm, basically. we should literally like, way. I, wait, um, basically we should live.
```

Authoritative saved/clean transcript was still repeated and semantically worse than truth:

```text
Basically, we should literally like, "Wait, um, basically, we should literally like, wait, um, basically."
```

`saveCandidate` boundary:

```json
{
  "saveCandidateReason": "service_result",
  "selectedForSaveLength": 106,
  "finalWordCount": 15,
  "resultTranscriptLength": 106,
  "chunkTranscriptLength": 106,
  "storeTranscriptLength": 106,
  "frozenStopTranscriptLength": 85,
  "candidateLengths": [
    {"source":"service_result","length":106},
    {"source":"committed_final","length":106},
    {"source":"visible_snapshot","length":85},
    {"source":"best_meaningful_partial","length":85},
    {"source":"store_visible_snapshot","length":106}
  ]
}
```

Timing context:

```json
{
  "timeToFirstProvisionalMs": 2908.9,
  "timeToFirstFinalMs": 11413.4,
  "finalizeDecodeMs": 1937.3,
  "finalizeWaitMs": 1260.6,
  "finalizePrepMs": 3.6,
  "utteranceSeconds": 8.315,
  "peakBufferedSeconds": 2.251
}
```

**Conclusion for @dev-agent:** keep the filler-count caller fix, but do **not** treat
`dev/private-live-draft-dedup@5d7d7f89` as release-ready. The remaining repetition is present
in `service_result` / committed final / store-visible candidates, not merely in a contaminated
DOM scrape. Next fix should target the service-result/final-candidate repetition path or explicitly
classify it as an engine decode artifact that needs a separate candidate-selection/filtering guard.

---

## DEV → TEST: STT-P8 — capture resampler parity candidate (2026-06-04, owner: dev-agent)

**Branch:** `dev/private-resampler-parity@58d9ba7d`  **Base:** `main@7656d68d`  **Status:** ready for A/B. Behavior-changing audio → no merge before A/B + product approval.

**Root cause of the Private app-vs-drop-in accuracy parity gap (deterministic, from code — not a guess):**
The Private final/saved transcript is a single whole-utterance decode of a CONTIGUOUS buffer
(`commitWholeUtteranceTranscript` → `privateSTT.transcribe`), using the **same** engine
(`TransformersJSEngine`), **same** model (`whisper-tiny.en`), and **same** decode options
(`chunk_length_s=30`, `stride_length_s=5`, `return_timestamps=true`) as the Private drop-in
(`private-browser-dropin.ts` → `engine.transcribe`). I verified the final buffer is contiguous
(every post-onset frame retained; only trailing silence after the last real-speech frame is
trimmed) — so it is **not** a cross-utterance-chunking or seam-from-gating problem.

The **one** remaining divergence on the exact audio fed to the decode is the **resampler**:
- Real-time capture worklet (`pcm-downsampler`, the app's final-decode input) → **box-averaging**.
- Drop-in reference (`resampleLinear`) **and** the app's own non-realtime helper
  (`AudioProcessor.downsampleAudio`) → **linear interpolation**.

So the app decodes a spectrally different 16 kHz signal than the drop-in even on identical mic
audio. This is the most plausible cause of `app(63.22%) < drop-in`, and it explains why the
test-side **decode-parameter A/B couldn't fix it** (the inputs differ before decode).

**This may also be the STT-P1D save-candidate repetition.** Degraded/box-filtered audio is a
known trigger for Whisper repetition-hallucination (the `service_result` doubling you measured:
`…wait, um, basically, we should literally like, wait, um, basically`). The box-vs-linear A/B
should record **whether linear removes the repetition**, not just whether WER improves.

**Fix shape (flagged candidate, P5/P6 pattern, default OFF = byte-identical):**
- `pcmResamplers.ts` — pure, unit-tested streaming resamplers. `createStreamingLinearResampler`
  is phase-continuous across 128-sample blocks and matches the one-shot linear method
  sample-for-sample; box variant preserves current behaviour.
- `audio-processor.worklet.ts` + `public/audio/audio-processor.worklet.js` (hand-maintained
  twin) — add a `resampleMode` processorOption; linear mirrors the pure reference inline.
- `privateResamplerFlag.ts` — `resolvePrivateResamplerMode()`
  (`?privateResampler=linear` / `window.__PRIVATE_RESAMPLER__='linear'`) +
  `__PRIVATE_RESAMPLER_TELEMETRY__` contract.
- `audioUtils.impl.ts` — thread resolved mode into the worklet + publish telemetry.

**Tests:** frontend `tsc` clean; `pcmResamplers` 4/4 (streaming-linear == one-shot linear parity;
box ≠ linear contrast; block-size invariance; 44.1 kHz non-integer ratio safe);
`privateResamplerFlag` 6/6; transcription `utils` 72/72.

**Proof recipe (@test-agent — box-vs-linear A/B on identical audio):**

```text
1. Serve dev/private-resampler-parity via canonical pnpm dev (5174), real auth.
2. For each fixture (conv_01, h1_6, human script): run Private twice on the SAME injected audio —
   (a) default (box), (b) ?privateResampler=linear.
   Confirm window.__PRIVATE_RESAMPLER_TELEMETRY__.resampleMode is 'box' / 'linear' respectively.
3. Capture for each: saveCandidate text, WER/accuracy, app-vs-drop-in delta, app-vs-Native delta,
   firstProgressMs/finalAtMs, and whether the STT-P1D save-candidate repetition is present.
4. PASS if linear improves or holds WER/accuracy AND narrows the app-vs-drop-in gap with no
   guard-row regression (h1_6) and no new onset clipping. Linear is the parity fix only if the
   gap closes; if not, resampler is exonerated and the gap is elsewhere (report it).
```

**Rollback:** revert `58d9ba7d` (7 files); default-OFF means no rollback needed unless promoted.

## TEST → DEV: STT-P8 preliminary A/B (2026-06-04, owner: test-release-agent / Codex)

**Branch tested:** `test/stt-p8-current-main@a38dd948` = current `main@ef13a20b`
+ cherry-pick `dev/private-resampler-parity@58d9ba7d`.

**Static proof:**
- `frontend/src/services/transcription/utils/__tests__`: **72/72 pass**.
- Frontend `tsc --noEmit`: **clean**.

**Harness note:** `scripts/manual-stt-corpus-proof.mjs` now supports
`STT_PRIVATE_RESAMPLER=box|linear` on `main` and surfaces `privateResamplerTelemetry` in the result.

**Artifacts:**
- `/private/tmp/stt-p8-box-conv01.json`
- `/private/tmp/stt-p8-linear-conv01.json`
- `/private/tmp/stt-p8-box-h1_6.json`
- `/private/tmp/stt-p8-linear-h1_6.json`

**Environment:** canonical local release proof app, `http://127.0.0.1:5174`, real auth,
`releaseProofEligible=true`, injected mic WAV route for repeatability.

**Results so far:**

| Fixture | Box accuracy / transcript | Linear accuracy / transcript | Timing signal | Verdict |
|---|---|---|---|---|
| `conv_01` | `85.71%`; `Umm, basically, we should literally like, wait.` | `85.71%`; same transcript | First text improved `5879 ms` → `3355 ms`; finalization `3427 ms` → `2690 ms` | No WER lift; no repetition in either artifact. |
| `h1_6` | `87.5%`; `Day, Like, Told Wild Tales to Frighten Him.` | `87.5%`; `Day. Like, told Wild Tales to frighten him.` | First text roughly flat `3125 ms` → `3073 ms`; finalization improved `4492 ms` → `3392 ms` | No WER lift; journey/detail passed both sides. |

`h1_6` telemetry confirmed the flag path:

```json
{
  "box": {"resampleMode":"box","overridden":false},
  "linear": {"resampleMode":"linear","overridden":true}
}
```

**Important caveat:** this preliminary run does **not** prove linear closes the app-vs-drop-in
accuracy gap. It shows no accuracy regression and some timing improvement on two short fixtures.
It also did not reproduce the STT-P1D save-candidate repetition in either `conv_01` artifact, so
it cannot prove or disprove whether linear removes that failure.

**Recommendation:** do not merge the linear resampler as an accuracy fix from this evidence alone.
Next useful paths are:
1. Extend P8 A/B to the originally requested human script / harder rows with in-result telemetry.
2. Let @dev-agent continue unblocking P5/P6 so VAD/model A/B can run.
3. If P8 remains timing-only, classify it as possible timing polish rather than the P0 accuracy fix.

## TEST → DEV: STT-P8 extended A/B (2026-06-04, owner: dev-agent)

Test branch: `test/stt-p8-extended@3341ee32` (`main@4292022a` +
`dev/private-resampler-parity`). Focused proof still passes:

- `transcription/utils` suite: `72/72`
- `pnpm --dir frontend exec tsc --noEmit`: clean

Extended browser A/B on additional guard rows:

| Fixture | Resampler | Artifact | Accuracy | WER | Transcript | Stop finalization | Journey/detail |
|---|---|---|---:|---:|---|---:|---|
| `h1_8` | box | `/private/tmp/stt-p8-box-h1_8.json` | `100%` | `0` | `The puppy, like, chewed up the new shoes.` | `2383 ms` | pass |
| `h1_8` | linear | `/private/tmp/stt-p8-linear-h1_8.json` | `100%` | `0` | `The puppy, like, chewed up the new shoes.` | `2363 ms` | pass |
| `h1_10` | box | `/private/tmp/stt-p8-box-h1_10.json` | `100%` | `0` | `Basically, the quick brown fox jumps over the lazy dog.` | `2802 ms` | pass |
| `h1_10` | linear | `/private/tmp/stt-p8-linear-h1_10.json` | `100%` | `0` | `Basically, the quick brown fox jumps over the lazy dog.` | `2833 ms` | pass |

Telemetry confirmed the flag toggled:

- box: `privateResamplerTelemetry={ resampleMode:"box", overridden:false }`
- linear: `privateResamplerTelemetry={ resampleMode:"linear", overridden:true }`

Conclusion: linear resampling is **safe on the tested rows** and does not break
save/history/detail, but it is **still not proven as an accuracy lift**. The added guard rows were
too easy because both modes scored perfectly. Do not merge P8 as an accuracy fix on this evidence
alone.

**Next useful proof:** run the human script, Washington/long script, or the original low-parity
exact buffer where box actually fails. Re-running h1_8/h1_10 will not answer the product question.

## TEST → DEV: STT-P1D complete proof (2026-06-04, owner: test-release-agent / Codex)

**Branch tested:** `test/private-p1d-complete-proof@f094f23e` = current
`main@63509d0a` + cherry-pick `dev/private-p1d-complete@e77b544c`.

**Static proof:**
- `PrivateWhisper.test.ts`: **45/45 pass**.
- Frontend `tsc --noEmit`: **clean**.

**Browser proof:** `BASE_URL=http://127.0.0.1:5174`, canonical manual real-auth environment,
Playwright fake-audio `conv_01`. Artifact trace:
`/private/tmp/stt-p1d-complete-private-smoke/live-tester-b-private-nati-a0965-1-audio-and-detects-fillers-deployed-live-chromium/trace.zip`.

**Result:** partial improvement, still not release-ready.

Truth:

```text
Um. Basically, we should literally like, wait.
```

Saved / clean transcript:

```text
Basically, we should literally like, "Wait, um, basically."
```

What improved:
- The prior long doubled phrase (`...wait, um, basically, we should literally like, wait, um, basically`) is reduced.
- Filler rows are no longer `um:0`: `um=3`, `basically=3`, `like=2`, `literally=2`.
- The browser spec passed its loose required-word and filler-row assertions.

What still fails:
- The opening `Um` is lost/moved.
- Extra `um, basically` remains at the end.
- The saved transcript still does not match the user/customer expectation for the simple fixture.

Save boundary:

```json
{
  "saveCandidateReason": "service_result",
  "selectedForSave": "Basically, we should literally like, \"Wait, um, basically.\"",
  "selectedForSaveLength": 59,
  "finalWordCount": 8,
  "resultTranscriptLength": 59,
  "frozenStopTranscriptLength": 106,
  "candidateLengths": [
    {"source":"service_result","length":59},
    {"source":"committed_final","length":59},
    {"source":"visible_snapshot","length":106},
    {"source":"best_meaningful_partial","length":106},
    {"source":"store_visible_snapshot","length":59}
  ]
}
```

**Conclusion for @dev-agent:** do **not** merge `dev/private-p1d-complete` as green. It is
a useful partial improvement, but the final candidate remains order/content-wrong. Either refine
the post-decode collapse so it preserves the earliest occurrence/order, or treat this as an engine
decode error and let P5/P6/model/VAD carry the accuracy work.

---

## DEV → TEST: STT-P1D repetition-collapse + STT-P5/P6 current-main branches (2026-06-04, owner: dev-agent)

**STT-P1D repetition fixed — `dev/private-p1d-complete@e77b544c` (base current main).**
This branch carries the test-confirmed filler-count fix + live-draft dedup AND a strengthened
`collapseTranscriptRepetitionLoops`. Root cause of the remaining failure: the existing collapse
only handled exact whole-text doubling (even length) or a unit repeated ≥3×. The conv_01 loop
is a **7-word span repeated exactly twice with a trailing token** (odd length) — missed by both,
so the doubled text became the `service_result` save candidate. Audio duplication in the onset
buffer was ruled out by code (assembled once + contiguous), so this is a decode-level Whisper
loop and is cleaned on the decode text.

Fix: also collapse a 2× repeat when the span length ≥ 5 words (a long verbatim immediate repeat),
scanning longest-span-first; short 2× repeats (`I think I think`, 4-word emphatic doubles) are
preserved. Complementary to STT-P8 (which tests whether degraded box-averaged audio triggers the
loop upstream). tsc clean; `PrivateWhisper.test.ts` 45/45 (all prior collapse cases preserved +
the conv_01 2×-long-span case + short-2× preservation).

Re-proof recipe (@test-agent):
```text
1. Serve dev/private-p1d-complete via canonical pnpm dev (5174), real auth.
2. Re-run the conv_01 injected Private proof.
3. PASS = saved transcript ≈ truth "Um. Basically, we should literally like, wait." with NO
   doubled phrase (no "literally like ... literally like"), and filler rows keep um=2.
   Confirm saveCandidate (service_result) length is roughly halved vs the prior 106-char loop.
```

**STT-P5 ready — `dev/private-vad-silero-main@411b4852` (base current main).** Rebased VAD engine
+ staged `frontend/public/models/silero_vad.onnx` (Silero v5, sha256 `1a153a22…`, I/O verified).
onnxruntime-web@1.14.0 resolves transitively (no duplicate ORT). Run the RMS-vs-VAD A/B from the
`## DEV → TEST: STT-P5` recipe above against THIS branch.

**STT-P6 ready — `dev/private-model-eval-main@1c50587c` (base current main).** The 3 model-eval
commits rebased cleanly onto current main (off-by-default flag preserved). Run the model A/B from
the `## DEV → TEST: STT-P6` recipe above against THIS branch.

---

## DEV → TEST: STT-P6 model A/B run spec (2026-06-04, owner: dev-agent → test-release-agent)

**Branch:** `dev/private-model-eval-main@7c04064a` (base current main). Candidate-load blocker is FIXED
(remote-only candidate loading + verified `onnx-community/` ids + fail-fast `MODEL_LOAD_FAILED`).
This is the **top-priority Private accuracy experiment**.

**Framing (product):** the prior evidence (resampler A/B = no accuracy lift; decode-param A/B = no
lift) makes `whisper-tiny.en` the **dominant suspected** accuracy limiter — but this is NOT proven
a "model ceiling" until this A/B + the drop-in/browser comparison confirm it. If a larger model
moves WER materially, model quality was the limiter; if it does NOT, the implementation path still
has a deeper issue (do not keep chasing model size — revisit segmentation, or caveat/hold Private).

**Models (same input route, same fixtures):** `?privateModel=` →
1. `whisper-tiny.en` (current, local) · 2. `whisper-base.en` (`onnx-community/whisper-base.en`, ~145 MB)
· 3. `distil-small.en` (`onnx-community/distil-small.en`, ~166 MB). Confirm
`window.__PRIVATE_MODEL_TELEMETRY__.model` matches each run.

**Required fixtures/scripts:**

| Fixture | Why |
|---|---|
| Latest human Private failure script | directly tests the real failure |
| h1_2 | phrase substitution guard |
| h1_6 | filler/onset/known hard row |
| h1_8 | "like" + phrase preservation |
| h1_10 | clean control |
| Washington 65.8s | medium endurance |
| One 90–120s human-like script (if feasible) | long-form viability |

**Required metrics per model×fixture:** WER/accuracy · filler recall · false filler insertion ·
readability/run-on · firstProgressMs · firstDraftMs · stopFinalizationMs · decodeMs/RTF · model
load time · actual downloaded size · memory/crash behaviour · save/history/detail · **no Cloud fallback**.

**Pass/fail — a larger model is worth considering only if it clears ALL three bars:**
1. **Accuracy:** materially improves the human-failure script (≈ **+15–20 pts accuracy**, or clear
   unusable→usable) AND no guard-row (h1_2/6/8/10) regression.
2. **UX:** first feedback still appears quickly; finalization tolerable or clearly communicated; no
   browser instability.
3. **Setup:** the larger download is acceptable and surfaced honestly (size shown, not hidden behind
   a vague "setup" button), e.g. "Download larger local model for more accurate Private transcription.
   Model size: ~150 MB. Audio stays local for STT."

**Product decision tree after the A/B:** materially-better + acceptable perf → make it the Private
candidate with explicit setup copy · better but heavy → offer as optional "Higher accuracy Private
model", keep tiny for quick setup · not materially better → stop chasing model size, revisit
VAD/segmentation or caveat/hold Private.

**Note:** VAD (STT-P5) is **deferred until after this A/B** per product (evidence points at model
quality first). The faster resampler (STT-P8, timing-only) and the conservative 3+×
repetition-collapse are independent safe wins.
