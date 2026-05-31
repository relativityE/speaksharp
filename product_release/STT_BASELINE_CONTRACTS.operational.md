**Owner:** [unassigned]
**Last Reviewed:** 2026-05-31
**Version:** v0.6.19-rc0
**Last Updated:** 2026-05-31

# STT Baseline Contracts

This document defines the non-negotiable speech-to-text baseline for SpeakSharp.

The repair order is:

1. Reference/vendor behavior first.
2. SpeakSharp transcript lifecycle second.
3. SpeakSharp analytics, scoring, copy, and product policy last.

No STT mode is acceptable because its internal engine logs text. It is acceptable only when useful text becomes visible quickly, survives stop, saves correctly, and feeds history/analytics from the same selected transcript.

## Test Environment For Latest Corpus Evidence

| Field | Value |
|---|---|
| Evidence date | 2026-05-31 |
| Machine | macOS 26.3, Darwin 25.3.0, arm64 |
| Node / pnpm | Node v22.12.0, pnpm 10.29.1 |
| Repo SHA at test time | `2dc0626e8945f817bb44bd4c8c9d02f0832b2242` |
| Worktree state | Dirty/uncommitted local changes present |
| App URL | `http://127.0.0.1:4173` |
| Corpus | Harvard fixtures `h1_1` through `h1_10` |
| App audio route | Real browser `getUserMedia` with macOS `afplay` through physical speaker/mic path |
| Native browser | Google Chrome via Playwright channel `chrome`; sample UA showed Chrome `148.0.0.0` |

## What "Drop-In" Means In This Document

| STT | Drop-In Comparator Used | Meaning | Limitation |
|---|---|---|---|
| Native | Standalone Chrome Web Speech harness | Minimal browser page using Chrome `SpeechRecognition` directly with `continuous=true`, `interimResults=true`, `maxAlternatives=1`; same Harvard WAVs played through `afplay` into the real mic/browser capture path. | This is not a vendor-certified accuracy target. `tests/STT_BENCHMARKS.json` has no approved numeric Native accuracy target. |
| Cloud | AssemblyAI benchmark workflow | Direct AssemblyAI transcription benchmark against the same Harvard WAV corpus, GitHub run `26716229264`. | This is API/provider benchmark evidence, not the same browser streaming path as the SpeakSharp app. |
| Private | Transformers.js Whisper Node CPU | Direct `@xenova/transformers` `pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en')` over the same Harvard WAV files. | This is Node CPU control evidence, not browser/WebGPU app execution. |
| Private browser drop-in | Browser Transformers.js engine-only harness | `frontend/private-dropin.html` plus `scripts/private-browser-dropin-proof.mts`; uses browser `getUserMedia`, macOS `afplay`, and `TransformersJSEngine.transcribe()` without Session page, controller, store, save, analytics, scoring, or Private gating. | Same local audio route and browser runtime as the app without SpeakSharp orchestration; this is the hard Private app parity comparator. |

## Stored Benchmark Targets

| STT | Stored Target In `tests/STT_BENCHMARKS.json` |
|---|---:|
| Native | No approved numeric target; Web Speech is marked browser/server/audio-route dependent. |
| Cloud | 91.86% expected accuracy for AssemblyAI streaming/comparable benchmark; 95% remains a stretch target for future batch/offline proof. |
| Private CPU | 93.89% expected accuracy |
| Private WebGPU | 93.00% expected accuracy |
| Private v4 | 88.89% expected accuracy |

## Published Performance Objectives

Goal: SpeakSharp app STT performance must not degrade the engine relative to a simple reference/drop-in path, and should be directionally consistent with credible published/vendor performance where the benchmark conditions are comparable.

Published benchmarks are sanity references unless the corpus, audio route, model, streaming mode, normalization, and scoring method are comparable. Drop-in parity and product journey proof are the hard release gates because customers only experience the SpeakSharp app.

WER is lower-is-better. Accuracy is `100% - WER`.

