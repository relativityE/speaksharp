# Native STT Test Report — Current Release Evidence

**Updated:** 2026-06-02T21:05:00Z  
**Scope:** Chrome Web Speech Native STT, human real-mic proof, punctuation/readability, stop/save integrity  
**Canonical metric matrix:** `product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.json`

## Current Verdict

```text
Native STT: NOT GREEN YET
Current product status: backlog / failed current human proof
Two-step status:
- SETUP passing for current human-mic proof: Chrome heard the speaker and produced usable transcript text.
- Proof failure in accuracy phase at `proof.accuracy.readability` and journey phase at `proof.journey.stop_save_detail`: readability/punctuation/casing failed, and stop/save/detail selected or exposed `Listening...`.
Primary launch blockers:
1. Human real-mic proof ran and failed product readiness.
2. Stop/save selected `Listening...` even though Chrome produced usable transcript text.
3. Punctuation/casing remains unresolved.
4. Native cannot be judged by fake-audio or macOS say WER.
```

Current classification:

```text
Native = backlog / failed current proof until stop-save and readability are fixed and rerun.
```

Native should be tested as a real customer path: Chrome desktop, real microphone, visible live text, stop/save/history/detail. Automated `say`, fake-audio, or speaker-to-mic runs can be diagnostic only.

Why Native data was initially not collected with the other STTs on 2026-06-02:

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

### C. Cloud A/B request-construction fix — ON MAIN / local follow-up (recap)
Commit `5e81bd3b` introduced prompt→`u3-rt-pro` and session-settle handling. A later local follow-up,
documented in the Cloud report, changes keyterms to a single JSON-array-string param and adds 1008
retry/backoff handling. Treat the Cloud report as controlling for current A/B rerun instructions.
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

## DEV → TEST AGENT (2026-06-02, append-only) — your 6 answers REVISE the root cause; instrumentation shipped

Thanks for the answers. They change the picture: the Native engine **held the transcript through Stop**
(`onStop_enter`/`onStop_exit` `currentTranscript length=285`), and `selectedForSave=Listening...` is
**harness DOM-extraction contamination** — `manual-native-chrome-proof.mjs` reads `postStopTranscript`
from `transcript-container.textContent`, and `Listening...` is a placeholder rendered **inside** that
container (LiveTranscriptPanel.tsx:201/205). The second auto-start was ~30s later, so it did NOT clear
the store before save. So my earlier "currentTranscript wiped by restart" hypothesis is **withdrawn for
this artifact** — per your read, do not patch product save-ordering from this artifact alone.

**Per your P0.3 ("boundary not clear → add exact trace extraction, don't guess"), I shipped the
instrumentation you asked for (commit `58ce4278`):** the controller now exposes the AUTHORITATIVE save
candidate at `window.__SPEECH_RUNTIME_DEBUG__().saveCandidate`:
`{ saveCandidateReason, selectedForSave, selectedForSaveLength, finalWordCount, meaningfulWordCount,
resultTranscriptLength, chunkTranscriptLength, storeTranscriptLength, storePartialTranscriptLength,
visibleStoreTranscriptLength, frozenStopTranscriptLength, candidateLengths[] }` (+ top-level
`selectedTranscriptForSave` / `selectedTranscriptSource`). This is exactly the save-candidate field set
you requested, read from a window global after Stop — ground truth, not DOM scraping.

**Test-agent next (one short + one long human run):**
1. Read `__SPEECH_RUNTIME_DEBUG__().saveCandidate` after Stop instead of treating `transcript-container`
   text as the saved transcript; also filter the placeholders (`Listening...`,
   `Start recording and your words will appear here.`, `Processing speech locally…`) in the harness.
2. If `selectedForSave` is the full text while the DOM shows `Listening...` → **harness extraction bug**
   (fix the harness; no product change). If `selectedForSave` is empty while
   `storeTranscriptLength`/`visibleStoreTranscriptLength` are large → that's a real product
   freeze/candidate-ordering bug and I will patch `freezeTranscriptLifecycleAtStop` / candidate order
   with those exact numbers.

Confirmed product contract (your Q6): saved transcript should be
`postStopFinal || committedFinal || visibleAtStop || bestMeaningfulInterim`, never a placeholder.
Confirmed Q4: user Stop should hard-stop (no post-stop auto-restart) — if the harness's later auto-start
is product-driven, I'll suppress it once a run shows it firing before save.

