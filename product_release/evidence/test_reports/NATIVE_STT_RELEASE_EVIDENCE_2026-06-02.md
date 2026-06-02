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

## Native Human Real-Mic Proof — 2026-06-02T17:42:16Z

Artifact:

```text
/private/tmp/speaksharp-native-human-proof-20260602.json
```

Script:

```text
Native Chrome microphone proof starts now. I want to make one simple point before we move on. Um, basically, the puppy like chewed up the new shoes, and that changed the whole plan. The main takeaway is that we should pause before the next idea, give one concrete example, and end with a clear next step.
```

### Result Summary

| Field | Value |
| --- | --- |
| Classification | FAIL / not release-green |
| Evidence type | Human real Chrome mic |
| Chrome produced usable text | yes |
| Visible at Stop | Native microphone proof Starts Now. I want to make one simple point before we move on basically the puppy like chewed up the new shoes and that changed the whole plan the main takeaway is that we should pause before the next idea give one concrete example and end with a clear Next Step. |
| Post-stop final from Native trace | native microphone proof Starts Now I want to make one simple point before we move on basically the puppy like chewed up the new shoes and that changed the whole plan the main takeaway is that we should pause before the next idea give one concrete example and end with a clear Next Step |
| Post-stop transcript in page | Listening... |
| Selected for save | Listening... |
| Saved marker | fail |
| History visible | pass |
| Detail transcript | fail / empty |
| Duplicate full transcript | pass |
| Blockers | stop did not settle: page.waitForFunction: Timeout 60000ms exceeded.; Native session did not expose saved-session marker. |

### Product Metrics

| Metric | Value | Verdict |
| --- | ---: | --- |
| Expected fillers | 3 | info |
| Recognized fillers | 2 | fail: missed `um` |
| Filler recall | 66.67% | fail |
| False filler insertion | 0 | pass |
| Terminal punctuation present | true | pass |
| Sentence count | 2 / expected ~4 | fail |
| Max run-on words | 49 | fail: target <=45 |
| Capitalization errors | Starts Now, Next Step | fail |
| Readability verdict | fail | blocker |
| Transcript confidence | low | block score confidence |

### Timing And Capture

Important trace note: this artifact contains a second auto-start after the stopped session. The values below use the stopped session boundary (`onStop_enter=53209.2ms`) and `nativeAudioReady=5321ms` for first-session audio start; `recordingStateAt` was not retained for that same session.

| Field | Value |
| --- | ---: |
| onaudiostartAt | 5321 ms |
| onspeechstartAt | not captured |
| firstInterimAt | 37452.3 ms |
| firstFinalAt | 49343.5 ms |
| stopClicked/onStop_enter | 53209.2 ms |
| onendAt | 53375.9 ms |
| audioStartToFirstInterim | 32131.3 ms |
| firstInterimToFirstFinal | 11891.2 ms |
| firstFinalToStop | 3865.7 ms |
| stopToOnEnd | 166.7 ms |
| stopToRecognitionFinished | 166.8 ms |
| Parallel mic duration | 48.1973125 sec |
| Parallel RMS / peak | 0.02246 / 0.423943 |
| Speech window | 21150-42800 ms |
| Segment count | 25 |

### Required Dev Follow-Up

1. Native trusted formatter is now a P0 if Native remains visible: raw Chrome output has wrong casing (`Starts Now`, `Next Step`) and run-on punctuation. The existing formatter seam is identity unless a formatter is registered.
2. Investigate stop/save selection: visibleAtStop and postStopFinal contain the transcript, but postStopTranscript/selectedForSave became `Listening...`, saved marker was false, and detail transcript was empty. Determine whether this is product code or harness extraction; it blocks Native green either way.
3. Preserve duplicate-stop guard: this run did not duplicate the full transcript.

## DEV → TEST AGENT (2026-06-02, append-only) — delivered features + how to use, and OPEN questions on the stop/save bug

