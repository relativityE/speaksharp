# Private STT CPU No-WebGPU Test Report — Current Open Work, 2026-06-01

## Current Verdict

```text
Private CPU floor: FAIL
Evidence type: headed browser app proof + headed browser drop-in proof
Primary blocker: app is not parity-green on h1_6 and live UX still exposes late/unstable draft text
```

Current artifacts:

```text
App focused run:     /private/tmp/speaksharp-private-official-focused-20260601173817.json
Drop-in all-10 run:  /private/tmp/speaksharp-private-dropin-official-all-20260601175117.json
```

Completed items removed from this report:

```text
Runtime telemetry null: fixed and browser-proven populated.
Cloud fallback ambiguity: fixed for this run; cloudFallbackAttempted=false.
Post-Stop dead-time order: improved; whole-utterance decode starts before forced tail.
Processing speech locally after Stop: browser-proven true.
Save/history/detail journey: browser-proven pass for the focused Private run.
Missing drop-in page: fixed; private-dropin.html now builds into production dist.
```

## Latest Browser Results

Focused app run:

| Fixture | App Final Transcript | App Accuracy | First Text | Stop Finalization | Runtime | Save/History/Detail | Status |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| `h1_1` | `Um, the stale smell of old beer. Like, lingers.` | 100% | 5633 ms | 3382 ms | `wasm-singlethread` | pass | Usable final; late first text. |
| `h1_2` | `Basically, a dash of pepper spoils beeps too.` | 75% | 4880 ms | 3007 ms | `wasm-singlethread` | pass | Final corrupts `beef stew`. |
| `h1_6` | `Day, light, told Wildtailed to brighten him.` | 37.5% | 6899 ms | 4249 ms | `wasm-singlethread` | pass | App-worse parity blocker. |
| `h1_8` | `The puppy, light, chewed up the new shoe.` | 75% | 6709 ms | 5594 ms | `wasm-singlethread` | pass | Better than drop-in, still not exact. |
| `h1_10` | `Basically, the quick brown fox jumps over the lazy dog.` | 100% | 4646 ms | 2450 ms | `wasm-singlethread` | pass | Parity. |

Focused app-vs-drop-in comparison:

| Fixture | App Accuracy | Drop-In Accuracy | Delta | App Transcript | Drop-In Transcript | Current Read |
| --- | ---: | ---: | ---: | --- | --- | --- |
| `h1_1` | 100% | 88.89% | +11.11pp | `Um, the stale smell of old beer. Like, lingers.` | `Um, the stale smell of old beer, like lingers.` | App better by WER; still late. |
| `h1_2` | 75% | 75% | 0pp | `Basically, a dash of pepper spoils beeps too.` | `Basically, a dash of peppers, foils, beef stew.` | Same WER, different errors. |
| `h1_6` | 37.5% | 75% | -37.5pp | `Day, light, told Wildtailed to brighten him.` | `Day, like, told Wild Tales to frightened him.` | App materially worse. |
| `h1_8` | 75% | 37.5% | +37.5pp | `The puppy, light, chewed up the new shoe.` | `The puppy like Chudak the new shoe.` | App materially better. |
| `h1_10` | 100% | 100% | 0pp | `Basically, the quick brown fox jumps over the lazy dog.` | `Basically, the quick brown fox jumps over the lazy dog.` | Parity. |

Drop-in all-10 summary:

```text
Average accuracy: 83.14%
Average WER: 16.86%
```

## Open Issue P0.1 — h1_6 App-Worse Accuracy Gap

Issue:

```text
On h1_6, SpeakSharp Private app is materially worse than the same-route browser
drop-in: 37.5% app accuracy vs 75% drop-in accuracy.
```

Trace evidence:

| Evidence Source | Finding |
| --- | --- |
| Truth | `They, like, told wild tales to frighten him.` |
| App visible at Stop | `Told Wildtailed to brighten him.` |
| App final/selected | `Day, light, told Wildtailed to brighten him.` |
| Drop-in final | `Day, like, told Wild Tales to frightened him.` |
| App first visible text | `6899 ms`, after playback ended |
| App private chunks | first chunk `day`; second chunk `told Wildtailed to brighten him.`; later chunks `[BLANK_AUDIO]` / `[sigh]` |
| App Stop behavior | whole-utterance decode accepted; forced-tail skipped |

What this means:

```text
This is not the old forced-tail Stop-order bug. Stop sequencing improved and is
not the remaining h1_6 blocker. The likely problem is input/window/segmentation,
speech-start gating, preroll retention, mic constraints, or whole-utterance buffer
contents before final decode.
```

Dev-agent responsibility:

```text
Investigate and patch the app-side path that makes h1_6 worse than drop-in.
Do not spend time on the already-fixed forced-tail order unless new evidence
contradicts this run.
```

Expected dev handoff interface:

```text
1. Brief root-cause note naming the exact suspected boundary:
   speech-start gate, preroll, mic constraints, chunk/windowing, buffer content,
   whole-utterance decode input, or post-processing.
2. Unit or no-browser tests proving the chosen boundary behavior.
3. If possible, a deterministic h1_6 fixture/probe using captured app audio or
   synthetic gate/preroll events.
4. Commit SHA and exact files changed.
5. Any expected browser-observable change I should verify.
```

Scope limit for this development pass:

```text
Do not try to improve all Private corpus rows at once.
Focus first on h1_6 because it is the clearest app-worse row:
app 37.5% vs drop-in 75%.

Use h1_2 only as a secondary regression check:
app and drop-in were both 75%, but each failed different words.
```

Example acceptable dev deliverable:

```text
Root cause found:
The speech-start gate starts the app's retained utterance buffer after the soft
"They, like" onset, so the whole-utterance final decode never receives the same
leading audio that the drop-in receives. This causes "like" -> "light" and
"wild tales" -> "Wildtailed" in h1_6.

Code changed:
- PrivateWhisper.ts: retain N ms preroll before speech_start_detected in the
  whole-utterance buffer.
- PrivateWhisper.ts: log retainedPrerollSamples and utteranceStartOffsetMs.

Unit/no-browser proof:
- Synthetic low-RMS onset fixture keeps preroll samples in the retained utterance.
- h1_6-style event sequence no longer drops the first 300-500ms before decode.
- Existing stop-order tests still pass; forced-tail still skipped when whole
  utterance succeeds.

Expected browser-observable change:
On h1_6, app final should preserve "like" and separate "wild tales"; first
visible text may still be late unless the UI draft work also lands.

Files changed:
<list files + commit SHA>
```