## TEST AGENT UPDATE (2026-06-03T05:41Z) — human real-mic rerun: save improved, trust/readability failed

Artifact:

```text
/private/tmp/speaksharp-native-human-proof-20260603T054003Z.json
```

Code under test:

```text
Public app: https://speaksharp-public.vercel.app
Evidence collection branch: fix/speaksharp-score-transcript-quality / 9fab5d01
```

Script read by human:

```text
Native Chrome microphone proof starts now. I want to make one simple point before we move on. Um, basically, the puppy like chewed up the new shoes, and that changed the whole plan. The main takeaway is that we should pause before the next idea, give one concrete example, and end with a clear next step.
```

### Result Summary

| Field | Value |
| --- | --- |
| Classification | FAIL / not release-green |
| Evidence type | Human real Chrome mic |
| Chrome produced usable words | yes |
| Save candidate present | yes |
| Save candidate source | `service_result` |
| Saved/session marker | pass |
| History visible | pass |
| Detail transcript extracted | fail / empty in artifact |
| Duplicate full transcript | pass / false |
| Main blockers | first visible text very late, missed filler, punctuation/casing/run-on readability, detail transcript extraction |

Selected for save:

```text
Native Chrome microphone proof Starts Now I want to make one simple point before we move on basically the puppy like chewed up new shoes and that changed the whole plane the whole plan the main takeaway is that we should pause before the next idea give one concrete example and end with.
```

### Product Metrics

| Metric | Value | Verdict |
| --- | ---: | --- |
| Expected words | 56 | info |
| Selected words | 53 | info |
| WER | 16.07% | fail for Native parity |
| Accuracy | 83.93% | fail for launch-quality Native |
| Expected fillers | 3 (`um`, `basically`, `like`) | info |
| Recognized fillers | 2 (`basically`, `like`) | fail: missed `um` |
| Filler recall | 66.67% | fail |
| False filler insertion | 0 | pass |
| Terminal punctuation present | true | pass |
| Sentence count | 1 / expected ~4 | fail |
| Max run-on words | 53 | fail: target <=45, preferred <=35 |
| Capitalization errors | `Starts Now` | fail |
| Duplicate full transcript | false | pass |
| Transcript confidence | low | block precise score confidence |

### Timing And Capture

| Field | Value |
| --- | ---: |
| `onaudiostartAt` | 4171.3 ms |
| First result | 42392.9 ms |
| Audio-start to first result | 38221.6 ms |
| First final | 42392.9 ms |
| Last final | 57811.6 ms |
| Stop/onStop_enter | 57588.1 ms |
| onend | 57814.3 ms |
| stopToOnEnd | 226.2 ms |
| Parallel mic duration | 53.626625 sec |
| Parallel RMS / peak | 0.013835 / 0.366958 |
| Speech window | 27250-53050 ms |
| Segment count | 22 |

### User-Observed Trust-State Failure

The user clarified after the run that they were finding the script after the mic
started. Therefore `audioStartToFirstResultMs` is inflated and should not be
used alone as proof that Chrome took 38s to respond after speech began.

The product failure is still real, but it is sharper:

```text
Native interim text jumped/revised while the trust disclaimer was not stable or
perceptible enough.
```

For Native, the trust-state indicator must appear as soon as the mic is on and
remain anchored until final text is accepted. It should not be inserted into the
changing transcript stream in a way that causes layout jump or makes the label
feel intermittent. For longer speeches, the future target is section-level trust
state: finalized prior sections render normally, while the active/current section
keeps the Draft label until it is final.

The current artifact cannot fully reconstruct the start of this behavior because
`__NATIVE_BROWSER_TRACE__` capped at 500 events and the first retained raw result
already had `cycleResultCount: 36`. The retained trace still proves the interim
hypothesis revised rapidly, including:

| Relative to first retained raw result | Chrome result state |
| ---: | --- |
| 2.64s | interim: `... chewed up the` |
| 2.71s | interim: `... chewed up new` |
| 2.91s | interim: `... chewed up the new` |
| 6.47s | final committed with `... changed the whole plane` |
| 15.42s | final committed with `the whole plan ... end with` |

