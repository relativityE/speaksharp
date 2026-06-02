# Native STT Test Report — Current Release Evidence

**Updated:** 2026-06-02  
**Scope:** Chrome Web Speech Native STT, human real-mic proof, punctuation/readability, stop/save integrity  
**Canonical metric matrix:** `product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.json`

## Current Verdict

```text
Native STT: NOT GREEN YET
Current product status: quick-start/browser-dependent path
Primary launch blockers:
1. Human real-mic proof is still required.
2. Punctuation/casing remains unresolved.
3. No duplicate-on-stop regression must be verified in real browser use.
4. Native cannot be judged by fake-audio or macOS say WER.
```

Native should be tested as a real customer path: Chrome desktop, real microphone, visible live text, stop/save/history/detail. Automated `say`, fake-audio, or speaker-to-mic runs can be diagnostic only.

## Current Release Metrics

All future Native runs must populate the shared JSON with these fields:

| Metric group | Required fields |
| --- | --- |
| Accuracy | transcript quality vs expected human script, not fake-audio WER as release proof |
| Product signals | filler recall, false filler insertion, transcript confidence |
| Readability | terminal punctuation, sentence count, max run-on words, capitalization errors, duplicate detection, readability verdict |
| Timing | mic click, onaudiostart, onspeechstart, first interim, first final, onend, stop-to-detail |
| Journey | visible at stop, post-stop final, selected for save, saved transcript, history visible, detail visible |
| Regression flags | duplicate full transcript, disappeared on Stop, empty/one-word save prevention |

Release gate:

```text
Native must feel credible as a quick-start browser transcription path:
fast visible text, no duplicate/erase on Stop, readable saved transcript,
and clear browser-dependent caveat.
```

## Latest Preserved Diagnostic Evidence

Latest automated route:

```text
Chrome headed + macOS say playback into real mic path.
Diagnostic only; not release WER proof.
```

Result:

| Field | Value |
| --- | --- |
| Visible at stop | `Native` |
| Post-stop transcript | `Native` |
| Selected for save | `Native` |
| Final result count | 0 |
| Result event count | 1 |
| Saved/history/detail | not saved, correctly |
| Parallel capture duration | 16.291 sec |
| Parallel capture RMS / peak | 0.006956 / 0.080567 |
| Speech window | 2200-7850 ms |
| Segment count | 4 |

Interpretation:

```text
The diagnostic route under-captured Chrome Web Speech.
The app correctly refused to save a one-word meaningless transcript.
This does not prove Native good or bad for real users.
```

Artifact:

```text
/private/tmp/speaksharp-native-current-required-fields-20260601.json
```

## Current Human Proof Requirement

Required human scripts:

```text
Script A: Native Chrome microphone proof starts now. I want to make one simple point before we move on. The quick brown fox reads clear speech for SpeakSharp validation.

Script B: Um, basically, I want to explain one thing. Like, the puppy chewed up the new shoes, and that changed the whole plan.

Script C: The main takeaway is that we should pause before the next idea, give one concrete example, and end with a clear next step.
```

Required output:

| Field | Required |
| --- | --- |
| `micClickedAt` | yes |
| `onaudiostartAt` / `onspeechstartAt` | yes if Chrome emits |
| `firstInterimAt` / first visible text ms | yes |
| `firstFinalAt` | yes if Chrome emits final |
| `visibleAtStop` | yes |
| `postStopFinal` | yes |
| `selectedForSave` | yes |
| `savedTranscript` | yes |
| `detailTranscript` | yes |
| duplicate full transcript? | yes |
| transcript disappeared on Stop? | yes |
| punctuation/readability fields | yes |
| save/history/detail pass | yes |

## Punctuation/Casing Status

Current code state:

```text
Native formatter seam exists and defaults to identity.
No trusted punctuation/casing formatter is registered.
No off-the-shelf formatter/provider has been approved.
```

Current product concern:

```text
Users judge Native quality visually. Run-on text, missing sentence stops, and
bad capitalization such as "Starts Now" are release blockers for Native as a
visible path.
```

Dev-agent responsibility:

```text
Research/propose a trusted Native-only formatter using the existing seam.
Do not ship bespoke regex punctuation as the final answer.
Formatter must never apply to Private mode unless separately approved.
```

STT test-agent responsibility:

```text
Collect raw Chrome output and saved/detail output so formatting can be judged.
If formatter is later implemented, compare raw vs formatted for punctuation,
casing, filler preservation, duplicate prevention, and word preservation.
```

## Dev/Test Boundary

Dev-agent responsibility:

```text
No Native code changes unless human real-mic proof shows an app-side bug:
good Chrome final -> corrupted saved/detail, duplicate append, erased transcript,
or failed persistence.
```

STT test-agent responsibility:

```text
Run Native human proof only after the current Private and Cloud evidence steps.
Fill the shared JSON release matrix with timing, readability, and journey fields.
Classify Native as green, caveated, hidden, or backlog.
```

## Timing Budget To Verify

| Metric | Target | Hard limit | Why it matters |
| --- | ---: | ---: | --- |
| Mic click to first visible text | <=2s | <=4s | Native is expected to feel live. |
| Stop to final selected | <=2s | <=5s | Web Speech should not feel frozen after Stop. |
| Stop to detail visible | <=8s | <=12s | Full journey polish. |
| Duplicate full transcript | false | false | Launch-blocking if true. |

## Next Required Run

Run only after the first four current-hour STT steps:

1. Native human real-mic proof using Scripts A-C.
2. Capture all transcript states and timing fields.
3. Update JSON/MD matrix.
4. Classify Native as green, caveated, hidden, or backlog.

Pass condition:

```text
Native can be visible as quick-start/browser-dependent only if human proof shows
fast live text, readable enough saved transcript, no duplicate/erase on Stop,
and save/history/detail pass.
```
