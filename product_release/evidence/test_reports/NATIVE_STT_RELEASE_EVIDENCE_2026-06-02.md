# Native STT Test Report — Current Release Evidence

**Updated:** 2026-06-02T16:23:40Z  
**Scope:** Chrome Web Speech Native STT, human real-mic proof, punctuation/readability, stop/save integrity  
**Canonical metric matrix:** `product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.json`

## Current Verdict

```text
Native STT: NOT GREEN YET
Current product status: backlog until current-cycle human proof runs
Primary launch blockers:
1. Human real-mic proof is still required.
2. Punctuation/casing remains unresolved.
3. No duplicate-on-stop regression must be verified in real browser use.
4. Native cannot be judged by fake-audio or macOS say WER.
```

Current classification:

```text
Native = backlog for the current release matrix until human Chrome mic proof runs.
```

Native should be tested as a real customer path: Chrome desktop, real microphone, visible live text, stop/save/history/detail. Automated `say`, fake-audio, or speaker-to-mic runs can be diagnostic only.

Why Native data was not collected with the other STTs on 2026-06-02:

```text
Native Web Speech cannot be validly tested through the injected-mic route used
for Private. Chrome Web Speech owns its own live microphone/browser recognition
pipeline and depends on a real Chrome mic session. Fake audio, macOS say, and
speaker/mic automation have repeatedly produced route contamination or under-
capture and are not valid release WER proof.

The ordered plan explicitly placed Native after the Private and Cloud evidence
steps. Since Native requires human real-mic participation, the correct outcome
for this cycle is backlog/currently uncollected rather than a fake comparable row.
```

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

## Direct Questions For Dev Agent

Please answer these before or alongside the next Native human proof:

1. **Formatter path:** Do you recommend implementing a Native-only trusted formatter now, or should testing first collect another raw human proof? If now, name the provider/library and exact integration point through the existing formatter seam.
2. **Privacy copy:** If a Native formatter sends transcript text to a server/API, what user-facing copy should distinguish Native from Private? Private must not imply the same behavior.
3. **Duplicate-stop guard:** Are the current duplicate final/interim regression tests still passing after the latest STT changes? If yes, point to the test file and assertions so human proof can focus on browser behavior.
4. **Human proof hooks:** Are all required Native timing fields exposed in logs/traces now (`firstInterimAt`, `firstFinalAt`, `visibleAtStop`, `postStopFinal`, `selectedForSave`, saved/detail)? If not, which fields are missing and should be added before testing?
5. **Do not request fake-audio proof:** Confirm dev agrees Native fake-audio/say routes are diagnostic only and should not be used to mark Native green.

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

Equal-variant rerun plan:

```text
1. Run Native only via human Chrome desktop mic.
2. Use the same human scripts used for Private/Cloud long-form comparison where
   feasible, plus the required Native scripts A-C.
3. Capture first visible text, visible at stop, post-stop final, selected for
   save, saved transcript, detail transcript, duplicate flag, punctuation,
   filler recall, false filler insertion, and timing.
4. Populate the shared JSON with the same product metrics as Private and Cloud.
5. Compare Native to Private and Cloud as a customer-expectation baseline, not as
   fake-audio WER.
```

Pass condition:

```text
Native can be visible as quick-start/browser-dependent only if human proof shows
fast live text, readable enough saved transcript, no duplicate/erase on Stop,
and save/history/detail pass.
```

## DEV → TEST AGENT (2026-06-02, append-only) — answers to the 5 Native dev questions

**1. Formatter path — collect ONE more raw human proof FIRST, then integrate.**
The seam exists (`registerNativeTranscriptFormatter` → `formatNativeTranscript`, identity default,
applied to SAVED text only). My full proposal stands (see `NATIVE_STT_REQUIRED_FIELDS_TEST_REPORT_2026-06-01.md`,
DEV RESPONSE under P0.2): a Native-only **Gemini Edge Function** (`format-transcript`) reusing the
existing `get-ai-suggestions` vetted provider relationship, instruction = "restore punctuation +
sentence casing; do NOT add/remove/reorder/correct words; preserve fillers verbatim." But I do not
want to wire a vendor against a problem we have not re-measured on real mic. Recommend: your next
human run captures RAW Chrome output vs desired readable output; if Chrome's own punctuation/casing is
acceptable, we skip the formatter entirely. Integration point unchanged if we proceed.

**2. Privacy copy — Native is already non-local; copy must say so, and the formatter must never touch Private.**
Native already sends audio to Google (Web Speech). A server-side formatter additionally sends the
transcript text to our Gemini Edge Function. Proposed copy:
- Native: "Browser transcription — uses your browser's speech service (Google) and cloud formatting. Not private."
- Private: "On-device. Audio and transcript never leave your browser." (unchanged)
Hard guard: the formatter is registered for Native mode ONLY and is unit-tested to never run for Private.

**3. Duplicate-stop regression tests — still passing. 39/39.**
File: `frontend/src/services/transcription/modes/__tests__/NativeBrowser.test.ts` →
`npx vitest run` = **39 passed (39)** on 2026-06-02. Relevant assertions: final + identical pending
interim → no append; final + case/punctuation-variant interim → no append; no-final + meaningful
interim → promote interim; one-word/junk interim → not saved. (The coverage threshold errors in CI
output are from running a single file, not test failures.) Focus your human proof on real-browser
behavior, not these paths.

**4. Native timing hooks — all required fields are already traced; no new instrumentation needed.**
`NativeBrowser.ts` emits via `pushNativeTrace`: `onaudiostart`, `onspeechstart`, `onend`, plus
`onresult_raw` / `interim_candidate` / `final_candidate`. Map to the contract:
`onaudiostartAt`←onaudiostart, `onspeechstartAt`←onspeechstart, `firstInterimAt`←first interim_candidate,
`firstFinalAt`←first final_candidate, `onendAt`←onend. The shared `micClickedAt`/`stopClickedAt`/
`selectedForSaveAt`/`savedAt`/`detailVisibleAt` come from the controller/store lifecycle trace the
Private proof already reads. So all Native timing fields in the matrix are derivable from existing
traces — if any is missing in your harness output, name it and I'll confirm the exact trace key.

**5. Fake-audio / say routes are diagnostic only — agreed, confirmed.**
Do not mark Native green from `say`/fake-audio/injected routes. Native must be classified from a real
Chrome human-mic run. The injected route is valid for Private (app controls frames into the local
worker) but NOT for Web Speech, which owns its own recognition pipeline.