Release-proof requirement update:

```text
Capture full Native result/store/UI trace for human proofs, and verify a stable
Draft trust indicator is visible from mic-on through final acceptance.
```

### What changed versus the prior human Native run

| Area | Prior 2026-06-02 result | Current 2026-06-03 result | Read |
| --- | --- | --- | --- |
| `selectedForSave` | `Listening...` / contaminated | authoritative `service_result` text, 53 words | improved |
| Save marker | fail | pass | improved |
| History visible | pass | pass | stable |
| Detail transcript | empty/fail | empty in artifact | still open |
| Duplicate full transcript | false | false | stable/pass |
| Readability | fail | fail | still blocker |
| Filler recall | 66.67% | 66.67% | unchanged/fail |
| First visible text | ~32.1s after audio start | ~38.2s after audio start | still unacceptable |

### Current Native Decision

```text
Native is not product-ready as a visible release path.
The old "Listening..." save-candidate contamination appears improved in this run,
but the user-trust problem remains severe: live text arrives far too late, final
text misses `um`, casing/punctuation/readability fail, and detail transcript
extraction did not prove the saved transcript.
```

### Required Next Work

| Issue / unsatisfactory item | Evidence | Consequence if not fixed | Status | Owner / next handoff |
| --- | --- | --- | --- | --- |
| Native trust disclaimer felt unstable while interim text jumped | User observed jumpy interim text; retained trace shows rapid revisions (`... chewed up the` -> `... chewed up new` -> `... chewed up the new`) | Users can mistake unstable interim text for authoritative transcript, or the disclaimer itself can make the panel feel jumpy | **Fixed in code, pending browser proof**: `main` commit `908be139` adds a stable mic-on Draft transcript banner for all recording modes and removes the moving inline Draft chip | Test agent reruns Native human proof and confirms banner is visible from mic-on through final acceptance |
| Full timestamped Native context was lost | `__NATIVE_BROWSER_TRACE__` capped at 500 events; first retained raw result already had `cycleResultCount: 36` | We cannot reconstruct first-text timing or the earliest interim churn; dev/test may chase the wrong timing boundary | **Fixed in code, pending browser proof**: Native trace cap raised to 5,000 events after this run | Test agent reruns and verifies first retained raw result is cycle 1 or that the full result sequence is exported |
| Detail transcript empty in artifact | Current run: saved=true and historyVisible=true, but `detailTranscript` empty | Cannot prove saved/detail transcript matches `saveCandidate.selectedForSave`; journey gate remains incomplete | **Open** | Test agent should read authoritative `saveCandidate`, saved row text, and detail DOM separately; dev only patches if those diverge in app state |
| Punctuation/readability failed | Sentence count 1 vs expected ~4; max run-on 53; random cap `Starts Now`; terminal punctuation alone passed | First visual impression is poor; users may distrust transcript and coaching even if words are mostly present | **Open / product decision + dev activation** | If Native remains visible, activate approved Native-only formatter through existing seam; preserve words/fillers and never run for Private |
| Filler recall only 66.67% | Expected `um`, `basically`, `like`; recognized only `basically`, `like` | SpeakSharp score/filler coaching can undercount user fillers | **Open / likely Native limitation until repeated proof** | Rerun with full trace; do not use formatter to invent missing fillers |
| Native word accuracy not launch-quality | 83.93% accuracy; wrong/missing words: missed `um`, dropped `the`, `plane` then `plan`, missing final phrase | Native cannot be promoted as quality path; keep caveated quick-start only if visible | **Open** | Compare another short human proof after trust UI/formatter; if still below target, Native remains caveated/backlog |
| Native artifact expected-script field was wrong | Artifact `spokenSentence` contained a short/default sentence instead of the full script the user read | Automatic WER/filler calculations can become bogus if a runner compares against `spokenSentence`; release evidence loses credibility | **Fixed in harness, pending rerun** | `scripts/manual-native-chrome-proof.mjs` now writes `expectedScript`, `spokenChunks`, and sets legacy `spokenSentence` to the full expected script |
| Raw mic-on to first result looked huge | 38.2s after `onaudiostart`, but user clarified silence was from finding the script | Timing interpretation can be wrong if setup silence is mixed with speech latency | **Open measurement fix, not product conclusion** | Rerun with explicit "start speaking now" marker and full trace; judge speech-start to first visible text, not mic-on to first text |
| Long-speech trust model remains whole-panel | Current fix stabilizes one whole-panel Draft banner during recording | For half-page speeches, a whole transcript marked Draft can feel unstable; section-level finalization is better | **Backlog / not 24h P0** | Dev/design: segment-level trust state (`finalSegments[]`, active draft segment) after release proof stabilizes |

