# STT Product Metrics Release Matrix

**Date:** 2026-06-02  
**Last updated:** 2026-06-03T02:33:00Z  
**Scope:** Private v2, Private v4, Native, Cloud  
**Location:** `product_release/evidence/` because this is temporary release evidence, not a canonical product-release artifact.  

## Purpose

This file is the measurement matrix only. The reviewer path-to-release,
product positioning, and 24/48-hour release plan have been consolidated into:

```text
product_release/evidence/test_reports/STT_SPEED_ACCURACY_MARKET_SURVIVAL_REVIEW_2026-06-02.md
```

Use this matrix to inspect metric definitions and measured values. Use the
market-survival review for release strategy and ownership.

## Two-Step Release Workflow

Optimization is the north star. Every STT proof now has only two gates:

| Step | Name | Question | If it fails |
| --- | --- | --- | --- |
| 1 | Setup | Can the user/harness reach the intended STT engine with the right account, mode, model/provider, runtime, mic/input route, and instrumentation? | Mark `INVALID_SETUP`. Do not score accuracy, timing, or release quality. |
| 2 | Proof | Once setup is proven, does the STT path meet runtime, timing, accuracy, and journey expectations versus its baseline? | Mark `PROOF_FAIL` with the first broken proof phase and gate. |

Rules:

```text
No setup proof, no STT scoring.
No proof, no release claim.
Every failure must identify one error phase: setup, runtime, timing, accuracy, or journey.
Every setup failure must name the exact setup gate.
Every proof failure must name the exact proof phase and gate.
```

### Setup Gates

| Gate | Pass condition | Typical breadcrumbs |
| --- | --- | --- |
| `setup.build_env` | Correct build mode, app URL, secrets, and test/live mode are proven. | `BUILD_ENV_READY`, `APP_URL_READY`, `SECRETS_PRESENT` |
| `setup.auth_tier` | User is signed in and effective Free/Pro tier matches the STT path. | `AUTH_FORM_VISIBLE`, `LOGIN_SUCCESS`, `TIER_CONFIRMED` |
| `setup.stt_mode` | Intended STT mode is visible and machine-readable. | `MODE_SELECTED`, `MODE_VISIBLE`, `MODE_DEBUG_VALUE` |
| `setup.model_provider` | Intended model/provider can be reached and is ready or explicitly downloading. | `SETUP_BUTTON_VISIBLE`, `SETUP_CLICKED`, `MODEL_STATUS`, `PROVIDER_READY` |
| `setup.runtime_telemetry` | Runtime/provider/device/thread/fallback telemetry is populated before scoring. | `RUNTIME_DEBUG_READY`, `WORKER_TELEMETRY_READY`, `CLOUD_FALLBACK_FALSE` |
| `setup.mic_input` | Requested mic constraints or human-mic/input route are captured and valid. | `MIC_CONSTRAINTS_CAPTURED`, `AUDIO_ROUTE_VALID`, `HUMAN_MIC_CONFIRMED` |
| `setup.artifact_schema` | Required logs, timing fields, transcript states, and artifact writers are populated. | `ARTIFACT_WRITER_READY`, `TIMING_FIELDS_READY`, `TRANSCRIPT_STATES_READY` |

### Proof Phases

| Phase | Gate | Pass condition | Typical breadcrumbs |
| --- | --- | --- |
| `runtime` | `proof.runtime.provider_selected` | Correct STT provider/runtime actually handles the run; no unintended fallback. | `ENGINE_READY`, `RUNTIME_SELECTED`, `RECORDING_STARTED` |
| `timing` | `proof.timing.first_progress` | User sees recording/listening/processing progress quickly. | `FIRST_PROGRESS_MS`, `RECORDING_STATE_AT` |
| `timing` | `proof.timing.first_text` | First usable interim/draft/final text appears within the mode budget. | `FIRST_TEXT_MS`, `FIRST_DRAFT_VISIBLE_AT` |
| `timing` | `proof.timing.finalization_wait` | Finalization and detail visibility are within the mode-specific budget. | `STOP_CLICKED`, `FINAL_READY_MS`, `DETAIL_VISIBLE_AT` |
| `accuracy` | `proof.accuracy.final_completeness` | Final transcript preserves beginning, middle, tail, and expected length. | `FINAL_TRANSCRIPT_WORDS`, `EXPECTED_WORDS`, `TAIL_PRESERVED` |
| `accuracy` | `proof.accuracy.fillers` | Accuracy, filler recall, and false filler insertion meet baseline/target. | `FILLER_RECALL`, `FALSE_FILLERS`, `WER` |
| `accuracy` | `proof.accuracy.readability` | Terminal punctuation, sentence boundaries, casing, no run-on text, no duplication. | `PUNCTUATION_QUALITY`, `READABILITY_VERDICT` |
| `journey` | `proof.journey.stop_save_detail` | Stop selects the intended transcript and saved/history/detail match it. | `STOP_SELECTED_SOURCE`, `SAVED`, `HISTORY_VISIBLE`, `DETAIL_VISIBLE` |

Current example:

| STT | Error phase | Failed gate | Why |
| --- | --- | --- | --- |
| Private v4 browser proof | setup | `setup.model_provider` | Current-head run `26853628019`: setup/runtime ends `INIT_FAILED`; Start disabled before transcription. |
| Private v2 exact-buffer h1_6 | proof | `proof.accuracy.final_quality` | Current exact-buffer run `26856565454` on commit `171a055c`: h1_6 guard passed at 87.5% with runtime telemetry populated (`wasm-singlethread`, `transformers-js`, `cloudFallbackAttempted=false`). Full Private suite still needs run `26856683929` result before release classification. |
| Cloud A/B keyterms | accuracy | `proof.accuracy.fillers` | Current-head run `26852918607`: requests/session validity closed; keyterms still hurts h1_6 accuracy. |
| Native human proof | accuracy, journey | `proof.accuracy.readability`, `proof.journey.stop_save_detail` | Chrome produced words, but readability and stop/save/detail failed. |

