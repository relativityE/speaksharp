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
```

What is not complete:

```text
No confidence-aware draft UI exists during recording.
No visual distinction exists between unstable provisional text and final selected text.
No policy prevents obviously unstable provisional text from appearing as final-quality copy.
```

Dev-agent responsibility:

```text
Implement the user-facing interim/draft UI behavior. This is product code, not
browser test code.
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
1. Component/state changes named.
2. Unit tests or component tests for synthetic event sequences:
   start -> listening
   provisional "day" -> drafting
   provisional changes -> still drafting
   stop -> finalizing
   final selected -> final styling/save candidate
3. Clear selectors/data attributes I can assert in browser proof, if new ones are added.
4. Commit SHA and expected user-visible behavior.
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
