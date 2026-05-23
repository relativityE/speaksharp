# STT Browser Trace Review Brief

Date: 2026-05-23

Purpose: give a second reviewer enough context, evidence, and code pointers to help close the release-blocking STT issues. This brief is based on visible-browser validation only: standalone Chrome exposed on remote debugging port `9222`, production-like local preview app at `http://127.0.0.1:4173/session`, audible input generated with macOS `say`, and browser console/runtime traces collected from the same Chrome session.

## Release Gate Definition

Tests are not the release yardstick for this phase. The product is ready only when a tester using the browser sees:

1. First spoken words captured.
2. Live transcript appears quickly enough to feel live.
3. Final transcript is accurate enough against known spoken truth.
4. No duplicate transcript loops.
5. No hallucinated non-speech text such as `[INAUDIBLE]`, music tags, clapping, or random sentences.
6. Stop/save/analytics/history still work after the STT pass.

## Shared Test Input

Most browser traces used this spoken truth:

```text
um the stale smell of old beer like lingers. uh a dash of pepper spoils beef stew. like the box was thrown beside the parked truck.
```

The input is intentionally short but includes:

- leading filler: `um`
- mid filler: `like`
- second filler: `uh`
- common Harvard-style sentence fragments
- final phrase that previously exposed chunk boundary and final-word issues

## Evidence Artifacts

| Engine | Artifact |
|---|---|
| Native Browser STT | `/private/tmp/speaksharp-native-real-trace-1779559480712.json` |
| Private STT | `/private/tmp/speaksharp-private-real-trace-after-preroll-1779559591235.json` |
| Cloud STT selection/availability | `/private/tmp/speaksharp-cloud-real-trace-1779559669830.json` |

These artifacts include page state before start, after start, visible transcript, trace arrays, and captured browser console events.

## Issue 1: Native Browser STT Accuracy Collapse

### Before

Native Browser STT historically worked well on this same machine/browser. Recent failures included repeated transcript loops such as:

```text
like lingers ... like lingers ... like lingers ...
```

The suspected self-inflicted bugs were:

- stale interim text being preserved after Chrome revised a Web Speech hypothesis
- final/partial store updates re-appending the same provider result
- insufficient tracing of the exact Web Speech event path

### During

Implemented and instrumented:

- Browser strategy resolver for Chrome, Edge, Safari, generic Web Speech, and unsupported browsers.
- Chrome/Edge use standard Web Speech configuration:
  - `lang = en-US`
  - `continuous = true`
  - `interimResults = true`
- Result extraction now follows the Web Speech contract:
  - read full `event.results`
  - treat `resultIndex` as the lowest changed index
  - emit only current interim hypotheses
  - emit each final result slot once
- Added trace events through Native and store paths:
  - `configured`
  - `onstart`
  - `onaudiostart`
  - `onspeechstart`
  - `onresult_raw`
  - `interim_candidate`
  - `final_candidate`
  - `emit_partial`
  - `emit_final`
  - `store_apply_partial`
  - `store_apply_final`
  - duplicate-skip traces

Code pointers:

- `frontend/src/services/transcription/modes/nativeBrowserStrategies.ts`
- `frontend/src/services/transcription/modes/NativeBrowser.ts`
- `frontend/src/services/SpeechRuntimeController.ts`
- `frontend/src/services/transcription/sttConstants.ts`

### After

Fresh browser trace:

```text
Artifact: /private/tmp/speaksharp-native-real-trace-1779559480712.json
Mode: Browser
Status after start: RECORDING ACTIVE
Trace count: 161
Console events: 640
```

Observed final transcript:

```text
don't want to do massage again the park truck
```

Relevant trace counts:

| Trace Event | Count |
|---|---:|
| `onresult_raw` | 21 |
| `interim_candidate` | 18 |
| `emit_partial` | 18 |
| `final_candidate` | 2 |
| `emit_final` | 2 |
| `store_apply_final` | 2 |
| `store_skip_duplicate_last_chunk` | 7 |

Final candidates from Chrome/Web Speech:

```text
don't want to do massage again
the park truck
```

### What This Proves

The duplicate transcript loop is materially improved: the final visible transcript was not repeated three times.

The remaining failure is more severe: Chrome Web Speech delivered bad recognition content. The app stored what the Native provider emitted. The trace shows the bad final text arrived as provider final candidates, not as a later analytics/history transformation.

