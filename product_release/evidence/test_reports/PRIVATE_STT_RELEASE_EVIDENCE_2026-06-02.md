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

## DEV → TEST: STT-P6 model-eval candidate ready (2026-06-04, owner: dev-agent)

Built + unit-verified on `dev/private-model-eval@25cde3b4` (base `d910a07d`). **Test the branch
pre-merge.** This is the **decode/model-quality lever** the CI 51.7% WER points at — the
companion to STT-P5 (onset VAD). Both flags are independent and can be A/B'd separately or
together.

**Enable (one model per session):** `?privateModel=distil-small.en` or `whisper-base.en`
(or `window.__PRIVATE_MODEL__ = '...'`). Default/absent/unknown → `whisper-tiny.en`
(production, byte-identical). No new dependency; the larger model downloads on demand.

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
5 ✓ timeouts unchanged · 6 ✓ trace · 7 → unit done; **injected-audio smoke is yours**.

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

## Open Blockers

| Priority | Blocker | Evidence | Owner |
| --- | --- | --- | --- |
| P0 | Accuracy/parity failure | Expected `the main idea is that every transcript...`; saved `the memory transcript...`. This is semantic STT error, not punctuation. | @dev-agent |
| P0 | Re-proof detail transcript empty (#29) | Prior human proof had `detailTranscript=""`, but current `main` includes cache-invalidation fix `72cabe45`. Verify `/analytics/:id` `data-session-detail-transcript` is non-empty and matches `saveCandidate`. | test-release-agent / Codex |
| P1 | Filler recall below product need | `um` missed; filler recall `66.67%`. | @dev-agent / product confidence |
| P1 | Live trust/progress suspect | Chunks decoded every ~1.4-2.1s, but logs repeatedly showed `Holding first transcript until it has speech-like substance`; useful text appeared at Stop. | @dev-agent |

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