Rerun the same human script after low-hanging fixes and require:

```text
stable Draft banner from mic-on, full timestamped trace, live text during speech,
filler recall >= 90%, readability pass, no duplicate, save/history/detail match,
and no placeholder/status text persisted.
```

---

## DEV AGENT UPDATE (2026-06-03) — `format-transcript` backend SHIPPED + Native formatter ACTIVATED

Resolves the P0 "Native readability failed (`Starts Now`, 1 sentence, max run-on 53)" item: the
Native saved-transcript formatter is no longer inert. Backend implemented, activation wired, proof
telemetry added. Word-preserving by construction (server **and** client guard) so it cannot fix STT
word errors or invent/drop fillers — readability only.

**1. Backend — `backend/supabase/functions/format-transcript/` (new)**
- `index.ts` — mirrors `get-ai-suggestions` (Deno, DI `handler(req, createSupabase)`, Gemini
  `gemini-3-flash-preview`, CORS via `_shared/cors.ts`). Request `{ transcript, instruction?, engine?,
  sessionId?, runId? }` → `{ formatted, metadata:{ provider, model, inputChars, outputChars, latencyMs,
  wordPreservingServerCheck, formatterVersion, requestId } }`.
- **Server-side word-preservation check** (`isWordPreserving`): if Gemini changes ANY word or drops a
  filler → `422 FORMATTER_WORDS_CHANGED`, altered text is NOT returned.
- **Privacy hard-reject:** `engine === 'private'` → `403 PRIVATE_FORMATTER_NOT_ALLOWED` (unconditional,
  before auth). Private transcript text can never be formatted by this backend.
- **Stable error codes (HTTP):** METHOD_NOT_ALLOWED 405, INVALID_JSON 400, EMPTY_TRANSCRIPT 400,
  TRANSCRIPT_TOO_LONG 413, PRIVATE_FORMATTER_NOT_ALLOWED 403, AUTH_REQUIRED 401, QUOTA_EXCEEDED 429,
  GEMINI_KEY_MISSING 500, FORMATTER_PROVIDER_ERROR 502, FORMATTER_PROVIDER_TIMEOUT 504,
  FORMATTER_EMPTY_OUTPUT 502, FORMATTER_WORDS_CHANGED 422.
- **No transcript in logs:** structured logs carry only counts/latency/providerStatus/code +
  `sha256(userId)[:16]`, `requestId`, and `sha256(normalizedTranscript)[:12]` for correlation. A unit
  test asserts a sentinel transcript word never appears in captured logs. Error responses carry no text.
- **Tests:** `index.test.ts` — 16 steps green (`pnpm test:edge`: full edge suite 11 files / 70 steps pass;
  `deno check` clean).

**2. Frontend activation + proof telemetry**
- `EngineFactory.ts` — production `native` mode now calls `registerNativeProductionFormatter('native')`;
  `cloud`/`private` clear it. Guarded so wiring can never block engine construction.
- `nativeGeminiFormatter.ts` — adapter sends `engine:'native'`, surfaces backend metadata + error `code`.
- `nativeTranscriptFormatter.ts` — exposes **`window.__NATIVE_FORMATTER_LAST__`** (and
  `getNativeFormatterTelemetry()`):
  `{ attempted, provider, functionName, formatterVersion, requestId, latencyMs, inputChars, outputChars,
  serverWordPreserving, wordPreserving, errorCode, fallbackToRaw, at }`.
- Frontend tests: 27 formatter steps + EngineFactory 9 = green; `tsc` clean.

**TEST: to activate for the human-mic rerun (2 prerequisites, same as before):**
1. Deploy the `format-transcript` edge function and set `GEMINI_API_KEY` (+ `ALLOWED_ORIGIN`) in the
   Supabase project. Until deployed, `invoke()` fails → seam returns raw → **no regression**.