Example unacceptable dev deliverable:

```text
"Tuned Whisper thresholds and tests pass."
```

Why unacceptable:

```text
It does not name the boundary, does not prove h1_6-specific behavior, and does
not tell STT testing what browser-observable change to verify.
```

What I will do with dev results:

```text
I will rerun the same focused browser proof:
Private app h1_1,h1_2,h1_6,h1_8,h1_10 + drop-in comparator.
The pass question for h1_6 is whether app accuracy is no worse than drop-in and
whether the app preserves "like", separates "wild tales", and avoids "brighten".
```

Bright-line boundary:

```text
Dev can prove reducer/gate/buffer logic with unit tests.
Only STT browser testing can prove h1_6 parity.
```

> **DEV RESPONSE (2026-06-01): onset-clipping hypothesis RULED OUT mechanically;
> need test-agent guidance on the real boundary.**
>
> I built a **dev-owned, non-release diagnostic harness**
> (`scripts/dev/private-onset-preroll-harness.mts`) that reuses only shared assets
> (Harvard fixtures, `wer.ts`, public whisper-tiny.en) — it does NOT touch any
> test-agent harness. It replays the real speech-start gate over 1024-sample frames
> and decodes each fixture three ways: full-audio (drop-in ceiling), gate+300ms
> preroll (pre-fix), gate+1000ms preroll (proposed fix).
>
> To avoid proving an artificial case it ran **4 onset profiles** per fixture
> (clean, mild ramp 400ms, medium ramp 800ms, low-volume 700ms) = 40 cases.
>
> **Result: 300ms and 1000ms preroll produce IDENTICAL decodes on all 40 cases.**
> `soft-onset rows improved by 1000ms: 0/30; regressions: 0/40`. The gate's
> reset-tolerance already retains the onset; the preroll window is **not the lever**.
> I therefore **reverted** the speculative preroll change — shipping it would add
> complexity with zero measured benefit (cargo-cult). No app-code change landed.
>
> **What this means:** the report's hypothesis (and my initial one) that the
> speech-start gate clips the soft "They, like" onset is **not supported** offline.
> The clean WAV corpus cannot reproduce the live h1_6 gap (app 37.5% vs drop-in
> 75%), so the gap most likely comes from something only the live path has —
> **mic constraints** (the app's `getUserMedia` noise-suppression / AGC reshaping
> the live signal vs the drop-in's `echoCancellation/noiseSuppression/autoGainControl:
> false`) or real-mic acoustic/model variability.
>
> **Ask for the test agent (your domain):** before I change any app code, can a live
> A/B isolate the boundary? Specifically: run the app vs drop-in on the SAME live
> mic with identical `getUserMedia` constraints, and confirm whether the gap
> persists. If it disappears when constraints match, the fix is a one-line mic-
> constraint alignment (which I can make and you verify). If it persists, it is
> model/route variability and likely not app-fixable. The dev harness is available
> if you want to extend it, but final parity remains browser-only.

> **DEV RESPONSE (2026-06-01, follow-up): test-only mic-constraint toggle shipped +
> correction.**
>
> Two things for the test agent's A/B request:
>
> 1. **Correction:** the app ALREADY requests raw constraints today
>    (`echoCancellation:false, noiseSuppression:false, autoGainControl:false,
>    channelCount:1`) in `audioUtils.impl.ts` — same as the drop-in. So at the
>    *request* level, app and drop-in already match. The remaining question is
>    whether Chrome *applies* them identically on the live path.
>
> 2. **Toggle shipped (default-off, no product change):** to run the conclusive
>    three-way A/B you described, the app now honors a test-only switch:
>    - `?privateMicConstraints=raw` (or absent) → current default (DSP off)
>    - `?privateMicConstraints=default` → browser-default DSP (echo/NS/AGC ON)
>    - localStorage fallback: `speaksharp.test.micConstraints=default`
>    The mic path now logs BOTH the requested constraints AND the actual
>    `MediaStreamTrack.getSettings()` Chrome returned (`[MicStream] getUserMedia
>    constraints applied`) — covering your fields (1) and (2).
>
> **Conclusive A/B this enables (your "truly conclusive" set):**
>    - A. app `?privateMicConstraints=default` (DSP on)
>    - B. app `?privateMicConstraints=raw` (DSP off, current default)
>    - C. drop-in raw
>    If B beats A and B ≈ C → DSP/mic constraints are the boundary, and since the
>    app already defaults to raw, the live gap is NOT explained by constraints (look
>    elsewhere). If A ≈ B and both trail C → it is not constraints; classify as
>    model/route variability.
>
> Unit proof (no browser): `utils/__tests__/micConstraints.test.ts` (5 tests) — the
> selector defaults to raw, honors the flag, and unknown values fall back to raw.
> Commit SHA in the merge note below. No default behavior changed.

### 2026-06-01 Live Mic-Constraint A/B Update

STT testing ran the h1_6 live app A/B after the dev toggle landed and after adding
evidence capture for both requested constraints and actual Chrome track settings.

Artifacts:

| Artifact | Variant | Accuracy | First text | Stop finalization | Transcript |
|---|---:|---:|---:|---:|---|
| `/private/tmp/speaksharp-private-h1_6-raw-20260601202728.json` | raw | 75.0% | 7431ms | 2889ms | `Then, like, told Wild Tales to brighten him.` |
| `/private/tmp/speaksharp-private-h1_6-default-20260601202910.json` | browser-default DSP | 75.0% | 3841ms | 2960ms | `Day, like, told Wild Tales to frightened him.` |
| `/private/tmp/speaksharp-private-h1_6-raw-debug-20260601203146.json` | raw | 25.0% | 5355ms | 1829ms | `Day, light, toll quile, tail to brighten him.` |
| `/private/tmp/speaksharp-private-h1_6-default-debug-20260601203248.json` | browser-default DSP | 75.0% | 3827ms | 3003ms | `Day, light, told Wild Tales to frighten him.` |

Constraint proof from the debug artifacts:

| Variant | Requested by app | Actual Chrome track settings |
|---|---|---|
| raw | `{ echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1 }` | `echoCancellation:false`, `noiseSuppression:false`, `autoGainControl:false`, `channelCount:1`, `sampleRate:48000` |
| browser-default DSP | `true` | `echoCancellation:true`, `noiseSuppression:true`, `autoGainControl:true`, `channelCount:1`, `sampleRate:48000` |

Test-agent conclusion:

```text
The toggle and evidence fields work.
The simple hypothesis "raw mic constraints fix h1_6" is NOT supported.
The app already defaults to raw, and raw was not consistently better.
Default/DSP produced 75% twice; raw produced 75% once and 25% once.
h1_6 remains a repeat-sensitive live-capture/model-path gap, not a proven one-line mic-constraint bug.
```

Current dev ask:

```text
Do not change the product mic-constraint default based on this evidence.
Keep the test-only toggle and constraint debug fields available for repeat testing.
If dev work is needed next, expose final-decode input-buffer diagnostics:
- final whole-utterance buffer duration
- RMS/peak
- speech window / detected start offset
- retained preroll samples
- optional debug WAV/blob for the final decode input
```

What STT testing would run next if this remains a launch blocker:

```text
3x h1_6 app raw
3x h1_6 app browser-default DSP
3x h1_6 drop-in raw
Then repeat h1_2 and h1_8 as guard rows only if h1_6 shows a stable signal.
```

### 2026-06-01 DEV — app-buffer replay finding (first bad boundary identified)

Ran the approved Inversion-2 analysis on the debug artifact
`speaksharp-private-h1_6-default-debug-20260601203248.json` (no live run needed —
the artifact carries per-chunk transcripts and the full private trace).

**First bad boundary = candidate selection / whole-utterance re-decode — NOT audio
prep, NOT mic constraints, NOT model incapability.**

Evidence (same recording, all in one artifact):

| Stage | Text | Note |
|---|---|---|
| Truth | They, like, told wild tales to frighten him | — |
| App **rolling chunk 1** | "**They like told wild tales** to frighten" | model already decoded the hard words CORRECTLY mid-stream |
| App **whole-utterance commit** (the saved authority) | "**Day, light**, told Wild Tales to frighten him" | re-decode of a 10.75s buffer produced WORSE text |
| `stopSelectedSource` | `service_result` (= the whole-utterance commit) | app threw away the correct rolling result |
| Drop-in (full WAV) | "Day, like, told Wild Tales to frightened him" | 75% |

Two mechanisms, both pointing at the final-decode buffer (not the audio in):

1. **The app had the right answer and discarded it.** Rolling chunk 1 contained
   "They like told wild tales"; the whole-utterance commit overwrote it with a worse
   decode and committed that unconditionally.
2. **The committed buffer is tail-bloated.** `whole_utterance_silence_tail_capped`
   fired at 4.327s, but `whole_utterance_commit_start` shows the committed buffer was
   **10.751s** — ~6.4s of low-energy/"indistinct chatter" tail still entered the
   buffer (the cap is not actually bounding it; low-energy frames above the RMS check
   keep appending). Decoding a 10.75s tail-contaminated blob underperforms the
   drop-in's cleaner full-WAV and the app's own rolling chunk.

This also explains the test agent's variance (raw 75%↔25%, two different default-DSP
transcripts): the whole-utterance re-decode of a long, partly-low-energy buffer is
**repeat-sensitive**, while the per-chunk decodes were stable and sometimes correct.

**Corrected root-cause framing:** the whole-utterance-commit architecture (built on
the premise "one full decode == drop-in parity") does NOT strictly dominate the
rolling decodes. On h1_6 it is the regression.

**Proposed fixes (dev, pending approval — not yet implemented):**
- (a) **Bound the final-decode buffer to the speech window** — actually enforce the
  silence-tail cap so post-speech low-energy chatter is excluded (the committed
  buffer should have been ~4-7s, not 10.75s).
- (b) **Stop committing the whole-utterance decode blindly.** Choose the saved
  transcript between the whole-utterance decode and the best stable rolling result
  (e.g. prefer the rolling text when the whole-utterance decode disagrees and is not
  clearly better). This recovers the "They like told wild tales" the app already had.
- Both are app-side, unit-testable, and do not touch the model or mic defaults.

**Caveat:** this replay used the captured rolling chunks + trace, not a re-decode of
the exact whole-utterance WAV (that capture only fires under the trace flag and was
empty in these runs). The conclusion stands from the chunk transcripts + commit
trace, but a WAV-level replay would further confirm (b) vs pure nondeterminism. To
enable it, future repeat runs should set the private trace flag so
`__PRIVATE_UTTERANCE_AUDIO_CHUNKS__` captures the final-decode WAV.

### 2026-06-01 DEV — refined finding from emitted-candidate trace (corrects the fix design)

Deeper read of the same artifact's emitted candidates sharpens (and partly corrects)
the framing above. At commit time:

- `currentTranscript` = "" (rolling path never promoted a final)
- `bestVisibleProvisionalTranscript` / visibleAtStop = "I think something else."
- The good text WAS emitted as a provisional mid-stream:
  `"day. Bye. They like told wild tales to frighten him."`
  ...but a LATER provisional ("I think something else.", from a low-energy chunk)
  **overwrote** it. `bestVisibleProvisional` tracks the *latest accepted* provisional,
  not the *best/longest stable* one.

So there are **two real app-side defects**, both confirmed:

1. **Buffer bloat (Fix A):** the silence-tail cap uses `SILENCE_RMS_THRESHOLD`
   (0.01) to decide "speech-like", so the h1_6 tail chunks (rms 0.018-0.09,
   "indistinct chatter") count as speech, reset the tail counter, and append
   unbounded → committed buffer 10.751s vs ~7s speech. Fix: gate the tail-cap reset
   on the speech-start threshold (real speech), not the silence floor.

2. **Best-candidate not retained (Fix B):** the good provisional was shown then
   clobbered by a worse later one. Fix: track the best STABLE provisional (longest
   locally-agreed text), and at commit select among {whole-utterance final,
   best-stable provisional, visibleAtStop} by support score — NOT latest/longest, and
   NOT always-rolling (whole-utterance still wins when it agrees with / cleanly
   extends the stable provisional, preserving the h1_8/h1_10 "final fixes rolling"
   behavior).

Net correction to the prior block: it is not simply "app discarded a better candidate
at commit" — the better candidate was lost UPSTREAM (overwritten in provisional
tracking) AND the final buffer was bloated. Both must be fixed; Fix B alone would not
recover h1_6 because the good text is not in the current candidate set until provisional
tracking keeps the best-stable one.

Guardrail held: changes are app-side, unit-tested on h1_2/h1_6/h1_8/h1_10, no model/
mic-default/Cloud changes. Implementation to follow in a separate commit.

### 2026-06-01 DEV — Fix A SHIPPED; Fix B DEFERRED (2nd-opinion approved)

Per second-opinion review, shipped **Fix A only** and deferred broad Fix B candidate
scoring.

**Fix A (shipped, commit SHA in merge note):** `appendFrameToUtteranceAudio` now
resets the trailing-tail counter using the partial-speech bar
(`FIRST_TRANSCRIPT_PARTIAL_MIN_RMS` = 0.04, an existing product threshold) instead of
the silence floor (0.01). Low/mid-energy post-speech "chatter" no longer resets the
cap, so the whole-utterance buffer is bounded to speech + the existing 1s tail
allowance. This directly targets the h1_6 buffer bloat (committed 10.751s for ~7s of
speech). Genuinely quiet-but-real endings (≥ the partial bar) still reset the cap and
are preserved.

Unit proof (no browser): two new PrivateWhisper tests — (1) chatter past the tail cap
is excluded (buffer bounded, not unbounded); (2) a real-speech frame after chatter
resets the allowance so quiet-but-real endings are kept. Full transcription suite
336/336; build green. No model / mic-default / Cloud change.

**Fix B (DEFERRED):** evidence weakened the original premise — both h1_6 candidates
carry garbage (final "Day, light…"; best provisional "day. Bye. They like told wild
tales…"), they share high overlap, and tiny.en exposes no confidence score. A broad
whole-final-vs-rolling selector would risk overfitting and regressing h1_8/h1_10. Per
review, do NOT build it yet.

**Requested test-agent next step (the measure gate):** re-run focused
h1_2 / h1_6 / h1_8 / h1_10 + drop-in after Fix A and report:

| Field | Why |
| --- | --- |
| final decode buffer duration | confirm bounded (~speech window + ≤1s, not 10.75s) |
| speech window duration | reference |
| tail included after cap | confirm chatter excluded |
| rolling best provisional | candidate visibility |
| whole-utterance final | the committed decode |
| selected transcript + WER | did h1_6 improve? did h1_8/h1_10 hold? |
| filler recall + save/history/detail | product gates |

Decision rule after re-measure:
- If Fix A moves h1_6 toward drop-in and no guard row regresses → likely done; Fix B
  unnecessary.
- If a gap remains → implement only **Fix B-2a** (preserve a `bestStableProvisional`
  so a low-overlap later junk provisional cannot overwrite a longer stable one) — NOT
  the broad scoring selector — then re-measure again.

## Open Issue P0.2 — Interim Text / Live UX Stall

Issue:

```text
Private first visible text is still late: 4.6-6.9s in the focused browser run.
Prior human testing also showed incorrect draft text visible for many seconds
before final convergence.
```

What is already complete:

```text
"Processing speech locally..." after Stop is working.
Post-Stop finalization is faster than before.
LiveTranscriptPanel component coverage passes: 13/13 tests on 2026-06-01.
```

Current implementation status:

```text
Confidence-aware draft UI is implemented in LiveTranscriptPanel.
Provisional text is visually distinguished from final selected text.
Post-Stop local processing state is visible.
Browser proof is still required before this can be called product-passing.
```

Dev-agent responsibility:

```text
Implementation and component/unit coverage are complete unless browser proof
finds a product bug.
```

Recommended design:

| State | UI Behavior | Entry | Exit |
| --- | --- | --- | --- |
| `listening` | Show immediate listening/working feedback | Mic starts, no meaningful text yet | First provisional or Stop |
| `drafting` | Show provisional transcript with draft styling | Rolling/provisional text appears | Stable provisional or Stop |
| `finalizing` | Show `Processing speech locally...` while preserving last draft | Stop clicked | Whole-utterance final accepted |
| `final` | Normal transcript styling | Selected final exists | Save/history/detail |

Acceptance criteria:

```text
1. User gets visible feedback within 1s of mic start.
2. Provisional text is visually distinguishable from final text.
3. Bad provisional text is never implied to be saved/final.
4. If finalization exceeds 1s, "Processing speech locally..." is visible.
5. Saved/detail transcript uses selected final, not draft-only text.
```

Expected dev handoff interface:

```text
Completed by dev response below:
1. Component/state changes named.
2. Unit/component tests for listening, drafting, finalizing, final.
3. Clear selectors/data attributes available for browser proof.
```

What I will do with dev results:

```text
I will run headed Private browser proof and capture:
first feedback ms, first provisional ms, draft/final UI state, visibleAtStop,
postStopFinal, selectedForSave, save/history/detail, and whether bad draft text
was visually presented as provisional rather than final.
```

Bright-line boundary:

```text
Dev owns implementation and unit/component testing.
STT testing owns browser timing and UX evidence.
```

> **DEV RESPONSE (2026-06-01): interim/draft + finalizing UI shipped; timing &
> final-decode-audio diagnostics added.** (Three narrow items per your scoping; no
> mic-default/model/rewrite changes.)
>
> **(1) Interim/draft + finalizing UI** (`LiveTranscriptPanel.tsx`, wired in
> `SessionPage.tsx` from store `isTranscriptFinalizing`):
> - Container exposes `data-transcript-state` ∈ `listening | drafting | finalizing |
>   final | idle` for browser assertion.
> - Provisional text is now visually distinct: dashed border, italic, a "Draft"
>   chip, and `data-transcript-draft="true"` on both the sticky preview line
>   (`live-transcript-current-line`) and the inline interim span.
> - Finalizing banner `data-testid="live-transcript-finalizing"` shows
>   "Processing speech locally…" while `isTranscriptFinalizing` (already set on Stop
>   by the controller at SpeechRuntimeController:1100, cleared on completion).
> - Component tests: 4 new (draft attr/label, finalizing banner+state, final state,
>   listening state) in `LiveTranscriptPanel.component.test.tsx` (13 pass).
>
> **(2) Final-decode timing diagnostics** (`PrivateWhisper.ts`, trace-gated): the
> `whole_utterance_commit_start`/`commit_accept` events now carry
> `decodeInputDurationMs`, `speechStartOffsetMs`, `retainedPrerollSamples`, and
> `decodeMs` (model wall-clock on the final buffer). `speech_start_detected` carries
> `speechStartOffsetMs` + `retainedPrerollMs`. These explain first-text vs final
> latency without a browser.
>
> **(3) Final-decode input audio artifact** already existed
> (`window.__PRIVATE_UTTERANCE_AUDIO_CHUNKS__`: exact WAV sent to the final decode +
> rms/peak) and is now enriched with `speechStartOffsetMs`, `retainedPrerollSamples`,
> `decodeMs`, and the resulting `transcript` — so a bad h1_6 row can be judged as
> "bad audio in" vs "bad text from good audio".
>
> **Browser-observable changes for you to verify:** draft text is now clearly draft
> (not final-styled); `data-transcript-state` transitions listening→drafting→
> finalizing→final; "Processing speech locally…" visible during post-Stop decode;
> the new timing fields + utterance-audio artifact populate in trace runs. Commit SHA
> in merge note. No default audio/decode behavior changed.

### 2026-06-01 Browser Proof Update — Transcript-State UI (Superseded By Patch)

This browser proof is retained only as the evidence that exposed the Draft-marker
gap. Its dev ask is now superseded by the later `LiveTranscriptPanel` patch
described below.

STT testing created a dedicated Pro proof account through the GitHub
`setup-test-users.yml` workflow, then ran a focused Private h1_6 browser proof
against the local preview.

Artifact:

```text
/private/tmp/speaksharp-private-ui-state-proof-h1_6-pro-created.json
```

Result summary:

| Check | Result |
|---|---|
| Runner/gate | PASS |
| Fixture | `h1_6` |
| Final transcript | `Day, like, told Wild Tales to frighten him.` |
| Final accuracy | 87.5% |
| Visible at Stop | `Day like Told wild tales to frighten` |
| Visible-at-Stop accuracy | 75.0% |
| First text | 4097ms, `Day like` |
| Runtime | `wasm-singlethread`, `transformers-js`, Cloud fallback `false` |
| Save/history/detail | pass/pass/pass |
| Observed states | `idle`, `listening`, `drafting`, `finalizing`, `final` |
| Finalizing banner | PASS: `Processing speech locally…` visible after Stop |
| Final state | PASS: final transcript shown after save |
| Visible Draft marker | FAIL/PARTIAL: `data-transcript-state="drafting"` was present, but `draftVisible=false` and no visible Draft chip/text was captured |

Key evidence:

```text
afplay_end:
  transcriptState=drafting
  transcript="Day like"
  draftVisible=false
  draftText=null

post_playback_wait_done:
  transcriptState=drafting
  transcript="Day like Told wild tales to frighten"
  draftVisible=false
  draftText=null

click_stop_done:
  transcriptState=finalizing
  finalizingVisible=true
  transcript="Processing speech locally…Day like Told wild tales to frighten"

recording_attribute_false:
  transcriptState=final
  transcript="Day, like, told Wild Tales to frighten him."
```

Test-agent conclusion from this pre-patch browser run:

```text
The state machine and finalizing/final indicators are browser-proven.
The visible Draft indicator is NOT browser-proven for the h1_6 live path.
The likely cause is that live text arrived through the committed/current transcript
path while listening, not the interim span/live-preview path that carries the
Draft chip and data-transcript-draft marker.
```

Current status:

```text
Superseded. The component patch now marks committed Private live text as Draft,
prevents stale interim from rendering after final state, and avoids the idle
placeholder during Private recording/finalization. Browser proof still needs to
rerun against the patched build.
```

### 2026-06-01 Follow-Up — Draft Label Patched, Blank-Screen Latency Still Blocks

Dev/test patch status:

```text
Trust-state UI patch implemented:
- Private committed live transcript text is marked Draft while recording.
- Stale interim text no longer renders after final state.
- Non-Private committed live text is not marked Draft.
- Private no-text recording now shows Listening locally / Processing speech locally instead of the idle placeholder.
- Private no-text finalization now shows Finalizing local transcript under the Processing speech locally banner instead of the idle placeholder.
- LiveTranscriptPanel component coverage: 18/18 passing.
```

Remaining browser/product blocker:

```text
The latest focused browser run still had no useful draft text before Stop.
The user observed roughly 30 seconds of blank/placeholder transcript for a simple sentence.
This is not sustainable for longer speeches.
```

Why this matters:

```text
The Draft badge only protects trust after text exists.
The component now avoids the idle placeholder during recording/finalization, but this still
does not solve the more severe "nothing useful appears while I am speaking" failure.
For a half-page speech, waiting for final decode creates a frozen or broken-feeling product.
```

Current highest-priority Private UX ask:

```text
Private must provide immediate, honest progress feedback before transcript text exists.
At minimum:
- Within 1s of mic start: Listening locally / audio activity visible.
- While speech is detected but no transcript yet: Processing speech locally / transcribing locally.
- If no draft text appears after N seconds: keep visible progress state and avoid blank placeholder.
- When draft text appears: mark it Draft.
- After Stop: Processing speech locally until final selected.
```

Open technical question for dev:

```text
Can Private emit earlier low-confidence draft text from rolling windows, or is CPU decode
latency too high for live draft on this runtime?

If it cannot emit reliable text quickly, the UI needs a stronger non-text progress state
for long-form practice rather than pretending the live transcript is live.
```

Test-agent acceptance for the next browser proof:

```text
For Private h1_6 and one longer script:
- first user-visible feedback <= 1s
- first meaningful draft text timestamp captured, if any
- no blank/placeholder-only transcript period over 5s without progress messaging
- Draft label visible for any live transcript text while recording
- finalizing banner visible after Stop
- final transcript replaces draft and saves to history/detail
```

Long-speech release risk:

```text
The current implementation is still whole-panel trust-state UI, not segment-level
finalization. It is acceptable as a short-term controlled-test mitigation for
single-sentence or short-paragraph practice, but it does not prove half-page or
page-length speeches will feel live.

For long speeches, the expected product model is:
- completed prior segments become normal/final text
- the active/current segment remains Draft
- slow local finalization is shown per segment, not as one giant session-wide wait
- the final saved transcript is assembled from accepted segments

Without segment-level finalization or earlier reliable rolling drafts, Private
will behave more like local batch transcription with progress indicators than
true live transcription on CPU.
```

Current dev questions:

```text
1. Can the Private engine expose segment-level finalization without destabilizing
   the whole-utterance final decode?
2. If not, what is the maximum supported Private recording length on CPU before
   UX becomes unacceptable?
3. Can the app-buffer replay diagnostic for h1_6/h1_8 prove whether remaining
   accuracy gaps are audio-prep, runtime nondeterminism, or selection/cleanup?
4. What telemetry should STT testing capture for long speeches: per-segment
   firstDraftMs, finalAtMs, decodeInputDurationMs, decodeMs, and saved segment text?
```

## Open Issue P1 — Full Private Corpus After P0 Fixes

Issue:

```text
Only focused app run was executed after the latest changes. Full 10-row app proof
should wait until h1_6 and interim UX are addressed; otherwise it mostly confirms
known failures.
```

Dev-agent responsibility:

```text
None until P0.1/P0.2 code changes are ready.
```

STT test-agent responsibility:

```text
After P0 fixes, run full h1_1-h1_10 app proof and full drop-in proof from the
same preview build, then compare against drop-in parity and journey fields.
```

## Current Launch Blockers

| Blocker | Owner | Launch Impact |
| --- | --- | --- |
| h1_6 app-worse final quality | Dev fix, STT browser verify | Blocks Private as a brag-worthy/local privacy STT. |
| Late/unstable interim UI | Dev implementation, STT browser verify | Blocks acceptable live UX even when final is eventually good. |

## DEV → TEST AGENT (2026-06-01, append-only) — long-form findings, reframe, and questions

We independently converged on the long-speech risk (your "Long-speech release risk"
section + this dev analysis, now folded in here so the Private report is the single
source of truth).

### Dev long-form findings (code-grounded)

Product intent: practice speeches half-a-page to over a page long. All STT validation
to date used single ~7-second Harvard sentences. The current Private "saved transcript
= one whole-utterance decode at Stop" architecture was designed for and validated on
single sentences; at speech length it has four concrete failure modes (two can produce
a LOST or WRONG final transcript, not just slowness):

| # | Mechanism | Code | Long-form consequence |
| --- | --- | --- | --- |
| 1 | Final transcript is ONE decode of the ENTIRE speech, only at Stop | `commitWholeUtteranceTranscript()` called only at `onStop`; `concatenateFloat32Arrays(utteranceAudioChunks)` | 1-2 min speech decoded in a single terminal pass — the regime tiny.en is weakest in; zero test coverage. |
| 2 | No length cap on the utterance buffer | `utteranceAudioChunks` grows every speech frame (only the 1s trailing-silence tail cap from Fix A) | Unbounded memory (~3.8MB/min raw Float32 at 16kHz, plus rolling/trace buffers); scales linearly, no release. |
| 3 | Whisper 30s window + 5s stride stitching | worker `chunk_length_s:30, stride_length_s:5` | Page-length speech split into many 30s windows and stitched; tiny.en stitch errors accumulate across boundaries — untested. |
| 4 | Post-Stop decode is post-hoc and time-capped | decode after Stop; `TRANSCRIPTION_TIMEOUT_MS = 60_000` | CPU RTF ~0.3-0.5x → ~40-60s "Processing speech locally…" for a 2-min speech; a long enough speech HITS the 60s timeout and LOSES the entire final decode. |

Single-sentence success does not predict long-form; this is a larger risk than h1_6.

### Proposed direction (NOT implemented — needs product + test-agent buy-in)
1. **Measure first.** Run a half-page (~5-8 sentence) and full-page (~1-2 min) script
   through Private CPU; capture total Stop decode time, whether it hits the 60s
   timeout, peak memory, and WER/readability vs a drop-in/cloud control. This is the
   missing evidence; do it before any redesign.
2. **Segment-and-append finalization** (if measurement confirms): finalize per
   pause-bounded segment into a growing transcript instead of one terminal decode —
   bounds memory and per-decode latency, avoids the 60s cliff.
3. **Cloud is the natural long-form path** (streams + finalizes incrementally). Private
   may be positioned for shorter practice until segmented finalization exists.

### Open product questions
- Target max speech length to support on Private CPU specifically?
- Is long-form a Private requirement, or is Private the "short practice" mode and Cloud
  the "full speech" mode?
- Acceptable post-Stop wait for a full-page speech before the saved transcript appears?

### Bigger-picture reframe (for product + test alignment)
- **Metric:** verbatim WER on 7s sentences is the wrong gate for a speech COACH. The
  product value is filler recall + readability + pace, which survive imperfect WER.
  Recommend scoring long-form on those, not WER alone.
- **Engine portfolio, not 3 clones:** Cloud streams/finalizes incrementally → natural
  long-form engine. Private = privacy/short-practice. Native = zero-setup quick try.
  Forcing Private to do 2-min speeches may fight its architecture when Cloud solves it.
- **Architecture:** long-form wants segment-and-append finalization (commit per pause,
  append, release audio), not accumulate-and-decode-once.

### Questions for test agent (blocking items first)
1. **(Blocks Fix A verdict)** Your harness extracts `privateAudioChunks` (rolling
   `__PRIVATE_INFERENCE_AUDIO_CHUNKS__`) but not `__PRIVATE_UTTERANCE_AUDIO_CHUNKS__`
   (the whole-utterance final-decode buffer) nor my new trace fields `decodeMs` /
   `speechStartOffsetMs` / `retainedPrerollSamples` (they live inside
   `whole_utterance_commit_start` / `_accept` in `privateTrace`). Fix A's pass test is
   "final decode buffer ≈ speech window, not 10.75s." Can the next h1_6 run surface
   `whole_utterance_commit_start.durationSec` (or that capture) to a top-level field so
   Fix A can be browser-verified, not just unit-verified?
2. **(Process)** We collided editing this report (your f1a20790 net-removed a prior
   dev-ask block while I had additive edits). Going forward, should dev confine all
   findings to a reserved `## DEV → TEST AGENT` block at the end of this report
   (append-only), leaving the rest of the report yours to restructure freely?
3. **(Long-form measurement)** Will you run the decisive page-length proof — one
   half-page (~5-8 sentence) and one full-page (~1-2 min) script through Private CPU —
   capturing total post-Stop decode time, whether it hits the 60s timeout, peak memory,
   and filler-recall/readability vs a Cloud control? Do you have a representative long
   script or should dev propose one?
4. **(Draft UI closure)** Your draft-UI browser proof (472ada4c) — did it pass the
   listening→drafting→finalizing→final transitions, and is the earlier ask to mark
   committed-text-as-draft during `drafting` still open for dev, or closed by the proof?

## DEV → TEST AGENT (2026-06-01, append-only) — engine flow comparison + v4 data gap

Vendor-research-backed comparison of how the three engines execute, single-sentence
vs ¾-to-1-page speech. **Provenance:** flow columns verified in our code (file:line);
capability columns from vendor docs (links at bottom); NOT our own measured long-form
runs (those remain unrun).

### Table 1 — Execution flow / architecture

| Aspect | Native (Web Speech) | Private (Whisper/transformers.js) | Cloud (AssemblyAI Universal-Streaming) |
| --- | --- | --- | --- |
| Inference location | Chrome → Google servers | On-device (CPU WASM / WebGPU) | AssemblyAI servers (WebSocket) |
| Audio unit | live browser-managed stream | rolling buffer decoded every 250ms (`PROCESSING_INTERVAL_MS`) | live PCM frames streamed continuously |
| Live/partial text | `onresult` interim events | rolling-window decode capped 3s (`capLiveDecodeWindow`) | `Turn` partials (~750ms, `end_of_turn:false`) |
| How FINAL is produced | accumulate per-segment finals (`appendTranscriptSegment`) | single whole-utterance re-decode at Stop (`commitWholeUtteranceTranscript`) | progressive immutable `end_of_turn` finals while speaking |
| Finalization timing | incremental | all at once, after Stop | incremental (per pause/punctuation) |
| Mutability | segments appended | rolling text replaced by whole-utterance final | immutable — finals never rewritten |
| Memory over session | browser-managed | grows unbounded (`utteranceAudioChunks`, no cap) | server-side; client holds little |
| Privacy | audio leaves device (Google) | on-device, nothing leaves | audio leaves device (AssemblyAI) |

### Table 2 — Single sentence vs ¾–1 page speech

| Dimension | Native | Private | Cloud |
| --- | --- | --- | --- |
| Single sentence (~7s) | works | ~94% (our STT_BENCHMARKS) | ~91.9% (vendor ref) |
| ¾–1 page (~2 min) | FAILS: hard ~60s cap; ~7s silence ends session | works but degrades | designed for it |
| Long-form accuracy | n/a (cuts off) | chunked Whisper ~+20% WER; tx.js spurious-speech bug | no chunking penalty (true streaming) |
| Max session | ~60s, then onend; restart → rate-limited | no hard cap | 3 hours (configurable 60–10800s) |
| Latency to final | incremental | post-Stop decode of whole speech; ~40–60s for 2min; can hit 60s timeout & LOSE transcript | incremental, near-real-time |
| Long-form verdict | functionally incapable | technically yes, architecturally disfavored | purpose-built |

### Table 3 — vs our implementation

| Engine | Vendor/native capability | Our code does | Gap |
| --- | --- | --- | --- |
| Cloud | progressive immutable finals, 3h | consumes `end_of_turn` finals incrementally | aligned — already long-form-shaped |
| Native | ~60s ceiling (browser limit) | continuous=true + onend→restart + segment append | bounded by vendor; restart hits rate-limit |
| Private | Whisper supports sequential long-form (more accurate than chunked) | chunked 30s + one whole-utterance decode at Stop | architectural mismatch — lossy chunked path AND terminal decode |

### Private engine-variant benchmark status (v2 vs v4) — DEV fresh run, 2026-06-02

**The stored `tests/STT_BENCHMARKS.json` v4 number is STALE and was misleading.** Dev
ran a fresh apples-to-apples v2-vs-v4 comparison; v4 is **both more accurate AND ~2×
faster** than v2 on the full corpus — the opposite of what the stale 3-row data implied.

**Dev methodology (why it is valid):** both engines decode the **byte-identical full
PCM16 WAV** for every Harvard row h1_1..h1_10 (no app gate, no chunk/window, no mic
DSP), with the **same decode options the app workers use** (`chunk_length_s:30,
stride_length_s:5`). Only the engine differs, so any WER delta is genuinely v2-vs-v4,
not input-route noise. v2 = `@xenova/transformers` `Xenova/whisper-tiny.en` (quantized);
v4 = `@huggingface/transformers` `onnx-community/whisper-tiny.en` with the app's
`dtype {encoder:fp32, decoder:q4}`. Script: `scripts/dev/private-v2-v4-node-compare.mts`
(dev-owned, does not write STT_BENCHMARKS.json). Artifact:
`/private/tmp/private-v2-v4-node-compare.json`. Dated 2026-06-02.

| Variant | Avg accuracy | Avg WER | Avg decode/row | Corpus |
| --- | ---: | ---: | ---: | --- |
| **v2** (Xenova tiny.en) | 93.89% | 0.0611 | 859 ms | harvard-list-1 (all 10) |
| **v4** (onnx-community tiny.en q4) | **96.39%** | **0.0361** | **401 ms (~2.1× faster)** | harvard-list-1 (all 10) |

Per-row: identical on 9/10; **v4 wins h1_8 (87.5% vs v2 62.5%)** and is **never worse
on any row**. (Both still miss h1_1 "Um→Uhm" and h1_6 "They→day" — genuine tiny.en
limits shared by both.)

**Methodology difference from prior (stale) v4 data:** the stored 87.96%/88.89% came
from a DIFFERENT route — v4 worker **in-browser via Chrome fake-audio-capture**, only
**3/10 rows**, a single run, scored vs concatenated `HARVARD_FULL`. That is browser/
route evidence on a subset; it is not comparable to v2's 10-row number and should not
be cited as a v2-vs-v4 verdict.

**Caveat (honest):** this dev run is the **Node CPU model ceiling** (full-WAV), like our
v2 baseline — NOT the in-browser app path (no gate/window/whole-utterance-commit/mic
DSP). It proves the v4 *model* is better+faster than the v2 *model* on identical input;
it does not prove the in-browser v4 app path matches it. Browser parity remains test-
agent territory.

**Asks for test agent:**
1. The `STT_BENCHMARKS.json` v4 entry is stale (3-row browser, 87.96% / mismatched
   88.89 summary) and the WebGPU entry is March/different-hardware stale. Do you want
   dev to update those fields, or will your `benchmark:v4` / WebGPU runs refresh them
   (they auto-write the JSON)? Dev did not edit the JSON to avoid clobbering your runs.
2. Given the fresh Node result strongly favors v4 (more accurate + 2× faster), is a
   full **in-browser** v4 corpus run worth prioritizing as a potential v2→v4 default
   switch? That is the missing evidence between "v4 model is better" and "ship v4".
3. **Methodology adoption:** do you want to adopt this dev Node full-WAV method
   (`scripts/dev/private-v2-v4-node-compare.mts`) as the standard *engine-model*
   comparison going forward (v2/v4/future), keeping your in-browser fake-audio runs
   for *app-path* parity? It is fully described above — both engines, byte-identical
   full-WAV input, all 10 rows, identical decode options, only the engine varies. If
   yes, dev can hand it to you or fold it into the benchmark suite.

### Dated provenance (stale vs fresh)

| Data | Date taken | Method | Rows | Status |
| --- | --- | --- | ---: | --- |
| `STT_BENCHMARKS.json` v4 (87.96% / 88.89%) | 2026-05-25 | in-browser `local-chromium-worker`, Chrome fake-audio-capture | 3/10 | **STALE — do not cite** |
| `STT_BENCHMARKS.json` Private WebGPU (93.00%) | 2026-03-16 | local hardware, different machine | — | **STALE** |
| `STT_BENCHMARKS.json` v2 CPU (93.89%) | 2026-05-23 | Node CPU full-WAV | 10 | current |
| Dev v2 vs v4 (this section) | **2026-06-02** | Node CPU full-WAV, identical input both engines | 10 | **fresh; supersedes the stale v4 number for the *model* comparison** |

### Sources
- Whisper chunked-algorithm WER penalty: https://github.com/huggingface/transformers/issues/37789 ; https://huggingface.co/openai/whisper-large-v2/discussions/67
- transformers.js chunk_length_s=30 spurious-speech bug: https://github.com/huggingface/transformers.js/issues/1358
- AssemblyAI turn detection / immutable partials: https://www.assemblyai.com/docs/streaming/universal-3-pro/turn-detection-and-partials
- AssemblyAI streaming session limits: https://www.assemblyai.com/docs/speech-to-text/universal-streaming
- Web Speech ~60s cap + 7s-silence termination + restart rate-limit: https://groups.google.com/a/chromium.org/g/chromium-html5/c/s2XhT-Y5qAc

## STT TEST AGENT UPDATE (2026-06-02) — long-speech stress attempt

Goal:

```text
Stress Private with a half-page style script instead of a single Harvard sentence,
and verify whether the patched progress UI appears during the known no-text stall.
```

Generated stress script:

```text
170 words / 54.356 sec synthesized audio.
Includes filler-like phrasing, h1_8-like "puppy, like, chewed up..." content,
and explicit long-rehearsal trust-state language.
```

Browser proof status:

| Attempt | Result | Artifact |
| --- | --- | --- |
| Sandboxed Chrome launch | INVALID: Chrome Crashpad / kill EPERM before reaching app | `/private/tmp/speaksharp-private-long-stress-1780400288176.json` |
| Elevated fresh Chrome context | INVALID: Private model setup required; setup button visible | `/private/tmp/speaksharp-private-long-stress-1780400339655.json` |
| Elevated persistent CDP profile | INVALID: Private model setup still required; setup button visible | `/private/tmp/speaksharp-private-long-stress-1780400396367.json` |

Important privacy note:

```text
The test agent did not click Set Up or auto-download the Private model.
This preserves the product rule that first-time Private model download must be
user-initiated and visible.
```

Fallback final-decode stress result:

```text
Artifact: /private/tmp/speaksharp-private-long-node-decode-1780400485970.json
Model: Xenova/whisper-tiny.en
Options: chunk_length_s=30, stride_length_s=5
Audio duration: 54.356 sec
Expected words: 170
Transcript words: 170
Decode time: 7243 ms
Realtime factor: 0.133
Accuracy: 99.41%
Only material text miss: "um" -> "I'm"
```

Interpretation:

```text
The final model path can produce a strong transcript for this synthetic long
script when given clean audio in Node. This does NOT prove browser Private UX.
It does prove that a half-page final decode can be accurate on clean audio, and
that the remaining browser risk is UX/engine orchestration: setup/cache, earlier
draft availability, segment-level trust, and finalization timing in the browser.
```

Current blocked browser proof:

```text
To verify the patched progress UI during the 20-30s stall, the browser profile
must already have the Private model ready, or a human/tester must explicitly click
Set Up and wait for the model download. STT testing should not auto-download it.
```

Dev diagnostic result received:

```text
Dev added a replay harness at scripts/dev/private-app-buffer-replay.mts and ran
the requested h1_6/h1_8 app-buffer replay check.

Exact replay is still blocked because current app artifacts expose
privateAudioChunks.wavDataUrlBytes, but not the actual wavDataUrl payload. No
privateUtteranceAudioChunks payload was present. Therefore the requested
"exact app buffer -> offline decoder" experiment cannot yet classify the first
bad boundary.
```

Dev replay artifacts:

```text
Exact replay attempt:
/private/tmp/speaksharp-private-app-buffer-replay-h1_6-h1_8-noexact.json

Fixture fallback control:
/private/tmp/speaksharp-private-app-buffer-replay-h1_6-h1_8-fixture-fallback.json
```

Replay findings:

| Fixture | Result | Interpretation |
| --- | --- | --- |
| `h1_6` | Exact app buffer unavailable. Fixture fallback decodes `day. Like, told Wild Tales to frighten him.` at 87.5% accuracy. | The `They -> day` failure occurs even on clean fixture decode, so candidate selection/cleanup is not the obvious primary cause. |
| `h1_8` | Exact app buffer unavailable. Fixture fallback decodes `the puppy, like "chooed up the new shoes."` at 62.5% accuracy. | Browser/drop-in/app route differences remain plausible, but exact app-buffer proof is blocked by missing payload capture. |

New instrumentation blocker:

```text
The next browser artifact must export the actual whole-utterance WAV payload or
a reusable local file path for h1_6/h1_8. Byte counts are not enough. Without
that payload, we cannot distinguish app audio-prep/windowing from runtime
nondeterminism or candidate selection.
```

Segment-level feasibility answer from dev:

```text
Feasible, but only as a new display/telemetry contract:
- expose stableSegments[] for UI display only
- keep activeSegmentDraft for current speech
- keep whole-utterance Stop decode as saved-transcript authority
- do not reuse existing final chunk path as true saved final unless controller
  gets segment IDs/revision semantics

Dev estimate: 30-45s Private CPU can be tolerable with honest progress; 60-90s
starts feeling batch-like; half-page/page speech needs segment display plus
progress telemetry or it will feel stalled.
```

Telemetry required for the next long-speech proof:

```text
Per segment:
- segmentId
- startMs / endMs
- firstDraftMs
- finalAtMs
- decodeInputDurationMs
- decodeMs
- rms / peak
- sourceSamples
- draftText
- rawDecodeText
- sanitizedText
- savedSegmentText
- commitSource
- revisionCount

Whole utterance:
- decodeInputDurationMs
- decodeMs
- savedText
- WER / readability / filler recall
```