### Reviewer Help Needed

Please focus on whether our Native Chrome lifecycle can still be causing provider degradation before we blame Chrome:

1. Are we starting audible input too soon after `onstart` and before Chrome is truly ready?
2. Should the app treat `onaudiostart` or `onspeechstart` as the real readiness boundary for Native Browser STT?
3. Are our immediate restart/backoff handlers interfering with Chrome's continuous recognition session?
4. Should Chrome Native mode use short non-continuous sessions plus explicit restarts instead of one `continuous=true` session?
5. Does Chrome Web Speech behave better if the first audio arrives after a larger post-start delay?

## Issue 2: Private STT First Chunk, Delay, and Hallucination

### Before

Private STT previously showed:

- no live text for a long time
- transcript dumped late
- first spoken words often missing
- fillers missed at the beginning
- random non-speech hallucinations after speech ended

Earlier direct WAV benchmarks showed the model can transcribe clean decoded WAV input, but that does not prove the browser mic path. The browser path remained the release gate.

### During

Implemented and instrumented:

- Central STT constants now include Private timing and derived sample counts.
- Private minimum transcription window is currently `1.75s`, derived to samples at the shared target sample rate.
- Added speech-start state in `PrivateWhisper`:
  - collect pre-roll while waiting for actual speech
  - require sustained speech before first Whisper inference
  - include pre-roll plus first speech frames in the first inference chunk
  - avoid sending initial room silence as the first Whisper chunk
- Added browser trace capture for Private inference chunks:
  - sample count
  - duration
  - RMS
  - peak
  - transcript returned for each chunk

Code pointers:

- `frontend/src/services/transcription/modes/PrivateWhisper.ts`
- `frontend/src/services/transcription/engines/TransformersJSEngine.ts`
- `frontend/src/services/transcription/engines/TransformersJSV4Engine.ts`
- `frontend/src/services/transcription/sttConstants.ts`
- `frontend/src/services/audio/pauseDetector.ts`
- `frontend/src/services/transcription/utils/audioUtils.impl.ts`

### After

Fresh browser trace:

```text
Artifact: /private/tmp/speaksharp-private-real-trace-after-preroll-1779559591235.json
Mode: Private
Status after start: RECORDING ACTIVE
First visible transcript delay: 10.527s after start
Console events: 7294
Private inference chunks: 6
```

First visible transcript:

```text
On the stale smell of all beer like lingers out of dash of pepper spoiled beefs to like the box was thrown beside.
```

Before stop:

```text
On the stale smell of all beer like lingers out of dash of pepper spoiled beefs to like the box was thrown beside. the Park Truck.
```

After stop:

```text
On the stale smell of all beer like lingers out of dash of pepper spoiled beefs to like the box was thrown beside. the Park Truck. No more begin.
```

Private chunk evidence:

| Chunk | Duration | RMS | Transcript |
|---:|---:|---:|---|
| 1 | 1.82s | 0.253014 | `On the stale smell of all beer` |
| 2 | 2.00s | 0.137547 | `like lingers out of dash of pepper spoiled` |
| 3 | 2.00s | 0.101613 | `beefs to like the box was thrown beside.` |
| 4 | 2.00s | 0.079042 | `the Park Truck.` |
| 5 | 2.00s | 0.019891 | `(door closes)` |
| 6 | 1.536s | 0.029318 | `No more begin.` |

### What This Proves

The first-chunk patch changed behavior in the right direction: the model now receives early speech chunks instead of waiting indefinitely for a large late dump.

Private STT is still not production-ready:

- First visible text is still too slow at `10.527s`.
- Leading `um` and `uh` were missed.
- `old beer` became `all beer`.
- `a dash` became `out of dash`.
- `spoils beef stew` became `spoiled beefs to`.
- Post-speech noise was transcribed as `(door closes)` and `No more begin.`

The hallucination evidence is especially important because the final transcript can become worse after the user stops speaking.

### Reviewer Help Needed

Please focus on the Private browser audio lifecycle:

1. Why does first visible text still take about `10.5s` when individual chunks are around `1.8-2.0s`?
2. Are inference results emitted promptly, or are store/controller updates delaying visibility?
3. Should Private emit partial text differently instead of only final chunk text?
4. Is the silence/noise gate too permissive? Chunk 5 RMS was `0.019891` and still produced `(door closes)`.
5. Is the stop-forced final inference running on tail noise and appending hallucinated text?
6. Should Private suppress parenthetical/audio-event transcripts and low-energy tail chunks more aggressively?
7. Should the first few hundred milliseconds of spoken audio be protected more strongly so leading fillers survive?