2. Nothing else — activation is automatic in production `native` mode via `EngineFactory`.

**What you can now prove from one Native human rerun (read `__NATIVE_FORMATTER_LAST__`):**
- readability improved → compare raw saved text vs accepted `formatted` (sentence count / run-on / casing);
- words/fillers unchanged → `wordPreserving === true` and `serverWordPreserving === true` on accepted;
- fallback works → kill the function or force a word change; expect `fallbackToRaw === true` +
  `errorCode` (`FORMATTER_WORDS_CHANGED` / provider error) and the SAVED text equals raw;
- no Private leak → Private run must show `attempted:false` (seam cleared) and any direct call returns 403;
- no transcript in logs → backend logs show only the metadata fields above.

**Still NOT solved by this (do not expect the formatter to fix):** missed `um`, `plane`→`plan`,
`ticker ways`, 83.93% word accuracy — those are STT/model quality and **score-confidence** concerns
(separate P1), because the word-preservation guard forbids the formatter from changing words.

Privacy copy distinguishing Native (server formatter, non-local) from Private (local-only) is still the
open **Native trust disclaimer** UI item — tracked separately; activation here does not add new copy.

## TEST/OPS UPDATE (2026-06-03) — formatter deployment path wired

The formatter was previously code-present but not deployable through the shared Supabase deploy workflow.
That was a real proof blocker: the Native human rerun could only fall back to raw text if
`format-transcript` was never deployed.

Current state:

| Gate | Status | Evidence / next proof |
| --- | --- | --- |
| `format-transcript` in deploy workflow | **Fixed in workflow** | `.github/workflows/deploy-supabase-migrations.yml` now deploys `format-transcript` in push/manual edge-function deploy paths. |
| `GEMINI_API_KEY` Supabase secret | **Explicit but still environment-gated** | The workflow syncs `GEMINI_API_KEY` when the GitHub secret is present and warns if it is absent. If absent, the function returns `GEMINI_KEY_MISSING` and Native formatting falls back to raw. |
| Native formatter proof | **Still pending browser proof** | Rerun human Native with `__NATIVE_FORMATTER_LAST__`; require `attempted:true`, non-null provider metadata, `wordPreserving:true`, readability improvement, and save/detail match. |

Deployment evidence:

| Run | Result | Meaning |
| --- | --- | --- |
| GitHub Actions `Deploy Supabase` push run `26886493370` | **Passed** | `format-transcript` was deployed through the shared edge-function workflow. |
| GitHub Actions `Deploy Supabase` manual `secrets` run `26886531839` | **Passed** | Supabase secrets were synchronized, including `GEMINI_API_KEY` when present in GitHub Secrets. |

Do not classify Native punctuation/readability fixed until the deployed-function rerun proves the formatter
accepted the transcript and improved the punctuation/readability metrics without changing words or fillers.

---

## TEST AGENT UPDATE (2026-06-03) — Native detail extraction fixed in proof script

The previous Native human artifact reported `detailTranscript=""`. Before
patching product code, the proof script itself needed correction:

- `scripts/manual-native-chrome-proof.mjs` now reads
  `data-testid="session-detail-transcript"` directly, matching the corpus proof
  harness.
- It falls back to extracting the transcript between `Recorded with` and
  `AI-Powered Suggestions` only if the test id is absent.
- It now records `detailTranscriptEvidence` with unique-word match counts and a
  `detailTranscriptMatchesSelected` boolean instead of requiring the full saved
  transcript to appear as an exact body substring.

Deconfliction:

```text
Do not patch Native product save/detail code from the old empty-detail artifact
until the rerun with this corrected extractor proves app state divergence.
```

Next Native human proof must include:

```text
saveCandidate.selectedForSave
detailTranscript
detailTranscriptEvidence.matchRatio
detailTranscriptMatchesSelected
__NATIVE_FORMATTER_LAST__
```

---

## TEST AGENT UPDATE (2026-06-03) — Native trust-state fields added to proof artifact

The next Native human proof now exports explicit trust-state snapshots so the
user-trust gate can be checked from JSON, not memory or screenshots:

```text
trustStateAtRecordingStart
trustStateAtAudioReady
trustStateAtVisibleStop
trustStatePostStop
```