### Latest Current-Head Cloud App Journey Proof: 2026-06-02T23:07Z

Run:

```text
Live Release Matrix: 26853283325
Cloud live artifact job: 79190255334
Commit: c043af72
Artifact: /private/tmp/live-cloud-artifact-26853283325/
Artifact ID: 7371932386
```

Result:

```text
PASS_WITH_METRIC_GAPS
```

| Check | Result | Evidence |
| --- | --- | --- |
| Provider final event | pass | Cloud provider emitted `eventType: final`. |
| Provider termination after Stop | pass | Cloud provider emitted `eventType: terminated`. |
| Save decision | pass | `[CLOUD_SAVE_DECISION] willSave: true`, transcript length 363, duration 26.996s. |
| Saved session metrics | pass | final transcript length 363, word count 67, filler count 6, WPM 149. |
| App journey | pass | Playwright passed: transcribe, save, analytics history. |

Interpretation:

```text
Cloud app journey is passing and Cloud remains the strongest 24-hour quality
path. This run does not yet close exact timing/readability/tail metrics because
the live test did not export __CLOUD_STT_TIMELINE__, WER/readability, or scripted
tail comparison against ground truth.
```

### Latest Current-Head Cloud Token Gate Proof: 2026-06-02T23:23Z

Run:

```text
Live Release Matrix: 26853914030
Cloud token gates job: 79192279314
Commit: bc6ca5da
Artifact ID: 7372174665
```

Result:

```text
PASS
```

| Scenario | Expected | Actual | Token issued |
| --- | --- | --- | --- |
| Missing auth | reject | 401 Missing Authorization header | false |
| Free account | reject Cloud token minting | 403 Cloud STT is available as a Pro feature. Trial access includes Private STT. | false |
| Active trial | reject Cloud token minting | 403 Cloud STT is available as a Pro feature. Trial access includes Private STT. | false |
| Paid Pro | mint Cloud token | 200 | true |
| Over-quota Pro | reject | 429 Usage limit reached | false |

Interpretation:

```text
Cloud entitlement/revenue control is live-proved: only paid Pro within quota
receives an AssemblyAI token. This closes the token gate, not transcript quality.
Cloud still needs long-script transcript timing/readability/tail proof before a
full release-green claim.
```

### Latest Current-Head Private Exact-Buffer Proof: 2026-06-03T00:41Z

Run:

```text
Controlled STT Benchmarks: 26856565454
Branch: fix/release-bug-burndown
Commit: 171a055c
Artifact: /private/tmp/speaksharp-exact-buffer-26856565454/private-exact-app-buffer-proof/speaksharp-private-h1_6-exact-buffer-current.json
```

| Candidate | Setup | Proof | Current classification |
| --- | --- | --- | --- |
| Private v2 / CPU h1_6 exact-buffer | pass: Pro, Private, model setup, exact final buffer captured, runtime telemetry populated | pass: 87.5% accuracy; first text 3100ms | guard row passed; not full-suite green |
| Runtime telemetry | pass | `runtime=wasm-singlethread`, `provider=transformers-js`, `webgpuAvailable=false`, `crossOriginIsolated=false`, `wasmThreadCount=1`, `cloudFallbackAttempted=false` | evidence gate closed for explicit CPU exact-buffer proofs |

Interpretation:

```text
The runtime telemetry null blocker from the previous exact-buffer artifact is
closed on commit 171a055c. This only proves h1_6 exact-buffer CPU; the full
Private v2/v4 browser suite is rerunning as workflow 26856683929.
```

### Prior Exact-Buffer Diagnostic: 2026-06-03T00:27Z

Run:

```text
Controlled STT Benchmarks: 26856163962
Branch: fix/release-bug-burndown
Commit: 2baca21d
Artifact ID: 7373035634
App artifact: /private/tmp/speaksharp-exact-buffer-26856163962/speaksharp-private-h1_6-exact-buffer-current.json
Replay artifact: /private/tmp/speaksharp-private-app-buffer-replay-h1_6-exact-26856163962.json
```

| Candidate | Setup | Proof | Current classification |
| --- | --- | --- | --- |
| Private v2 / CPU h1_6 browser app | pass: Pro, Private, model download/setup, exact final buffer captured | fail: app saved 75% accuracy; first text at 3091ms; final ready at ~12.49s after recording began / ~4.31s after Stop | not green; app saved output worse than exact-buffer offline decode |
| Exact app-buffer offline replay | pass: replayable `privateUtteranceAudioChunks[0].wavDataUrl` | 87.5% accuracy from same captured audio | narrows boundary away from audio prep/windowing |
| Runtime telemetry | superseded | Runtime fields were null in this earlier artifact; fixed and verified in run `26856565454` | closed for exact-buffer CPU |

Comparison:

| Fixture | Truth | App saved/live | Exact app-buffer offline decode | Browser drop-in | Accuracy read |
| --- | --- | --- | --- | --- | --- |
| `h1_6` | `They, like, told wild tales to frighten him.` | `A. Like. Told Wild Tales to frightened him.` | `A. Like, told Wild Tales to frighten him.` | `Day, like, told Wild Tales to frightened him.` | app 75%; exact-buffer replay 87.5% |

Interpretation:

```text
The exact app audio buffer is not catastrophically truncated. Current h1_6
does not support audio prep/windowing as the primary root cause. The remaining
gap is browser runtime/candidate selection, cleanup/sanitization, or result
routing, plus missing runtime telemetry in the artifact.
```

### Prior Current-Head Private Browser Proof: 2026-06-02T23:18Z

Run:

```text
Controlled STT Benchmarks: 26853628019
Private Browser Benchmarks job: 79191366613
Commit: 2a6fe37a
Artifact: /private/tmp/private-browser-26853628019/
Artifact ID: 7372094146
```