| STT | Credible External Source | Published / Reference Performance | SpeakSharp Objective | Current Evidence | Current Status |
|---|---|---:|---|---:|---|
| Native / Chrome Web Speech | MDN documents `SpeechRecognition.interimResults`; no credible official Google/MDN WER target found. Source: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/interimResults | No published WER target | Hard gate: meet or materially approximate same-machine standalone Chrome Web Speech drop-in harness on the same corpus/audio route. | Physical route app WER 1.4975 vs drop-in WER 0.2656 before latest replaceable-interim fix. Fresh Chrome fake-audio-capture reruns were invalid for WER in both app and standalone because Chrome produced empty or unrelated speech-like text. | Not release-green. Lifecycle/journey improved, but Native quality still needs a valid clean-input proof route before parity can be claimed. |
| Cloud / AssemblyAI Universal-3 Pro | AssemblyAI benchmark page, updated February 2026. Source: https://www.assemblyai.com/benchmarks | Streaming/comparable English table average used for release target: 8.14% WER / 91.86% accuracy. Pre-recorded/batch numbers remain stretch-only. | Hard gate: app follows AssemblyAI v3 streaming sequence and journey proof passes. Sanity target: directionally match the published streaming benchmark. | App WER 0.0847 / 91.53%; stored target now 91.86%. Added direct streaming A/B proof script: `pnpm benchmark:cloud:streaming-ab`. | Effectively near target; remaining work is running the A/B script with `ASSEMBLYAI_API_KEY` and a fresh app journey proof, not broad Cloud rebuild. |
| Private / Whisper tiny.en | Hugging Face `openai/whisper-tiny.en` model card. Source: https://huggingface.co/openai/whisper-tiny.en | Mean WER 12.81; LibriSpeech clean WER 5.66; LibriSpeech other WER 15.45. | Hard gate: saved/detail transcript should not materially underperform a same-model browser drop-in control on the same audio route. Node CPU is advisory only. Live provisional text is measured separately because Whisper-style browser ASR is chunk inference, not true word streaming. | Browser drop-in WER 0.0725 / 92.75% accuracy. Latest SpeakSharp Private saved/detail final transcript WER 0.0460 / 95.40% accuracy on Harvard 10, while live provisional WER was 0.2644 / 73.56% accuracy. Artifact: `/private/tmp/speaksharp-private-harvard10-after-live-assembly-4174.json`. | Saved/detail parity now passes on Harvard 10 and journey passes 10/10. Live provisional text is no longer blank until stop, but remains rough and must be documented as provisional. h1_8 remains the row-level quality gap to review. |

### Objective Rules

| Rule | Meaning |
|---|---|
| Published targets are sanity references unless comparable | Published numbers can guide expectations, but are hard gates only when corpus, audio route, model, mode, normalization, and scoring are comparable. |
| Drop-in parity is required | The app must not be materially worse than a minimal same-engine drop-in comparator using the same corpus/audio route. |
| Native uses drop-in parity | Because no credible official Chrome Web Speech WER target is available, Native release quality is judged against the standalone Chrome Web Speech drop-in harness. |
| Journey proof is separate | Accuracy alone is insufficient. Text must appear live, survive stop, save, and appear in history/detail. |
| Source claims must be cited | Any numeric target in this document must cite the vendor/model/benchmark source or be labeled as an internal/drop-in target. |

## Shared Cross-Engine Contract

| Boundary | Required Behavior |
|---|---|
| Engine emits text | Engine-specific transcript events must be captured with timestamp and mode. |
| Service receives text | Service must normalize only enough to remove unsafe metadata/noise; it must not collapse partials into stale finals. |
| Controller updates lifecycle | Controller owns the canonical live transcript state: committed final, current partial, best meaningful partial, visible transcript, frozen-at-stop transcript, selected-for-save transcript. |
| Store updates | Store reflects controller state for UI and must not clear visible transcript during stop/finalization. |
| UI visible before stop | If useful text exists, the user must see it quickly enough to feel live. |
| Stop | Stop freezes the latest visible transcript before destructive teardown. |
| Save | Save uses the selected transcript from the same lifecycle chain the user saw. |
| History/analytics/PDF | Downstream outputs must use the saved selected transcript, not an alternate raw buffer. |

## Baseline Matrix