## Issue 3: Cloud STT Not Testable in Current Browser Session

### Before

Cloud STT is supposed to be the most reliable transcript path, but it is cost-gated and not part of the default tester script. We still need one sanity pass before release because it is a paid/pro feature.

### During

Attempted to select Cloud from the real browser UI in the same Chrome session.

### After

Fresh browser trace:

```text
Artifact: /private/tmp/speaksharp-cloud-real-trace-1779559669830.json
Displayed account badge: PRO
Cloud option visible: yes
Cloud option text: CLOUD (PRO FEATURE ONLY)
Cloud option disabled: yes, aria-disabled=true
Mode after attempted Cloud selection: Private
Transcript: Words appear here...
```

DOM inspection showed:

```text
data-testid="stt-mode-cloud"
role="menuitemradio"
aria-disabled="true"
```

### What This Proves

This run does not prove Cloud transcription quality. It proves Cloud is blocked in the current browser/account entitlement state even while the visible nav badge says `PRO`.

### Reviewer Help Needed

Please focus on entitlement/state coherence:

1. Why does the page show a `PRO` badge while Cloud remains disabled?
2. Is this a real entitlement bug, a local preview auth/profile mismatch, or expected because the current user hit a daily limit?
3. What exact UI state should users see when Cloud is unavailable?
4. What test account/profile state is required for a valid Cloud browser transcription pass?

## Cross-Cutting Issue: Filler Detection Is Only As Good As Captured Transcript

The input included `um`, `uh`, and `like`. In the latest traces:

- Native final transcript contained none of the true fillers.
- Private detected `like`, but missed leading `um` and `uh`.
- Cloud was not run.

This means filler analytics cannot be considered valid until transcript capture improves. The filler detector may still have its own issues, but the current blocker is upstream STT quality.

## Cross-Cutting Issue: Save/Analytics Can Look Successful Despite Bad Transcript

Native saved the session and displayed analytics:

```text
✓ Great practice! Session saved.
Transcript: don't want to do massage again the park truck
Clarity Score: 85%
WPM: 27
```

This is dangerous for release because the app can show polished analytics for a bad transcript. Once transcript quality is poor, analytics become misleading.

Reviewer question:

Should low-confidence/short/bad STT output suppress or qualify analytics instead of presenting confident scores?

## Current Release Status

| Engine | Browser Release Status | Reason |
|---|---|---|
| Native Browser | Blocked | Real Chrome emitted badly wrong final text. Duplication appears improved, but accuracy is unacceptable. |
| Private | Blocked | First text delay still about `10.5s`; accuracy is mixed; tail noise hallucinations append bad text. |
| Cloud | Blocked for validation | Could not select Cloud in current PRO-labeled browser session; entitlement/UI state must be clarified. |

## Highest-Value Next Work

1. Native: run a controlled trace where `say` starts only after `onaudiostart` or `onspeechstart`, then compare whether Chrome final text improves. If it does, Native readiness timing is self-inflicted.
2. Private: trace timestamps from `model_inference_result` to `transcript_callback_emit` to `store_final_transcript_apply` to visible DOM update. The 10.5s delay may be model/inference, store visibility, or both.
3. Private: harden tail silence handling so low-energy/noise chunks do not append text after speech ends.
4. Cloud: resolve the PRO badge vs disabled Cloud mismatch, then run one real browser Cloud pass.
5. After each engine produces acceptable browser transcript, rerun stop/save/analytics/history.

## Reviewer Summary

The app has moved from "unclear if engines start" to "engines start and traces identify where they fail." Native and Private are both still release-blocking in real Chrome. Native's current failure is provider final text quality or timing around provider readiness. Private's current failure is user-facing latency plus hallucinated tail chunks. Cloud cannot yet be evaluated because UI/entitlement state prevents selecting it in the current preview session.

The second reviewer should not spend time on unit-test pass/fail. The useful contribution is to inspect the browser traces and code paths above, then help decide whether each failure is caused by readiness timing, result assembly, audio lifecycle, silence gating, entitlement state, or provider limitation.
