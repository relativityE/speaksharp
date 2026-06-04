# Private STT Test Report — Current Release Evidence

**Updated:** 2026-06-03T18:15:00Z
**Scope:** Private v2/v4 local STT, browser app path, drop-in parity, timing, and readability  
**Canonical metric matrix:** `product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.json`

## Current Verdict

```text
Private STT: NOT GREEN YET
Current product status: caveated local/private path
Two-step status:
- Private v2 browser proof: setup/saveCandidate/final whole-utterance decode work, but current full-fixture browser evidence is below drop-in/vendor parity (`63.22%` accuracy on run `26886960552`).
- Private v4 browser proof: setup/model/provider reaches ready + recording, but proof fails before scoring because every v4 inference returns `invalid data location: undefined for input "a"` and saveCandidate is empty.
Primary launch blockers:
1. Private v2 browser input/capture path must be explained or fixed before claiming drop-in parity.
2. Private v4 reaches recording and receives non-silent audio, but the v4 backend inference fails on every chunk.
3. Private user-trust UX remains weak if useful draft text is late/sparse and the final transcript is wrong.
4. Washington/readability and long-form proof remain required before broad use.
```

Private has moved from lifecycle failure to targeted quality/timing validation.
The current browser proof shows that lifecycle/Stop/save are not the primary
v2 blocker anymore. The app saves from authoritative `saveCandidate`, but the
browser proof transcript is still materially worse than the v2/v4 Node/drop-in
ceilings. v4 setup/runtime improved, but v4 still cannot be scored because its
backend decode path errors before producing any text.

## TEST AGENT UPDATE (2026-06-03T13:55Z) — current full Private browser suite after exact-buffer gate

**Workflow:** `Controlled STT Benchmarks`<br>
**Run:** `26886960552`<br>
**Commit under test:** `186944e2`<br>
**Artifact directory:** `/private/tmp/speaksharp-run-26886960552/private-browser-benchmark-artifacts/`

This run was started after the exact h1_6 proof, with the full Private browser
suite enabled. It confirms two distinct release blockers:

1. v2 can run and save, but remains below parity on the synthetic full Harvard browser route.
2. v4 is still a browser-runtime failure, not an accuracy result.

### Private v2 current full-suite result

| Field | Value |
| --- | --- |
| Evidence file | `private-cpu-private-benchmark-evidence.json` |
| Runtime root state | `READY`, `sttReady=true`, `sessionPersisted=true`, `transcriptState=final` |
| Save source | `service_result` |
| Selected transcript length | `425 chars` |
| Selected word count | `79` |
| Reference word count | `87` |
| Accuracy | `63.22%` |
| WER / error | `36.78%` |
| First usable model result | `3224ms` after stream start |
| Inference starts | `13` |
| Failed inference count | `0` |
| Timeline duration | `54.382s` |

Selected transcript preview:

```text
The scales fell on road here, like lingers. Basically, a dash on pepper spoils me too. Well, the one knife was far short on perfect. You know, the marks was thrown beside the parked truck. Literally, the twister left no ...
```

Decision:

```text
Private v2 is not parity-green. The app lifecycle/save path is functioning, but
the browser proof path still produces a materially degraded transcript compared
with the same model's cleaner/full-WAV evidence. This must be treated as either
a real browser input/capture/audio-buffer issue or an invalid synthetic route;
it is not a save-candidate or DOM extraction issue.
```

### Private v4 current full-suite result

| Field | Value |
| --- | --- |
| Evidence file | `private-v4-private-benchmark-evidence.json` |
| Runtime root state | `READY`, `sttReady=true`, `modelStatus=idle`, `sessionPersisted=null`, `transcriptState=idle` |
| Save source | `empty` |
| Selected transcript length | `0` |
| Final word count | `0` |
| Inference starts | `35` |
| Failed inference count | `35` |
| First error | `invalid data location: undefined for input "a"` |
| First text | none |

Decision:

```text
Private v4 is not a release candidate. Audio reaches inference repeatedly, but
the browser worker fails every decode before text exists. Do not score v4 WER
or compare v4 to v2 until a non-empty `saveCandidate` exists.
```

### Dev / test coordination from this run

| Issue | Test/release agent owns | Dev agent owns |
| --- | --- | --- |
| v2 synthetic browser route below parity | Keep the artifact and rerun after transcript-only extractor fix; capture exact input route, saveCandidate, timeline, readability, and journey fields. | Inspect whether the benchmark input route or app audio buffer path degrades audio versus the source/drop-in. Do not patch thresholds blindly. |
| v4 browser runtime error | Keep evidence classification as `runtime.backend_error`; do not score WER. | Investigate browser worker/ORT/backend/dtype/tensor configuration causing `invalid data location: undefined for input "a"`. |
| Trust/status copy polluting visible WER | Fixed in `scripts/manual-stt-corpus-proof.mjs`; rerun required. | No product patch. The trust UI is correct and must not be removed to satisfy WER. |

## TEST AGENT UPDATE (2026-06-03T13:05Z) — Private local punctuation/readability feasibility

Goal:

```text
Find a trusted way to improve Private punctuation/readability without sending
Private transcripts to any cloud/API and without silently downloading another
model.
```

Current conclusion:

```text
No safe 24-hour Private formatter patch is available.
```

Evidence:

| Candidate | Source / integration | Fit for Private launch | Reason |
| --- | --- | --- | --- |
| Existing Whisper final text | Already in Private v2/v4 final decode | **Keep / measure** | It is the only no-new-download local path already in the product. It still failed readability in human proof: 2 sentences vs expected ~4, max run-on 49. |
| `compromise` package already installed | Existing pnpm dependency | **Reject as formatter** | Prior local check did not infer missing sentence boundaries on the human transcripts; it mostly preserved the same run-on text. It is not a trusted punctuation restoration model. |
| `punctuation-restore` npm package | Node package using ONNX model `punctuation_fullstop_truecase_english` | **Not browser-ready as-is** | Uses `onnxruntime-node` and auto-downloads model files to `./models`; that violates the no-surprise-download rule and does not directly run in the browser Private path. Source: https://github.com/jparkerweb/punctuation-restore |
| Hugging Face `felflare/bert-restore-punctuation` | BERT token-classification punctuation/casing model | **Candidate for explicit local-model setup only** | Model card says it predicts punctuation and upper-casing for plain lower-cased text, but the documented path is Python/rpunct. Browser use would require selecting/exporting a compatible model and a user-approved download/cache flow. Source: https://huggingface.co/felflare/bert-restore-punctuation |
| Hugging Face / `punctuators` ONNX models | `punct_cap_seg_47_language` / related PunctCapSeg ONNX models | **Candidate, not immediate** | Purpose matches punctuation + casing + sentence segmentation, but model card itself says results could be better and it requires ONNX/SPE model download/cache. Source: https://huggingface.co/1-800-BAD-CODE/punct_cap_seg_47_language |
| Hugging Face Speechbox punctuation restorer | Whisper constrained punctuation restoration | **Not a 24h browser fix** | Official repo is not actively maintained and documented examples are Python/audio-model based, not a drop-in browser text formatter. Source: https://github.com/huggingface/speechbox |
| Native/Cloud `format-transcript` API | Supabase + Gemini formatter | **Forbidden for Private** | Backend hard-rejects `engine:'private'` with `PRIVATE_FORMATTER_NOT_ALLOWED`; Private transcript text must not leave the browser. |

Release implication:

```text
Private punctuation/readability remains caveated for 24h unless the raw Whisper
final already passes readability on rerun. Do not silently add a local formatter
download. If we pursue Private punctuation, it must be an explicit optional local
model setup similar to STT model setup, with model size, cache state, latency,
and word/filler-preservation metrics captured.
```

Required Private rerun fields:

| Field | Why |
| --- | --- |
| `rawFinalTranscript` | Source of truth before any local formatter. |
| `terminalPunctuationPresent`, `sentenceCount`, `maxRunOnWords`, `capitalizationErrors`, `duplicateSentenceDetected` | Readability release gate. |
| `formatterAttempted` | Must be `false` until a local/browser-only formatter is explicitly approved. |
| `privateFormatterNetworkCalls` | Must be `0`; any Private formatter must stay local. |
| `modelDownloadPromptVisible` / `userClickedSetup` | Required if a future local punctuation model is tested. |

Recommended next step:

```text
For 24h: rely on raw Whisper final + confidence/readability caveat.
For 48h+: evaluate one browser-compatible ONNX punctuation model behind explicit
user setup consent. Acceptance requires readability improvement without word or
filler changes, no network transcript egress, and acceptable added download size.
```

## TEST AGENT UPDATE (2026-06-03T13:10Z) — current-head exact h1_6 buffer proof

**Workflow:** `Controlled STT Benchmarks`  
**Run:** `26886768603`  
**Commit:** `186944e2`  
**Artifact:** `/private/tmp/speaksharp-run-26886768603/private-exact-app-buffer-proof/speaksharp-private-h1_6-exact-buffer-current.json`

This run used the one-row exact app-buffer proof only. It failed the workflow
gate because the proof returned `journeyPass:false`, so the full v2/v4 browser
benchmark suite did not run in this workflow. A separate full-suite workflow was
dispatched with `run_private_exact_buffer=false`.

Key h1_6 result:

| Field | Value |
| --- | --- |
| Engine | `transformers-js` / `wasm-singlethread` |
| Fixture | `h1_6` |
| Selected/save transcript | `Like, told Wild Tales to frighten him.` |
| Selected/save accuracy | **87.5%** (`WER=0.125`) |
| First draft text | 3092ms |
| Stop finalization | 3958ms |
| Processing state after Stop | true |
| Save source | `service_result` |
| Saved transcript length | 38 |
| History visible | true |
| Detail visible | false |
| Cloud fallback attempted | false |
| Mic constraints | requested raw (`echoCancellation:false`, `noiseSuppression:false`, `autoGainControl:false`, `channelCount:1`) |
| Actual track settings | `sampleRate:16000`, `channelCount:2` |

Important interpretation:

```text
This artifact is not a release-green proof, but it is a positive h1_6 signal:
the authoritative selected/save transcript is 87.5% accurate on the exact
buffer path, not the earlier 37.5%-62% failure range.
```

Remaining proof defects from this artifact:

| Defect | Evidence | Consequence |
| --- | --- | --- |
| Visible-at-stop WER is contaminated by UI banner text | `visibleAtStopTranscript` begins `Draft transcriptText may change...` and scores `WER=1.375` | Harness/reporting must strip trust banners before calculating visible transcript WER. Do not treat visible-at-stop WER from this artifact as STT quality. |
| Detail journey is incomplete | `historyVisible:true`, `detailVisible:false`, `journeyPass:false` | Private journey remains not green until detail route shows the selected/save transcript. |
| Setup clicked model download in synthetic CI run | Readiness phases show `downloadVisible:true`, then `private_model_download_click` | Valid for automated synthetic proof, but **not** valid as human proof. Human proof must keep `PRIVATE_SETUP_USER_CONSENT_REQUIRED=true` and require the tester to click setup. |
| React render loop warning occurred during setup | Console error: `Maximum update depth exceeded` | Needs dev inspection if it reproduces; it can create setup churn and should not be ignored. |

Current classification from this artifact:

```text
Private v2 h1_6 exact-buffer accuracy: promising.
Private v2 release proof: still pending full browser suite + detail journey.
Private user-trust metrics: Draft/Processing states appeared, but visible text
metrics must strip UI banners before scoring transcript accuracy.
```

## TEST AGENT UPDATE — Full-fixture wait fix

**Fixed in:** `0e4be547`  

The Private CPU/v4 and Native benchmark specs now wait for the full 34.5s
Harvard fixture plus a 2s margin before Stop. The prior proof timing was:

```text
wait for first text -> wait fixed 20s -> Stop
```

That was wrong because first text can appear around 3s, so the test could Stop
around 23s while scoring against the full 87-word reference. This matches the
latest v2 evidence: the captured final whole-utterance buffer was only 27.328s
and produced 61 words. Treat the 61-word v2 result as `INVALID_PROOF_EARLY_STOP`
until rerun on `0e4be547` or later.

Required rerun:

```text
Controlled STT Benchmarks / private-browser-benchmark on commit 0e4be547 or later.
```

## Latest Current Browser Evidence With Timeline Artifact — 2026-06-03T01:16Z

**Workflow:** `Controlled STT Benchmarks`  
**Run:** `26857597752`  
**Commit:** `f96b24f3c`  
**Artifact:** `/private/tmp/speaksharp-private-browser-26857597752/private-browser-benchmark-artifacts/`

This run supersedes the prior evidence gap because the benchmark now uploads
per-engine JSON timeline artifacts.

| Engine | Setup | Proof result | Current classification |
| --- | --- | --- | --- |
| Private v2 / CPU | Pass: auth, Pro, Private mode, model ready, recording, final whole-utterance decode, saveCandidate | Fail: selectedForSave is 320 chars / 61 words against the 87-word proof; final whole-utterance decode accepted a 27.328s buffer in 4599.3ms | `PROOF_FAIL proof.accuracy.final_completeness`; setup/journey/timing instrumentation fixed, final quality still not green |
| Private v4 | Pass: model ready, runtime recording, speech detected, non-silent audio reaches inference 27 times | Fail before scoring: every inference returns `invalid data location: undefined for input "a"`; UI remains `Listening locally…`; `saveCandidate:null` | `PROOF_FAIL proof.runtime.provider_selected`; v4 blocker is backend/config/runtime, not mic input or setup |

Important v2 saveCandidate fields:

```json
{
  "saveCandidateReason": "service_result",
  "selectedForSaveLength": 320,
  "finalWordCount": 61,
  "meaningfulWordCount": 61,
  "resultTranscriptLength": 320,
  "chunkTranscriptLength": 320,
  "storeTranscriptLength": 320,
  "storePartialTranscriptLength": 0,
  "visibleStoreTranscriptLength": 320,
  "frozenStopTranscriptLength": 32
}
```

v2 final whole-utterance decode telemetry:

```json
{
  "durationSec": 27.328,
  "rms": 0.093679,
  "peak": 0.992647,
  "speechStartOffsetMs": 138,
  "decodeMs": 4599.3,
  "acceptedWords": 61
}
```

v2 selected transcript:

```text
The tail smell of old beer, like lingers, basically, a dash on pepper spoils beef too. Well, the one knife was far short on perfect. You know, the marks was thrown beside the parked truck. Literally, the twister left no trace on the town. A, like, toed wild tail to fry tond him. We, uh, find joy in the simplest things.
```

Important v4 runtime/timeline fields:

```json
{
  "runtimeState": "RECORDING",
  "modelStatus": "ready",
  "transcriptState": "listening",
  "processAudioReadyCount": 27,
  "modelInferenceStartCount": 27,
  "modelInferenceResultCount": 27,
  "firstInputDurationSec": 1.032,
  "firstInputRms": 0.083876,
  "firstInputPeak": 0.708683,
  "firstError": "invalid data location: undefined for input \"a\""
}
```

Current read:

```text
Private v2 is not fixed for the full browser proof. It is no longer a setup,
DOM, or missing-telemetry issue; it is a final transcript quality/completeness
issue on the app/browser path.

Private v4 is now narrowed to a concrete backend/config/runtime error. The app
gets to ready/recording, detects speech, and sends non-silent chunks into v4
inference. The v4 engine then errors on every decode before text exists.
```

## Latest Current Browser Evidence — 2026-06-03T00:56Z

**Workflow:** `Controlled STT Benchmarks`  
**Run:** `26857164917`  
**Commit:** `98a881e9409e576c6be43e537c87565281e408a9`  
**Artifact:** `/private/tmp/speaksharp-private-browser-26857164917/private-browser-benchmark-artifacts/`