| STT | Reference Behavior | SpeakSharp Current Divergence | Required Fix | Proof Test |
|---|---|---|---|---|
| Native / Chrome Web Speech | `continuous = true`, `interimResults = true`, `maxAlternatives = 1`; on every `onresult`, render `committedFinal + currentInterim`; interim is a replaceable window; final appends once. | Historical full-corpus app runs showed looped repeated garbage in `h1_4`, `h1_6`, and `h1_10`. Focused trace after harness/journey fixes proved text now survives stop/history/detail, but Native quality still lagged drop-in. | Completed deterministic repair: removed residual app-side rolling interim accumulation so Chrome interim is treated as replaceable hypothesis, not an append buffer. | `NativeBrowser.test.ts` passed after the latest fix. Focused worst-row rerun after latest fix: `/private/tmp/speaksharp-native-worst-after-replaceable-interim.json`; no repeated loop reproduced, all three rows journey-passed. Full-corpus rerun still required. |
| Cloud / AssemblyAI Universal-3 Pro | WebSocket opens; `Begin` marks provider-ready; every `Turn.transcript` is the current turn text; `end_of_turn=false` emits partial; `end_of_turn=true` commits final; after `Terminate`, keep message handling alive until `Termination`, socket close, or timeout. | Parser/termination risks were repaired. Remaining product-specific gap is filler/disfluency preservation: keyterms alone may not overcome provider formatting that removes fillers. | Completed deterministic repair: live partials prefer `Turn.transcript` with `words[]` fallback, stop keeps message handling alive after `Terminate`, and the connection now sends a prompt instructing verbatim filler/repetition/disfluency preservation with keyterms. Added `scripts/assemblyai-streaming-ab-proof.mts` for baseline vs keyterms vs prompt vs prompt+keyterms proof. | `AssemblyAICloudProvider.test.ts` covers prompt + keyterms and Turn parsing. `CloudAssemblyAI.test.ts` covers post-Terminate final tail handling and prompt propagation. `pnpm benchmark:cloud:streaming-ab` dry-runs to the expected missing-key gate; real A/B corpus evidence still requires `ASSEMBLYAI_API_KEY`. |
| Private / Transformers.js Whisper | Whisper-style browser ASR is chunk inference, not true token streaming. Baseline live UX is rolling chunks: show coherent provisional chunk text quickly, revise/stabilize later, and perform stricter final/save selection at stop. | Earlier app reruns proved lifecycle/journey, but traces showed two deterministic quality defects: low-energy post-transcript tails were cleared before stop, and first-final local-agreement could save a shorter/worse candidate than the useful provisional/current inference. | Completed deterministic repair: display gate is lighter than final/save gate; coherent provisional chunks emit to UI; stop waits for in-flight inference; low-energy post-transcript tail audio is deferred instead of wiped; first-final selection prefers a longer coherent current/visible candidate over a shortened stable-prefix final. Added browser drop-in harness to isolate browser/audio-route effects from SpeakSharp app orchestration. | `PrivateWhisper.test.ts` now covers gate split, stop-during-inference tail processing, low-energy tail deferral, and first-final candidate replacement. Browser drop-in artifact: `/private/tmp/speaksharp-private-browser-dropin-harvard10.json` at WER 0.0725 / 92.75% accuracy. Clean first-four app rerun artifact: `/private/tmp/speaksharp-private-harvard-first4-rerun-after-tail-candidate-fixes.json`; WER 0.1153 / 88.47%, 4/4 save/history/detail. Full clean app corpus rerun is still required. |

## Gate Status Language

| Statement | Allowed Only When |
|---|---|
| Native lifecycle passed | Text reached UI, stop froze transcript, save/history succeeded. |
| Native release-ready | Native also passes live smoothness and saved transcript quality gates. |
| Cloud release-ready | AssemblyAI live turns are visible, final turns commit, and post-terminate tail is preserved. |
| Private release-ready | Coherent provisional chunks appear quickly, final/save guards prevent junk, and stop captures in-flight work. |

## Evidence Table Required For Each STT

Each STT proof must fill this table. Historical full-corpus artifacts listed below did **not** fully capture `Stop Selected Source` as a structured field, and Cloud app artifacts did **not** include row-level structured engine/service/store trace arrays. Those historical cells remain marked `not captured`.

The corpus runner now collects `window.__SS_TRANSCRIPT_TRACE__` and derives:

- `traceStageCounts`
- `traceBoundaryStatus`
- `firstBrokenBoundary`
- `stopSelectedSource`
- `stopSelectedTranscriptLength`
- `visibleTranscriptAtStopLength`
- `savePayloadTranscriptLength`
- `savedTranscriptLength`
- `analyticsTranscriptEvidence`
- `detailTranscriptEvidence`, when a detail button is visible