| Candidate | Setup | Proof | Current classification |
| --- | --- | --- | --- |
| Private v2 / CPU | pass: Pro, Private, model ready, saved session | fail: WER 66.67%, accuracy 33.33%, saveCandidate finalWordCount 51 / expected 87 | not green; real app/browser accuracy/tail blocker |
| Private v4 | fail: `modelStatus=init-failed`, `serviceState=INIT_FAILED`, Start disabled | not reached | invalid setup/runtime; do not score accuracy |

Private v2 selected transcript:

```text
The tail smell of old beer, like lingers, basically, a dash of pepper spoils beef to, well, the one knife was far short on perfect, you know, the marks was thrown beside the parked truck, literally, the twister left no trace on the town, a, like, toed wild tail to fry.
```

Interpretation:

```text
The 8-word DOM/banner artifact is superseded. Current Private v2 can save an
authoritative transcript, but the transcript is materially worse than the v2
drop-in/full-WAV baseline. Dev needs the app-buffer replay diagnostic to decide
whether this is audio prep/windowing, runtime/config, or candidate selection.
```

### Latest Current-Head Private Cache/Setup Proof: 2026-06-02T23:34Z

Run:

```text
Live Release Matrix: 26854295228
Private cache job: 79193489334
Commit: bc6ca5da
Artifact: /private/tmp/live-private-cache-26854295228/
```

Result:

```text
PASS_SETUP_ONLY
```

| Check | Result | Evidence |
| --- | --- | --- |
| First start model ready | pass | `modelStatus:"ready"`, `runtimeState:"READY"` |
| Transformer cache populated | pass | `cacheNames:["transformers-cache"]`, `transformerCacheKeyCount:7` |
| Second start avoids download prompt | pass | `downloadVisible:false`, `secondStartReadyWithoutDownloadPrompt:true` |
| Cache persists | pass | `cachePersisted:true` |

Interpretation:

```text
Private v2 setup/cache is not the current release blocker. This proof does not
score transcript accuracy; v2 final quality and v4 init failure remain open.
```

### Latest Current-Head Private Browser Proof: 2026-06-02T22:46Z

Run:

```text
Controlled STT Benchmarks: 26852510533
Private Browser Benchmarks job: 79187735332
Commit: b9c00f27
Artifact: /private/tmp/private-browser-26852510533/
```

This rerun used the authoritative Stop/save candidate exposed at
`window.__SPEECH_RUNTIME_DEBUG__().saveCandidate` instead of scoring
`transcript-container` text during `STOPPING`.

It changed the Private v2 diagnosis:

```text
Old contaminated read: 8 words, because the harness read the DOM while
`Processing speech locally...` was rendered in the transcript panel.

New authoritative read: 60 saved words selected from `service_result`.
The prior 8-word under-capture classification is superseded.
```

The rerun still fails release proof:

| Candidate | Step | Expected | Actual | First broken gate | Exit/error code |
| --- | --- | --- | --- | --- | --- |
| Private v2 | setup | Auth, Pro tier, Private mode, setup click, provider ready | Passed. `SETUP_MODEL_PROVIDER_READY`; model status `ready`; service `READY`; recording started. | none | none |
| Private v2 | proof | Show useful early draft, Stop, save complete accurate transcript | First live-text gate failed before Stop: expected >5 visible words, received 2. After Stop, `saveCandidate.selectedForSave` existed with 60 words from `service_result`, but WER was 62.07% / accuracy 37.93%. | `proof.timing.first_text`, then final quality | `expect(received).toBeGreaterThan(expected): Expected > 5, Received 2`; saved final logged as `Private (CPU) Ceiling: WER 62.07% -> Accuracy 37.93%` |
| Private v4 | setup | Auth, Pro tier, Private mode, setup click, provider ready within 90s | Auth/mode/setup button passed; after click, worker failed WebGPU adapter acquisition and app ended `INIT_FAILED`; Start stayed disabled. | `setup.model_provider` / runtime backend | `INVALID_SETUP setup.model_provider TIMEOUT private-engine-ready-timeout after 90000ms`; console: `no available backend found. ERR: [webgpu] Failed to get GPU adapter` |

Current read:

```text
Private v2 is no longer blocked by auth/model setup and the 8-word
under-capture was a harness read bug. However, v2 is still not release-green:
the user-visible first-text gate failed and the authoritative saved transcript
was only 37.93% accurate on the full benchmark fixture.

Private v4 is still blocked before transcription by setup/model-provider
readiness. This run points to WebGPU backend acquisition / fallback handling in
the v4 worker, not an accuracy result.
```

Authoritative v2 save candidate:

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
candidateLengths:
- service_result: 319
- committed_final: 319
- visible_snapshot: 60
- best_meaningful_partial: 60
- store_visible_snapshot: 319