All work is on `main` (no branches). Two of the three Native items are addressed in code; the
stop/save selection (#2 above) needs your clarification before I ship a fix — see questions at the end.

### A. Native saved-transcript formatter — ON MAIN, ready, but INERT until activated
Commit `515784a1`. Native-only, SAVED transcript only (never live, never Private).
- `frontend/src/services/transcription/modes/nativeGeminiFormatter.ts` — trusted server-side adapter
  via the existing Gemini edge-fn pattern (`supabase.functions.invoke('format-transcript', { body:{ transcript, instruction } })`).
- `nativeTranscriptFormatter.ts` — added a **word-preservation guard** to `formatNativeTranscript`:
  accepts punctuation/casing/spacing-only reformatting; REJECTS any output that adds/removes/reorders/
  "corrects" words (so fillers um/uh/like/you know/basically/literally can NEVER be dropped) → falls
  back to raw. 24 unit tests pass (`nativeTranscriptFormatter.test.ts`, `nativeGeminiFormatter.test.ts`).
- **To ACTIVATE for your human-mic rerun (2 prerequisites):**
  1. Deploy a `format-transcript` Supabase Edge Function (contract: body `{ transcript, instruction }`
     → `{ formatted }`; the instruction string is exported as `NATIVE_FORMATTER_INSTRUCTION`). This is the
     only piece not in this repo (edge fns are deployed separately).
  2. Register it for Native: `registerNativeProductionFormatter('native')` at Native init. I have NOT
     auto-wired this yet because activation sends transcript TEXT to the server — needs the product
     privacy-copy decision first (Native is already non-local, but copy should say so). Tell me to wire
     it and I will (Native-only; hard `assertNotPrivateMode` guard; Private never invokes it).
  - Until both are done it is a safe no-op: any failure/missing edge fn → raw transcript (no regression).
- **Validation once active:** rerun the human Native scripts; confirm the SAVED transcript is more
  readable AND the word/filler set is identical to raw (the guard guarantees this; your run is the proof).

### B. Generic STT timing readers — ON MAIN, use these to fill the matrix timing fields
Commit `68368415`: `scripts/lib/sttTiming.ts` (pure/inert tooling, no runtime behavior). One module
for all three engines — import the reader for the engine under test:
- `readPrivateFinalizeTiming(window.__PRIVATE_STT_TIMELINE__)` → `finalInferenceDurationMs` (decodeMs),
  `decodeInputDurationMs`, finalize phase spans. Plus `decomposeFinalizeWait(finalizationWaitMs, t)` →
  `{ decodeMs, appOverheadMs, decodeShare }` (proved decode ≈ 98% of the post-Stop wait).
- `readNativeStopTiming(window.__NATIVE_BROWSER_TRACE__)` → `onAudioStartMs`, `onSpeechStartMs`,
  `firstInterimMs`, `firstFinalMs`, `stopToOnEndMs`, and **`finalAfterStopInvoke`** (TRUE = a Chrome
  final arrived AFTER stop was requested — the exact late-final failure class; useful for this very bug).
- `readCloudStreamTiming(events)` → `openToFirstPartialMs`, `openToFirstFinalMs`, `stopToTerminationMs`.
  Reader is ready; Cloud has NO trace global yet (`__CLOUD_STT_TIMELINE__`) — lands when I do the
  Cloud stop-timeout work. Until then it returns nulls (safe).
Mapping is documented in the file header; 11 unit tests in `tests/private/sttTiming.test.ts`.

### C. Cloud A/B request-construction fix — ON MAIN (recap)
Commit `5e81bd3b`: prompt→`u3-rt-pro`, keyterms as repeated params, session settle delay for 1008.
Rerun cheap first: `ASSEMBLYAI_STREAMING_AB_VARIANTS=baseline,keyterms ASSEMBLYAI_STREAMING_AB_FIXTURES=h1_1,h1_6,h1_8`.

### D. Stop/save `Listening...` bug — root cause traced, but I have QUESTIONS before fixing
What I confirmed in code (NOT yet a shipped fix):
- The save candidate is built from STORE snapshots, not `engine.getTranscript()`
  (`SpeechRuntimeController.ts:1784-1797`): service_result / committed_final / visible_snapshot /
  best_meaningful_partial / store_visible_snapshot.
- `freezeTranscriptLifecycleAtStop()` (`:1089`) snapshots the store at stop. If the store was already
  cleared (`store.updateTranscript('','')`, `:1034`) by Native's restart/stop churn or a **post-stop
  auto-start** (your report notes "a second auto-start after the stopped session") BEFORE the freeze
  runs, every candidate is empty → save empty → UI shows the `Listening...` placeholder.
So it looks like a stop-sequence ORDERING race specific to Native. Before I implement, I need to know
whether the SAVE actually selected empty (product bug) or only the harness's post-stop DOM read saw the
placeholder after a post-save reset (harness extraction). I will ship the correct fix once you answer
the questions below.