| Mode | Engine Text? | Service Emit? | Controller Lifecycle Update? | Store Update? | UI Visible Before Stop? | Stop Selected Source | Saved? | First Broken Boundary |
|---|---|---|---|---|---|---|---|---|
| Native | ✅ Focused rows had `engine:emit` | ✅ Focused rows had `service:receive` | ✅ Focused rows had `controller:receive` | ✅ Focused rows had `store:update` | ✅ Focused rows had first text observed | ✅ `service_result` in focused proof | ✅ Focused rows saved/history/detail passed | Historical full-corpus rows exposed quality failure; latest focused worst-row rerun removed loops but full-corpus rerun is required. |
| Cloud | Not captured as full row-level structured trace in historical corpus run | Not captured as full row-level structured trace in historical corpus run | ✅ 10/10 historical rows had start/stop phases | Not captured as row-level structured trace | ✅ 10/10 rows had first text observed | Not captured as explicit field | ✅ 10/10 persisted historically | Historical history/detail 0/10 was caused by corpus harness navigation/reload behavior, not proven product save failure. Fresh Cloud prompt A/B + journey proof required. |
| Private | ✅ 10/10 rows had `model_inference_result` historically | ✅ 10/10 rows had `transcript_callback_emit` or provisional emit historically | ✅ 10/10 rows had start/stop phases | ✅ Reflected in phase transcript snapshots; shared `store:update` field now exists for new runs | ✅ 10/10 rows had first text observed | Not captured in historical corpus; now captured by runner | ✅ 10/10 persisted historically | Historical history/detail 0/10 was a harness proof gap. Browser drop-in comparator and fresh app-vs-drop-in corpus evidence required. |

### Trace Field Validation

After the runner update, a one-fixture Native proof verified the required trace fields are present in the artifact. This is a harness-field validation only; it is **not** a Native quality pass.

| Field | Value |
|---|---|
| Artifact | `/private/tmp/speaksharp-native-worst-after-replaceable-interim.json` |
| Mode / fixtures | Native / `h1_4`, `h1_6`, `h1_10` |
| Transcripts | `h1_4`: `You know the box was thrown beside the`; `h1_6`: `Day like told Wild`; `h1_10`: `Basically the quick brown fox when you're` |
| WER / accuracy | `h1_4`: 0.2000 / 80.00%; `h1_6`: 0.6250 / 37.50%; `h1_10`: 0.5000 / 50.00% |
| First visible text | 1821ms to 2334ms across the three rows |
| Persisted / history / detail | true / true / true for all three focused rows |
| Boundary status | Engine, service, controller, store, UI, stop, and save boundaries all captured |
| First broken lifecycle boundary | none captured |
| Stop selected source | `service_result` |
| Saved transcript length | populated for all three focused rows |
| Read | Loops were not reproduced after the latest replaceable-interim fix; quality/recall still requires full-corpus rerun against the drop-in baseline. |

## Deterministic Evidence Collected

Last focused suite run on 2026-05-31:

```text
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false \
  frontend/src/services/transcription/modes/__tests__/NativeBrowser.test.ts \
  frontend/src/services/transcription/modes/__tests__/nativeBrowserStrategies.test.ts \
  frontend/src/services/transcription/modes/__tests__/PrivateWhisper.test.ts \
  frontend/src/services/transcription/modes/__tests__/CloudAssemblyAI.test.ts \
  frontend/src/services/transcription/providers/cloud/__tests__/AssemblyAICloudProvider.test.ts \
  frontend/src/services/transcription/__tests__/TranscriptionService.test.ts \
  frontend/src/services/__tests__/SpeechRuntimeController.test.ts \
  frontend/src/components/session/__tests__/LiveTranscriptPanel.component.test.tsx
```

Earlier broad focused result: **8 test files passed, 133 tests passed.**

Latest focused Native/STT result after the Native interim-window change:

```text
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false \
  frontend/src/services/transcription/modes/__tests__/NativeBrowser.test.ts \
  frontend/src/services/transcription/modes/__tests__/nativeBrowserStrategies.test.ts \
  frontend/src/services/transcription/__tests__/TranscriptionService.test.ts \
  frontend/src/services/__tests__/SpeechRuntimeController.test.ts \
  frontend/src/components/session/__tests__/LiveTranscriptPanel.component.test.tsx
```

Result: **5 test files passed, 94 tests passed.**

Additional local gates on 2026-05-31:

| Gate | Result | Notes |
|---|---:|---|
| `pnpm quality` | ✅ Pass | Lint, TypeScript, and eslint-disable guard passed. |
| `pnpm build` | ✅ Pass | Production build completed. Existing model/runtime bundle size and ONNX eval warnings remain advisory. |
| `pnpm ci:unit` | ✅ Pass | 135 test files passed; 975 tests passed; 1 todo. |