selectedForSave:
The tail smell of old beer, like lingers. Basically, a dash on pepper spoil
beef too. Well, the one knife was far short on perfect. You know, the marks was
thrown beside the parked truck. Literally, the twister left no trace on the
town. A, like, toed wild tail to frighten him. We, um, find joy in the simplest
things.
```

### Latest Current-Head Cloud A/B Proof: 2026-06-02T23:00Z

Run:

```text
Controlled STT Benchmarks: 26852918607
Commit: b63768aa
Artifact: /private/tmp/speaksharp-cloud-ab-26852918607/assemblyai-streaming-ab-proof.json
Variants: baseline,keyterms
Requested fixtures: h1_1,h1_2,h1_6,h1_8,h1_10,washington_01
Scored fixtures: h1_1,h1_2,h1_6,h1_8,h1_10
```

This run closes the Cloud A/B request/session validity action item for the h1
subset. Both variants produced valid sessions. `washington_01` did not appear
in the artifact, so Cloud long-speech/app-tail proof remains open.

| Candidate | Step | Expected | Actual | First broken gate | Exit/error code |
| --- | --- | --- | --- | --- | --- |
| Cloud baseline | proof | Valid AssemblyAI streaming sessions with strong accuracy and filler evidence | 5/5 valid, 97.78% average accuracy, 90% filler recall | none | none |
| Cloud keyterms | proof | Improve filler recall without material ordinary-word accuracy loss | 5/5 valid, 95% average accuracy, 100% filler recall; h1_6 dropped to 75% | `proof.accuracy.fillers` | quality tradeoff, not request failure |

Per-row detail:

| Variant | Fixture | Accuracy | Filler recall | Retries | Transcript |
| --- | --- | ---: | ---: | ---: | --- |
| baseline | h1_1 | 88.89% | 50% | 0 | `The stale smell of old beer, like, lingers.` |
| baseline | h1_2 | 100% | 100% | 0 | `Basically, a dash of pepper spoils beef stew.` |
| baseline | h1_6 | 100% | 100% | 0 | `They, like, told Wild Tales to frighten him.` |
| baseline | h1_8 | 100% | 100% | 0 | `The puppy, like, chewed up the new shoes.` |
| baseline | h1_10 | 100% | 100% | 0 | `Basically, the quick brown fox jumps over the lazy dog.` |
| keyterms | h1_1 | 100% | 100% | 0 | `Um, the stale smell of old beer, like, lingers.` |
| keyterms | h1_2 | 100% | 100% | 2 | `Basically, a dash of pepper spoils beef stew.` |
| keyterms | h1_6 | 75% | 100% | 0 | `They like told wild tales to frighten him.` |
| keyterms | h1_8 | 100% | 100% | 0 | `The puppy, like, chewed up the new shoes.` |
| keyterms | h1_10 | 100% | 100% | 0 | `Basically, the quick brown fox jumps over the lazy dog.` |

Current read:

```text
Cloud baseline remains the safest Cloud release candidate. The Cloud A/B
plumbing is no longer the blocker for the h1 subset: request shape, session
validity, and artifact capture worked on current main. Keyterms remains blocked
because it trades better filler recall for worse h1_6 transcript accuracy.
Long-speech/app-tail proof is still open because `washington_01` was not emitted
by this provider-only A/B artifact.
```

## Candidate Set

v3 is removed from the release-candidate comparison set.

Reason:

```text
On washington_01, v3 was faster than v2 but materially less accurate than v2/v4.
No current evidence suggests v3 is a better release candidate than v4.
```

Active STT candidates:

| Candidate | Status |
| --- | --- |
| Private v2 | Keep as current/legacy Private baseline |
| Private v4 | Prioritize for browser proof; strongest Private candidate so far |
| Native | Keep as customer-expectation baseline / quick-start path |
| Cloud | Keep as quality/full-speech launch candidate |
| Private v3 | Retired from release-candidate comparison unless new evidence reverses this |

## Metric Gate

The release gate is interpreted in the market-survival review. The measurement
standard used by this matrix is:

```text
Each visible STT path must match or exceed its corresponding drop-in/customer
baseline on the product metrics below, or it must be caveated/de-emphasized.
```

Drop-in/customer baselines:

| Candidate | Baseline to match or exceed |
| --- | --- |
| Private v2 | Private v2 full-WAV/drop-in ceiling and current browser app path |
| Private v4 | Private v4 full-WAV/drop-in ceiling and Private v2 where v2 is current default |
| Native | Real Chrome human-mic customer expectation |
| Cloud | AssemblyAI baseline streaming behavior; prompt/keyterms only if A/B proves safe |

## Product Metric Contract

| Metric | Required value | Why it is a product metric |
| --- | --- | --- |
| Accuracy/error | Not materially worse than drop-in/customer baseline | Engineering quality guardrail |
| Filler recall | Expected fillers recognized | SpeakSharp coaching depends on fillers |
| False filler insertion | 0 target | Prevents bad coaching feedback |
| Terminal punctuation | true | Users expect readable final text |
| Sentence count | roughly matches expected sentence count | Detects run-on text and missing sentence boundaries |
| Max run-on words | <=45 target; <=35 preferred | Wall-of-text transcripts drive users away |
| Capitalization errors | 0 obvious errors target | Random caps such as "Starts Now" look amateurish |
| Duplicate sentence/speech | false | Duplicate transcript is launch-blocking |
| Readability verdict | pass/fail | Captures punctuation/casing/duplication quality |
| First progress | <=1s target; <=2s hard limit | Prevents blank/frozen UI |
| First draft | <=5s target; <=8s hard limit for Private CPU | Shows the app is working |
| Finalization wait | short <=8s target / <=12s hard; 60s speech <=20s target / <=30s hard | Measures post-stop frustration |
| Transcript confidence | high/medium/low | Prevents overconfident score/analytics from weak STT |
| Save/history/detail | pass required | Proves the product journey |

## Timing Bottleneck Contract

Every browser/app run must include the timing fields below. Without them, we
cannot tell whether lag came from microphone startup, VAD, buffering, worker
queue, model inference, store/UI update, final decode, save, or detail loading.

### Shared Timing Fields

| Field | Meaning |
| --- | --- |
| `micClickedAt` | User clicked mic/start recording |
| `recordingStateAt` | App entered recording/listening state |
| `stopClickedAt` | User clicked Stop |
| `selectedForSaveAt` | Controller/service selected transcript for persistence |
| `savedAt` | Session persisted |
| `detailVisibleAt` | Saved session detail became visible |

### Private Timing Fields

| Field | Meaning |
| --- | --- |
| `speechDetectedAt` | Private VAD/speech-start gate detected speech |
| `firstAudioChunkQueuedAt` | First usable audio chunk queued to worker |
| `firstInferenceStartAt` | Worker started first draft/provisional inference |
| `firstInferenceEndAt` | Worker completed first draft/provisional inference |
| `firstDraftVisibleAt` | UI displayed first Private draft text |
| `finalInferenceStartAt` | Worker started final whole-utterance inference |
| `finalInferenceEndAt` | Worker completed final whole-utterance inference |

### Native Timing Fields

| Field | Meaning |
| --- | --- |
| `onaudiostartAt` | Chrome Web Speech audio pipeline started |
| `onspeechstartAt` | Chrome Web Speech detected speech |
| `firstInterimAt` | First Chrome interim text event |
| `firstFinalAt` | First Chrome final text event |
| `onendAt` | Chrome Web Speech recognition ended |

### Cloud Timing Fields

| Field | Meaning |
| --- | --- |
| `socketOpenAt` | Cloud streaming socket opened |
| `firstProviderMessageAt` | First provider message received |
| `firstPartialAt` | First partial/interim transcript received |
| `firstFinalAt` | First final/turn transcript received |
| `terminationAt` | Provider termination/end-of-turn/final session message received |

### Derived Timing Metrics

| Metric | Meaning |
| --- | --- |
| `micToSpeechDetectedMs` | Capture/VAD delay for Private, or mic-to-speechstart for Native |
| `speechDetectedToFirstInferenceStartMs` | Private buffering/queue delay |
| `firstInferenceDurationMs` | Private first draft model time |
| `inferenceEndToDraftVisibleMs` | Store/UI delay after draft inference |
| `stopToFinalInferenceStartMs` | Pre-finalization delay after Stop |
| `finalInferenceDurationMs` | Private final model decode time |
| `finalInferenceEndToSaveMs` | App/backend save delay after final decode |
| `micToFirstInterimMs` | Native/Cloud first text latency from mic start |
| `firstFinalToSelectedForSaveMs` | App selection delay after provider/browser final |
| `stopToOnEndMs` | Native recognition shutdown/finalization delay |
| `providerOpenToFirstPartialMs` | Cloud streaming partial latency |
| `providerOpenToFirstFinalMs` | Cloud streaming final latency |
| `stopToDetailVisibleMs` | Total post-stop user wait |

Current status:

```text
The timing fields are now part of the MD/JSON metric contract.
Private browser values were refreshed on 2026-06-02 with the injected-mic route.
Cloud provider A/B values were refreshed via GitHub Actions credentialed run.
Native human real-mic proof ran on 2026-06-02 and failed product-readiness.
```

## Current Values

Legend:

```text
MEASURED_NODE = measured in Node/drop-in-style full-WAV path.
MEASURED_PRIOR_APP = older app-path evidence; must be refreshed before release.
NOT_CAPTURED_CURRENT_RUN = no defensible current value yet.
BLOCKER = missing value blocks green classification.
```

## Current Product Classification — 2026-06-02

| STT | Classification | Why | Next action |
| --- | --- | --- | --- |
| Private | Caveated / not release-green | Latest workflow `26857597752` shows v2 setup/Stop/saveCandidate/final whole-utterance decode work, but the 61-word result is now classified `INVALID_PROOF_EARLY_STOP`: the harness stopped the 34.5s fixture before full completion. v4 improved from setup init-failed to ready/recording and receives non-silent audio, but every v4 inference fails with `invalid data location: undefined for input "a"`. | Rerun v2 on `0e4be547` or later to judge parity. Treat v4 as backend/config/runtime failure, not setup or mic failure. |
| Cloud | Caveated / closest | Larger credentialed h1 subset on current code is valid: baseline 97.78% accuracy / 90% filler recall; keyterms 95% / 100%. Baseline is the safest current Cloud candidate. Keyterms improves filler recall but still hurts h1_6 accuracy, so it is not shippable as default. Long-speech/app-tail proof remains open. | Launch/position Cloud baseline as quality path if app-tail proof passes. DEV/PRODUCT: change/narrow/disable keyterms before defaulting it. TEST: run Cloud app journey/tail proof with `__CLOUD_STT_TIMELINE__`. |
| Native | Backlog / failed current proof | Latest human real-mic rerun improved save selection: authoritative `saveCandidate` selected 53 words from `service_result`, session saved, history visible, and no full duplicate. It still failed product readiness: user observed jumpy interim text/trust-state behavior, raw first result arrived ~38.2s after audio start but that number is inflated by human setup silence, filler recall remained 66.67%, readability/punctuation/casing failed, and detail transcript extraction was empty in the artifact. | Fix stable Native trust-state labeling from mic-on through final acceptance, fix/activate Native readability strategy, verify detail transcript extraction, then rerun human Chrome mic proof. |

Clarifications:

```text
Private browser evidence collected on 2026-06-03 covers both v2 and v4.
v2 reaches saveCandidate and final whole-utterance decode; the last 61-word
result is superseded as an early-stop artifact and must be rerun. v4 reaches
ready/recording and receives non-silent audio but fails every decode with
`invalid data location: undefined for input "a"`.