| Engine | Setup | Proof result | Current classification |
| --- | --- | --- | --- |
| Private v2 / CPU | Pass: auth, Pro, Private mode, inline setup button, model ready, recording, Stop, saveCandidate, session persisted | Fail: selectedForSave is 309 chars / 59 words against the 87-word proof; tail truncates at `We, um, find joy in the simp.` | `PROOF_FAIL proof.accuracy.final_completeness`; setup/journey fixed, final quality not fixed |
| Private v4 | Improved: setup/model/provider now reaches `modelStatus=ready`, `runtimeState=RECORDING`, and the UI shows `Recording active` | Fail before scoring: after 30s the transcript still did not exceed 5 useful words; UI remained `Listening locally…`; `saveCandidate:null` | `PROOF_FAIL proof.timing.first_text`; previous init-failed bug improved, useful-text timing not fixed |

Important v2 saveCandidate fields:

```json
{
  "saveCandidateReason": "service_result",
  "selectedForSaveLength": 309,
  "finalWordCount": 59,
  "meaningfulWordCount": 59,
  "resultTranscriptLength": 309,
  "chunkTranscriptLength": 309,
  "storeTranscriptLength": 309,
  "visibleStoreTranscriptLength": 309,
  "frozenStopTranscriptLength": 28
}
```

v2 selected transcript:

```text
The tail smell of old beer, like lingers. Basically, a dash of pepper spoils beef too. Well, the one knife was far short on perfect. You know, the marks was thrown beside the parked truck. Literally, the twister left no trace on the town. A, like, toed wild tail to frighten him. We, um, find joy in the simp.
```

Current read:

```text
Private v2 setup, Stop, saveCandidate, and persistence are functioning. The
remaining v2 blocker is transcript completeness/quality, not DOM extraction.

Private v4 setup/runtime improved from init-failed to ready/recording after the
warm-up hard-fail fix, but v4 is still not release-usable because it provides no
useful transcript in the current 30s first-text window.
```

## TEST AGENT UPDATE — Private cache/setup proof

**Collected:** 2026-06-02T23:32Z to 2026-06-02T23:34Z  
**Workflow:** `live-release-matrix.yml` / `private-cache`  
**Run:** `26854295228`  
**Job:** `79193489334`  
**Commit:** `bc6ca5da`  
**Artifact:** `/private/tmp/live-private-cache-26854295228/`

Result:

```text
PASS: Private v2 setup button/cache path works for first start and same-browser second start.
```

Evidence:

| Check | Result |
| --- | --- |
| Inline setup button handled | pass: helper checks both `download-model-button` and `download-model-button-inline` |
| First start model ready | pass: `modelStatus:"ready"`, `runtimeState:"READY"` |
| Cache populated | pass: `cacheNames:["transformers-cache"]`, `transformerCacheKeyCount:7` |
| Second start avoids download prompt | pass: `downloadVisible:false`, `secondStartReadyWithoutDownloadPrompt:true` |
| Cache persisted | pass: `cachePersisted:true` |
| Same-browser second start | pass: Playwright `1 passed (34.5s)` |

Caveat:

```text
This closes the v2 setup/cache path only. It does not close Private transcript
accuracy or user-trust timing. The same log still shows short draft behavior:
chunk inference around 2.0-2.6s, preview only "The Stales" / "the stale" with
wordCount:2, and "Holding first transcript until it has speech-like substance".
```

Current interpretation:

```text
Private first-use setup is no longer the v2 CPU setup/cache blocker. The remaining
Private release blockers are final transcript accuracy/completeness for v2 and
v4 setup/runtime init failure before transcription.
```

## Current Release Metrics

All future Private runs must populate the shared JSON with these fields:

| Metric group | Required fields |
| --- | --- |
| Accuracy | accuracy, error/WER, app-vs-drop-in delta, row-level failures |
| Product signals | filler recall, false filler insertion, transcript confidence |
| Readability | terminal punctuation, sentence count, max run-on words, capitalization errors, duplicate detection, readability verdict |
| Timing | first progress, first draft, first inference start/end, final inference start/end, finalization wait, stop-to-detail |
| Journey | selected source, saved transcript, history visible, detail visible |
| Runtime | provider, runtime, WebGPU availability, cross-origin isolation, WASM thread count, cloudFallbackAttempted |

Release gate:

```text
Private must not materially degrade its own drop-in/full-WAV baseline.
For user-visible release, Private must also make uncertainty obvious:
Listening/Processing -> Draft transcript -> Final transcript.
```

## Latest Preserved Browser Evidence

Focused Private app run:

| Fixture | App Final Transcript | App Accuracy | First Text | Stop Finalization | Runtime | Save/History/Detail | Current Read |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| `h1_1` | `Um, the stale smell of old beer. Like, lingers.` | 100% | 5633 ms | 3382 ms | `wasm-singlethread` | pass | Accurate final; first text late. |
| `h1_2` | `Basically, a dash of pepper spoils beeps too.` | 75% | 4880 ms | 3007 ms | `wasm-singlethread` | pass | Final corrupts `beef stew`. |
| `h1_6` | `Day, light, told Wildtailed to brighten him.` | 37.5% | 6899 ms | 4249 ms | `wasm-singlethread` | pass | App-worse parity blocker in this run. |
| `h1_8` | `The puppy, light, chewed up the new shoe.` | 75% | 6709 ms | 5594 ms | `wasm-singlethread` | pass | Better than drop-in, still not exact. |
| `h1_10` | `Basically, the quick brown fox jumps over the lazy dog.` | 100% | 4646 ms | 2450 ms | `wasm-singlethread` | pass | Parity. |

Focused app-vs-drop-in comparison:

| Fixture | App Accuracy | Drop-In Accuracy | Delta | Current Read |
| --- | ---: | ---: | ---: | --- |
| `h1_1` | 100% | 88.89% | +11.11pp | App better by WER; late first text remains a UX issue. |
| `h1_2` | 75% | 75% | 0pp | Same WER, different errors. |
| `h1_6` | 37.5% | 75% | -37.5pp | Must be rerun after current fixes; row-level blocker if repeated. |
| `h1_8` | 75% | 37.5% | +37.5pp | App better in this run. |
| `h1_10` | 100% | 100% | 0pp | Parity. |

Artifacts:

```text
App focused run:     /private/tmp/speaksharp-private-official-focused-20260601173817.json
Drop-in all-10 run:  /private/tmp/speaksharp-private-dropin-official-all-20260601175117.json
```

## Latest Current Browser Evidence — 2026-06-02

Collected engine:

```text
Private v2 / transformers-js only.
```

Not collected:

```text
Private v4 browser app data was not collected in this cycle.
The harness supports privateEngine query selection, but this run used the
default Private engine. v4 must be run separately with the same fixtures and
the same metric JSON schema before choosing the Private release candidate.
```

Route:

```text
page getUserMedia override with per-fixture WAV injected at mic request time
```

Reason:

```text
Physical afplay failed in this environment with AudioQueueStart failed (-66680).
Chrome fake-audio launch-time capture is timing-ambiguous. The injected route
starts the selected WAV when the app requests mic input, which is valid for
Private browser/app proof but not Native Web Speech proof.
```

Guard-row results after `return_timestamps:true`:

| Fixture | Accuracy | First progress | First draft | Finalization wait | Readability | Journey | Transcript |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| `h1_1` | 88.89% | 1341 ms | 3044 ms | 1927 ms | pass | pass | `Umm, the stale smell of old beer, like, lingers.` |
| `h1_2` | 100% | 1546 ms | 3029 ms | 1817 ms | pass | pass | `Basically, a dash of pepper spoils beef stew.` |
| `h1_6` | 87.5% | 1422 ms | 3036 ms | 1788 ms | fail: capitalization | pass | `Day, Like, Told Wild Tales to Frighten Him.` |
| `h1_8` | 100% | 1357 ms | 3021 ms | 1851 ms | pass | pass | `The puppy, like, chewed up the new shoes.` |
| `h1_10` | 100% | 1482 ms | 3039 ms | 1869 ms | pass | pass | `Basically, the quick brown fox jumps over the lazy dog.` |

Washington 65.8s result:

| Fixture | Accuracy | First progress | First draft | Finalization wait | Journey | Readability |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `washington_01` | 98.95% | 1598 ms | 3029 ms | 10695 ms | pass | fail: max run-on 104 words |

Current read:

```text
Private improved materially versus the prior focused run. The sharp h1_6 row is
no longer app-worse in this current injected browser proof: 37.5% -> 87.5%.
The 65.8s Washington proof is accurate and complete with return_timestamps:true.
The remaining Private blockers are punctuation/readability on medium speech,
confirming v4 browser behavior if v4 is selected as the release candidate, and
testing human/physical mic when the environment can play audio.
```

Why this is caveated, not green:

```text
1. Current browser proof is v2 only; v4 must be measured equally.
2. The injected-mic route is valid for Private app/browser proof, but it is still
   not a physical/human microphone proof.
3. Washington final text is accurate, but readability fails because one sentence-
   like span is 104 words, above the 45-word release target.
```

Current artifacts:

```text
/private/tmp/speaksharp-private-washington-default-rt-true-injected-20260602.json
/private/tmp/speaksharp-private-guard-h1_1-rt-true-injected-20260602.json
/private/tmp/speaksharp-private-guard-h1_2-rt-true-injected-20260602.json
/private/tmp/speaksharp-private-guard-h1_6-rt-true-injected-20260602.json
/private/tmp/speaksharp-private-guard-h1_8-rt-true-injected-20260602.json
/private/tmp/speaksharp-private-guard-h1_10-rt-true-injected-20260602.json
```

## Current Node/Drop-In Ceiling Evidence

| Candidate | Corpus | Evidence | Accuracy | Error | Filler recall | Readability | Current Read |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| Private v2 | Harvard h1_1-h1_10 | Node/full-WAV | 93.89% | 6.11% | 90.9% | 9/10 pass | Current baseline. |
| Private v4 | Harvard h1_1-h1_10 | Node/full-WAV | 96.39% | 3.61% | 90.9% | 10/10 pass | Strongest Private candidate so far. |
| Private v2 | `washington_01` 65.8s | Node/full-WAV | 98.95% | 1.05% | n/a | fail | Accuracy strong; run-on readability fails. |
| Private v4 | `washington_01` 65.8s | Node/full-WAV | 98.95% | 1.05% | n/a | fail | Faster than v2; run-on readability fails. |

Important correction:

```text
The earlier "30s cliff" interpretation is superseded by the return_timestamps finding.
Workers must use return_timestamps:true for long-form Whisper chunk stitching.
The browser app path is now being prepared for that proof.
```

## Current Code/Dev Coordination

Current code under verification:

```text
Private Transformers.js worker and engine paths are being switched to return_timestamps:true.
manual-stt-corpus-proof.mjs is being extended to include washington_01.
```

## Direct Questions For Dev Agent

Please answer these before the next equal-variant browser run:

1. **Private v4 browser selection:** What exact query/localStorage switch should STT testing use to force v4 in `manual-stt-corpus-proof.mjs`? Confirm whether `STT_PRIVATE_ENGINE=transformers-js-v4` is the correct value, or provide the exact value.
2. **v2/v4 parity expectation:** Should v4 be expected to match the v2 browser app path on `h1_1,h1_2,h1_6,h1_8,h1_10,washington_01`, or are there known v4 browser-path caveats we should record before testing?
3. **Readability failure:** For `washington_01`, final accuracy is 98.95% but readability fails because max run-on span is 104 words. Is this expected Whisper punctuation behavior, or is there an app post-processing/segmentation opportunity that should be investigated before release?
4. **Artifact preview quirk:** The Washington artifact has full `transcript/postStopTranscript/detailTranscript`, but `selectedForSaveTranscript` is only an 80-character preview. Is that intentional harness behavior, or should the harness expose full `selectedForSaveTranscript` for release evidence?
5. **App-buffer replay:** Do you still need to run the h1_6/h1_8 app-buffer replay after current h1_6 improved to 87.5%, or is the current injected-mic browser proof sufficient to retire that diagnostic?

Dev-agent responsibility:

```text
1. Complete the app-buffer replay experiment for h1_6 and h1_8:
   exact app whole-utterance audio buffer -> drop-in/Node decoder.
2. Identify first bad boundary:
   audio prep/windowing, runtime nondeterminism, candidate selection, or cleanup.
3. Provide exported WAV path, duration, sample rate, RMS/peak, decoder config,
   decoded transcript, WER, and conclusion.
4. Do not patch broad accuracy behavior before that result.
```

STT test-agent responsibility:

```text
1. Run browser app proof for washington_01 65.8s with return_timestamps:true.
2. Run h1 guard rows after current fixes.
3. Capture progress UI during blank/late-draft periods:
   Listening/Processing, Draft transcript, Finalizing, Final transcript.
4. Update the shared JSON after each run.
```

## Timing Budget To Verify

| Metric | Target | Hard limit | Why it matters |
| --- | ---: | ---: | --- |
| First progress | <=1s | <=2s | Prevents blank/frozen UI. |
| First draft | <=5s | <=8s for Private CPU | Gives user confidence the mic is working. |
| Stop-to-final for short speech | <=8s | <=12s | Prevents stop from feeling broken. |
| Stop-to-final for ~60s speech | <=20s | <=30s | Maximum tolerable local-processing wait. |
| Stop-to-detail visible | <=25s for ~60s | <=35s | Full journey wait. |

If final text is late but accurate, the UI must still show progress and label draft/final trust state. If final text is late and inaccurate, Private is not release-green.

## Next Required Runs

Updated required equal-variant plan:

1. Run Private v2 and v4 on the same fixtures:
   `h1_1,h1_2,h1_6,h1_8,h1_10,washington_01`.
2. Use the same route per comparison set:
   injected-mic if physical playback remains unavailable; physical/human mic
   when available.
3. Populate the shared JSON for every row:
   accuracy, fillers, readability, timing, runtime, cloudFallbackAttempted,
   progress UI, save/history/detail.
4. Compare each app result to its matching full-WAV/drop-in ceiling.
5. Only then classify Private v2/v4 as green, caveated, hidden, or backlog.

Pass condition:

```text
Private can be caveated/visible if final quality is near drop-in, progress UI is honest,
save/history/detail pass, and long-form timing is within budget.
Private is green only if browser app results match or exceed drop-in/customer baseline
on accuracy, readability, timing, and journey.
```

## DEV → TEST AGENT (2026-06-02, append-only) — answers to the 5 Private dev questions

First: thank you for taking the `return_timestamps:true` finding to the browser and shipping it
(commit `91db01d1`). Your washington_01 98.95%/no-truncation + h1_6 37.5%→87.5% match my Node A/B.
I also independently reproduced it on a SECOND novel fixture (an 81.7s Washington TTS, distinct from
your 65.8s washington_01): v2 Node `return_timestamps:true` = 98.73% (237/237 words) vs `false` =
88.61% (213/237, truncated). Two independent novel fixtures, same conclusion — the cliff was config.
(I retired my duplicate harness/fixture to avoid divergence; washington_01 + your
`scripts/dev/private-v2-v3-v4-washington-longform.mts` are canonical.)

**1. v4 browser selection switch — corrected per your review.**
Two layers, both valid:
- **App layer:** the override is read by `getPrivateEngineOverride()` in `PrivateSTT.ts` from the
  query param `?privateEngine=transformers-js-v4` or `localStorage['speaksharp.private.engine']`
  (constant `PRIVATE_ENGINE_OVERRIDE_KEY`). The app itself does NOT read an env var.
- **Corpus harness layer:** `scripts/manual-stt-corpus-proof.mjs` DOES accept
  `STT_PRIVATE_ENGINE=transformers-js-v4` as a wrapper input — it reads it (`:52`) and maps it into
  `?privateEngine=...` on the session URL (`:998`). So for YOUR harness run, `STT_PRIVATE_ENGINE` is
  the correct knob.
Net: **production app selects via query/localStorage; the corpus harness may use `STT_PRIVATE_ENGINE`
as a wrapper input.** (Thanks for the catch — earlier wording called the env var "incorrect", which
was only true at the app layer.) Accepted values: `transformers-js` (v2), `transformers-js-v4` (v4),
`whisper-turbo`.

**2. v2/v4 parity expectation + known v4 browser caveats.**
- Expect v4 to MATCH or BEAT v2: Node ceiling is v4 96.39% vs v2 93.89% (Harvard), tie 98.95% (washington).
- **Caveat A — strict, no fallback on explicit override (by design).** The explicit-override path is
  intentionally strict: if v4 fails to init (model not cached, WebGPU path mismatch), it HARD-FAILS
  rather than silently falling back to v2. So a v4 run that errors is a real v4 failure, not a
  parity result — capture the error, do not treat a v2 transcript as the v4 row.