Fixture/live-style corpus evidence on 2026-05-31:

These single-fixture rows are retained for history only. The 10-fixture Harvard corpus section below is the current comparison evidence.

| Mode | Artifact | Result |
|---|---|---|
| Native | `/private/tmp/speaksharp-native-app-fake-after-baseline.json` | Historical single-fixture evidence only; superseded by full-corpus Native rows below. |
| Private | `/private/tmp/speaksharp-private-corpus-setupfix-after-baseline.json` | Historical single-fixture evidence only; superseded by full-corpus Private rows below. |
| Cloud | `/private/tmp/speaksharp-cloud-corpus-ghpro-traced-text.json` | Historical single-fixture evidence only; superseded by full-corpus Cloud rows below. |

## Full Harvard Corpus Baseline Comparison

This section supersedes single-fixture optimism. The comparison uses the same 10 Harvard WAV fixtures (`h1_1` through `h1_10`) wherever available.

| Engine | Path | Artifact / Evidence | Browser Console Evidence | Avg WER | Avg Accuracy | Gate Result | Factual Read |
|---|---|---|---:|---:|---:|---|---|
| Native | Drop-in Chrome Web Speech harness, physical speaker/mic route | `/private/tmp/speaksharp-native-standalone-harvard10-rerun/*.json` | ✅ Per-fixture browser logs in each JSON | 0.2656 | 73.44% | No stored target | Drop-in rows include blank `h1_1`, partial `h1_3`, and capitalization changes such as `Road` / `Pleasant`. This remains the latest usable same-machine comparator, but the route is still physically exposed to room audio. |
| Native | SpeakSharp app | `/private/tmp/speaksharp-native-harvard10-app-rerun.json` | ✅ 2169 console events, 0 page errors, 48 failed requests | 2.8117 | -181.17% | No stored target | App WER was higher than drop-in WER on 5/10 rows. |
| Native | SpeakSharp app after interim-window fix | `/private/tmp/speaksharp-native-harvard10-app-after-interim-window-fix.json` | ✅ 2058 console events, 0 page errors, 56 failed requests | 1.4975 | -49.75% | No stored target | App WER improved from 2.8117 to 1.4975 after the interim-window fix; app WER remains higher than drop-in WER. |
| Native | SpeakSharp app after replaceable-interim fix, full corpus rerun | `/private/tmp/speaksharp-native-harvard10-app-after-replaceable-interim-full.json` | ✅ Trace/journey evidence captured | invalid for WER | invalid for WER | Input isolation failed | 10/10 save/history/detail passed, but the recognizer captured unrelated speech-like text across the run. This artifact is evidence that the runner/audio environment was contaminated, not a valid Native WER parity measurement. |
| Native | SpeakSharp app after replaceable-interim fix, Chrome fake-audio-capture route | `/private/tmp/speaksharp-native-isolated-harvard10-after-fixes.json` | ✅ Per-row JSON artifacts and browser console traces captured | invalid for WER; raw avg WER 1.325 on 3 unflagged rows | invalid for WER; raw avg accuracy -32.50% on 3 unflagged rows | Gate failed | 9/10 journey passed, but 7/10 rows were flagged input-contaminated/unrelated by truth-word recall. Example outputs included CNN/political/news-like text instead of Harvard fixtures. This rejects Chrome fake-audio capture as a valid app Native WER proof route. |
| Native | Standalone Chrome Web Speech drop-in, Chrome fake-audio-capture route | `/private/tmp/speaksharp-native-standalone-isolated-harvard10-after-fixes.json` | ✅ Per-row JSON artifacts and browser console traces captured | invalid for WER; raw avg WER 1.1375 | invalid for WER; raw avg accuracy -13.75% | Gate failed | The standalone comparator also failed under Chrome fake-audio capture: most rows were empty and some rows produced unrelated speech-like text (`soccer ball...`, `stop Carissa...`). This means fake-audio capture is not a reliable Chrome Web Speech WER route here. |
| Cloud | AssemblyAI drop-in/API benchmark | GitHub run `26716229264`, AssemblyAI Ceiling Benchmark | N/A API benchmark, not browser | 0.1044 | 89.56% | Below streaming target on this corpus | API benchmark is provider evidence, not browser streaming app evidence. |
| Cloud | SpeakSharp app | `/private/tmp/speaksharp-cloud-harvard10-app.json` | ✅ 10295 console events, 0 page errors, 32 failed requests | 0.0847 | 91.53% | Near streaming target 91.86%; gap 0.33pp | App WER was lower than API benchmark WER on this run. Historical history/detail 0/10 was a harness proof gap; fresh journey proof still required. |
| Private | Transformers.js `whisper-tiny.en` Node CPU drop-in | `/private/tmp/speaksharp-private-dropin-harvard10.json` | N/A Node CPU benchmark, not browser | 0.0611 | 93.89% | Matches 93.89% CPU target | Fresh no-write control completed locally. |
| Private | Browser Transformers.js engine-only drop-in | `/private/tmp/speaksharp-private-browser-dropin-harvard10.json` | ✅ Per-row browser console output from `PRIVATE_BROWSER_DROPIN_ROW` | 0.0725 | 92.75% | Hard Private parity comparator | Same browser/audio route as app without Session/controller/store/save/gating. |
| Private | SpeakSharp app after whole-utterance finalization and live provisional assembly | `/private/tmp/speaksharp-private-harvard10-after-live-assembly-4174.json` | ✅ Trace/lifecycle evidence captured; save/history/detail visible 10/10 | live provisional: 0.2644; saved/detail final: 0.0460 | live provisional: 73.56%; saved/detail final: 95.40% | Saved/detail final passes browser drop-in parity; live is provisional only | Rolling chunks now emit visible text before stop. Stop-time whole-utterance decode is the saved/detail authority and beat the browser drop-in aggregate on this corpus. h1_8 saved final still trails drop-in row-level WER (0.25 vs 0.125). |
| Private | Browser Transformers.js engine-only drop-in, first four rows | `/private/tmp/speaksharp-private-browser-dropin-harvard10.json` rows `h1_1`-`h1_4` | ✅ Per-row browser console output from `PRIVATE_BROWSER_DROPIN_ROW` | 0.0875 | 91.25% | First-four parity comparator | Drop-in first four transcripts: exact on `h1_1`/`h1_3`, same WER as app on `h1_2`/`h1_4`. |
| Private | SpeakSharp app after low-energy-tail and first-final selection fixes, first four rows | `/private/tmp/speaksharp-private-harvard-first4-rerun-after-tail-candidate-fixes.json` | ✅ Trace/lifecycle evidence captured | 0.1153 | 88.47% | Still trails browser drop-in | 4/4 save/history/detail, no contamination flags. Remaining gap is mainly `h1_1` (`like` heard as `Life`); `h1_2`, `h1_3`, and `h1_4` matched drop-in WER. |
| Private | SpeakSharp app after provisional-display/stop fixes | `/private/tmp/speaksharp-private-harvard10-app-after-private-fixes-fresh.json` | ✅ Trace/lifecycle evidence captured; `h1_10` marked input-contaminated-or-fixture-not-captured | 0.2408 all rows; 0.1454 excluding contaminated row | 75.92% all rows; 85.46% excluding contaminated row | Fails browser drop-in parity | 10/10 rows persisted/history/detail visible. Avg first visible text 4.94s. App still lags drop-in quality and live latency expectations. |
| Private | SpeakSharp app | `/private/tmp/speaksharp-private-harvard10-app.json` | ✅ 74290 console events, 0 page errors, 54 failed requests | 0.0936 | 90.64% | Below 93.89% CPU target | App WER was higher than drop-in WER. All rows persisted; history/detail visibility was 0/10. |