Cloud "invalid" means no usable provider transcript session, not bad WER.
Those rows are excluded from quality averages and block green classification.
Latest local Cloud A/B code treats `keyterms_prompt` as a JSON-array-string.
The cheap credentialed subset confirms baseline/keyterms are both valid on
`h1_1,h1_6,h1_8`. Keyterms improves filler recall but currently lowers h1_6
accuracy, so it is not selected yet.

Native human real-mic proof is now collected and failed twice. The current
controlling run no longer points to `Listening...` as the authoritative save
candidate, but it still fails live-text timing, filler, readability, and detail
proof. Injected mic/fake/say routes remain invalid release proof for Native Web
Speech.
```

### Short Corpus: Harvard h1_1-h1_10

| Candidate | Evidence | Accuracy | Error | Filler recall | False filler insertion | Terminal punctuation | Readability | First progress | Finalization wait | Save/history/detail | Release status |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |
| Private v2 | MEASURED_NODE full-WAV | 93.89% | 6.11% | 90.9% (10/11) | 0 | 9/10 rows | 9/10 rows | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | Not browser-green |
| Private v4 | MEASURED_NODE full-WAV | 96.39% | 3.61% | 90.9% (10/11) | 0 | 10/10 rows | 10/10 rows | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | Best Private candidate; needs browser proof |
| Native | Human real-mic proof | script-level exact WER not scored | n/a | 66.67% (2/3) | 0 | pass | fail | first interim 32.1s after audio start | stop-to-onend 167 ms, but save/detail failed | fail: selected `Listening...`, detail empty | FAIL / not release-green |
| Cloud | MEASURED_PRIOR_APP | 91.53% | 8.47% | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | prior proof exists but current trace proof needed | Strongest path, not closed |

### Private Browser Proof: Current Guard Rows, 2026-06-02

Route:

```text
page getUserMedia override with per-fixture WAV injected at mic request time
```

Why this route was used:

```text
macOS afplay failed in this environment with AudioQueueStart failed (-66680).
Chrome launch-time fake audio is invalid for Native and timing-ambiguous for
Private. The injected route starts the selected WAV only when the app requests
mic input, preserving the Private browser/app path while avoiding physical audio.
```

| Fixture | Accuracy | Error | Filler recall | First progress | First draft | Finalization wait | Readability | Save/history/detail |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `h1_1` | 88.89% | 11.11% | 50% | 1341 ms | 3044 ms | 1927 ms | pass | pass |
| `h1_2` | 100% | 0% | 100% | 1546 ms | 3029 ms | 1817 ms | pass | pass |
| `h1_6` | 87.5% | 12.5% | 100% | 1422 ms | 3036 ms | 1788 ms | fail: capitalization | pass |
| `h1_8` | 100% | 0% | 100% | 1357 ms | 3021 ms | 1851 ms | pass | pass |
| `h1_10` | 100% | 0% | 100% | 1482 ms | 3039 ms | 1869 ms | pass | pass |

Current read:

```text
The prior h1_6 app-worse browser row improved materially in current proof:
37.5% -> 87.5%. h1_2 and h1_8 are now exact. First draft is consistently about
3 seconds. Finalization is under 2 seconds for short guard rows.
```

### Medium Speech: `washington_01` 65.8s

| Candidate | Evidence | Accuracy | Error | RTF | Words emitted | Terminal punctuation | Sentence count | Max run-on words | Duplicate detected | Readability verdict | Release status |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- | --- | --- |
| Private v2 | MEASURED_NODE full-WAV | 98.95% | 1.05% | 0.1652 | 190 | true | 4 | 104 | false | fail | Accuracy strong, punctuation/run-on fails |
| Private v4 | MEASURED_NODE full-WAV | 98.95% | 1.05% | 0.0961 | 192 | true | 4 | 56 | false | fail | Accuracy strong, faster than v2, punctuation/run-on fails |
| Native | Human real-mic proof | script-level exact WER not scored | n/a | n/a | usable words, missed filler/punctuation | true | 2 / expected ~4 | 49 | false | fail | FAIL / not release-green |
| Cloud | Credentialed long-form proof required | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | streaming | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | NOT_CAPTURED_CURRENT_RUN | BLOCKER before Cloud brag path |

### Private Browser Proof: `washington_01`, 2026-06-02

| Candidate | Evidence | Accuracy | Error | First progress | First draft | Finalization wait | Save/history/detail | Readability verdict |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Private v2 app | browser injected-mic | 98.95% | 1.05% | 1598 ms | 3029 ms | 10695 ms | pass | fail: max run-on 104 words |

Artifact:

```text
/private/tmp/speaksharp-private-washington-default-rt-true-injected-20260602.json
```

Current read:

```text
return_timestamps:true resolves the prior long-form completeness concern for
this 65.8s browser proof. The final/detail transcript is accurate and saved.
Remaining blocker is readability/punctuation: 4 sentences are present, but one
sentence-like span is 104 words, above the 45-word release target.
```

Artifact note:

```text
The artifact's selectedForSaveTranscript field is an 80-character preview.
Full text is present in transcript/postStopTranscript/detailTranscript, and
the selected/saved length is 1074.
```

### Cloud Credentialed A/B, 2026-06-02

Older broad artifact:

```text
/private/tmp/assemblyai-ab-26830845676/assemblyai-streaming-ab-proof.json
```

Latest larger targeted artifact:

```text
/private/tmp/speaksharp-cloud-ab-26852918607/assemblyai-streaming-ab-proof.json
```

Latest larger targeted workflow:

```text
https://github.com/relativityE/speaksharp/actions/runs/26852918607
```

Dispatch:

```text
streaming_ab_variants=baseline,keyterms
streaming_ab_fixtures=h1_1,h1_2,h1_6,h1_8,h1_10,washington_01
```

Artifact caveat:

```text
The artifact emitted h1_1,h1_2,h1_6,h1_8,h1_10 only. washington_01 did not
appear in the scored results, so Cloud long-speech/tail proof remains open.
```

| Variant | Before fix | Latest targeted proof | Current read |
| --- | --- | --- | --- |
| baseline | 5/10 valid; 95.56% accuracy / 90% filler recall on valid rows | 5/5 valid; 97.78% accuracy / 90% filler recall | Valid and strongest current default; misses `um` in h1_1. |
| keyterms | 0/10 valid; request/session invalid | 5/5 valid; 95% accuracy / 100% filler recall | Request/session fixed; product-quality tradeoff remains. |
| prompt | 0/10 valid in older run; later partial rows used `u3-rt-pro` | not run in latest cheap proof | Hold pending cost approval. |
| prompt_keyterms | 0/10 valid in older run | not run in latest cheap proof | Hold pending cost approval and keyterms quality decision. |

Latest row detail:

| Variant | Fixture | Accuracy | Filler recall | Current read |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| baseline | h1_1 | 88.89% | 50% | Misses `um`. |
| baseline | h1_2 | 100% | 100% | Exact. |
| baseline | h1_6 | 100% | 100% | Best h1_6 result. |
| baseline | h1_8 | 100% | 100% | Exact. |
| baseline | h1_10 | 100% | 100% | Exact. |
| keyterms | h1_1 | 100% | 100% | Recovers `um`. |
| keyterms | h1_2 | 100% | 100% | Exact; required 2 concurrency retries. |
| keyterms | h1_6 | 75% | 100% | Accuracy regression versus baseline. |
| keyterms | h1_8 | 100% | 100% | Exact. |
| keyterms | h1_10 | 100% | 100% | Exact. |

Current read:

```text
Cloud A/B request/session validity is closed for the h1 subset. Keyterms is
valid and improves filler recall, but it is not quality-safe yet because it
lowers h1_6 accuracy from 100% to 75%. Baseline remains the safer Cloud
candidate. Cloud long-speech/app-tail proof still needs a separate app run with
`__CLOUD_STT_TIMELINE__`.
```

## Punctuation Quality Metric

Current scoring rule:

| Field | Pass target |
| --- | --- |
| `terminalPunctuationPresent` | final transcript ends with `.`, `?`, or `!` |
| `sentenceCount` | roughly matches expected script sentence count |
| `maxRunOnWords` | no sentence-like span over 45 words; 35 preferred |
| `capitalizationErrors` | no obvious mid-sentence random caps |
| `duplicateSentenceDetected` | false |
| `readabilityVerdict` | pass if punctuation/casing/duplication all pass |

Current finding:

```text
Private v4 is clean on short Harvard readability, but both v2 and v4 fail the
Washington medium-speech readability gate because sentence spans are too long.
This proves punctuation/readability must be measured as a sales-critical metric
instead of treated as polish.
```

## Technical Changes Required To Reach Sales-Quality

| Product need | Technical change | Owner |
| --- | --- | --- |
| Credible transcript readability | Add punctuation/readability scoring to every STT run and artifact | Test/release agent; dev if harness fields missing |
| Native text looks usable | Add approved Native-only final transcript formatter after selected final and before persistence | Product decision + dev |
| Private final text stays usable | Verify Whisper punctuation on short/medium/long scripts; add formatter only if final text remains run-on | Test first; dev only if proven |
| Cloud remains sales path | Verify AssemblyAI baseline punctuation/casing on long scripts; do not ship prompt/keyterms if they break transcripts | Test first |
| Score does not lie | Include transcript confidence/readability/punctuation in score confidence gating | Dev + test |
| Analytics tells the truth | Make Transcript Quality prominent enough to separate STT capture issues from speaking issues | Dev/design + test |

## Next Measurement Work

Required next table:

| Candidate | Must run next |
| --- | --- |
| Private v2 | Browser app path on h1_6 and `washington_01` with timing/readability |
| Private v4 | Browser app path on Harvard h1_1-h1_10 and `washington_01`; compare to v2 and v4 Node ceiling |
| Native | Human real-mic scripts with timing, punctuation/readability, no duplicate, save/history/detail |
| Cloud | Credentialed baseline long-form proof with filler recall, punctuation/readability, tail preservation, save/history/detail |

Green classification requires:

```text
Accuracy at or above drop-in/customer baseline.
Filler recall acceptable and false filler insertion near zero.
Punctuation/readability pass.
First progress and finalization timing within budget.
Transcript confidence high enough for scoring.
Save/history/detail pass.
```

### Native Human Real-Mic Proof: 2026-06-02

| Candidate | Evidence | Filler recall | Terminal punctuation | Sentence count | Max run-on words | Capitalization errors | Duplicate | Save/history/detail | Release status |
| --- | --- | ---: | --- | ---: | ---: | --- | --- | --- | --- |
| Native | human real Chrome mic | 66.67% (2/3) | true | 2 / expected ~4 | 49 | Starts Now, Next Step | pass | fail: selected `Listening...`, saved=false, detail empty | FAIL / not release-green |

Artifact:

```text
/private/tmp/speaksharp-native-human-proof-20260602.json
```

Current read:

```text
Chrome produced usable words and no full-speech duplication, but Native remains blocked by readability and stop/save selection. visibleAtStop/postStopFinal contained the transcript; postStopTranscript and selectedForSave became "Listening..." and saved marker was false. Timing fields were corrected to the stopped session boundary because the artifact also contains a second auto-start after stop.
```

### Native Human Real-Mic Rerun: 2026-06-03T05:41Z

| Candidate | Evidence | Accuracy | Filler recall | Terminal punctuation | Sentence count | Max run-on words | Capitalization errors | Duplicate | Save/history/detail | First result | Release status |
| --- | --- | ---: | ---: | --- | ---: | ---: | --- | --- | --- | ---: | --- |
| Native | human real Chrome mic | 83.93% | 66.67% (2/3) | true | 1 / expected ~4 | 53 | Starts Now | pass | saveCandidate/session/history pass; detail transcript empty in artifact | raw 38221.6 ms after audio start; inflated by setup silence | FAIL / not release-green |

Artifact:

```text
/private/tmp/speaksharp-native-human-proof-20260603T054003Z.json
```

Authoritative selected transcript:

```text
Native Chrome microphone proof Starts Now I want to make one simple point before we move on basically the puppy like chewed up new shoes and that changed the whole plane the whole plan the main takeaway is that we should pause before the next idea give one concrete example and end with.
```

Current read:

```text
The old `Listening...` selectedForSave failure is superseded for this run:
`saveCandidate.saveCandidateReason=service_result`, selected length 287, final
word count 53, and session saved. The raw mic-on to first-result timing is
inflated because the user was finding the script after starting the mic. Native
still remains not release-green because the user observed jumpy interim text and
the trust-state disclaimer was not stable/perceptible enough, `um` is missed,
sentence boundaries/casing are bad, and detail transcript proof is empty.
```

## Current-Head Private Browser Proof: 2026-06-02T21:45-05:00

Controlling artifact:

```text
GitHub run: 26858116484
Commit under test: e8477232740d05d1232db041435cbb675519ef98
Artifact: /private/tmp/speaksharp-private-browser-26858116484/
```

This proof ran after the benchmark harness was corrected to wait for the full
34.5s Harvard benchmark fixture before clicking Stop.

| Candidate | Setup | Runtime/proof phase | Accuracy | Filler recall | Timing | Journey | Release read |
| --- | --- | --- | ---: | ---: | --- | --- | --- |
| Private v2 | pass | accuracy | 72.41% | 90% | final decode `7969.7ms`; final input `36.587s` | saved/persisted | Not parity-green; real full-duration accuracy blocker. |
| Private v4 | pass to recording | runtime | n/a | n/a | audio reaches inference 28 times | no save candidate | Runtime/no-output failure; not an accuracy result. |

Private v2 selected transcript:

```text
The tail smell of old beer, like lingers. Basically, a dash of pepper spoils beef to... Well, the one knife was far short on perfect. You know, the marks was thrown beside the parked truck. Literally, the twister left no trace on the town. A, like, toed wild tail to frighten him. We, um, find joy in the simplest things. The puppet, like, tune up the new shoes. A smooth road you know, make striving clement, basically, the cool.
```

Current classification:

```text
Private v2 is no longer blocked by setup, DOM extraction, or early-stop proof
contamination. It now fails the accuracy/parity gate on a full-duration browser
proof.

