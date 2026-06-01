# Native STT Required-Fields Test Report — Latest State, 2026-06-01

## Executive Summary

Native STT is **not release-green**. The latest automated Native diagnostic run captured the required fields, but Chrome/Web Speech emitted only one interim word and no final transcript. The app correctly refused to save a meaningless session, but the user-facing Native path did not work in this run.

Current classification:

```text
Native lifecycle instrumentation: present
Native automated diagnostic: FAIL
Native human-real-mic release proof: still required
Native drop-in parity: not proven
Native punctuation/casing: unresolved
```

## Latest Evidence

Artifact:

```text
/private/tmp/speaksharp-native-current-required-fields-20260601.json
```

Setup:

| Field | Value |
| --- | --- |
| App URL | `http://127.0.0.1:4182` |
| Browser | Google Chrome via Playwright, headed |
| Fake audio | false |
| Input route | macOS `say` playback into real browser mic path |
| Mode | Native |
| Script | `Native Chrome microphone proof. The quick brown fox reads clear speech for SpeakSharp release validation.` |

## Latest Result Table

| Field | Value |
| --- | --- |
| Pass | false |
| Visible at stop | `Native` |
| Post-stop transcript | `Native` |
| Selected for save | `Native` |
| Transcript visible | false |
| Saved | false |
| History visible | false |
| Detail visible | false |
| First result | `native` at 5981.5 ms |
| Final result count | 0 |
| Result event count | 1 |
| Duplicate full transcript | false |

Parallel capture was populated:

| Field | Value |
| --- | ---: |
| Duration | 16.291 sec |
| RMS | 0.006956 |
| Peak | 0.080567 |
| Speech start | 2200 ms |
| Speech end | 7850 ms |
| Speech duration | 2700 ms |
| Speech segments | 4 |

## What Worked

| Area | Result |
| --- | --- |
| Required transcript-state fields | Captured |
| Parallel mic fields | Captured, including speech window and segment count |
| Duplicate detection | Captured; no duplicate in this run |
| Meaningless-session guard | Worked; app did not save one-word `Native` as a completed session |

## Current Blockers

### P0 — Native Live Transcript Is Not Reliable

Latest run:

```text
Chrome/Web Speech heard audio but returned only "native".
No final result arrived.
No useful session was saved.
```

Consequence if not fixed:

Native cannot serve as a credible Free quick-start path. Users may click the mic, speak normally, and see nothing useful until Stop or never get a saved transcript.

Benefit of fixing:

Native can become an acceptable browser-dependent quick-start mode instead of a trust-eroding first impression.

Native needs the same style of timing decomposition as Private, but the ownership is split differently. Chrome/Web Speech owns speech recognition and endpointing; SpeakSharp owns state propagation, final/interim merge, stop selection, save, and formatting.

Reviewer/agent must answer during human real-mic proof:

```text
How long until first interim text appears?
Does early interim text remain wrong for several seconds before Chrome final converges?
Does Stop wait long enough for Chrome final without duplicating stale interim?
Does selected-for-save come from Chrome final, visible-at-stop, or stale interim?
Does punctuation/casing come from Chrome, a formatter, or no formatter?
```

Required Native timing fields:

| Field | Meaning |
| --- | --- |
| `micClickedAt` | user clicked mic |
| `onaudiostartAt` | Chrome audio started |
| `onspeechstartAt` | Chrome detected speech |
| `firstInterimAt` | first interim result |
| `firstFinalAt` | first final result |
| `visibleAtStopAt` | transcript visible when Stop clicked |
| `stopClickedAt` | user clicked Stop |
| `onendAt` | Chrome recognition ended |
| `selectedForSaveAt` | app selected transcript |
| `savedAt` | session persisted |
| `detailVisibleAt` | saved transcript visible in detail |

### P0 — Human Real-Mic Proof Still Missing

The current automation route is diagnostic only. Native Web Speech is server-side and sensitive to browser/audio route. The latest automated failure cannot be treated as a final WER benchmark, but it also cannot be ignored because it reflects a failed browser path.