### Native Row-Level Comparison

| Fixture | Drop-in WER | App WER | App Worse? | Drop-in Transcript | SpeakSharp App Transcript |
|---|---:|---:|---|---|---|
| h1_1 | 1.0000 | 0.8889 | No | `` | `The` |
| h1_2 | 0.0000 | 0.0000 | No | `basically a dash of pepper spoils beef stew` | `Basically a dash of pepper spoils beef stew` |
| h1_3 | 0.5556 | 1.7778 | Yes | `well the Swan Dive` | `All these are way all these are what well the Swan Dive all these are what well the Swan diet was Far short of perfect.` |
| h1_4 | 0.1000 | 7.0000 | Yes | `you know the box was thrown beside the park truck` | `You know the box was thrown beside the park truck I want of course and we I want of course and he said I want of course and we said the court I want of course and he said to court but I want of course and we said the court button feels like it's not worth because look at I want of course and we said the court button feels like it's not worth because look so powerful.` |
| h1_5 | 0.0000 | 0.0000 | No | `literally the Twister left no trace of the town` | `Literally the Twister left no trace of the town.` |
| h1_6 | 0.2500 | 11.8750 | Yes | `daylight told wild Tales to frighten him` | `Day Life told wild Tales to frighten him maybe I'm in baby I'm going to get it I don't know something with baby I'm going to get it I don't know something but baby I'm going to get it I don't know something with almost baby I'm going to get it I don't know something but today I baby I'm going to get it I don't know something but today or whatever baby I'm going to get it I don't know something but today I want nothing baby I'm going to get it I don't know something but today or whatever` |
| h1_7 | 0.7500 | 0.7500 | No | `find joy` | `Like 8 or right now find joy in the simplest thing.` |
| h1_8 | 0.0000 | 0.1250 | Yes | `the puppy like chewed up the new shoes` | `The puppy life chewed up the new shoes` |
| h1_9 | 0.0000 | 0.0000 | No | `a smooth Road you know makes driving Pleasant` | `A smooth Road you know makes driving Pleasant` |
| h1_10 | 0.0000 | 5.7000 | Yes | `basically the quick brown fox jumps over the lazy dog` | `I guess cuz the next time TylerBasically the quick brown fox jumps over the lazy dog never pick up kick never pick up a picture of never pick up a picture right never pick up a picture of that never pick up a picture of it. Because he's trying to. Change it. I guess cuz the next time Tyler I guess cuz the next time Tyler` |