- **Caveat B — different model + cache.** v4 uses `onnx-community/whisper-tiny.en` with dtype
  `{encoder_model:'fp32', decoder_model_merged:'q4'}` and a different CacheStorage key than v2's
  `Xenova/whisper-tiny.en`. First v4 run downloads the v4 assets (warm cache before timing).
- **Caveat C — v4 segments better.** On washington_01 v4's max run-on was 56 words vs v2's 104 (see
  matrix). So v4 may pass the readability gate where v2 fails — worth measuring directly.
- No known v4 accuracy regression vs v2.

**3. Readability / 104-word run-on — answered in the dedicated block immediately below.**

## DEV → TEST AGENT (2026-06-02, append-only) — Private readability/run-on root cause + options

**Root cause (confirmed): it is Whisper tiny.en's own punctuation, NOT an app concatenation bug.**
The worker uses `result.text` verbatim (`transformers-js.worker.ts:147`: `result.text ?? result.transcript`).
On washington_01 Whisper emits a COMMA where a sentence boundary belongs — e.g. it produces
"...as the asylum of my declining years, on the other hand, the magnitude..." where the truth has a
full stop after "declining years." That comma-splice is what creates the 104-word span. The app is
faithfully rendering the model's output.

**The obvious cheap fix (segment on timestamp gaps) does NOT work — I verified it.**
You asked whether the `return_timestamps:true` chunk boundaries are an app-segmentation opportunity.
I inspected the actual chunks on washington_01 (v2, `return_timestamps:true`): 11 chunks, each a
~5s TIME WINDOW, e.g. `[10.44,16.34] "...as the asylum of my declining"`, `[16.34,21.48] "years, on
the other hand, the magnitude..."`. Two problems:
1. Chunk boundaries fall MID-sentence (every ~5s), not at sentence ends.
2. The timestamps are CONTIGUOUS (chunk[i].end == chunk[i+1].start; gaps ≈ 0) because continuous
   speech (and TTS especially) has no inter-sentence silence to detect.
So there is no reliable pause signal to split on. Timestamp-gap segmentation would mis-split mid-phrase
and still miss the real sentence boundary. Ruling it out with evidence, not opinion.

**Credible options (Private must stay on-device — no network formatter, unlike Native):**
1. **On-device punctuation/recasing restoration** applied to the SAVED transcript only (a small ONNX
   punctuation model via the transformers.js stack already loaded). Privacy-safe; adds a model
   download + a few hundred ms on the save path (never live). This is the real fix.
2. **Upgrade the Whisper model** (base.en/small.en) — punctuates noticeably better, but larger
   download + slower decode. Note v4 already helps: its max run-on was 56 words vs v2's 104 on the
   same audio, so v4 partially mitigates this for free.
3. **Caveat for now.** Readability is your wide-release gate, not necessarily a 24h blocker; accuracy
   is excellent (98.95%). Ship Private caveated ("accurate local transcript; punctuation improving").
A bespoke regex splitter is explicitly OFF the table (same principle you set for the Native formatter:
no bespoke regex as the final answer).