Required proof:

```text
Human speaks into Chrome mic.
Capture first visible text, visible at stop, post-stop final, selected-for-save, saved/detail transcript, duplicate flag, and punctuation/readability.
```

Consequence if missing:

We cannot tell whether Native is viable for actual users or only failing under automation.

Benefit:

Separates app bugs from Chrome/input-route instability and gives product-relevant evidence.

### P0 — Native Punctuation/Casing Is Unresolved

Prior human Native runs showed:

```text
run-on transcript
missing sentence stops
wrong capitalization such as "Starts Now"
```

Current code has a formatter seam, but no trusted formatter implementation is proven.

Consequence if not fixed:

Even when Chrome recognition is accurate, saved Native transcripts may look amateurish and hurt trust.

Benefit:

Readable Native transcripts with normal casing and punctuation, ideally through a trusted off-the-shelf formatter/API rather than custom formatting logic.

### P0 — Stop/Finalization Merge Needs Continued Human Verification

Prior human evidence showed a concrete app bug:

```text
Chrome produced a good final transcript.
SpeakSharp appended a stale pending interim copy on Stop.
Saved transcript duplicated the full speech.
```

Regression coverage exists, but this needs human proof after the latest changes.

Consequence if not proven:

Native may corrupt good Chrome output at the exact moment the user trusts the app to save.

Benefit:

Native can preserve good browser output instead of damaging it.

## Drop-In Parity Status

Native has not met drop-in parity.

Reason:

```text
The automated Web Speech route is not a stable release WER benchmark.
Standalone/drop-in Web Speech must be compared against SpeakSharp under the same real mic conditions.
Latest automated SpeakSharp run failed with only one interim word.
```

What prevents parity:

1. Chrome/Web Speech input route is unstable in automation.
2. Human real-mic evidence is incomplete after the duplicate-stop fix.
3. Punctuation/casing is unresolved.
4. Native saved-output behavior still needs proof under real speech.

## Required Native Test Matrix

| Script | Required Evidence |
| --- | --- |
| Clean | first text ms, visible at stop, post-stop final, selected save, saved/detail, duplicate flag |
| Filler-heavy | filler preservation, punctuation, selected save, detail transcript |
| Realistic | readability, sentence stops, no duplication, history/detail |

Required scripts:

```text
Native Chrome microphone proof starts now. I want to make one simple point before we move on. The quick brown fox reads clear speech for SpeakSharp validation.

Um, basically, I want to explain one thing. Like, the puppy chewed up the new shoes, and that changed the whole plan.

The main takeaway is that we should pause before the next idea, give one concrete example, and end with a clear next step.
```

## Immediate Development Needs

| Priority | Need | Consequence If Missing | Benefit If Fixed |
| --- | --- | --- | --- |
| P0 | Human real-mic proof after duplicate-stop fix | Cannot classify Native product viability | Product-relevant Native release decision |
| P0 | Trusted punctuation/casing formatter | Accurate words still look unpolished | Native transcripts become readable |
| P0 | Confirm no duplicate append on Stop | Good Chrome final can be corrupted | Stop/save becomes trustworthy |
| P1 | Standalone-vs-app real-mic comparison | Drop-in parity remains unknown | Isolates app degradation vs Chrome behavior |

## No-Browser Verification Instructions For Next Agent

Use this when Chrome/human mic testing is unavailable. This cannot prove Native release readiness, but it can verify the latest failure and inspect the app-side merge/selection logic.

### 1. Extract current Native evidence artifact

Artifact:

```text
/private/tmp/speaksharp-native-current-required-fields-20260601.json
```

Command:

```bash
node - <<'NODE'
const fs = require('fs');
const row = JSON.parse(fs.readFileSync('/private/tmp/speaksharp-native-current-required-fields-20260601.json', 'utf8'));
console.log({
  pass: row.pass,
  blockers: row.blockers,
  visibleAtStop: row.visibleAtStop,
  postStop: row.postStopTranscript,
  selectedForSave: row.selectedForSave,
  transcriptVisible: row.transcriptVisible,
  saved: row.saved,
  historyVisible: row.historyVisible,
  detailVisible: Boolean(row.detailTranscript),
  traceSummary: row.nativeTraceSummary,
  parallelCapture: row.parallelCaptureSummary,
});
console.table((row.nativeTrace || [])
  .filter((event) => /audio|speech|result|interim|final|stop|cycle|parallel|promot/i.test(event.event || ''))
  .map((event) => ({
    event: event.event,
    t: event.t,
    transcript: event.rawResults?.map((r) => r.transcript).join(' ') || '',
    finalCount: event.finalResultCount,
    interimCount: event.interimResultCount,
    resultCount: event.resultCount,
    skipReason: event.skipReason,
  })));
NODE
```

Expected no-browser finding:

```text
Audio and speech were detected.
Only one interim result, "native", arrived.
No final result arrived.
The app did not save the meaningless transcript.
```

### 2. Inspect Native merge/finalization code without browser

Files/lines to review:

| File | Lines | Why |
| --- | ---: | --- |
| `frontend/src/services/transcription/modes/NativeBrowser.ts` | 478-580 | result extraction, partial emit, final emit |
| `frontend/src/services/transcription/modes/NativeBrowser.ts` | 640-669 | audio/speech start tracing |
| `frontend/src/services/transcription/modes/NativeBrowser.ts` | 682-747 | onend/restart behavior |
| `frontend/src/services/transcription/modes/NativeBrowser.ts` | 754-760 | cycle reset and interim preservation |

No-browser review questions:

```text
If Chrome emits only interim "native", does app correctly avoid saving it? Current answer: yes.
If Chrome emits a good final and stale matching interim, does app avoid duplicating it? Verify regression tests.
If Chrome emits final with poor punctuation, where will formatter be applied?
```

### 3. Unit-testable checks without browser

Add or run tests that do not need Chrome:

```text
1. Native final + identical pending interim -> no duplicate append.
2. Native final + punctuation/case variant pending interim -> no duplicate append.
3. Native one-word interim only -> do not save as completed session.
4. Formatter seam identity default -> unchanged transcript.
5. Formatter throws -> original transcript preserved.
```

These checks do not replace human real-mic proof. They only prove app-side safeguards before the next live run.

## Evidence Appendix — Latest Native Failure

Artifact:

```text
/private/tmp/speaksharp-native-current-required-fields-20260601.json
```

Script:

```text
Native Chrome microphone proof. The quick brown fox reads clear speech for SpeakSharp release validation.
```

Observed:

| Field | Value |
| --- | --- |
| Visible at Stop | `Native` |
| Post-stop transcript | `Native` |
| Selected for save | `Native` |
| Transcript visible | false |
| Saved | false |
| History visible | false |
| Detail visible | false |
| First result | `native` at 5981.5 ms |
| Final result count | 0 |
| Result event count | 1 |

Parallel capture:

```json
{
  "durationSec": 16.290625,
  "sampleRate": 16000,
  "rms": 0.006956,
  "peak": 0.080567,
  "speechStartMs": 2200,
  "speechEndMs": 7850,
  "speechDurationMs": 2700,
  "segmentCount": 4
}
```

Native trace:

```json
{"event":"onaudiostart","t":3257}
{"event":"onspeechstart","t":5256.2}
{"event":"onresult_raw","t":5981.5,"rawResults":[{"isFinal":false,"transcript":"native"}],"finalTranscriptLength":0,"interimTranscriptLength":6}
{"event":"onStop_enter","t":19292.8,"currentTranscript":{"redacted":true,"length":0}}
{"event":"parallel_capture_saved","t":19317.5,"durationSec":16.291,"rms":0.006956,"peak":0.080567,"speechStartMs":2200,"speechEndMs":7850,"speechDurationMs":2700,"segmentCount":4}
{"event":"recognition_cycle_summary","t":19368.9,"sawAudio":true,"sawSound":true,"sawSpeech":true,"resultCount":1,"finalResultCount":0,"interimResultCount":1}
{"event":"native_interim_promotion_skipped","t":19369.5,"skipReason":"no_meaningful_interim","lastInterim":{"redacted":true,"length":6}}
```