### Current Numeric Status From Full Corpus

| Mode | Numeric Status |
|---|---|
| Native | No stored numeric target. Latest valid physical-route app-vs-drop-in comparison remains app WER 1.4975 vs drop-in WER 0.2656. Fresh Chrome fake-audio-capture reruns were invalid for both app and standalone, so they cannot be used to claim Native parity. |
| Cloud | Latest app accuracy 91.53% vs updated streaming target 91.86%. App WER 0.0847 vs API benchmark WER 0.1044. Direct streaming A/B script exists but still needs an API-key run. |
| Private | Browser same-route drop-in accuracy 92.75%. Latest SpeakSharp saved/detail final accuracy 95.40% vs browser drop-in 93.10% on the same 10-row Harvard corpus, with 10/10 save/history/detail. Live provisional accuracy is 73.56% and should be treated as rough interim text, not final transcript quality. |

## SpeakSharp Score Eligibility

Short STT fixtures are not valid SpeakSharp Score proofs. The live score intentionally hides the numeric value until enough speech exists for a directional coaching signal.

| Score State | Minimum Criteria | User Expectation |
|---|---|---|
| Warming up | Fewer than 25 captured words | The card may show `--` / `score soon`; this is expected and should be explained to the user. |
| Directional score | At least 25 captured words | A numeric SpeakSharp Score can appear, but should be treated as early guidance. |
| Usable score | At least 75 captured words and at least 30 seconds of speech | The score is more reliable for coaching and trend comparison. |

The current `h1_1` fixture has only 9 ground-truth words, so Native/Private/Cloud runs against that fixture can prove transcription lifecycle, first-text timing, WER, filler detection, and save behavior. They cannot prove a numeric SpeakSharp Score. Score proof requires a longer fixture or script that crosses the 25-word threshold.

## Acceptance Targets

| Dimension | Target |
|---|---|
| Native first visible text | Quickly after Chrome `onresult` interim begins. |
| Native/Cloud partial latency | p95 engine-to-visible latency under approximately 750ms during normal speech, unless provider/browser behavior proves otherwise. |
| Private first provisional text | Within a reasonable rolling chunk window, not blank until stop. |
| Stop/save | Visible useful text must not disappear on stop. |
| Saved quality | No unintended repeated 4+ word sequence; first word capitalized; terminal punctuation applied when appropriate. |

## Review Rule

Any STT change should state which layer it changes:

| Layer | Examples |
|---|---|
| Reference adapter | AssemblyAI Turn parsing, Web Speech result assembly, Whisper chunk inference. |
| Shared lifecycle | Freeze at stop, selected save transcript, store/UI reflection. |
| Product policy | Entitlements, setup copy, hallucination save guard, analytics/scoring/PDF. |

Reference adapters should stay close to vendor/common baseline behavior. Product policy must not prevent baseline live transcription.