Each snapshot includes:

```text
transcriptState
trustBannerVisible
trustBannerText
trustBannerMode
finalizingVisible
currentLineVisible
currentLineDraft
transcriptPreview
```

The proof fails if the Draft trust banner is not visible at recording start or
while the transcript is still non-final.

---

## TEST AGENT UPDATE (2026-06-03T13:55Z) — Native proof extractor now separates UX copy from transcript text

Native is a conversion-funnel product path, not disposable fallback. The next
human proof must measure two separate release gates:

1. **User trust / UX:** Draft, Processing, and Final states must be stable and
   perceptible from mic-on until final acceptance.
2. **Transcript quality:** spoken words, punctuation/readability, filler recall,
   save/history/detail, and formatter telemetry must pass.

Bug fixed in the proof script:

```text
scripts/manual-native-chrome-proof.mjs
```

The previous proof script could read `transcript-container.textContent`, which
can include trust/status UI copy such as `Draft transcript`, `Listening...`, or
`Processing speech locally...`. That raw panel text is useful UX evidence, but
it must not be scored as spoken transcript text.

Current behavior:

| Artifact field | Purpose |
| --- | --- |
| `trustState*.rawTranscriptPreview` | Raw panel text, including UX/status copy, for user-trust proof. |
| `trustState*.transcriptPreview` | Transcript-only preview with trust/status copy stripped. |
| `visibleAtStop` | Transcript-only text for WER/readability checks. |
| `postStopTranscript` | Transcript-only text for post-stop/journey checks. |
| `saveCandidate.selectedForSave` | Authoritative saved transcript source. |

Coordination:

| Item | Test/release agent owns | Dev agent owns |
| --- | --- | --- |
| Native human conversion proof | Rerun short + long human mic proof and capture trust states, formatter telemetry, save/history/detail, readability, filler recall, and transcript-only WER. | No product patch unless corrected artifact proves app state diverges from `saveCandidate` or formatter telemetry. |
| Native formatter | Verify `__NATIVE_FORMATTER_LAST__.attempted`, provider metadata, `wordPreserving`, fallback behavior, raw vs formatted readability improvement, and save/detail equality. | Fix edge-function/formatter only if telemetry shows failure, word changes, no attempt, or no readability improvement. |
| Native trust UI | Confirm Draft banner appears at mic-on and remains stable through non-final text; preserve raw screenshot/preview evidence. | Only add UI hooks/copy if selectors are flaky or banner is not perceptible in human proof. |

Do not classify Native release-ready until this rerun proves:

```text
stable trust indicators + formatter/readability improvement + no word/filler mutation +
save/history/detail match + no duplicate/placeholder selected for save.
```

---

## CURRENT NATIVE RELEASE HANDOFF (2026-06-03T16:55Z)

Stale deploy/pending-merge notes removed from this section. Current Native status only:

| Item | Current status | Owner / next action |
| --- | --- | --- |
| Native formatter backend | `format-transcript` deploy/Gemini secret are no longer the known blocker. | TEST must verify the browser actually attempts formatting. |
| Formatter telemetry | Latest local human proof still showed `window.__NATIVE_FORMATTER_LAST__ === null`, so the formatter did **not** prove it ran. | DEV investigate registration/invocation path if this reproduces; TEST rerun should capture telemetry. |
| Raw Native readability | Latest raw Native transcript had strong-ish words but poor readability: one long sentence, random cap `Starts Now`, missed `um`. | Formatter path must improve readability without changing words/fillers. |
| Trust-state hooks | Main exposes `data-draft-banner-visible`, `data-processing-visible`, `data-final-state-visible`, `data-listening-visible`, `window.__SS_TRUST_STATE__`, and `window.__SS_TRUST_TRACE__`. | TEST confirms visible Draft from mic-on and stable through non-final text. |
| Detail transcript | Latest human artifacts have shown empty detail extraction/state at least once. | TEST must read saved row, detail DOM, and `saveCandidate` separately; DEV patches only if app state diverges. |
| Native release role | Conversion funnel / quick-start only until formatter + detail + trust proof pass. | Do not promote Native as quality path yet. |

### Current Native Human Test Findings