Private v4 is no longer blocked first by setup/mic. It receives non-silent audio
and repeatedly starts inference, but emits no usable transcript/saveCandidate.
```

## Private Exact-Buffer Replay: 2026-06-03T03:25Z

Controlling artifacts:

```text
GitHub run: 26858549345
Commit under test: 89006629
Browser artifact: /private/tmp/speaksharp-private-browser-26858549345/test-results/live/live-benchmark-cpu.live-measure-TransformersJS-CPU--live-stt-chromium/private-cpu-private-benchmark-evidence.json
Extracted WAV: /private/tmp/private-v2-browser-final-buffer-26858549345.wav
```

| Candidate / Input | Decoder | Timing config | Accuracy | Error | Words | Release implication |
| --- | --- | --- | ---: | ---: | ---: | --- |
| v2 source fixture full-WAV | Node v2 / `Xenova/whisper-tiny.en` | `return_timestamps:true` | 94.25% | 5.75% | 87 | Model/source ceiling is acceptable. |
| v2 source fixture full-WAV | Node v2 / `Xenova/whisper-tiny.en` | `return_timestamps:false` | 37.93% | 62.07% | 35 | Invalid for >30s; proves timestamps must stay on. |
| v2 exact browser final WAV | Node v2 / `Xenova/whisper-tiny.en` | `return_timestamps:true` | 62.07% | 37.93% | 79 | Bad result follows the app/browser captured buffer. |
| v2 exact browser final WAV | Node v2 / `Xenova/whisper-tiny.en` | `return_timestamps:false` | 44.83% | 55.17% | 77 | Still bad; timestamp flag is not the root fix. |

Private v2 updated boundary:

```text
The exact audio buffer captured by the browser app is already degraded enough
that offline Node/drop-in replay reproduces the bad transcript. The same decoder
and options decode the original source fixture at 94.25%.
```

Effect of fixing v2:

```text
Fixing v2 means validating/fixing the browser input audio path: fake-audio route,
WebRTC/DSP constraints, resampling, clipping/gain, or the app's final buffer
assembly. If fixed, v2 can become a credible caveated local baseline. If not,
v2 remains secondary and cannot be claimed parity against its own drop-in/source
ceiling.
```

Private v4 updated boundary:

```text
v4 is not currently an accuracy comparison. The browser worker reaches recording
and starts inference, but each inference returns:

invalid data location: undefined for input "a"
```

Effect of fixing v4:

```text
Fixing v4 means making the browser backend/runtime emit text/saveCandidate. If
fixed, v4 is still the strongest Private candidate based on Node/full-WAV
evidence. If not fixed, v4 must be hidden/disabled for release regardless of its
promising Node numbers.
```

## Private v2 Human Mic Proof: 2026-06-03T06:05Z

Artifact:

```text
/private/tmp/speaksharp-private-v2-human-proof-2026-06-03T060231313Z.json
```

Classification:

```text
CAVEATED_POST_SETUP_PROOF
```

This is not valid first-time setup/download proof because the harness clicked
the Private setup/download button automatically. The run is still useful as a
post-setup Private v2 human real-mic quality signal.

| Candidate | Evidence | Accuracy | WER | Filler recall | False fillers | Sentence count | Max run-on | Save/history/detail | Release implication |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Private v2 | human real mic, post-setup caveat | 91.07% | 8.93% | 66.67% | 0 | 2 / expected ~4 | 49 | saved true; history/detail failed in artifact | Better than Native human on accuracy, still caveated. |
| Native Chrome | human real mic | 83.93% | 16.07% | 66.67% | 0 | 1 / expected ~4 | 53 | save/history pass; detail empty | Not release-green; readability/punctuation failed. |

Private selected transcript:

```text
Private local microphone proof starts now. I want to make one simple point before we move on Basically the puppy like chewed up the new shoes that changed the whole plane plan The main ticker ways that we should pause before the next idea give one concrete example and end with a clear next step.
```

New live-final assembly issue:

```text
User observed the visible transcript ending as only: "With a clear next step."
The JSON saveCandidate retained the full transcript, so this artifact does not
prove saved-data loss. It does prove a user-trust failure: sentence-sized final
updates were visible as replacements instead of accumulated final text.
```

Fix status:

```text
Implemented in TranscriptionService and covered by focused unit regression:
sentence-sized final updates now accumulate; full-transcript provider updates
can still replace when they truly contain the previous final as a prefix.
Needs browser proof.
```

## Latest Human Private v2 UX Regression: 2026-06-03T16:55Z

Artifact:

```text
/private/tmp/speaksharp-private-human-41dc1997-rerun.json
```

| STT | Setup | Proof result | Blocking issue | Owner |
| --- | --- | --- | --- | --- |
| Private v2 human mic | setup consent observed: user saw/clicked `Set Up`; no auto-download proof violation in this run | final selected transcript strong: 94.64% accuracy, 5.36% WER, 100% filler recall, readability pass | **live visible text before Stop showed only the latest/tail sentence** (`Confirmed the score explains. transcript quality.`) instead of cumulative transcript text | dev fix, then test rerun |

Release impact:

```text
Private v2 cannot be marked user-trust green until live recording shows cumulative transcript progress.
The final saved text is good, but the in-progress experience makes longer speeches feel like earlier
sentences are being removed.
```