Conclusion:

```text
Chrome/Web Speech heard audio and detected speech, but only returned a one-word interim and no final. The app correctly refused to promote/save it.
```

## Code Evidence

### Native result extraction and emit path

File: `frontend/src/services/transcription/modes/NativeBrowser.ts`

Relevant lines: 478-580.

```ts
this.recognition.onresult = (event: SpeechRecognitionEvent) => {
  const { rawResults, finalTranscript, interimTranscript } = strategy.extractTranscripts(
    event,
    this.finalizedResultIndexes,
  );
  ...
  if (latestInterim) {
    this.onTranscriptUpdate({ transcript: { partial: latestInterim } });
  }
  if (finalTranscript) {
    this.currentTranscript = this.currentTranscript
      ? NativeBrowser.appendTranscriptSegment(this.currentTranscript, finalForEmission)
      : finalForEmission;
    this.onTranscriptUpdate({ transcript: { final: finalForEmission } });
  }
};
```

Why it matters:

```text
The latest Native run never reached the final path. It only emitted one interim: "native".
```

### Native audio/speech event tracing

Relevant lines: 640-669.

```ts
this.recognition.onaudiostart = () => {
  this.cycleAudioStartedAtMs = performance.now();
  pushNativeTrace('onaudiostart', ...);
};
...
this.recognition.onspeechstart = () => {
  this.cycleSpeechStartedAtMs = performance.now();
  pushNativeTrace('onspeechstart', ...);
  this.scheduleNoResultSpeechRestart('speechstart');
};
```

Why it matters:

```text
The trace proves Chrome reached audio and speech start. The failure was no usable Web Speech result, not total mic silence.
```

### Native cycle summary and no-result detection

Relevant lines: 335-371.

```ts
const summary = this.getRecognitionCycleSummary(reason);
pushNativeTrace('recognition_cycle_summary', summary);
...
if (summary.sawSpeech && speechDurationMs > 500 && this.cycleResultCount === 0) {
  pushNativeTrace('vad_truncation_drop', summary);
}
```

Why it matters:

```text
The instrumentation is present to distinguish heard-audio/no-result from app save failures. Latest run had one result, but no final and no meaningful transcript.
```

## Dev Regression Review (no-browser, against this artifact)

Question: is the latest Native failure an app regression from recent changes?

| Recent Native change | Could suppress live text? | Could drop final? | Verdict |
| --- | --- | --- | --- |
| Formatter seam (`01715a23`) | No — applies to `getTranscript()` saved path only, identity default | No | Not implicated |
| Duplicate-stop fix / interim merge | No new suppression of finals | Only de-dupes identical interim | Not implicated |
| Status/lifecycle (`P0.2`) | Writes `info` status during STOPPING only | No transcript path change | Not implicated |

Decisive trace evidence from `/private/tmp/speaksharp-native-current-required-fields-20260601.json`:

```text
Chrome onresult events:            1
Chrome FINAL results delivered:    0
app duplicate/append events:       0
app promotion-skip events:         1  (correctly skipped meaningless one-word interim)
```

Conclusion: the app received **zero finals** from Chrome, so there was nothing for app code to drop, duplicate, or suppress. This is **Chrome/Web Speech under-capture of the macOS `say` route, not an app regression**. App-side safeguards (final+identical-interim no-dup, one-word-interim no-save, formatter identity) remain covered by `NativeBrowser.test.ts` and `nativeTranscriptFormatter.test.ts`. No app code change is warranted; the gap is the input route + missing human real-mic proof.

## Current Verdict

```text
Native STT is instrumented but not proven.
Latest failure is Chrome under-capture (0 finals), not an app regression.
Do not claim Native meets drop-in behavior.
Do not use automated Native WER (say/fake-audio route) as release proof.
Next decisive step is human real-mic proof via native-human-cdp-monitor.mjs plus a punctuation/formatting plan.
```