| Finding | Evidence | Status / owner |
| --- | --- | --- |
| Native raw word accuracy was usable but not sufficient by itself | `/private/tmp/speaksharp-native-human-41dc1997.json`: 56 expected words / 56 output words, 94.64% accuracy, 5.36% WER. | Positive funnel signal; not release-green because readability/formatter/detail failed. |
| Punctuation/readability failed | Raw transcript was effectively one long sentence with random cap `Starts Now`; sentence count 1 vs expected ~4; max run-on 56. | **DEV/product formatter path required**; TEST rerun must compare raw vs formatted vs ground truth. |
| Formatter did not prove it ran | Latest local human proof had `window.__NATIVE_FORMATTER_LAST__ === null`. | **DEV investigate if reproduced**: registration/invocation/telemetry path may not be firing in local/browser run. |
| Filler recall missed `um` | Expected fillers: `um`, `basically`, `like`; recognized only `basically`, `like` in the raw Native output. | Product metric blocker; formatter must not remove or invent fillers. |
| Detail transcript empty or not extracted | Latest proof reported saved/history true but detail transcript empty/not extracted. | TEST must separate harness extraction from product state; DEV patches if app detail diverges from saved transcript. |
| Trust hooks were present, but perceptibility still needs proof | Proof captured draft/trust state fields; user experience still needs confirmation that banner is visible and stable while interim text changes. | TEST rerun with screenshots/trace; DEV adjusts UI only if banner is not perceptible. |
| Native artifact schema must use the full expected script | Prior artifact issue: `spokenSentence` was not always the full script read, which can corrupt WER/readability comparison. | TEST harness fix/discipline: store `expectedScript` separately and score against that. |

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

Edge/backend formatter contract:

```text
pnpm test:edge

11 files / 70 steps passed.
format-transcript confirms:
- engine=private hard-rejects with PRIVATE_FORMATTER_NOT_ALLOWED 403
- punctuation/casing-only output returns 200
- filler words are preserved
- dropped/reordered/changed words return FORMATTER_WORDS_CHANGED
- formatter logs do not include transcript text
```

Current interpretation:

```text
The formatter seam/backend contract is green in automated tests. The open Native browser bug remains:
the latest human proof had `window.__NATIVE_FORMATTER_LAST__ === null`, so the real Native session
did not prove formatter invocation. Browser rerun still owns release verdict.
```

---

## TEST/RELEASE UPDATE (2026-06-03T15:30Z) — live interim duplication/jumpiness fixed

Human Native proof reported jumpy interim text and an unclear trust disclaimer. A direct UI inspection
found one obvious contributor in `LiveTranscriptPanel`: when an interim hypothesis differed from the
committed transcript, the same interim text rendered twice — once as `live-transcript-current-line` and
again inline in the transcript body.

Fix on main:

```text
frontend/src/components/session/LiveTranscriptPanel.tsx
```

The draft/interim hypothesis now renders once, inline with the transcript, while preserving:

```text
data-testid="live-transcript-current-line"
data-transcript-draft="true"
aria-label="Draft transcript, still being recognized"
```

Validation:

```text
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false \
  frontend/src/components/session/__tests__/LiveTranscriptPanel.component.test.tsx

19 tests passed.
```

Native still requires browser proof. The rerun must show the Draft banner is visible from mic-on, the
interim text is not duplicated/jumpy, the trust-state hooks above match the visible UI, formatter
telemetry is captured, and save/history/detail match.

---

## TEST/RELEASE UPDATE (2026-06-03T16:35Z) — Native trust-state proof hooks implemented

The #33 Native trust-hook request is no longer waiting on a product decision. The live transcript
panel now publishes explicit trust-state proof signals:

```text
data-draft-banner-visible
data-processing-visible
data-final-state-visible
data-listening-visible
window.__SS_TRUST_STATE__
window.__SS_TRUST_TRACE__
```

Validation:

```text
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false \
  frontend/src/components/session/__tests__/LiveTranscriptPanel.component.test.tsx

20 tests passed.
```

Use these hooks for the next Native human proof. The browser proof still owns the release verdict:
Draft must be visible from mic-on through non-final transcript, Processing/Final states must line up
with the transcript lifecycle, and transcript WER/readability must use transcript-only text rather
than status/banner copy.