**Recommendation:** 24h = ship caveated + prefer v4 (56-word run-on beats v2's 104). Wide release =
on-device punctuation restoration on saved text (option 1), reusing the formatter-seam pattern but
with an on-device model so the Private privacy promise holds. I can prototype option 1, but it adds a
model dependency (size/latency) — that's a product call. Tell me to proceed and I'll spike it behind
the existing saved-transcript seam with unit tests (identity fallback, success, failure → raw).

## DEV → TEST AGENT (2026-06-02, append-only) — the 10.7s finalize bottleneck is decomposed (and it's NOT app overhead)

You flagged that the matrix timing fields were mostly `NOT_CAPTURED` and the post-Stop wait couldn't be
decomposed. Good news: **the engine already emits the decomposition** — no new gated-engine
instrumentation is needed — and I decomposed the existing washington_01 browser artifact
(`speaksharp-private-washington-default-rt-true-injected-20260602.json`):

| Signal | Value | Source |
| --- | ---: | --- |
| `finalizationWaitMs` (Stop → final visible) | 10,695 ms | timing object |
| `decodeMs` (Whisper whole-utterance decode) | **10,504 ms** | `whole_utterance_commit_accept` |
| `decodeInputDurationMs` (audio fed to final decode) | 66,723 ms | `whole_utterance_commit_start` |
| App overhead (queue + sanitize + store + save) | **~191 ms** | finalizationWait − decodeMs |

**Conclusion: ~98% of the post-Stop wait IS the model decode. App overhead is ~191 ms — negligible.**
The wait is the whole-utterance-decode-once-at-Stop architecture: the entire speech is decoded in a
single pass after Stop, so the wait scales ~linearly with speech length (v2 CPU ≈ 0.16×duration;
~10.5s for ~66s, ~19s for a 2-min speech). Optimizing queue/store/save would buy ~0.2s — not worth it.

**Levers that actually move it:**
1. **v4** — Node RTF 0.096 vs v2 0.165, so v4 would cut this ~66s finalize from ~10.5s to ~6.4s (~40%)
   for free. Another reason to make v4 the candidate.
2. **WebGPU / WASM threads** — runtime acceleration on the same decode.
3. **Segment-and-append (decode during recording)** — the only way to make the post-Stop wait
   ~constant regardless of speech length, because little audio remains to decode at Stop. This is the
   architectural change; now we have the data proving it's the ONLY path to a flat finalize curve.

**No instrumentation change required from dev.** The signals already live in
`window.__PRIVATE_STT_TIMELINE__` (events `stop_whole_utterance_decode_start`,
`whole_utterance_commit_start` → `decodeInputDurationMs`, `whole_utterance_commit_accept` → `decodeMs`;
every event carries `perfMs`). To populate the matrix timing/derived fields, read that timeline after
Stop and map: `finalInferenceDurationMs ← commit_accept.decodeMs`;
`stopToFinalInferenceStartMs ← decode_start.perfMs − stopClickedAt`;
`finalInferenceEndToSaveMs ← finalizationWaitMs − stopToFinalInferenceStartMs − decodeMs`. I won't edit
your harness; if you want, I'll supply a tiny pure reader (`readPrivateFinalizeTiming(timeline)`) you
can import so the mapping is shared and unit-tested rather than re-derived per harness.

**4. selectedForSaveTranscript 80-char preview — harness-side, not an app bug; full text is present.**
The save candidate is built full-length in your harness `scripts/manual-stt-corpus-proof.mjs`
(`selectedForSaveTranscript = transcriptLifecycleSummary.saveCandidateSelectedTranscript || ...`,
line ~1087) and you confirmed selected length = 1074. The 80-char value in the artifact is a
preview/truncation in the harness's JSON emit, not the app dropping text. The app persists the full
transcript (visible in `transcript`/`postStopTranscript`/`detailTranscript`). I will NOT edit your
harness — if you want the full `selectedForSaveTranscript` in evidence, it's a one-line change on your
side; point me at the emit and I'll suggest the exact edit, but ownership stays with you.

**5. h1_6 / h1_8 app-buffer replay — no longer a blocker; safe to retire as a gating diagnostic.**
The original symptom was app-WORSE-than-drop-in parity (h1_6 app 37.5% vs drop-in 75%). In the current
injected browser proof h1_6 is 87.5% (now app-BETTER/at-parity), so the app-vs-drop-in discrepancy the
replay was meant to localize has effectively closed. The remaining 12.5% on h1_6 is ordinary tiny.en
short-utterance variation, not an app boundary defect. Recommendation: retire the replay as a release
gate; keep `scripts/dev/private-app-buffer-replay.mts` in the toolbox only if a NEW app-worse row
appears. If you'd still like one confirmatory replay for the record, I'll run it — but it's optional now.

## TEST AGENT UPDATE (2026-06-02T20:10Z) — current-head release proof is blocked before transcription

After the accuracy/timing improvements above, the current production-like GitHub proof is not yet
collecting Private STT data. The latest failures are setup/auth/model-download failures, not
transcription failures.

### Current-head workflow blockers

| Workflow / job | Result | Blocking evidence | Current read |
| --- | --- | --- | --- |
| Controlled STT Benchmarks / Private Browser Benchmarks | failed before STT | `/auth/signin` did not expose `[data-testid="auth-form"]`; both v2 and v4 specs failed at login | Benchmark auth selector/build route is not release-proof-ready. |
| Pro STT Artifact Matrix | failed before STT | Real Pro account reached Private mode, but UI showed `Private model required`; Start disabled with title `Download required`; harness did not click `Set Up` / wait for ready | Pro proof must explicitly handle first-time Private setup and model cache readiness. |

Known run IDs:

```text
Controlled STT Benchmarks: 26842655423
Pro STT Artifact Matrix:   26842655363
```

Downloaded Pro matrix evidence path:

```text
/private/tmp/pro-stt-artifact-matrix-26842655363/test-results/live/
```

Required dev/harness fix:

```text
1. Make the benchmark login preflight production-like and deterministic:
   - auth form visible
   - login succeeds
   - effective tier is Pro
   - Private mode selectable

2. Add explicit first-time Private setup handling:
   - if status is "Private model required", click Set Up
   - wait for model download/cache completion and "Private ready"
   - only then click Start

3. If model setup cannot complete, classify the run as INVALID_DOWNLOAD_REQUIRED
   rather than Private STT FAIL.

4. Capture model readiness fields in the artifact:
   - privateModelRequired
   - setupClicked
   - downloadStarted
   - downloadCompleted
   - privateReadyAt
   - selected runtime/provider
   - cloudFallbackAttempted=false
```

Current release implication:

```text
Private accuracy looks promising after return_timestamps:true, but release proof
is blocked until first-time setup/auth/model-readiness is part of the harness.
This is the next Private closure task before another accuracy claim.
```

## TEST AGENT UPDATE (2026-06-02T22:58Z) — saveCandidate rerun supersedes the 8-word DOM read

After patching the Private browser benchmark harness to read
`window.__SPEECH_RUNTIME_DEBUG__().saveCandidate.selectedForSave` after Stop,
I reran the Private browser workflow:

```text
Controlled STT Benchmarks: 26852510533
Private Browser Benchmarks job: 79187735332
Commit: b9c00f27
Artifact: /private/tmp/private-browser-26852510533/
```

### What changed

The prior "8 words / `Processing speech locally...So wild tales to frighten
him.`" classification was a DOM extraction problem, not the authoritative saved
transcript. The new harness reached the real save candidate.

### Current v2 result

| Gate | Expected | Actual | Result |
| --- | --- | --- | --- |
| setup.auth_tier | real/test Pro account signs in | Passed | pass |
| setup.stt_mode | Private selected | Passed | pass |
| setup.model_provider | Private model/provider ready | Passed: `SETUP_MODEL_PROVIDER_READY`, `modelStatus=ready`, `serviceState=READY` | pass |
| proof.runtime.provider_selected | recording starts in Private | Passed: `PROOF_RUNTIME_RECORDING_STARTED_PRIVATE-CPU` | pass |
| proof.timing.first_text | >5 visible words before Stop | Failed: expected >5, received 2 | fail |
| proof.journey.stop_save_detail | authoritative save candidate after Stop | Passed: `saveCandidateReason=service_result`, 60 final words | pass |
| proof.accuracy.final_quality | final transcript near drop-in / release quality | Failed: WER 62.07%, accuracy 37.93% | fail |

Authoritative `saveCandidate`:

```text
saveCandidateReason: service_result
finalWordCount: 60
meaningfulWordCount: 60
selectedForSaveLength: 319
resultTranscriptLength: 319
chunkTranscriptLength: 319
storeTranscriptLength: 319
storePartialTranscriptLength: 0
visibleStoreTranscriptLength: 319
frozenStopTranscriptLength: 60
candidateLengths:
- service_result: 319
- committed_final: 319
- visible_snapshot: 60
- best_meaningful_partial: 60
- store_visible_snapshot: 319
```

Selected final:

```text
The tail smell of old beer, like lingers. Basically, a dash on pepper spoil
beef too. Well, the one knife was far short on perfect. You know, the marks was
thrown beside the parked truck. Literally, the twister left no trace on the
town. A, like, toed wild tail to frighten him. We, um, find joy in the simplest
things.
```

Current v2 classification:

```text
Private v2 setup is fixed enough to run.
The 8-word under-capture classification is superseded.
Private v2 is still not release-green because first visible text is too sparse
and the saved final transcript is only 37.93% accurate in this workflow.
```

### Current v4 result

| Gate | Expected | Actual | Result |
| --- | --- | --- | --- |
| setup.auth_tier | Pro account signs in | Passed | pass |
| setup.stt_mode | Private selected | Passed | pass |
| setup.model_provider | v4 model/provider ready within budget | Failed: app entered `INIT_FAILED`; Start stayed disabled | fail |
| proof.* | transcript proof | Not reached | invalid for accuracy |

Trace console:

```text
[TransformersJSV4] Failed to initialize engine.
Error: no available backend found. ERR: [webgpu] Failed to get GPU adapter.
You may need to enable flag "--enable-unsafe-webgpu" if you are using Chrome.
```

Current v4 classification:

```text
Private v4 remains setup/runtime blocked before transcription. Do not score v4
accuracy from this workflow. Dev should confirm v4 CPU fallback behavior or
classify this environment as INVALID_SETUP setup.model_provider when WebGPU
adapter acquisition fails.
```

### Dev attention needed

1. **Private v2 accuracy:** Explain why current browser workflow final output is
   37.93% accurate even though setup and saveCandidate selection are working.
   This is no longer the old DOM-banner extraction issue.
2. **Private v2 timing/trust:** First visible text gate saw only 2 words before
   Stop. The UI progress state is present, but useful draft text remains too
   late/sparse for release trust.
3. **Private v4 runtime:** Current failure is `webgpu` adapter acquisition /
   backend selection. Either v4 must fall back to CPU in this environment, or
   the harness/product must classify it as setup invalid before any STT score.

### New dev experiment to validate: cross-origin isolation / WASM threads

Dev shipped an env-gated experiment toggle in `8a030dd0`:

```text
STT_CROSS_ORIGIN_ISOLATED=1
```

The toggle is off by default and does not change baseline behavior. If enabled
for a scoped preview, it should be treated as a timing experiment only until
proved:

| Gate | Required proof |
| --- | --- |
| isolation | `window.crossOriginIsolated === true` and `SharedArrayBuffer` available |
| worker threading | Private worker reports `wasmThreadCount > 1` / `wasm-multithread` |
| third-party smoke | Supabase auth/profile, Sentry/PostHog, model assets/cache, fonts, and hosted Stripe checkout redirect still work; no Stripe.js dependency inside the isolated document |
| benchmark | compare current vs isolated on `h1_2`, `h1_6`, `h1_8`, `h1_10`, and `washington_01` |

Release interpretation:

```text
This may improve Private CPU decode/finalization timing. It does not by itself
fix user trust or accuracy. User trust still requires immediate progress state,
useful draft timing, accurate final saveCandidate text, and score/analytics
confidence gating.
```

## TEST AGENT UPDATE (2026-06-02T23:18Z) — current-head rerun confirms real v2 accuracy/tail blocker

**Workflow:** `Controlled STT Benchmarks` run `26853628019`  
**Private Browser job:** `79191366613`  
**Commit:** `2a6fe37a`  
**Artifact:** `/private/tmp/private-browser-26853628019/`  
**Artifact ID:** `7372094146`

This rerun is after the saveCandidate harness fix and after the inert
cross-origin-isolation toggle commit. It confirms the old 8-word result was
DOM/banner contamination, but the current Private v2 browser path is still not
release-green.

| Engine | Setup | Proof result | Classification |
| --- | --- | --- | --- |
| Private v2 / CPU | Passed: Pro, Private, setup/model ready, saved session | Failed accuracy regression: WER 66.67%, accuracy 33.33%; selected transcript 51 words, expected fixture 87 words | `PROOF_FAIL proof.accuracy.final_completeness` / quality regression |
| Private v4 | Failed before transcription: `modelStatus=init-failed`, `serviceState=INIT_FAILED`, Start disabled | Not scored | `INVALID_SETUP setup.model_provider` |

Authoritative v2 save candidate:

```text
saveCandidateReason: service_result
finalWordCount: 51
meaningfulWordCount: 51
selectedForSaveLength: 269
resultTranscriptLength: 268
chunkTranscriptLength: 269
storeTranscriptLength: 269
storePartialTranscriptLength: 0
visibleStoreTranscriptLength: 269
frozenStopTranscriptLength: 22
candidateLengths:
- service_result: 268
- committed_final: 269
- visible_snapshot: 22
- best_meaningful_partial: 22
- store_visible_snapshot: 269
```

Selected transcript:

```text
The tail smell of old beer, like lingers, basically, a dash of pepper spoils beef to, well, the one knife was far short on perfect, you know, the marks was thrown beside the parked truck, literally, the twister left no trace on the town, a, like, toed wild tail to fry.
```

Current read:

```text
Private v2 setup, Stop, saveCandidate, and persistence are working enough to
produce an authoritative saved transcript. The failure is now a real proof
failure: final quality/completeness is far below the v2 drop-in/full-WAV
baseline and the transcript truncates before the expected tail.
```

Immediate dev attention:

1. Determine why the browser app path produces 51 words / 33.33% accuracy when
   the v2 full-WAV baseline is 93.89%.
2. Compare the exact app whole-utterance buffer against the Node/drop-in decoder
   to separate audio prep/windowing from runtime/candidate-selection issues.
3. Explain why `visible_snapshot` / `best_meaningful_partial` froze at only 22
   characters while service/store had 269 characters; this may affect user trust
   during Stop even when saved candidate is non-empty.
4. Private v4 remains blocked at setup/runtime. The failure is not an accuracy
   result: it is `INIT_FAILED` before transcription despite `hasWebGPU=true` in
   the browser snapshot.

## TEST AGENT UPDATE (2026-06-02T21:35Z) — superseded by 22:58Z saveCandidate rerun

**Superseded detail:** this run scored the DOM transcript panel during
finalization and classified v2 as an 8-word under-capture. The 22:58Z rerun above
shows the authoritative saved transcript contained 60 final words, so use this
older section only as evidence that the bounded setup/proof taxonomy works.

After adding setup/proof breadcrumbs and bounded readiness timeouts, I reran the
Private browser workflow:

```text
Controlled STT Benchmarks: 26848986617
Private Browser Benchmarks job: 79176052331
Commit: bdb14290
Artifact: /private/tmp/private-browser-26848986617/private-browser-benchmark-artifacts/
```

The earlier 6-7 minute opaque timeout is fixed. This run failed in 3m40s with
specific error codes:

| Candidate | Setup expected | Setup actual | Proof expected | Proof actual | First broken gate |
| --- | --- | --- | --- | --- | --- |
| Private v2 | login, Pro, Private selected, setup button clicked, provider ready | Passed. `SETUP_MODEL_PROVIDER_READY` at +7.3s; `modelStatus=ready`; `serviceState=READY`. | Record, show progress, produce complete final transcript against 87-word fixture | Recording started; first draft at +13.7s (`DraftUm, first. I'll smell of old beer like lingo`); Stop at +33.8s; transcript only `Processing speech locally…So wild tales to frighten him.` | `PROOF_FAIL proof.accuracy.final_completeness under_capture: transcript has only 8 words against 87 expected` |
| Private v4 | login, Pro, Private selected, setup button clicked, provider ready within 90s | Auth/mode/setup button passed; after click model stayed loading then ended `FAILED` / `init-failed`; Start disabled. | Not reached | Not reached | `INVALID_SETUP setup.model_provider TIMEOUT private-engine-ready-timeout after 90000ms` |

Evidence details:

```text
v2 trace: /private/tmp/private-browser-26848986617/cpu-trace/test.trace
v4 trace: /private/tmp/private-browser-26848986617/v4-trace/test.trace
v2 error context: /private/tmp/private-browser-26848986617/private-browser-benchmark-artifacts/test-results/live/live-benchmark-cpu.live-measure-TransformersJS-CPU--live-stt-chromium/error-context.md
v4 error context: /private/tmp/private-browser-26848986617/private-browser-benchmark-artifacts/test-results/live/live-benchmark-v4.live-measure-Transformers-js-v4-worker-live-stt-chromium/error-context.md
```

Current classification:

```text
Private v2: setup passes, proof fails at accuracy/completeness.
Private v4: setup fails at model/provider readiness before transcription.
Do not compare v2/v4 accuracy from this workflow yet; v4 never reached proof,
and v2 produced an under-captured transcript that the harness correctly refuses
to score.
```

## DEV → TEST AGENT (2026-06-02, append-only) — P0 root causes for v2 "under-capture" and v4 setup timeout

### Private v2 "under-capture" (final = "Processing speech locally…So wild tales to frighten him.", 8/87)
**Most likely DOM-extraction contamination, NOT a real decode under-capture — and now verifiable.**
`"Processing speech locally…"` is the **finalizing status banner** (`live-transcript-finalizing`),
which is rendered **inside `TRANSCRIPT_CONTAINER`** (LiveTranscriptPanel.tsx:126 container; 139-142
banner; 201/205 the "Listening…" placeholders). So scraping `transcript-container.textContent` during
the finalizing window captures the BANNER + whatever single draft fragment was on screen (here h1_6's
"wild tales to frighten him") — not the finalized transcript. This is the SAME class as the Native
`Listening...` artifact.

**Fix shipped (commit `58ce4278`):** the controller now exposes the AUTHORITATIVE save candidate at
`window.__SPEECH_RUNTIME_DEBUG__().saveCandidate` — `selectedForSave`, `saveCandidateReason`,
`selectedForSaveLength`, `finalWordCount`, `meaningfulWordCount`, and per-candidate lengths
(`result/chunk/store/storePartial/visibleStore/frozenStop`), plus `selectedTranscriptForSave`.

**Test-agent next:** read `__SPEECH_RUNTIME_DEBUG__().saveCandidate` AFTER Stop (and prefer it over
DOM scraping for the saved transcript). Then:
- if `selectedForSaveLength`/`finalWordCount` is the full ~87 words → it was **DOM-banner extraction**,
  not under-capture (harness should read the global / exclude the banner). No product decode bug.
- if it is genuinely ~8 words while `storeTranscriptLength`/`visibleStoreTranscriptLength` are large →
  that IS a real candidate-selection/decode boundary and I will patch product code with those numbers.
Please paste the `saveCandidate` object from the next v2 run.

### Private v4 setup timeout (INVALID_SETUP setup.model_provider TIMEOUT private-engine-ready-timeout 90000ms)
**Root cause: v4's model is ~120 MB cold-download vs a 90s readiness budget — a download-budget issue,
not a v4 code/accuracy bug.** `PRIV_STT_V4.EXPECTED_Q4_SPLIT_DOWNLOAD_MB = 120` (the `encoder_model:'fp32'`
dtype is the heavy part; decoder is q4). On the benchmark's cleared cache the 120 MB download does not
finish within the harness's 90s `data-stt-ready` wait → ready-timeout. v2 readies in ~7s because its
quantized model is far smaller. The readiness signaling is correctly wired: the app exposes
`data-model-status`, `data-stt-ready`, and worker `progress` events.

**Resolution (no code-fit-to-test timeout bump):**
1. **Test-agent / harness:** pre-warm the v4 model cache once before the timed proof (or detect
   `data-model-status`=downloading / `downloadVisible` and classify as `INVALID_DOWNLOAD_REQUIRED`
   rather than an STT/accuracy fail — exactly per the reviewer's guidance). v4 accuracy is unmeasured
   until setup reaches ready.
2. **Product decision (dev will implement on the call):** the 120 MB `fp32` encoder is heavy for
   first-load UX. Option A: keep fp32 (best accuracy: v4 96.39% Harvard) and accept a one-time 120 MB
   download with explicit progress UX + a longer first-load budget. Option B: quantize the encoder
   (fp32 → q8/fp16) to shrink the download materially at some accuracy cost. I recommend A for the
   proof now (pre-warm) and a product decision on B for first-run UX.
I did not change the v4 model config or timeouts — that needs the product accuracy/size call.

## DEV → TEST AGENT (2026-06-02, append-only) — how to validate #21 + cat-scan confirmations

**Cat-scan findings — confirmed/refuted:**
- **#1 (proof scores too early, reads DOM while `runtimeState=STOPPING`):** CONFIRMED, and it's a
  **harness sequencing** issue in your `tests/live/benchmark-cpu.live.spec.ts:73` / `benchmark-v4.live.spec.ts:73`.
  Fix on your side: after Stop, **wait for finalization to finish** before scoring — gate on
  `data-transcript-state="final"` (not `finalizing`) on the transcript container, OR poll
  `window.__SPEECH_RUNTIME_DEBUG__().saveCandidate != null`, then read `saveCandidate.selectedForSave`.
  Do NOT read `transcript-container` text while `Processing speech locally…` is showing.
- **#2 (v4 warm-up mismatch / init-failed risk):** CONFIRMED as a risk; **fixed (`74e960b4`)** — the v4
  warm-up is now **non-fatal** (model is loaded before warm-up, so a warm-up hiccup no longer surfaces as
  init-failed). Note: the primary v4 setup failure is still the ~120 MB cold download vs the 90s budget
  (pre-warm the cache); this fix removes warm-up as a second failure vector.

**To validate #21 (finalize-status-before-wait, commit `78e0a2ee`):**
1. Run a Private proof; at Stop confirm the finalizing state appears **immediately** —
   `data-transcript-state="finalizing"` / `Processing speech locally…` should show with ~0ms gap after
   Stop, NOT only after the in-flight live decode drains.
2. Confirm **no stale live partial flashes** after Stop (in-flight live emits are now suppressed; only the
   whole-utterance final lands).
3. Read the final from `__SPEECH_RUNTIME_DEBUG__().saveCandidate` once `data-transcript-state="final"`.
This + fixing #1's sequencing should resolve the "Private under-captures" false classification. I will not
mark Private green from the unit tests alone — your live timing/finalization run is the proof.

## TEST AGENT UPDATE (2026-06-02T20:50-05:00 / 2026-06-03T00:50Z) — h1_6 exact-buffer replay completed

This section supersedes the earlier "exact buffer missing" blocker below.
The exact-buffer artifact now exists and the replay diagnostic ran. Runtime
telemetry was then fixed and verified in a second exact-buffer proof.

### Runtime telemetry verification: 2026-06-03T00:41Z

Run:

```text
Controlled STT Benchmarks: 26856565454
Branch: fix/release-bug-burndown
Commit: 171a055c
Artifact: /private/tmp/speaksharp-exact-buffer-26856565454/private-exact-app-buffer-proof/speaksharp-private-h1_6-exact-buffer-current.json
```

Result:

| Check | Result | Evidence |
| --- | --- | --- |
| Exact-buffer proof | pass | `runnerPass=true`, `gatePass=true`, `pass=true` |
| h1_6 app transcript | pass for guard row | `A. Like, told Wild Tales to frighten him.`; 87.5% accuracy |
| First text | caveat | first visible text at 3100ms: `DraftA. Like.` |
| Runtime telemetry | pass | `runtime=wasm-singlethread`, `provider=transformers-js`, `webgpuAvailable=false`, `crossOriginIsolated=false`, `wasmThreadCount=1`, `cloudFallbackAttempted=false` |
| Exact audio | pass | utterance WAV data present |

Interpretation:

```text
The previous runtime telemetry gap is closed for explicit Private CPU proofs.
This does not make the full Private browser suite green; it only proves the
one-row h1_6 exact-buffer guard can now emit the required runtime fields.
```

### Prior exact-buffer diagnostic: 2026-06-03T00:27Z

Run:

```text
Controlled STT Benchmarks: 26856163962
Branch: fix/release-bug-burndown
Commit: 2baca21d
Artifact ID: 7373035634
App artifact: /private/tmp/speaksharp-exact-buffer-26856163962/speaksharp-private-h1_6-exact-buffer-current.json
Replay artifact: /private/tmp/speaksharp-private-app-buffer-replay-h1_6-exact-26856163962.json
```

Setup/proof result:

| Check | Result | Evidence |
| --- | --- | --- |
| Real Pro/private setup | pass | setup clicked mic-window `Set Up`; `modelStatus=ready`; transformer cache 7 keys |
| Exact final decode buffer captured | pass | `privateUtteranceAudioChunks[0].wavDataUrl` present; duration 4.032s; RMS 0.124116; peak 0.730975; speechStartOffsetMs 134.7 |
| Browser app saved transcript | fail | `A. Like. Told Wild Tales to frightened him.`; 75% accuracy / 25% error |
| Exact app-buffer offline decode | better, not perfect | `A. Like, told Wild Tales to frighten him.`; 87.5% accuracy / 12.5% error |
| Browser drop-in comparator | imperfect | `Day, like, told Wild Tales to frightened him.` |
| Runtime telemetry in artifact | superseded / fixed later | `privateRuntime`, `privateProvider`, `privateCloudFallbackAttempted`, `privateWasmThreadCount` were null in this earlier run; fixed by commit `171a055c` and verified in run `26856565454` |

Comparison:

| Fixture | Truth | App saved/live | Exact app-buffer offline decode | Browser drop-in | First bad boundary |
| --- | --- | --- | --- | --- | --- |
| `h1_6` | `They, like, told wild tales to frighten him.` | `A. Like. Told Wild Tales to frightened him.` | `A. Like, told Wild Tales to frighten him.` | `Day, like, told Wild Tales to frightened him.` | word 1: expected `they`, got `a` |

Current interpretation:

```text
The exact app audio buffer is not catastrophically truncated. It decodes
offline to 87.5%, so the older catastrophic h1_6 under-capture story is not
reproduced by this current exact-buffer proof.

The browser app still saves a worse 75% transcript from the same utterance.
That narrows the next dev boundary to browser runtime/candidate selection,
post-decode cleanup/sanitization, or result routing. It does not currently point
to audio prep/windowing/gating as the primary h1_6 failure.
```

Immediate dev attention:

1. Explain why the browser app saved `frightened` while exact app-buffer offline
   decode produced `frighten` from the same captured whole-utterance audio.
2. Confirm whether browser worker decode options/runtime differ from the replay
   decoder options.
3. Runtime telemetry nulls in explicit CPU proofs are fixed by commit
   `171a055c`; keep checking these fields in scored runs.
4. Keep exact audio capture opt-in only; it contains user audio and must not be
   included in normal release artifacts.

Release read:

```text
Private h1_6 is improved/narrowed but not parity-green. The app path is no
longer failing from obvious buffer truncation on this row, but the browser
saved transcript still underperforms the exact-buffer offline decode and the
runtime telemetry gap prevents a clean release proof.
```

## TEST AGENT UPDATE (2026-06-02T20:15-05:00) — superseded: app-buffer replay was previously blocked by stripped audio; opt-in capture added

**Superseded by the 20:50-05:00 exact-buffer replay above.** This older section
is retained only to explain why the opt-in audio capture was added.

This was the state after reviewing the `26853628019` Private browser
artifact and local replay tooling.

### What was tried

Command run against the best available h1_6 debug artifact:

```bash
pnpm exec tsx scripts/dev/private-app-buffer-replay.mts \
  --fixtures h1_6 \
  --app-artifact /private/tmp/speaksharp-private-h1_6-default-debug-20260601203248.json \
  --dropin-artifact /private/tmp/speaksharp-private-dropin-official-all-20260601175117.json \
  --out /private/tmp/speaksharp-private-app-buffer-replay-h1_6-noexact-current.json
```

Result:

| Fixture | App saved/live result | App-buffer offline decode | Browser drop-in result | Classification |
| --- | --- | --- | --- | --- |
| `h1_6` | `Day, light, told Wild Tales to frighten him.` | unavailable | `Day, like, told Wild Tales to frightened him.` | `artifact/config mismatch` |

### Why the replay could not close root cause yet

Existing artifacts do not contain the exact `wavDataUrl` buffer used by the
final whole-utterance decode. They contain only byte counts such as
`wavDataUrlBytes`. The failing current-head workflow artifact under
`/private/tmp/private-browser-26853628019/` contains Playwright trace/video/error
context files, but no JSON result row with replayable audio.

So the current artifacts can prove that the saved transcript was bad, but cannot
decide whether the first bad boundary is:

| Boundary | Can current artifacts prove it? | Why |
| --- | --- | --- |
| audio prep/windowing/gating | no | exact app WAV buffer missing |
| runtime nondeterminism | no | exact buffer cannot be replayed through Node/drop-in |
| candidate selection | partial | `saveCandidate` proves selected text, but not whether decode input was already degraded |
| cleanup/sanitization | partial | selected text is visible, but raw app-buffer decode is unavailable |

### Fix added to unblock the next run

`manual-stt-corpus-proof.mjs` now supports an explicit diagnostic opt-in:

```bash
STT_INCLUDE_AUDIO_DATA_URL=true
```

When set, Private artifacts include:

- `privateAudioChunks[].wavDataUrl` for rolling inference chunks
- `privateUtteranceAudioChunks[].wavDataUrl` for the final whole-utterance decode buffer
- existing `wavDataUrlBytes` fields remain for normal privacy-preserving runs

Default remains privacy-preserving: no raw audio data URL is included unless
`STT_INCLUDE_AUDIO_DATA_URL=true` is set.

### Required next rerun to close the h1_6 boundary

Run a single-row Private proof with exact audio capture enabled:

```bash
STT_MODES=private \
STT_FIXTURES=h1_6 \
STT_INJECT_MIC_AUDIO=true \
STT_PRIVATE_ENGINE=transformers-js \
STT_INCLUDE_AUDIO_DATA_URL=true \
STT_CORPUS_OUT=/private/tmp/speaksharp-private-h1_6-exact-buffer-current.json \
pnpm exec tsx scripts/manual-stt-corpus-proof.mjs
```

Then run:

```bash
pnpm exec tsx scripts/dev/private-app-buffer-replay.mts \
  --fixtures h1_6 \
  --app-artifact /private/tmp/speaksharp-private-h1_6-exact-buffer-current.json \
  --dropin-artifact /private/tmp/speaksharp-private-dropin-official-all-20260601175117.json \
  --out /private/tmp/speaksharp-private-app-buffer-replay-h1_6-exact-current.json
```

Decision table for the rerun:

| Replay result | Root-cause classification | Next dev action |
| --- | --- | --- |
| offline decode matches app bad transcript | app audio prep/windowing/gating | inspect final whole-utterance buffer duration, speechStartOffsetMs, RMS/peak, VAD tail cap |
| offline decode matches drop-in/good transcript | runtime/candidate-selection | inspect browser worker options, selected candidate, sanitizer, and result routing |
| offline decode differs from both | artifact/export/config mismatch | inspect exported WAV and decoder configuration before patching product code |

## TEST AGENT UPDATE (2026-06-02T21:45-05:00) — current-head Private browser proof after full-fixture wait fix

Controlling artifact:

```text
GitHub run: 26858116484
Commit under test: e8477232740d05d1232db041435cbb675519ef98
Artifact: /private/tmp/speaksharp-private-browser-26858116484/
```

### What changed before this proof

The previous Private v2 proof was invalid because the harness stopped after
`first text + 20s`, while the benchmark fixture is about `34.5s` long. That
meant the app could capture only about `27s` of audio but still be scored
against the full 87-word Harvard reference.

The current proof ran after commit `0e4be547`, which waits for the full
benchmark audio window before Stop. This removes the early-stop confound.

### Private v2 result

| Field | Value |
| --- | --- |
| Setup | pass |
| Runtime | `READY` |
| Model status | `idle` after final |
| Transcript state | `final` |
| Session persisted | `true` |
| Final decode input duration | `36.587s` |
| Speech start offset | `99.6ms` |
| Final decode time | `7969.7ms` |
| Selected source | `service_result` |
| Selected length | `430 chars` |
| Selected word count | `79` |
| Reference word count | `87` |
| Accuracy | `72.41%` |
| Error | `27.59%` |
| Filler recall | `90%` |
| Readability | pass |
| Save/history/detail | save marker pass in artifact |

Selected transcript:

```text
The tail smell of old beer, like lingers. Basically, a dash of pepper spoils beef to... Well, the one knife was far short on perfect. You know, the marks was thrown beside the parked truck. Literally, the twister left no trace on the town. A, like, toed wild tail to frighten him. We, um, find joy in the simplest things. The puppet, like, tune up the new shoes. A smooth road you know, make striving clement, basically, the cool.
```

Current classification:

```text
Private v2 setup/save/harness sequencing is fixed enough to expose a real
accuracy/parity failure. This is no longer DOM extraction contamination and no
longer early-stop proof contamination. The app captured full-duration audio and
saved from the authoritative saveCandidate, but the final transcript is still
well below release parity.
```

### Private v4 result

| Field | Value |
| --- | --- |
| Setup | pass enough to start recording |
| Runtime state | `RECORDING` |
| Model status | `ready` |
| Transcript state | `listening` |
| Save candidate | `null` |
| First audio chunk | present: `1.021s`, RMS `0.084193`, peak `0.707008` |
| `process_audio_ready` events | `28` |
| `model_inference_start` events | `28` |
| `model_inference_result` events | `27` |
| UI transcript | `Listening locally…` |
| Product classification | runtime/no-output failure |

Current classification:

```text
Private v4 is not blocked by mic setup in this artifact: audio reaches the
inference path repeatedly. It remains blocked because the browser worker never
produces usable transcript text or a save candidate. Treat v4 as runtime/config
failure, not an accuracy result.
```

### Dev attention requested

1. **Private v2:** Investigate why the browser app final decode of a full
   `36.587s` benchmark buffer produces only `72.41%` accuracy when the Node
   full-WAV ceiling for v2 is much higher. First suspect boundaries:
   browser worker decode options, runtime/config mismatch, audio buffer
   contents versus source fixture, and result cleanup/sanitization.
2. **Private v4:** Investigate the browser worker runtime/no-output path. The
   setup and mic path are no longer the first blocker; audio enters inference
   repeatedly, but no usable transcript is emitted and `saveCandidate` remains
   null.
3. Keep `saveCandidate` as the scored transcript source. Do not regress to DOM
   `transcript-container` reads, because those include user-facing status copy.

Release read:

```text
Private remains caveated/not release-green. v2 can run and save, but misses the
accuracy/parity gate. v4 is not usable until the browser runtime emits text.
```

## Current Controlling Replay Evidence: 2026-06-03T03:25Z

GitHub run:

```text
26858549345
```

Commit under test:

```text
89006629
```

Artifacts:

```text
/private/tmp/speaksharp-private-browser-26858549345/test-results/live/live-benchmark-cpu.live-measure-TransformersJS-CPU--live-stt-chromium/private-cpu-private-benchmark-evidence.json
/private/tmp/private-v2-browser-final-buffer-26858549345.wav
```

This run includes the exact final whole-utterance WAV buffer that the browser
app sent to the v2 Private worker. That removes the prior ambiguity about
whether the failure was worker runtime, save-candidate selection, cleanup, or
audio input.

### v2 App-Buffer Replay Result

| Decode input | Decoder | `return_timestamps` | Accuracy | Error | Words | Result |
| --- | --- | --- | ---: | ---: | ---: | --- |
| Source fixture `tests/fixtures/harvard_benchmark_16k.wav` | Node v2 / `Xenova/whisper-tiny.en` | `true` | 94.25% | 5.75% | 87 | Good ceiling / near drop-in |
| Source fixture `tests/fixtures/harvard_benchmark_16k.wav` | Node v2 / `Xenova/whisper-tiny.en` | `false` | 37.93% | 62.07% | 35 | Invalid for >30s; tail-only behavior |
| Exact browser final WAV buffer from run `26858549345` | Node v2 / `Xenova/whisper-tiny.en` | `true` | 62.07% | 37.93% | 79 | Bad; reproduces product-path degradation offline |
| Exact browser final WAV buffer from run `26858549345` | Node v2 / `Xenova/whisper-tiny.en` | `false` | 44.83% | 55.17% | 77 | Bad; still not the source-ceiling result |

Exact browser buffer metadata:

| Field | Value |
| --- | --- |
| Samples | `586496` |
| Duration | `36.656s` |
| RMS | `0.091232` |
| Peak | `0.992647` |
| Speech start offset | `105.5ms` |
| Retained preroll samples | `469` |
| Browser final decode time | `8239.8ms` |
| Browser selected word count | `80` |

Browser selected transcript:

```text
The scales fell on road here, like lingers. Basically, a dash on pepper spoils me too. Well, the one knife was far short on perfect. You know, the marks was thrown beside the parked truck. Literally, the twister left no trace on the town. A, like, toed wild tails to frighten him. We, uh, find joy in the simplest things. The puppet, like, tune up the new shoes. As move road, you know, make striving clement. Basically, the quid, the.
```

Exact-buffer offline replay with `return_timestamps:true`:

```text
The scales fell on road here, like lingers. Basically, a dash on pepper spoils me too. Well, the one knife was far short on perfect. You know, the marks was thrown beside the parked truck. Literally, the twister left no trace on the town. A, like, toed wild tails to frighten him. We, uh, find joy in the simplest things. The puppet, like, tune up the new shoes. A smooth road you know, make striving clement, basically, the quid.
```

### Updated v2 Diagnosis

```text
Private v2 is not fixed for release parity.

The worker/config/save-candidate path is no longer the first bad boundary for
this benchmark: the exact browser-captured final WAV buffer decodes badly when
replayed offline through the Node/drop-in v2 decoder. The same decoder and
options decode the original source fixture at 94.25%.

First bad boundary: browser input/capture/audio-buffer route for this proof.
```

Consequences:

| If fixed | If not fixed |
| --- | --- |
| v2 can become a credible caveated Private baseline for short/medium local use, with save/journey already mostly working. | v2 must remain caveated/secondary and cannot be claimed drop-in parity; the current browser benchmark is either exposing real input degradation or is invalid as a release accuracy proof. |

Immediate dev/test ask:

1. Compare the exact browser final WAV against the source fixture: duration,
   waveform, silence, gain, clipping, resampling, browser fake-mic route, and
   any WebRTC/DSP constraints.
2. Decide whether this is a benchmark route defect or a product real-mic
   defect. Do not claim v2 accuracy parity from this fake-audio browser proof
   until the captured WAV is validated.
3. Keep `return_timestamps:true` for >30s Private decoding. It is necessary for
   long-form assembly, but it does not fix the degraded browser buffer.

### Updated v4 Diagnosis

The same workflow still shows v4 reaching recording/inference, but every
browser worker inference result fails with:

```text
invalid data location: undefined for input "a"
```

Local Node smoke with `@huggingface/transformers@4.2.0` and the same mixed dtype
shape (`encoder_model: fp32`, `decoder_model_merged: q4`) loads and returns text,
so the current v4 blocker is browser runtime/backend/config specific rather than
"v4 model cannot run at all."

Consequences:

| If fixed | If not fixed |
| --- | --- |
| v4 remains the best Private candidate to prove because Node/full-WAV evidence is stronger than v2 and faster on the Washington long script. | v4 must be hidden/disabled for release; it is not an accuracy candidate until the browser worker emits text/saveCandidate. |

Immediate dev ask:

1. Reproduce the browser worker `invalid data location: undefined for input "a"`
   failure outside the full benchmark if possible.
2. Compare v4 browser runtime/backend settings to the passing Node smoke:
   device/backend, ORT/WASM config, dtype shape, input tensor allocation, and
   package/model asset versions.
3. Do not score v4 WER until saveCandidate exists.

## TEST AGENT UPDATE: Private v2 Human Mic Proof (2026-06-03T06:05Z)

Artifact:

```text
/private/tmp/speaksharp-private-v2-human-proof-2026-06-03T060231313Z.json
```

This run is **not valid first-time setup/download proof**. The harness clicked
the mic-window setup/download control automatically, which violates the product
trust rule that a user must explicitly choose Private model setup. Treat this
artifact only as a **post-setup Private v2 human real-mic transcript proof**.

Setup consequence:

```text
The next Private human proof must stop when the setup/download button is visible,
tell the user to click it, and record that explicit click. Do not auto-download
the model for a user.
```

### Old vs New Private Human JSON

| Field | Old run `055924777Z` | New run `060231313Z` |
| --- | --- | --- |
| Setup result | invalid | caveated post-setup proof |
| First blocker | `Could not select private; state=native` | setup/download was auto-clicked by harness |
| `selectedForSave` | empty | full transcript, `296` chars |
| `saveCandidateReason` | `null` | `service_result` |
| Final words | n/a | `55` / expected `56` |
| Accuracy | n/a | `91.07%` |
| WER | n/a | `8.93%` |
| Filler recall | n/a | `66.67%` (`basically`, `like`; missed `um`) |
| False filler insertions | n/a | `0` |
| Terminal punctuation | n/a | present |
| Sentence count | n/a | `2`, expected about `4` |
| Max run-on words | n/a | `49` |
| Save/history/detail | n/a | saved true; history/detail failed in artifact |

Selected transcript:

```text
Private local microphone proof starts now. I want to make one simple point before we move on Basically the puppy like chewed up the new shoes that changed the whole plane plan The main ticker ways that we should pause before the next idea give one concrete example and end with a clear next step.
```

Authoritative save-candidate numbers:

| Field | Value |
| --- | ---: |
| `selectedForSaveLength` | `296` |
| `finalWordCount` | `55` |
| `meaningfulWordCount` | `55` |
| `resultTranscriptLength` | `295` |
| `chunkTranscriptLength` | `296` |
| `storeTranscriptLength` | `296` |
| `storePartialTranscriptLength` | `0` |
| `visibleStoreTranscriptLength` | `296` |
| `frozenStopTranscriptLength` | `23` |

### Comparison Against Native Human Run

| Candidate | Evidence | Accuracy | WER | Filler recall | Sentence count | Max run-on | Save/history/detail | Release read |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Private v2 | human real mic, post-setup caveat | `91.07%` | `8.93%` | `66.67%` | `2 / ~4` | `49` | saved true; history/detail failed in artifact | Better transcript quality than Native, but still caveated. |
| Native Chrome | human real mic | `83.93%` | `16.07%` | `66.67%` | `1 / ~4` | `53` | save/history pass; detail empty in artifact | Worse readability/accuracy; still not release-green. |

Current read:

```text
Private v2 human real-mic quality is materially better than the Native human
run on the same style of script, but it is not release-green. It missed `um`,
has weak sentence boundaries/run-on text, contains recognition errors
(`plane plan`, `ticker ways`), and failed history/detail in the artifact. The setup
consent path is invalid because the harness auto-clicked model setup.
```

### Newly Observed Live Final-Overwrite Bug

User-visible symptom after Stop:

```text
With a clear next step.
```

The JSON shows the authoritative `saveCandidate` retained the full transcript,
so this is not proven as saved-data loss in this artifact. It is still a P0 user
trust bug: each finalized sentence/chunk appeared to overwrite the previous
visible final text during the live session, leaving only the latest segment on
screen.

Implemented fix pending browser proof:

```text
TranscriptionService now accumulates sentence-sized final updates instead of
replacing prior final text. If a provider sends a true full-transcript prefix,
the service still uses the fuller replacement. If it sends a new final segment,
the service appends it with overlap de-duplication.
```

Verification so far:

```text
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false \
  frontend/src/services/transcription/__tests__/TranscriptionService.test.ts \
  frontend/src/services/__tests__/SpeechRuntimeController.test.ts

33 tests passed.
```

Required rerun:

1. Fresh Private v2 human proof where the user explicitly clicks setup/download
   if needed.
2. Confirm the stable Draft trust banner appears at mic-on.
3. Confirm each final sentence appends to prior visible final text.
4. Confirm Stop/save/history/detail contain the whole speech.
5. Recompute accuracy, filler recall, readability, and timing from the new JSON.

Proof-harness guard now available for the rerun:

```text
PRIVATE_SETUP_USER_CONSENT_REQUIRED=true
```

When that flag is set, the live proof helpers must fail fast with:

```text
INVALID_SETUP setup.model_provider USER_CONSENT_REQUIRED private-setup-download-visible
```

instead of clicking the Private setup/download button. This keeps first-time
human proof honest: if setup is visible, the user must explicitly click it.

2026-06-03 follow-up: the guard now applies across the current Private setup
proof paths, including the benchmark helpers, first-time trial proof, Pro STT
artifact matrix, Tester B proof, Private cache proof, STT switching contract,
and manual corpus proof. Normal automated setup remains available when the flag
is not set.

---

## CURRENT CROSS-AGENT CONFIRMATION PROTOCOL (2026-06-03)

Bugs and fixes require the **other agent's confirmation** before being treated as done/green,
**unless the issue is glaringly obvious**. Applies both ways.
- **DEV-found bug → TEST confirms** (unless glaringly obvious). I will: (a) fix glaringly-obvious bugs
  directly on main and note them here; (b) for non-obvious bugs, post a **DEV BUG CANDIDATE** entry
  (file:line + evidence + proposed fix) and wait for your confirm before changing product behavior.
- **TEST-found bug → DEV confirms** (unless glaringly obvious). Post a **TEST BUG CANDIDATE** with the
  failing artifact/boundary; I confirm it reproduces in product code before I patch.
- "Glaringly obvious" = self-evident defect with no behavioral judgement needed (e.g. unguarded
  render-path `JSON.parse` that white-screens the app — fixed in `0d35d233`). When in doubt, it is NOT
  obvious → route for confirmation.

### Current unresolved bug-candidate list
_(none open in this bucket; #C1 is resolved later in this report as a bounded provisioning UX fix,
with browser proof still required.)_

---

## TEST/RELEASE UPDATE (2026-06-03T15:20Z) — Private setup consent UI contract verified

The product-side mic-window setup action is present and wired:

```text
SessionPage -> LiveRecordingCard.onDownloadModel -> speechRuntimeController.initiateModelDownload('private')
```

Focused coverage now requires `LiveRecordingCard` to show the inline
`download-model-button-inline` / `Set Up` action when Private needs model setup
and to call the supplied setup handler on click.

Validation:

```text
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false \
  frontend/src/components/session/__tests__/LiveRecordingCard.test.tsx

13 tests passed.
```

This does **not** close the human setup proof. The next Private human proof must
still run with `PRIVATE_SETUP_USER_CONSENT_REQUIRED=true` and must stop when setup
is visible so the user explicitly clicks setup/download. Do not auto-click model
setup in human proof.

---

## TEST/RELEASE UPDATE (2026-06-03T15:30Z) — Private/Native interim text no longer renders twice

The live transcript panel had an obvious trust/UX bug: when the interim hypothesis differed from the
committed transcript, the same draft text rendered twice — once as the `live-transcript-current-line`
card and again inline in the transcript body. This can make live text look jumpy or duplicative during
Private and Native recognition.

Fix on main:

```text
frontend/src/components/session/LiveTranscriptPanel.tsx
```

The interim/draft text now renders once, inline, while preserving the existing proof hook:

```text
data-testid="live-transcript-current-line"
data-transcript-draft="true"
```

Validation:

```text
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false \
  frontend/src/components/session/__tests__/LiveTranscriptPanel.component.test.tsx

19 tests passed.
```

This is a UI/trust fix only. It does not change STT decoding, WER, formatter behavior, saveCandidate,
or history/detail. The next Private proof must still measure first progress, finalization wait,
readability, save/history/detail, and app-vs-drop-in parity.

---

## TEST/RELEASE UPDATE (2026-06-03T15:45Z) — completed transcript is no longer failed by later metrics-update failure

Code-review bug found in the stop/finalization path:

```text
completeSession(status:'completed', transcript: finalTranscript) succeeded
-> updateSession(metrics) failed
-> old path threw SESSION_METRICS_UPDATE_FAILED
-> catch path could mark the already completed session failed
```

Fix on main:

```text
frontend/src/services/SpeechRuntimeController.ts
```

The completed transcript now remains completed/persisted when the later rich-metrics update fails.
The public proof signal stays true:

```text
html[data-session-persisted="true"]
```

Validation:

```text
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false \
  frontend/src/services/transcription/__tests__/SttSafeguards.test.ts

11 tests passed.
```

This closes a data-integrity/user-trust bug. It does **not** close the open Private
detail/history journey proof: the next browser proof still must show history/detail
contain `saveCandidate.selectedForSave` on the current SHA.

---

## DEV FINDING — Private LOCAL punctuation feasibility (#32) — for TEST confirm (2026-06-03)

Dev built an objective feasibility rig (commit `c8f0528b`):
`scripts/private-local-punctuation-feasibility.mts` (`npx tsx ...`). It scores any candidate
local formatter against YOUR documented acceptance criteria (readability improves + words
unchanged + fillers preserved + no network). Result on representative human-proof run-ons:

| Candidate | run-on fixtures | words | fillers | sentences | max run-on | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| identity (raw Whisper final) | native-scriptB, private | ok | ok | 1 → 1 | 45/40 (unchanged) | **FAIL readability** |
| localHeuristic (no-network, word-preserving) | native-scriptB, private | ok | ok | 1 → 7 | 45→18, 40→15 | **PASS** |

**Conclusion (dev):** raw Whisper final cannot carry Private readability — a local formatter is
required. A strictly word-preserving, NO-network heuristic clears the gate today without touching
words/fillers, so it is the measurable LOWER BOUND (and a possible **caveated stopgap**) a real
browser-local ONNX model must beat. Per owner ("no bespoke regex as the final answer"), the heuristic
is NOT shipped — it is a measurement baseline.

**Recommended path (needs product + TEST confirm before any ship):**
1. 24h: keep Private readability caveated; do NOT auto-download anything.
2. 48h+: integrate ONE browser-local ONNX punctuation model (PunctCapSeg / bert-restore-punctuation)
   in the Whisper worker, behind an EXPLICIT "Enable punctuation" setup consent, zero network after a
   one-time consented download. Acceptance = pass the same 4 checks AND beat the heuristic, with
   `privateFormatterNetworkCalls === 0`.

**TEST asks:** (a) confirm these acceptance checks match your release gate; (b) is a word-preserving
local heuristic acceptable as an interim caveated stopgap, or do we hold for the ONNX model only?
(c) which fixtures do you want added to the rig (Washington / your h1_* set) so this gates real proofs?

---

## CURRENT PRIVATE RELEASE HANDOFF (2026-06-03T16:55Z)

Stale coordination removed from this section. Current Private status only:

| Item | Current status | Owner / next action |
| --- | --- | --- |
| Setup/download consent | Human run observed explicit `Set Up`; no auto-download before user click in latest proof. | TEST reruns after any Private live-text fix to keep consent green. |
| Final transcript quality | Latest human Private v2 final was strong: 94.64% accuracy, 5.36% WER, 100% filler recall, readability pass. | Keep as positive quality evidence, but not release-green until live UX is fixed. |
| Live transcript before Stop | **P0 user-trust bug:** live panel showed only latest/tail sentence before Stop, while final after Stop was full. | DEV fix; TEST rerun same human script. |
| Detail/history journey | Latest artifact still needs saved/history/detail equality confirmed after the live-text fix. | TEST validates; DEV patches only if app state diverges. |
| Private punctuation/readability | Final whole-utterance can be readable, but local punctuation remains a product caveat for other runs. | **DEV-owned local implementation track**; no Gemini/server formatter for Private. Minimize friction because another local download can hurt adoption. |
| Score confidence-gating | Merged to main; transcript quality now affects confidence/caveat copy. | TEST visual check remains useful, not a Private STT blocker. |

### Current Private Human Test Findings

| Finding | Evidence | Status / owner |
| --- | --- | --- |
| Explicit setup/download consent behaved correctly | Latest human proof showed `Set Up` before model setup; user clicked it; no proof of auto-download before click. | **Pass in latest proof**; TEST must preserve this in rerun. |
| Final selected transcript quality is strong | `/private/tmp/speaksharp-private-human-41dc1997-rerun.json`: 94.64% accuracy, 5.36% WER, 100% filler recall, readability pass. | Positive quality signal; not release-green because live UX failed. |
| Live transcript is not cumulative before Stop | User saw only `Confirmed the score explains. transcript quality.` before Stop; after Stop the full 56-word transcript appeared. | **P0 DEV bug**: append accepted final/draft segments live instead of showing only latest/tail text. |
| Detail/history journey still needs proof | Latest run needs save/history/detail equality confirmed after the live-text fix. | TEST rerun; DEV patches only if saved row/detail diverges from `saveCandidate`. |
| Trust labels exist but must be retested with cumulative live text | Draft/final hooks are available, but the current visible transcript behavior still violates trust. | TEST verifies after DEV live-cumulative fix. |
| Local punctuation remains a Private caveat | Private cannot use server/Gemini formatting. Product direction is to roll our own local solution while avoiding another high-friction download if possible. | **DEV-owned**: design and implement local punctuation/readability path; do not send Private transcript to network formatter. |
| Manual proof harness timing needs cleanup | The rerun stop timer was process-relative; future timed human proofs should start the countdown at `READY_TO_SPEAK`. | TEST harness hygiene, not product bug. |

### Private Formatter Product Boundary

Product direction:

```text
Private formatting must be local. Do not use Gemini, `format-transcript`, or any server formatter for
Private. Dev owns the local punctuation/readability implementation. The solution must protect the
local/privacy promise and minimize user friction; another large local model download is risky unless
there is no lighter viable path.
```

Acceptance requirements for the dev proposal/implementation:

| Requirement | Why it matters |
| --- | --- |
| no network calls for Private formatting | preserves the Private STT privacy promise |
| word/filler preservation guard | prevents scoring/coaching from being based on altered speech |
| readability improves vs raw Private output | users need punctuation/casing/sentence boundaries |
| low-friction setup | Private already has model setup; another heavy download can cause churn |
| telemetry | expose formatter attempted/accepted/fallback/error/latency and network-call count for TEST proof |

### Test-Agent Verification Of Current Supporting Features (2026-06-03T17:37Z)

Automated checks run on `main` after report handoff merge `38243a14`:

```text
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false \
  frontend/src/components/session/__tests__/LiveTranscriptPanel.component.test.tsx \
  frontend/src/components/session/__tests__/LiveCoachingScoreCard.test.tsx \
  frontend/src/components/__tests__/ProfileGuard.component.test.tsx \
  frontend/src/hooks/__tests__/useStreak.test.ts \
  frontend/src/lib/__tests__/logRedaction.test.ts \
  frontend/src/utils/__tests__/speakingScore.test.ts \
  frontend/src/services/transcription/modes/__tests__/nativeTranscriptFormatter.test.ts \
  frontend/src/services/transcription/modes/__tests__/nativeGeminiFormatter.test.ts

83 tests passed.
```

Private-local punctuation feasibility:

```text
pnpm exec tsx scripts/private-local-punctuation-feasibility.mts

identity/raw Whisper: FAIL on run-on fixtures
localHeuristic/no-network: PASS on run-on fixtures; words+fillers unchanged
harness self-validation: OK
```

Current interpretation:

```text
The supporting confidence, trust-hook, redaction, formatter-seam, and onboarding unit/component
checks are green. They do not close the Private P0 browser bug above: live transcript must still
be fixed and rerun so cumulative speech appears before Stop.
```

## TEST → DEV P0 HANDOFF (2026-06-03T16:55Z) — Private live text replaces prior final text before Stop

**Attention dev agent:** the latest human Private proof found a user-visible live transcript assembly bug.

Artifact:

```text
/private/tmp/speaksharp-private-human-41dc1997-rerun.json
```

Observed by the user during the human Private v2 run:

```text
Before Stop, the visible transcript showed only:
"Confirmed the score explains. transcript quality."

After Stop, the final selected/saved transcript contained the whole speech:
"Um, speak sharp microphone proof starts now. Basically, I want to make one simple point before we move on. Like, the main idea is that every transcript should stay readable, keep prior sentences, and preserve the final words. Next step is to save this session, open the detail page, and confirm the score explains transcript quality."
```

Expected behavior:

```text
While recording, Private must display cumulative transcript text as final/draft chunks become available.
Each accepted final segment should append to the prior visible final text. The user should not see only
the latest sentence/tail segment until they click Stop.
```

Actual behavior in the artifact:

| Field | Value |
| --- | --- |
| `visibleBeforeStop` | `Confirmed the score explains. transcript quality.` |
| `saveCandidate.selectedForSave` | full 56-word transcript |
| accuracy vs full human script | 94.64% |
| WER | 5.36% |
| filler recall | 100% |
| readability final | pass: 4 sentences, max run-on 19, terminal punctuation present |
| release verdict | **not green** because live transcript UX violates trust expectations |

Why this matters:

```text
This is not saved-data loss; the final selected transcript is strong. It is a live user-trust bug:
Private looks like it is replacing the speech with one sentence at a time while recording. For a
half-page or page-length practice speech, this makes the app feel broken even if Stop later recovers
the full transcript.
```

Likely code areas to inspect:

```text
frontend/src/services/transcription/TranscriptionService.ts
frontend/src/services/SpeechRuntimeController.ts
frontend/src/services/transcription/modes/PrivateWhisper.ts
frontend/src/stores/useSessionStore.ts
```

Dev ask:

1. Confirm whether Private rolling/final updates reaching the live store are sentence-sized segments or cumulative transcripts.
2. Fix the live path so accepted Private final text is cumulative before Stop, without breaking the good full final selected at Stop.
3. Add a regression test for this sequence:
   - first accepted segment appears in live transcript
   - later accepted segment appends instead of replacing
   - before Stop, visible text contains both earlier and later segments
   - after Stop, `saveCandidate.selectedForSave` remains the full final transcript
4. Preserve provider-full-transcript replacement behavior for engines that legitimately send the entire prior transcript as a prefix.
5. Hand back the commit SHA and expected verification hooks so TEST can rerun the same human script.

Test rerun after dev fix:

```text
Mode: Private v2 human mic
Script: same 56-word proof script used in `/private/tmp/speaksharp-private-human-41dc1997-rerun.json`
Pass criteria:
- setup consent remains explicit (`Set Up` visible; no auto-download before user click)
- Draft banner visible from mic-on while text is provisional
- before Stop, visible transcript contains cumulative earlier + later speech, not only latest/tail sentence
- after Stop, final transcript remains full, readable, and save/history/detail match
```

## TEST UPDATE (2026-06-03T17:00Z) — Candidate `eff03d2d` automated support is strong, browser UX proof is blocked

Candidate tested:

```text
branch: fix/private-live-cumulative-transcript-2
commit: eff03d2d
```

This candidate is intended to address the Private live-cumulative transcript bug
above and includes related trust/formatter/score work. Automated checks support
the branch, but browser user-experience proof did not complete.

Automated results:

| Check | Result | Private read |
| --- | --- | --- |
| Focused STT/user-trust suite | **Pass:** 11 files / 146 tests | Unit/component coverage supports transcript panel, score confidence, controller/service, `PrivateWhisper`, log redaction, and formatter seams. |
| Full unit suite | **Pass:** 147 files / 1123 tests passed / 1 todo | Broad non-browser support is green. |
| Typecheck | **Pass** | No TS blocker found. |
| Build | **Pass:** `pnpm build:test` | Candidate builds. |
| Private local punctuation feasibility | **Pass:** harness self-validation | Raw/identity fails run-on fixtures; no-network word-preserving formatter lower bound passes. |
| Quality/lint | **Fail** | Release hygiene blocker before candidate can be called quality-green. |
| Browser UX smoke | **Fail before STT proof** | App never reached `html[data-app-visible-ready="true"]`; Private cumulative live text was not browser-proven. |

Quality/lint blockers:

```text
frontend/src/services/transcription/__tests__/SttSafeguards.test.ts
  11:10 error 'useSessionStore' is defined but never used

tests/live/benchmark-native.live.spec.ts
  4:16 error 'expect' is defined but never used

backend/supabase/functions/format-transcript/index.ts
  229:12 warning '_err' is defined but never used
  244:14 warning '_err' is defined but never used
```

Browser UX smoke blocker:

```text
tests/e2e/infra.probe.e2e.spec.ts failed waiting for:
html[data-app-visible-ready="true"]

Browser console/root error:
Mock auth is not available from the runtime app. Use the centralized E2E test
harness or create real test users through the test-user workflow.
```

Private release impact:

```text
Do not mark the Private live-cumulative transcript fix browser-green from this
sweep. The branch has useful automated evidence, but the browser proof was
blocked by auth/test-harness setup before the user could experience recording,
Draft, Processing, Final, save/history/detail, or cumulative live text.
```

Required next action:

1. Fix the browser smoke setup path: use centralized E2E harness or real test
   users so the app reaches `data-app-visible-ready="true"`.
2. Rerun Private v2 human/browser proof on the merged SHA:
   - setup consent explicit
   - draft/trust banner visible from mic-on
   - live transcript cumulative before Stop
   - Stop final selected transcript full/readable
   - save/history/detail match

### Lint Blocker Closed: 2026-06-03T17:06Z

Commit `e50e005f` clears the lint blockers above. Verification:

```text
pnpm quality

PASS: lint, typecheck, disable-directive hygiene
```

Private browser proof remains open because `pnpm rc:ux:smoke` still needs a valid
auth/test-harness setup path before it can reach mic-on and prove cumulative live
text.

### Current Main Browser UX Smoke Rerun: 2026-06-03T17:14Z

```text
main: 6855f598
command: pnpm rc:ux:smoke
result: FAIL — 5 infra-probe tests failed; 9 did not run
```

The build step passed. Browser UX proof failed before Private STT execution:

```text
waited for: html[data-app-visible-ready="true"]
root error: Mock auth is not available from the runtime app. Use the centralized
E2E test harness or create real test users through the test-user workflow.
```

Private impact:

```text
The current main rerun still cannot prove the Private cumulative live transcript
fix, Draft/Processing/Final trust UI, setup consent, or save/history/detail in a
browser. The blocker is setup/app boot, not a transcript accuracy result.
```

## TEST/FIX UPDATE (2026-06-03T17:23Z) — Private live provisional no-shrink fix merged

Commit:

```text
main: 1af4f73f
fix: preserve accumulated live provisional transcript
```

What changed:

```text
Private live provisional text now preserves already-visible accumulated draft
text once enough context has been shown. Sliding-window rolling decodes that
contain new speech append instead of replacing the live transcript with only the
latest window. Very early unconfirmed openers and unsafe marker candidates can
still revise/replace so bad first guesses are not locked in.
```

Verification:

```text
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false \
  frontend/src/services/transcription/modes/__tests__/PrivateWhisper.test.ts \
  frontend/src/services/transcription/modes/__tests__/mergeLiveProvisionalTranscript.test.ts

PASS: 2 files / 35 tests

pnpm quality

PASS: lint, typecheck, disable-directive hygiene
```

Important correction from testing:

```text
The first no-shrink attempt failed two existing PrivateWhisper safety regressions
because it preserved unconfirmed opener/unsafe text. The merged fix is narrower:
it preserves accumulated live draft text after enough context exists, while still
allowing early unstable text to revise.
```

Release impact:

```text
This closes the code/unit side of the "visible transcript replaces prior final
text before Stop" bug. It does not close browser UX proof because `pnpm
rc:ux:smoke` still fails before STT execution on the mock-auth visible-ready
gate. The human/browser rerun must still prove:
- visible transcript accumulates during recording
- Draft/Processing/Final trust states are visible
- final save/history/detail still match the full selected transcript
```

---

## DEV → TEST — independent codebase review: confirmations + test vision (2026-06-03)

**@test-agent — calling your attention to these.** An independent read-only review raised 5 STT
findings. DEV verified each against the code (the review also raised security items that were already
mitigated, so each was checked skeptically). **You have overall jurisdiction on how to confirm the app
works** — below is DEV's confirmation + a proposed test vision for each. DEV will own the code fixes for
the confirmed ones (tasks #36/#37/#38).

| Ref | Finding | DEV verdict | Owner |
| --- | --- | --- | --- |
| **F5** | `shouldPreferVisibleProvisional` prefers the LONGER candidate → can pick a longer hallucination over a clean shorter transcript | ✅ **CONFIRMED** | DEV fix (#36) → TEST validate |
| **F2** | No sliding-window overlap across utterances (`utteranceAudioChunks` resets per utterance) → boundary phoneme mutation ("chewed up"→"tune up") | ⚠️ **PARTIAL** — real trait, likely a facet of the v2 parity gap; hypothesis not defect | TEST A/B proof → DEV fix only if proven (#37) |
| **F3** | Asterisk sanitizer `/\*[^*]{1,40}\*/g` misses >40-char / nested tags | ✅ **CONFIRMED** (low sev) | DEV fix (#38) → TEST validate |
| **F1** | "Default getUserMedia DSP on distorts audio" | ❌ **REFUTED** — default is `RAW_AUDIO_CONSTRAINTS` (DSP off); DSP-on is test-only (`?privateMicConstraints=default`) | none — confirm `__PRIVATE_MIC_CONSTRAINTS_DEBUG__.mode==='raw'` |
| **F4** | "Stop-tail silence bypass → hallucination, blocklist only checks empty" | ❌ **MOSTLY REFUTED** — low-energy forced tail dropped before inference (`PrivateWhisper.ts:1162`); tiny/unsupported dropped (1471/1490); forced tail is fallback-only (1678) | none — confirm no low-energy tail decode in timeline |

**DEV test vision (for your jurisdiction to accept/adjust):**
- **F5 (#36):** unit — feed `shouldPreferVisibleProvisional` a `(clean shorter, hallucinated/repetitive longer)`
  pair, assert the clean candidate is preferred. Human/browser proof: no longer-hallucination ever shown as
  the visible transcript over a clean shorter one. DEV will replace length-only with quality-aware selection.
- **F2 (#37):** A/B harness — same audio through (a) the app's per-utterance decode vs (b) an overlapping
  sliding-window drop-in; compare WER and **boundary-word accuracy at utterance starts**. This is the
  concrete test of the v2 parity hypothesis. DEV changes the windowing ONLY if overlap measurably closes
  the gap (no blind pipeline change).
- **F3 (#38):** unit — metadata tags of length 10/40/41/80 + nested `*a*b*`; assert all stripped from the
  saved/detail transcript (DB + UI). DEV raises/removes the cap or multi-passes.
- **F1 / F4:** no fix needed; please just confirm the negative in a proof artifact (mic mode `raw`; no
  low-energy tail decode) so we can close them on the record.

**STATUS (2026-06-03, updated):**
- **#36 (F5) — ✅ DONE, merged to main `24d719e3`.** `shouldPreferVisibleProvisional` now requires a longer
  provisional to genuinely extend the final (≥70% of final words preserved) or it is rejected; unit tests
  added. Handed back for browser/human validation (no longer hallucination shown as visible).
- **#38 (F3) — ✅ DONE, merged to main `24d719e3`.** `sanitizeTranscriptText` strips asterisk metadata of
  ANY length (`/\*[^*]+\*/g`); unit tests added. Handed back for validation (no `*…*` metadata in saved/detail).
- **#37 (F2) — 🔧 DEV IN PROGRESS NOW.** Building the dev-side app-vs-drop-in windowing A/B harness to
  prove/kill the cross-utterance-overlap parity hypothesis with data before any pipeline change.
- **F1 / F4 — ❌ refuted** (unchanged; F4 = watch-item "no hallucinated tail appended").

---

## TEST/FIX UPDATE (2026-06-03T18:15Z) — browser UX smoke setup blocker cleared

This section supersedes the earlier `2026-06-03T17:14Z` `html[data-app-visible-ready="true"]`
mock-auth blocker. That blocker was real at `6855f598`, but it is no longer the
controlling state after the E2E harness fixes in `c167d3b0`.

Commit under test:

```text
main local: c167d3b0
```

Commands/results:

| Command | Result | Evidence type |
| --- | --- | --- |
| `pnpm quality` | **PASS** | unit/build hygiene |
| `CI=true pnpm exec playwright test tests/e2e/primary-journey.e2e.spec.ts --config=playwright.config.ts --project=full-suite --reporter=line --output=test-results/playwright-primary-journey-sessiondb` | **PASS:** 8/8 | harness-proof |
| `pnpm rc:ux:smoke` | **PASS:** 14/14 | harness-proof |

Bug findings fixed by this update:

| Finding | Result |
| --- | --- |
| Browser smoke could not boot because runtime mock auth/Supabase was missing. | Fixed by injecting the centralized E2E Supabase/auth mock client. |
| Native/mock STT persistence selected `[E2E_MOCK]` instead of the transcript emitted by the proof bridge. | Fixed by preserving the last final transcript on the E2E bridge and returning it from the mock engine. |
| Analytics stayed at the seeded `5Total Sessions` after a saved session. | Fixed by persisting the mock session DB in `sessionStorage` across full page navigation and invalidating session analytics after `data-session-persisted=true`. |
| Primary journey attempted to prove persistence from an invalid sub-5-second session. | Fixed by aligning the proof with the product save contract and waiting past the minimum-duration gate. |

Private release interpretation:

```text
The mock browser journey is no longer blocked by setup/auth and now proves that
the harness can boot, emit transcript text, save, navigate, and refresh analytics.
This is NOT a Private real-model parity result. Private still needs the real
browser/human proof for:
- cumulative visible transcript during recording
- Draft/Processing/Final trust-state visibility
- save/history/detail equality with the authoritative saveCandidate
- v2/v4 parity against drop-in where applicable
- local punctuation/readability path
```

---

## TEST UPDATE (2026-06-03T19:57Z) — deployed Private injected-audio reached execution but failed quality/UI extraction

Run:

```text
BASE_URL=https://speaksharp-public.vercel.app
CI=true
pnpm exec playwright test tests/live/tester-b-private-native-stt.live.spec.ts \
  --config=playwright.deployed-live.config.ts \
  --project=deployed-live-chromium \
  --grep "Private STT" \
  --reporter=line \
  --output=/private/tmp/speaksharp-private-injected-escalated-20260603155713
```

Result:

```text
FAIL — proof.accuracy + proof.journey.filler_ui_schema
```

Evidence:

```text
/private/tmp/speaksharp-private-injected-escalated-20260603155713/live-tester-b-private-nati-a0965-1-audio-and-detects-fillers-deployed-live-chromium/trace.zip
/private/tmp/speaksharp-private-injected-escalated-20260603155713/live-tester-b-private-nati-a0965-1-audio-and-detects-fillers-deployed-live-chromium/error-context.md
/private/tmp/speaksharp-private-injected-escalated-20260603155713/live-tester-b-private-nati-a0965-1-audio-and-detects-fillers-deployed-live-chromium/test-failed-1.png
```

What worked:

| Gate | Evidence |
| --- | --- |
| `setup.build_env` | Deployed URL reachable: `https://speaksharp-public.vercel.app`. |
| `setup.auth_tier` | Fresh signup succeeded; `PRO` badge visible. |
| `setup.stt_mode` | Private selected; `modeSelectState="private"`. |
| `setup.model_provider` | Fresh cache showed `modelStatus="download-required"` and visible setup CTA; harness clicked setup; model loaded; `PrivateWhisper` reported `Model ready! Using CPU mode.` |
| `proof.runtime.provider_selected` | `engine="transformers-js"`, no cloud fallback observed in logs. |
| `proof.journey.save_candidate` | Save candidate populated: `selectedForSaveLength=106`, `finalWordCount=15`, `saveCandidateReason="service_result"`, `sessionPersisted="true"`. |

What failed:

| Gate | Evidence | Release meaning |
| --- | --- | --- |
| `proof.accuracy.final_text` | Truth: `Um. Basically, we should literally like, wait.` Final selected text: `Basically, we should literally like, "Wait, um, basically, we should literally like, wait, um, basically."` | Private duplicated/repeated the short fixture and did not preserve the expected concise utterance. This is not parity-green. |
| `proof.timing.first_draft_trust` | Live transcript contained trust-copy text concatenated into transcript DOM: `Draft transcriptText may change before the final transcript is saved.Basically...` | Harness should read authoritative transcript/debug fields instead of raw DOM for text scoring; product should still ensure visible trust copy is separated from transcript semantics. |
| `proof.journey.filler_ui_schema` | Filler UI text was `basically3um2like2literally2uh0...`; the proof could not parse individual filler words from DOM text. | The filler list should expose machine-readable row/test ids or aria labels for each filler/count. Without that, release artifacts can mis-score filler recall even when the UI visually shows counts. |

Dev/test ask:

| Item | Ask |
| --- | --- |
| Private short-utterance duplication | DEV: inspect why the saved final repeated `basically / um / like` in a short injected fixture. Candidate boundary: chunk overlap/append or final decode selection. TEST: rerun after fix and compare selectedForSave directly to truth, not raw transcript-container DOM. |
| Trust copy contaminates transcript DOM scoring | DEV/TEST: keep trust copy visually present, but expose a transcript-only selector or debug field for scoring; do not force tests to scrape the full panel text. |
| Filler UI schema | DEV: add stable per-filler rows/test ids/aria labels with word and count. TEST: parse those instead of concatenated panel text. |


---

## TEST UPDATE (2026-06-03T21:10Z) — deployed Private proof after live-cumulative work still fails final-text quality

Run:

```text
BASE_URL=https://speaksharp-public.vercel.app
CI=true
pnpm exec playwright test tests/live/tester-b-private-native-stt.live.spec.ts \
  --config=playwright.deployed-live.config.ts \
  --project=deployed-live-chromium \
  --grep "Private STT" \
  --reporter=line \
  --output=/private/tmp/speaksharp-private-rerun-20260603165439
```

Result:

```text
FAIL — proof.accuracy.final_text + stale filler extraction assertion
```

Current controlling evidence:

| Gate | Evidence | Release meaning |
| --- | --- | --- |
| setup.build_env/auth_tier/stt_mode | Deployed app, fresh signup, PRO, Private selected, setup/download CTA clicked, CPU runtime reached. | Setup path is runnable in deployed proof. |
| proof.journey.save_candidate | `saveCandidateReason=service_result`, `selectedForSaveLength=106`, `finalWordCount=15`, `fillerCount=5`. | The bug is in the selected final/service result, not only raw DOM scraping. |
| proof.accuracy.final_text | Truth: `Um. Basically, we should literally like, wait.`; selected final: `Basically, we should literally like, "Wait, um, basically, we should literally like, wait, um, basically."` | Private still duplicates/repeats a short utterance. It is not parity-green. |
| proof.journey.filler_ui_schema | Existing live spec still read concatenated `filler-words-list` text and parsed `[]`; visible row text contained counts like `basically3um2like2literally2...`. | TEST must update extraction to the clean row selectors dev exposed: `[data-filler-word]` / `[data-filler-count]`. Product only fails if those clean rows are missing or wrong. |

Direct dev/test handoff:

| Item | Owner | Ask |
| --- | --- | --- |
| Private final duplication | DEV | Inspect finalization/merge/candidate selection. This proof shows the authoritative `service_result` is already repeated; do not treat it as trust-copy contamination only. Add a regression that `selectedForSave` for the short filler fixture is concise and not repeated. |
| Private filler artifact extraction | TEST | Stop parsing the full `filler-words-list` text. Use the clean row data attributes so counts and labels are separable. |
| Private setup consent | TEST/DEV | Human proof must not auto-click setup; it must prove one clear setup CTA and no model download before explicit user click. |


---

## TEST UPDATE (2026-06-03T21:28Z) — current-main Private duplication proof reached save; not blocked at setup

Commit under test:

```text
4013f6f0 feat(proof): identity-bearing persisted-session marker (#5)
```

Run:

```text
BASE_URL=https://speaksharp-public.vercel.app
CI=true
pnpm exec playwright test tests/live/tester-b-private-native-stt.live.spec.ts \
  --config=playwright.deployed-live.config.ts \
  --project=deployed-live-chromium \
  --grep "Private STT" \
  --reporter=line \
  --output=/private/tmp/speaksharp-main-current-private-proof
```

Result:

```text
FAIL — stale filler assertion, but proof reached setup -> recording -> stop -> saveCandidate.
```

Dev-answering evidence:

| Question | Answer from proof |
| --- | --- |
| Is Private duplication classification blocked at DOWNLOAD_REQUIRED? | **No.** Current-main deployed proof reached model setup, model ready, recording, Stop, and persisted session marker. |
| Is the repeated transcript only raw DOM contamination? | **No.** The authoritative save candidate selected `service_result`, and `service_result` itself is repeated. |
| What was selected for save? | `Basically, we should literally like, "Wait, um, basically, we should literally like, wait, um, basically."` |
| What was truth? | `Um. Basically, we should literally like, wait.` |
| Key saveCandidate fields | `saveCandidateReason=service_result`, `selectedForSaveLength=106`, `finalWordCount=15`, `resultTranscriptLength=106`, `chunkTranscriptLength=106`, `storeTranscriptLength=106`, `visibleStoreTranscriptLength=106`, `frozenStopTranscriptLength=66`. |
| Candidate lengths | `service_result=106`, `committed_final=106`, `visible_snapshot=66`, `best_meaningful_partial=66`, `store_visible_snapshot=106`. |
| Current failure in live spec | The assertion still parses concatenated `filler-words-list` text and receives `[]`; this is stale extraction. Use `[data-filler-word]` / `[data-filler-count]` for filler proof. |

Direct dev ask:

```text
Private duplication is now classified enough to start product debugging:
the repeated text is in service_result/saveCandidate, not just UI container text.
Please inspect the Private finalization/service-result path: whole-utterance final decode,
chunk/live final merge, and candidate selection. The fix should make selectedForSave for
conv_01 equal the concise truth without repetition. The test harness should separately
move filler assertions to the clean row selectors.
```

---

## TEST UPDATE (2026-06-03T22:42Z) — Private timing branch proof for dev `__PRIVATE_TIMING__`

Purpose: unblock the dev decision tree introduced in commit `c108eaa6`
(`finalizeWaitMs` / `finalizePrepMs` / `finalizeDecodeMs`). This is a
short injected-audio Private proof on `conv_01.wav`, not a long human speech
proof. It is valid for proving the timing fields and short-utterance branch
selection; long-form/private-human timing still needs the same fields captured
on a longer run.

Run:

```text
BASE_URL=https://speaksharp-public.vercel.app
CI=true
pnpm exec playwright test tests/live/tester-b-private-native-stt.live.spec.ts \
  --config=playwright.deployed-live.config.ts \
  --project=deployed-live-chromium \
  --grep "Private STT" \
  --reporter=line \
  --output=/private/tmp/speaksharp-private-timing-deployed-c108eaa6
```

Result:

```text
PASS — setup -> Private model ready -> recording -> Stop -> saveCandidate.
```

Timing evidence from `window.__PRIVATE_TIMING__`:

| Field | Value | Branch meaning |
| --- | ---: | --- |
| `timeToFirstProvisionalMs` | 2743.5 ms | First visible draft was not immediate; still measurable. |
| `timeToFirstFinalMs` | 9957.5 ms | First committed final came late for this short fixture. |
| `finalizeWaitMs` | 0.2 ms | Branch 1 drain/cleanup did **not** dominate this proof. |
| `finalizePrepMs` | 0.9 ms | Branch 2 concat/energy/audio-capture prep did **not** dominate this proof. |
| `finalizeDecodeMs` | 1878.2 ms | Branch 3 model decode **dominated** post-Stop wait on this fixture. |
| `utteranceSeconds` | 8.192 s | Short fixture. |
| `peakBufferedSeconds` | 1.752 s | No long-form buffer cliff measured here. |

Save/result evidence:

| Field | Value |
| --- | --- |
| `saveCandidateReason` | `service_result` |
| `selectedForSaveLength` | 106 |
| `finalWordCount` | 15 |
| `frozenStopTranscriptLength` | 85 |
| selected final | `Basically, we should literally like, "Wait, um, basically, we should literally like, wait, um, basically."` |
| truth | `Um. Basically, we should literally like, wait.` |

Direct dev answer:

```text
For short Private conv_01, the post-Stop delay is decode-dominated:
finalizeDecodeMs=1878.2ms vs finalizeWaitMs=0.2ms and finalizePrepMs=0.9ms.
Do not spend this short-fixture fix on concat/capture prep or drain. If you are
optimizing this path, the measured lever is CPU decode / WASM threading. However,
the same proof still confirms Private final duplication remains in service_result,
so accuracy/merge correctness is a separate blocker from the timing branch.

Need next proof: repeat this exact __PRIVATE_TIMING__ capture on a longer human
or washington-style speech before deciding segment-finalization / long-form
buffering from peakBufferedSeconds.
```

Dev interpretation accepted:

| Signal | Current conclusion | What remains open |
| --- | --- | --- |
| Short `conv_01` post-Stop wait | Decode-dominated and acceptable: ~1.9s decode, ~0ms drain/prep. | Does not explain the earlier ~10s wait on the longer 79-word artifact. |
| `timeToFirstFinalMs` on short `conv_01` | ~10s, meaning this short recording showed draft text but did not settle a committed final until Stop/finalize. | For long speeches, this may become the "draft never settles / stop dump" UX problem. |
| Earlier longer artifact | Suggested large pre-decode wait, but lacked `finalizeWaitMs` / `finalizePrepMs` split. | Needs rerun with the new timing fields before any branch fix. |

Required next evidence before dev changes long-form architecture:

| Run | Required fields | Decision it unlocks |
| --- | --- | --- |
| ~60s distinct-prose Private run | `timeToFirstProvisionalMs`, `timeToFirstFinalMs`, `finalizeWaitMs`, `finalizePrepMs`, `finalizeDecodeMs`, `utteranceSeconds`, `peakBufferedSeconds`, `saveCandidate`, transcript completeness/readability | Distinguish drain-vs-decode-vs-segmentation for medium speech. |
| ~120s distinct-prose Private run | Same fields, plus `RTF = finalizeDecodeMs / (utteranceSeconds * 1000)` | Decide whether long-form needs segment-level finalization, worker drain cap/skip, or WASM threading. |

Decision rule for dev:

```text
If finalizeWaitMs grows on long runs -> fix Stop drain / cap discarded in-flight live decode.
If finalizeDecodeMs scales linearly and Stop wait is still unacceptable -> segment-level finalization is the UX lever.
If RTF is high and decode dominates -> WASM threads / cross-origin isolation is the throughput lever, subject to third-party smoke tests.
If timeToFirstFinalMs stays beyond Stop on long runs -> segment-level finalization is needed for trust/smoothness even if raw decode speed is acceptable.
```

---

## TEST UPDATE (2026-06-04T00:17Z) — 65.8s Washington long-form timing proof

Purpose: answer the dev agent's follow-up that the short `conv_01` branch might
not generalize to long speech. This run uses the public-domain `washington_01`
fixture (65.81s, 191 words) through the deployed browser Private path and reads
the same `window.__PRIVATE_TIMING__` fields.

Run:

```text
BASE_URL=https://speaksharp-public.vercel.app
CI=true
pnpm exec playwright test tests/live/private-longform-timing.live.spec.ts \
  --config=playwright.deployed-live.config.ts \
  --project=deployed-live-chromium \
  --reporter=line \
  --output=/private/tmp/speaksharp-private-longform-washington-timing
```

Artifact:

```text
/private/tmp/speaksharp-private-longform-washington-timing/live-private-longform-timi-45ffb--washington-01-65-8s-speech-deployed-live-chromium/private-longform-washington-timing.json
```

Result:

```text
PASS — setup -> Private model ready -> recording -> Stop -> saveCandidate.
```

Timing and quality:

| Field | Value | Interpretation |
| --- | ---: | --- |
| `timeToFirstProvisionalMs` | 2742.5 ms | First draft appeared in the same range as the short proof. |
| `timeToFirstFinalMs` | 76594.1 ms | No committed final during the 65.8s speech; final appears only after Stop/finalize. |
| `finalizeWaitMs` | 130.9 ms | Drain/in-flight live decode did **not** dominate the long proof. |
| `finalizePrepMs` | 57.2 ms | Concat/capture prep did **not** dominate the long proof. |
| `finalizeDecodeMs` | 11566.2 ms | Model decode dominates post-Stop wait. |
| `utteranceSeconds` | 64.917 s | Long-form proof input. |
| `peakBufferedSeconds` | 5.749 s | Live buffered window remained bounded; final decode still processes full utterance. |
| `RTF` | 0.1782 | Decode is faster than real time, but a 65s utterance still creates an 11.6s Stop wait. |
| Accuracy | 97.38% | Strong final accuracy on this fixture. |
| WER | 2.62% | Final transcript is quality-usable despite punctuation/readability caveat. |

Save/result evidence:

| Field | Value |
| --- | --- |
| `saveCandidateReason` | `service_result` |
| `selectedForSaveLength` | 1057 |
| `finalWordCount` | 189 / 191 expected |
| `frozenStopTranscriptLength` | 1248 |
| `stop_predecode_breakdown.wasProcessingAtStop` | `true` |
| `stop_predecode_breakdown.drainWaitMs` | 130.7 ms |

Direct dev answer:

```text
For the 65.8s washington_01 browser proof, the long-form post-Stop wait is still
decode-dominated, not drain/prep dominated:

finalizeDecodeMs=11566.2ms
finalizeWaitMs=130.9ms
finalizePrepMs=57.2ms
RTF=0.1782

So the measured fix is NOT concat/capture prep and NOT Stop drain. The technical
throughput lever is WASM threading / cross-origin isolation, but the product-UX
lever is segment-level finalization: timeToFirstFinalMs=76594.1ms means the user
gets draft text during the whole speech and waits ~11.6s after Stop for the first
trusted final. That is the trust/smoothness problem for long speeches.

Recommendation: prioritize segment-level finalization for user trust, and keep
WASM threading as the speed lever gated by the existing COOP/COEP + Stripe/third-
party smoke tests. A 120s run would quantify scale, but this 65.8s run is enough
to reject the drain/prep branches for medium speech.
```

## TEST UPDATE (2026-06-04T01:43Z) — dev-requested backlog proofs

Purpose: answer the dev agent's "who closes the other six tests" handoff. I ran
the automatable proofs and documented which items are still human-only.

### 1. Focused Score/Analytics and journey browser sweep

Run:

```text
CI=true
pnpm exec playwright test \
  tests/e2e/analytics-suite.e2e.spec.ts \
  tests/e2e/analytics-truth.e2e.spec.ts \
  tests/e2e/user-facing-regressions.e2e.spec.ts \
  tests/e2e/primary-journey.e2e.spec.ts \
  --config=playwright.config.ts \
  --project=full-suite \
  --reporter=line \
  --output=/private/tmp/speaksharp-automatable-backlog-proofs-readyfix
```

Result:

```text
PASS — 20/20
```

What this proves:

| Requested proof | Result | Notes |
| --- | --- | --- |
| Score/Analytics confidence proof | Pass in mocked browser flow | Session-to-Analytics surfaces, score/quality caveat, and metric parity paths are covered by the focused sweep. |
| Onboarding/profile smoke | Pass in mocked browser flow | Included in the primary/user-facing regression paths. |
| Native/Cloud/Private primary mocked journeys | Pass | This is not a substitute for live STT / real mic / credentialed provider proof. |

### 2. Deployed Private trial journey proof

Before rerun, two harness defects had to be fixed:

| Harness defect | Fix |
| --- | --- |
| Signup copy assertion expected stale text: `60-minute Pro trial included`. | Assert `/60-minute Pro trial/i`, matching current product copy: "Start free, with a 60-minute Pro trial". |
| Private readiness wait accepted `runtimeState=READY` while `data-model-status=loading`. | Private readiness now requires `data-stt-ready=true`, `data-model-status=ready`, or active `RECORDING`; idle controller READY is no longer enough. |

Run:

```text
BASE_URL=https://speaksharp-public.vercel.app
CI=true
pnpm exec playwright test tests/live/first-time-tester-private-trial.live.spec.ts \
  --config=playwright.deployed-live.config.ts \
  --project=deployed-live-chromium \
  --reporter=line \
  --output=/private/tmp/speaksharp-private-trial-journey-proof-transcript-clean
```

Result:

```text
PASS — signup -> Private selected -> setup/model ready -> recording -> Stop/save -> History -> /analytics/:id
```

Key evidence:

| Field | Value |
| --- | --- |
| `firstUseReady.modelStatus` | `ready` |
| `firstUseReady.statusText` | `Private ready. Nothing leaves your browser.` |
| `recordingEvidence.transcriptText` | `Basically. we should literally like. "Wait, um, basically."` |
| `recordingEvidence.fillerCount` | `5` |
| Filler row text | `basically2`, `um1`, `like1`, `literally1` |
| `historyEvidence.historyItemVisible` | `true` |
| `historyEvidence.openedUrl` | `https://speaksharp-public.vercel.app/analytics/83885a61-d60f-4ed3-a3e6-1b4a3d991f4e` |

Important limitation: this proves the automated deployed journey can open the
saved detail route. It does **not** yet prove `data-session-detail-transcript`
matches `saveCandidate.selectedForSave`; the first-time live spec should be
extended for that exact content comparison if we want to close #28 fully without
a human proof.

### 3. Private setup consent guard

Run:

```text
BASE_URL=https://speaksharp-public.vercel.app
CI=true
PRIVATE_SETUP_USER_CONSENT_REQUIRED=true
pnpm exec playwright test tests/live/first-time-tester-private-trial.live.spec.ts \
  --config=playwright.deployed-live.config.ts \
  --project=deployed-live-chromium \
  --reporter=line \
  --output=/private/tmp/speaksharp-private-consent-guard-proof
```

Result:

```text
EXPECTED FAIL — INVALID_SETUP setup.model_provider USER_CONSENT_REQUIRED private-setup-download-visible
```

Evidence summary:

| Field | Value |
| --- | --- |
| `modelStatus` | `download-required` |
| `serviceState` | `DOWNLOAD_REQUIRED` |
| `startButtonDisabled` | `true` |
| Visible copy | `Private model required... Set up Private / Vault Mode on this computer. All audio processing remains local.` |

Interpretation: the harness guard is now working. With
`PRIVATE_SETUP_USER_CONSENT_REQUIRED=true`, automated proof stops at the setup CTA
instead of auto-clicking. This does not close the human consent proof: a human
still has to click setup explicitly and verify the CTA/copy feels acceptable.

### Current owner split after these tests

| Item from dev handoff | Status |
| --- | --- |
| Native real Chrome mic | Still human/test-agent only; injected audio is diagnostic, not release proof. |
| Private human trust proof | Still human/test-agent only because setup consent requires the user's click. |
| Private detail/history journey | Automated route opens history/detail; content equality still needs `saveCandidate` vs `data-session-detail-transcript`. |
| Score/Analytics confidence proof | Automatable focused browser proof passed 20/20. |
| Onboarding/profile smoke | Covered in the focused browser sweep; no new failure found. |
| Private 120s timing | Not run in this pass. We already have a distinct-prose 65.8s Washington proof; the checked-in 120s fixture is repeated corpus and weaker for release accuracy claims. |

### DEV-facing asks

```text
1. The automatable tests are not blocked now. The live Private proof helpers no
   longer treat controller READY as model-ready; use this version for future
   Private parity/timing runs.

2. Do not treat the consent-guard failure as product failure. It is an expected
   human-proof stop: setup CTA is visible and the harness refuses to click it.

3. If dev wants #28 fully closed without a human, the next small test task is to
   extend first-time Private proof to read `window.__SPEECH_RUNTIME_DEBUG__().saveCandidate`
   after Stop and compare it with `[data-testid="session-detail-transcript"]` /
   `data-session-detail-transcript` on `/analytics/:id`.

4. The long-form timing branch remains as previously measured: 65.8s is decode-
   dominated and UX-trust dominated; do not chase Stop-drain or prep-copy fixes
   from the timing numbers.
```
