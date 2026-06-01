# Private STT CPU No-WebGPU Test Report — Latest State, 2026-06-01

---

## ⇄ DEV → TEST AGENT REVIEW REQUEST (2026-06-01)

**What dev changed (merged to main):** (1) P0.1 telemetry read-side — harness now reads
the single-source `window.__PRIVATE_STT_RUNTIME_DEBUG__`; (2) post-Stop latency — Stop
runs the whole-utterance decode first and skips the redundant forced-tail decode
(removes the measured ~5s pre-decode wait); (3) acceptance validator + timing/status
reducers encoding your no-browser checks.

**What dev verified (no browser, RAN not asserted):** all 4 Private + 5 Native
no-browser checks pass — see "Test-agent no-browser checks — RAN, not asserted" table
below. Timing reducer reproduces the ~5s pre-decode wait on the real artifact;
validator reproduces your gatePass=false.

**What dev needs the test agent to verify (live, I cannot run):**
1. Full `h1_1..h1_10` Private CPU `STT_DISABLE_WEBGPU=true` re-run.
2. Confirm `privateRuntime`/`privateProvider` now **non-null** and
   `privateCloudFallbackAttempted=false`.
3. Confirm `stopFinalizationMs` **materially lower** than this run **AND finals no
   worse** (the latency fix must not trade speed for quality — this is the key gate).
4. Gate the artifact with `scripts/private-corpus-acceptance.mjs`.

**Still open (not addressed by this pass):** wrong finals `spoils→spurtles` (h1_2),
`They→Day` (h1_6) are model/route variability — need your same-run app-vs-drop-in diff
before any fix. First-paint latency.

---

## DEV UPDATE (2026-06-01, post-report) — changes landed + no-browser verification

A dev pass addressed the report's actionable P0s. **All claims below are unit- and
artifact-verified WITHOUT a browser. None are live-harness-proven — a corpus
re-run by the test agent is still required to confirm timing and final quality on
real audio.**

### What changed (branch merged to main)

| Report issue | Change | Verification (no browser) | Live re-run still needed? |
| --- | --- | --- | --- |
| P0 runtime telemetry null | Read-side fix: harness now reads the single-source global `window.__PRIVATE_STT_RUNTIME_DEBUG__` (the old `__TRANSCRIPTION_SERVICE__.strategy.getRuntimePath()` chain was the controller, no `.strategy`, so always null). PrivateSTT publishes + persists the decision after Stop. | Unit test asserts the global is populated with provider/runtime/threads/`cloudFallbackAttempted=false` after init. | Yes — re-run must show non-null `privateRuntime*` rows. |
| P0 stop finalization too slow | onStop now runs the whole-utterance decode FIRST and skips the redundant forced-tail decode on success. Timing math confirmed ~5s of pre-decode dead time (`stopToWholeStartMs` 5074/5013ms for h1_2/h1_6) that this removes. | 27/27 PrivateWhisper unit tests pass under new order; timeline events added. | **Yes — see "Latency safety" below.** |
| P0 processing state | Already verified: artifact shows `processingSpeechLocallyShown=true`. | Confirmed in `speaksharp-stt-corpus-1780341387199.json`. | No (confirmed). |
| Cloud A/B invalid sessions | (Cloud report) invalid empty/no-Termination sessions excluded from averages. | Verified against real artifact: keyterms/prompt 10/10 invalid → `evidenceValid=false` not "0%". | Yes — fresh valid A/B subset. |
| Harness duplication | Deleted 4 invalid/duplicate Native harnesses; one job → one harness. | N/A | No. |
| Acceptance gate as code | Added `scripts/private-corpus-acceptance.mjs` + release test encoding the report's gate (telemetry non-null, truth-preserving final, `stopFinalizationMs<=8000`, cloud-fallback=false). Cross-checks the real pre-fix artifact and reproduces gatePass=false. | Release test passes. | No. |

### Latency safety — answer to "did lowering time cause no-final / worse-final?"

- **Final correctness is unchanged by the reorder (logically + unit-level).** In the
  OLD order the forced-tail decode ran first but `commitWholeUtteranceTranscript()`
  OVERWROTE it, so the saved final was always the whole-utterance result. The NEW
  order produces the SAME whole-utterance result, only without the discarded tail
  decode. Updated regression tests assert identical final text with fewer decodes.
- **"No final" is not introduced:** the empty-commit fallback still runs forced-tail
  processing when the whole-utterance decode yields nothing.
- **NOT yet proven on real audio.** Unit tests mock `transcribe`. The actual latency
  drop (predicted ~9s → ~4s) and "finals are no worse" MUST be confirmed by a live
  corpus re-run. This is the open gate. Do NOT treat the latency fix as proven until
  a real run shows `stopFinalizationMs` down AND h1_x finals no worse than this run.
- **Out of scope of this change:** the wrong finals `spoils→spurtles` (h1_2) and
  `They→Day` (h1_6) are model/route variability, not the latency path. Still require
  the same-run app-vs-drop-in diagnosis the report requested before any "fix."

### Test-agent no-browser checks — RAN, not asserted

Every "Unit-testable checks without browser" item from the Private AND Native
reports was executed (not claimed). Results:

| Report | # | Check | Implemented in | Result |
| --- | --- | --- | --- | --- |
| Private | 1 | Timing reducer (firstDraftDelay/stopToWholeStart/wholeDecodeDuration/stopFinalizationMs) | `scripts/private-timing-reducer.mjs` + test | PASS — reproduces ~5s pre-decode wait on real artifact |
| Private | 2 | Artifact validator (null telemetry / wrong final / stopFinalizationMs>8000) | `scripts/private-corpus-acceptance.mjs` + test | PASS — reproduces report gatePass=false on real artifact |
| Private | 3 | Sanitizer does not alter h1_2/h1_6 clean finals | `private-no-browser-checks.test.ts` | PASS |
| Private | 4 | Status reducer prefers "Processing speech locally…" during STOPPING | `scripts/private-status-reducer.mjs` + test | PASS |
| Native | 1 | final + identical interim → no duplicate append | `NativeBrowser.test.ts:558` | PASS |
| Native | 2 | final + case/punct variant interim → no duplicate | `NativeBrowser.test.ts:581` | PASS |
| Native | 3 | one-word interim → not saved | `NativeBrowser.test.ts:446` | PASS |
| Native | 4 | formatter identity default → unchanged | `nativeTranscriptFormatter.test.ts:17` | PASS |
| Native | 5 | formatter throws → original preserved | `nativeTranscriptFormatter.test.ts:34` | PASS |

These prove app-side logic + evidence-field integrity without a browser. They do
NOT prove transcription quality, latency, or human-mic behavior — those remain the
live-run gates below.

### Test agent — required next run

1. Rebuild prod, fresh preview, real Pro, `STT_DISABLE_WEBGPU=true`.
2. Run full Harvard `h1_1..h1_10` Private CPU corpus.
3. Confirm: `privateRuntime`/`privateProvider` non-null, `privateCloudFallbackAttempted=false`,
   `stopFinalizationMs` materially lower than this run, finals no worse than this run,
   `processingSpeechLocallyShown=true`, save/history/detail pass.
4. Run `node` against the new validator to gate the artifact:
   `import { validatePrivateCorpusArtifact } from 'scripts/private-corpus-acceptance.mjs'`.

---

## Executive Summary

Private STT is **not release-green**. The latest focused real-Pro, no-WebGPU run completed the app journey, but it failed the P0 verification gate because final quality regressed on targeted rows and required runtime/fallback telemetry is still missing.

Current classification:

```text
Private CPU floor: FAIL
Evidence type: browser-proof / harness-proof
Primary blocker: slow and sometimes incorrect live/final transcription under CPU path
Drop-in parity: not proven by the latest focused run
```

## Latest Evidence

Artifact:

```text
/private/tmp/speaksharp-stt-corpus-1780341387199.json
```

Setup:

| Field | Value |
| --- | --- |
| App URL | `http://127.0.0.1:4182` |
| Account | fresh real Pro account from workflow `26776295751` |
| Mode | Private |
| WebGPU | disabled with `STT_DISABLE_WEBGPU=true` |
| Fixtures | `h1_1,h1_2,h1_6,h1_8,h1_10` |
| Runner result | `runnerPass=true`, `gatePass=false` |

## Latest Result Table

| Fixture | Final Transcript | Accuracy | First Text | Stop Finalization | Save | History | Detail | Key Issue |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| `h1_1` | Um, the stale smell of old beer, like lingers. | 100% | 4136 ms | 9044 ms | yes | yes | yes | Slow but correct. |
| `h1_2` | Basically, a dash of pepper spurtles beef stew. | 87.5% | 7709 ms | 9316 ms | yes | yes | yes | `spoils` became `spurtles`; bad interim exposed first. |
| `h1_6` | Day, like, told Wild Tales to frighten him. | 87.5% | null | 8383 ms | yes | yes | yes | `They` became `Day`; no useful live text before Stop. |
| `h1_8` | The puppy, like, chewed up the new shoes. | 100% | 6907 ms | 7831 ms | yes | yes | yes | Final recovered from poor live chunks. |
| `h1_10` | Basically, the quick brown fox jumps over the lazy dog. | 100% | 6678 ms | 6619 ms | yes | yes | yes | Slow but correct. |

## Current Blockers

### P0 — Bad Interim Text Is Visible Too Long

Evidence from `h1_2`:

```text
Live/rolling chunks: Basically. / Peace too. / [BLANK_AUDIO]...
Final selected: Basically, a dash of pepper spurtles beef stew.
Truth: Basically, a dash of pepper spoils beef stew.
```

Evidence from `h1_6`:

```text
Live/rolling chunks: day. / and / [BLANK_AUDIO]...
Final selected: Day, like, told Wild Tales to frighten him.
Truth: They, like, told wild tales to frighten him.
```

Consequence if not fixed:

Users see obviously wrong text in the live transcript window for several seconds. If final text later corrects it, the experience still feels unstable. If final text does not fully correct it, the user loses trust in Private STT.

Benefit of fixing:

Private can feel honest while local inference is still working: users get immediate feedback without mistaking low-confidence draft text for final-quality transcription.

Recommended design:

```text
1. Keep live chunks visually marked as provisional/draft.
2. Show "Processing speech locally..." when finalization starts or when provisional text is low confidence.
3. Do not hide all feedback; show listening/processing state immediately.
4. Only promote draft text visually when it is coherent and stable.
5. Do not rely on the stall/processing UX unless final whole-utterance output is consistently correct.
```

> **DEV RESPONSE (2026-06-01):** Not fixed yet, and I agree with your point #5 — I did
> NOT add draft-hiding, precisely because you said not to hide bad interim until the
> final is reliable, and it is not (see next block). The first-paint gate was already
> lowered (5.0s→2.0s) which can surface *more* low-confidence interim; that trade is
> intentional for "feels alive" but it makes your "mark as provisional/draft" design
> (#1/#4) the right next step. **This is a UI-state change I have not made** — it needs a
> provisional/draft visual treatment in the live transcript panel. Flagging as open for
> a dev+design pass, not silently resolved.

### P0 — Final Output Does Not Always Converge Correctly

The stall solution is only safe if final output is nearly perfect. Latest evidence does not meet that bar:

| Fixture | Final Problem |
| --- | --- |
| `h1_2` | `pepper spoils` became `pepper spurtles` |
| `h1_6` | `They` became `Day` |

Consequence if not fixed:

Masking interim text would only hide the problem until the final incorrect text appears. That creates delayed disappointment instead of live confusion.

Benefit of fixing:

Once final text is reliable, we can safely de-emphasize unstable drafts and let users wait briefly for a high-quality local result.

Required next diagnosis:

```text
Compare same-run browser drop-in vs SpeakSharp app for h1_2 and h1_6.
Capture raw rolling chunks, whole-utterance raw output, sanitized output, selected-for-save, and captured audio RMS/peak.
Decide whether the final error comes from app audio capture/preprocessing or from route/model variability.
```

> **DEV RESPONSE (2026-06-01):** Not fixed — and deliberately NOT touched by code yet,
> because your "required next diagnosis" must come first. I verified (no browser) that
> the sanitizer is NOT the cause: `private-no-browser-checks.test.ts` proves the clean
> finals "pepper spoils" / "They, like..." pass through `sanitizeTranscriptText`
> unchanged, so cleanup is not corrupting them — the wrong text comes from the model/
> route. **The same-run app-vs-drop-in diff is yours to run** (needs browser + the
> kept `private-browser-dropin-proof.mts` comparator). I will not "fix" candidate
> selection blind until that diff says whether it is app audio prep vs model
> variability — changing it blind risks a rewrite chasing a model limitation.

### P0 — Runtime/Fallback Telemetry Is Still Missing

Required fields still came through as `null`:

```text
privateRuntime
privateProvider
privateWebgpuAvailable
privateCrossOriginIsolated
privateWasmThreadCount
privateCloudFallbackAttempted
```

Consequence if not fixed:

We cannot prove the privacy promise. Reviewers cannot verify that CPU/no-WebGPU selected local Private STT and that Cloud fallback was not attempted.

Benefit of fixing:

Private becomes auditable: every run can prove runtime, provider, thread count, isolation state, and `cloudFallbackAttempted=false`.

> **DEV RESPONSE (2026-06-01):** Fixed on the read side, needs your re-run to confirm.
> Root cause was a read/write split: PrivateSTT publishes the decision to
> `window.__PRIVATE_STT_RUNTIME_DEBUG__` (persisted after Stop), but the harness read
> `window.__TRANSCRIPTION_SERVICE__.strategy.getRuntimePath()` — and that global is the
> *controller* (no `.strategy`), so it always resolved to null. Corpus harness now reads
> the single-source global. Unit test asserts it is populated with provider/runtime/
> threads/`cloudFallbackAttempted=false`. **Verify on next run:** these fields non-null
> per row. (This artifact predates the fix, so it still shows null — expected.)

### P0 — Stop Finalization Is Too Slow For a Live Transcript Product

Latest focused run:

| Fixture | First Draft | Final After Stop |
| --- | ---: | ---: |
| `h1_1` | 4.1s | 9.0s |
| `h1_2` | 7.7s | 9.3s |
| `h1_6` | none | 8.4s |
| `h1_8` | 6.9s | 7.8s |
| `h1_10` | 6.7s | 6.6s |

User-observed timing in human Private tests:

```text
partial/draft around 6s
final earliest around 16s from start
sometimes final text arrives around 26s from start
```

This timing issue is **not fixed**. It is now a required root-cause question for the next development/reviewer pass.

Reviewer/agent must answer:

```text
Why does first visible draft take roughly 6 seconds?
Why does final text take another 10+ seconds after the first draft?
Why does final convergence vary from about 16 seconds to 26 seconds from recording start?
Which stage owns the delay: speech gate, audio buffer cadence, worker queue, model inference, whole-utterance final decode, transcript selection, store update, or UI render?
```

Required trace fields for the next Private run:

| Field | Meaning |
| --- | --- |
| `micClickedAt` | user clicked mic |
| `recordingStateAt` | app entered recording |
| `speechDetectedAt` | VAD/speech gate detected speech |
| `firstAudioChunkQueuedAt` | first audio chunk reached worker queue |
| `firstInferenceStartAt` | first model inference started |
| `firstInferenceEndAt` | first model inference ended |
| `firstDraftVisibleAt` | first visible non-placeholder text |
| `stopClickedAt` | user clicked Stop |
| `finalInferenceStartAt` | final/whole-utterance decode started |
| `finalInferenceEndAt` | final/whole-utterance decode ended |
| `selectedForSaveAt` | selected transcript committed |
| `savedAt` | save completed |
| `detailVisibleAt` | saved transcript visible in detail |

> **DEV RESPONSE (2026-06-01):** Partially fixed — the *app-owned* slice is addressed;
> the model-decode slice is irreducible on CPU. I confirmed your timing math on the real
> artifact via `private-timing-reducer.mjs`: `stopToWholeStart ≈ 5074ms (h1_2) / 5013ms
> (h1_6)` of dead time before the whole-utterance decode even began, plus ~3-4s for the
> decode itself. Fix: `onStop` now runs the whole-utterance decode FIRST and skips the
> redundant forced-tail rolling decode on success (it was being overwritten anyway) —
> removing the ~5s. `wholeDecodeDuration` (~3-4s) is the model on CPU and cannot be cut
> without WebGPU/threads (tracked separately). New timeline events `stop_whole_utterance
> _decode_start` / `stop_force_tail_skipped|fallback` let you measure it. **Verify on
> next run:** `stopFinalizationMs` materially lower AND finals no worse — I cannot prove
> the real-audio number here. Re: the requested per-stage trace fields — added the
> Stop-side decode markers; the full mic→detail field set is a harness instrumentation
> task on your side.

## Timing Budget Required To Fix Private

This is the target timing budget for CPU Private STT:

| Stage | Target | Hard Limit | Current Evidence | Status |
| --- | ---: | ---: | --- | --- |
| Mic click feedback | < 300 ms | 500 ms | generally immediate | pass |
| Listening/recording indicator | < 300 ms | 500 ms | generally immediate | pass |
| First useful draft, if shown | <= 3000 ms | 5000 ms | 4.1s to 7.7s; sometimes null | fail |
| Low-confidence draft state | immediate when draft is unstable | 1000 ms | not explicit enough | fail |
| Processing state after Stop | < 500 ms | 1000 ms | now observed in latest run | improved |
| Stop finalization | <= 5000 ms | 8000 ms | 6.6s to 9.3s | fail |
| Final from recording start | <= 12000 ms for short phrase | 16000 ms | user saw 16s to 26s | fail |
| Save/history/detail after final | <= 3000 ms | 5000 ms | passed once final exists | pass |

If CPU cannot meet the latency budget consistently, the UI must communicate this honestly:

```text
Draft transcript
Processing speech locally...
Final transcript
```

But this UI treatment is acceptable only after final transcript quality is stable.

## Wrong-Final Rows Requiring Immediate Verification

The latest focused run had two wrong final transcripts:

| Fixture | Truth | Latest Final | Failure |
| --- | --- | --- | --- |
| `h1_2` | Basically, a dash of pepper spoils beef stew. | Basically, a dash of pepper spurtles beef stew. | `spoils -> spurtles` |
| `h1_6` | They, like, told wild tales to frighten him. | Day, like, told Wild Tales to frighten him. | `They -> Day` |

Required reviewer/agent verification:

```text
Run h1_2 and h1_6 through browser drop-in and SpeakSharp app in the same run.
Use the same audio route and no-WebGPU CPU runtime.
Capture raw rolling chunks, whole-utterance raw output, sanitized output, selected-for-save, and detail transcript.
Verify whether drop-in converges correctly while SpeakSharp does not.
```

Acceptance:

```text
h1_2 final must preserve "pepper spoils".
h1_6 final must preserve "They, like".
Final convergence must meet the timing budget or be explicitly labeled slow CPU behavior.
```

## Drop-In Parity Status

Private has not met drop-in parity yet.

Latest focused SpeakSharp run is not sufficient to claim drop-in parity because it is not a full corpus run and it failed two targeted rows. The next valid parity proof must compare the same fixtures, same browser route, and same run window against the browser drop-in control.

What prevents parity:

1. SpeakSharp rolling chunks expose low-quality interim text.
2. Whole-utterance finalization is not consistently perfect.
3. CPU finalization latency is too high.
4. Runtime/fallback telemetry is missing, so the run is not fully auditable.

## Immediate Development Needs

| Priority | Need | Consequence If Missing | Benefit If Fixed |
| --- | --- | --- | --- |
| P0 | Publish stable Private runtime telemetry | Cannot prove local/private runtime or no Cloud fallback | Privacy promise becomes testable |
| P0 | Same-run app vs browser drop-in for `h1_2`/`h1_6` | Cannot isolate app degradation vs model/route variability | Root cause becomes actionable |
| P0 | Add low-confidence draft UI state | Users see wrong text as if it is normal live transcript | UX becomes honest during local inference |
| P0 | Reduce or explain stop finalization delay | User waits 8-26s with stale/wrong text | Private feels reliable even when CPU is slow |
| P1 | Full Harvard 10 rerun only after focused P0 passes | Bad full-corpus data wastes time | Clean parity evidence |

## No-Browser Verification Instructions For Next Agent

Use this when a browser run is unavailable. This does not prove product behavior, but it can identify root cause candidates and prevent blind changes.

### 1. Extract timing and transcript evidence from the latest artifact

Artifact:

```text
/private/tmp/speaksharp-stt-corpus-1780341387199.json
```

Command:

```bash
node - <<'NODE'
const fs = require('fs');
const artifact = JSON.parse(fs.readFileSync('/private/tmp/speaksharp-stt-corpus-1780341387199.json', 'utf8'));
for (const fixture of ['h1_2', 'h1_6']) {
  const row = artifact.results.find((r) => r.fixture === fixture);
  console.log('\\n###', fixture);
  console.log({
    truth: row.truth,
    visibleAtStop: row.visibleAtStopTranscript,
    final: row.postStopTranscript,
    detail: row.detailTranscript,
    wer: row.wer,
    firstText: row.firstText,
    stopFinalizationMs: row.stopFinalizationMs,
    processingSpeechLocallyShown: row.processingSpeechLocallyShown,
  });
  console.table((row.privateAudioChunks || []).map((chunk) => ({
    durationSec: chunk.durationSec,
    rms: chunk.rms,
    peak: chunk.peak,
    transcript: chunk.transcript,
  })));
  console.table((row.privateTrace || [])
    .filter((event) => [
      'speech_start_detected',
      'process_audio_ready',
      'model_inference_start',
      'model_inference_result',
      'first_transcript_substance_retain',
      'first_transcript_provisional_partial_emit',
      'stop_requested',
      'whole_utterance_commit_start',
      'whole_utterance_commit_accept',
      'stop_force_processing_complete',
    ].includes(event.event))
    .map((event) => ({
      event: event.event,
      epochMs: event.epochMs,
      perfMs: event.perfMs,
      preview: event.payload?.preview || event.payload?.rawPreview || '',
      durationSec: event.payload?.durationSec,
      rms: event.payload?.rms,
      samples: event.payload?.samples,
    })));
}
NODE
```

Expected no-browser finding:

```text
h1_2 exposes bad draft text: "Basically. Peace too."
h1_2 final remains wrong: "pepper spurtles"
h1_6 exposes no useful live text
h1_6 final remains wrong: "Day, like..."
```

### 2. Validate timing math from artifact only

Calculate:

```text
firstDraftDelay = firstText.timestampMs
stopDelay = stopFinalizationMs
wholeDecodeDuration = whole_utterance_commit_accept.epochMs - whole_utterance_commit_start.epochMs
stopToWholeStart = whole_utterance_commit_start.epochMs - stop_requested.epochMs
```

Expected current values:

| Fixture | First Draft | Stop Delay | Whole Decode | Stop To Whole Start |
| --- | ---: | ---: | ---: | ---: |
| `h1_2` | 7709 ms | 9316 ms | ~3828 ms | ~5074 ms |
| `h1_6` | null | 8383 ms | ~2919 ms | ~5013 ms |

Interpretation:

```text
About 5 seconds after Stop is spent before whole-utterance final decode begins.
Whole-utterance decode itself takes about 3-4 seconds on this CPU path.
Together they explain the 8-9 second stop finalization window.
```

### 3. Inspect code paths without browser

Files/lines to review:

| File | Lines | Why |
| --- | ---: | --- |
| `frontend/src/services/transcription/modes/PrivateWhisper.ts` | 780-848 | speech-start gate / preroll / first accepted audio |
| `frontend/src/services/transcription/modes/PrivateWhisper.ts` | 926-1099 | rolling chunk decode, silence gate, force handling |
| `frontend/src/services/transcription/modes/PrivateWhisper.ts` | 1266-1301 | weak first transcript hold vs provisional emit |
| `frontend/src/services/transcription/modes/PrivateWhisper.ts` | 1573-1596 | Stop waits for active inference, then force-processes tail and whole decode |
| `frontend/src/services/transcription/modes/PrivateWhisper.ts` | 1846-1915 | whole-utterance final decode and commit |

No-browser review questions:

```text
Why is Stop waiting for active rolling inference before whole-utterance decode?
Can blank/low-energy rolling chunks be skipped faster once Stop is requested?
Can whole-utterance final decode start sooner?
Is the final decode audio identical to browser drop-in audio for h1_2/h1_6?
```

### 4. Unit-testable checks without browser

Add or run unit tests that do not require Chrome:

```text
1. Timing reducer: given Private trace events, computes firstDraftDelay, stopToWholeStart, wholeDecodeDuration, stopFinalizationMs.
2. Artifact validator: fails if any focused row has null runtime telemetry, wrong final, or stopFinalizationMs > 8000.
3. Candidate sanitizer: h1_2/h1_6 final text should not be altered by cleanup.
4. Status reducer: STOPPING + local finalization must prefer "Processing speech locally..." over "Recording active".
```

These tests will not prove transcription quality, but they will prevent the evidence fields and timing analysis from regressing again.

## Evidence Appendix — Exact Failing Harvard Corpus Rows

Artifact:

```text
/private/tmp/speaksharp-stt-corpus-1780341387199.json
```

Run window:

```text
startedAt: 2026-06-01T19:16:27.200Z
completedAt: 2026-06-01T19:20:10.110Z
runnerPass: true
gatePass: false
```

### h1_2 — Bad Interim, Slow Final, Wrong Final

Truth:

```text
Basically, a dash of pepper spoils beef stew.
```

Observed:

| State | Value |
| --- | --- |
| First text | `Basically.` at 7709 ms |
| Visible at Stop | `Basically. Peace too.` |
| Post-stop final | `Basically, a dash of pepper spurtles beef stew.` |
| Detail transcript | `Basically, a dash of pepper spurtles beef stew.` |
| Error | `spoils -> spurtles` |
| Accuracy | 87.5% |
| Stop finalization | 9316 ms |

Raw chunk evidence:

```json
[
  {"durationSec":1.041,"rms":0.00861,"peak":0.041458,"transcript":" Basically."},
  {"durationSec":3,"rms":0.004483,"peak":0.03813,"transcript":" Peace too."},
  {"durationSec":3,"rms":0.000637,"peak":0.019531,"transcript":" [BLANK_AUDIO]"},
  {"durationSec":3,"rms":0.000537,"peak":0.00882,"transcript":" [BLANK_AUDIO]"},
  {"durationSec":1.456,"rms":0.000729,"peak":0.006062,"transcript":" [BLANK_AUDIO]"}
]
```

Timing evidence:

```text
speech_start_detected: 19:17:35.476
first model_inference_start: 19:17:36.116
first model_inference_result: 19:17:40.537 -> "Basically."
first draft emitted: 19:17:40.540
second result: 19:17:44.389 -> "Peace too."
Stop clicked: 19:17:50.586
Processing speech locally visible: 19:17:52.701
whole_utterance_commit_start: 19:17:55.730
whole_utterance_commit_accept: 19:17:59.558 -> "Basically, a dash of pepper spurtles beef stew."
stop_force_processing_complete: 19:17:59.902
```

Key trace rows:

```json
{"event":"first_transcript_provisional_partial_emit","preview":"Basically.","reason":"pre_final_threshold","emittedToUi":true}
{"event":"first_transcript_provisional_partial_emit","preview":"Basically. Peace too.","rawPreview":"Peace too.","reason":"pre_final_threshold","emittedToUi":true}
{"event":"whole_utterance_commit_accept","rawPreview":" Basically, a dash of pepper spurtles beef stew.","preview":"Basically, a dash of pepper spurtles beef stew."}
```

Conclusion:

```text
h1_2 is the clearest Private row where the UI exposed a bad draft and the final whole-utterance decode still failed to converge correctly.
```

### h1_6 — No Useful Live Text, Slow Final, Wrong Onset

Truth:

```text
They, like, told wild tales to frighten him.
```

Observed:

| State | Value |
| --- | --- |
| First text | none; harness still saw placeholder/listening |
| Visible at Stop | `Listening...` |
| Post-stop final | `Day, like, told Wild Tales to frighten him.` |
| Detail transcript | `Day, like, told Wild Tales to frighten him.` |
| Error | `They -> Day` |
| Accuracy | 87.5% |
| Stop finalization | 8383 ms |

Raw chunk evidence:

```json
[
  {"durationSec":1.073,"rms":0.011706,"peak":0.09054,"transcript":" day."},
  {"durationSec":3,"rms":0.004228,"peak":0.038502,"transcript":" and"},
  {"durationSec":3,"rms":0.000412,"peak":0.006038,"transcript":" [BLANK_AUDIO]"},
  {"durationSec":3,"rms":0.000247,"peak":0.00241,"transcript":" [BLANK_AUDIO]"},
  {"durationSec":3,"rms":0.000225,"peak":0.001247,"transcript":" [BLANK_AUDIO]"},
  {"durationSec":3,"rms":0.000242,"peak":0.001036,"transcript":" [BLANK_AUDIO]"},
  {"durationSec":3,"rms":0.000177,"peak":0.000911,"transcript":" [BLANK_AUDIO]"},
  {"durationSec":3,"rms":0.00016,"peak":0.000724,"transcript":" [BLANK_AUDIO]"},
  {"durationSec":0.869,"rms":0.00018,"peak":0.000683,"transcript":" [BLANK_AUDIO]"}
]
```

Timing evidence:

```text
speech_start_detected: 19:18:14.974
first model_inference_start: 19:18:15.644
first model_inference_result: 19:18:20.361 -> "day."
first transcript retained, not emitted: wordCount=1, canEmitPartial=false
second model_inference_result: 19:18:23.761 -> "and"
second transcript retained, not emitted: wordCount=1, canEmitPartial=false
Stop clicked: 19:18:43.705
Processing speech locally visible: 19:18:46.166
whole_utterance_commit_start: 19:18:49.134
whole_utterance_commit_accept: 19:18:52.053 -> "Day, like, told Wild Tales to frighten him."
stop_force_processing_complete: 19:18:52.088
```

Key trace rows:

```json
{"event":"first_transcript_substance_retain","preview":" day.","wordCount":1,"minWords":4,"rms":0.011706,"minRms":0.05,"canEmitPartial":false}
{"event":"first_transcript_substance_retain","preview":" and","wordCount":1,"minWords":4,"rms":0.009414,"minRms":0.05,"canEmitPartial":false}
{"event":"whole_utterance_commit_accept","rawPreview":" Day, like, told Wild Tales to frighten him.","preview":"Day, like, told Wild Tales to frighten him."}
```

Conclusion:

```text
h1_6 failed badly as a user experience because no useful live text appeared, then the final arrived late and still had the wrong onset.
```

## Code Evidence

### Speech-start gate and buffering

File: `frontend/src/services/transcription/modes/PrivateWhisper.ts`

Relevant lines: 780-848.

```ts
if (!this.hasDetectedSpeech) {
  this.recordSpeechGateFrame(energy, isSpeechFrame);
  ...
  if (this.consecutiveSpeechSamples >= SPEECH_START_MIN_SAMPLES) {
    this.hasDetectedSpeech = true;
    this.audioChunks = [
      ...this.prerollAudioChunks.map((chunk) => chunk.slice(0)),
      ...this.speechStartAudioChunks.map((chunk) => chunk.slice(0)),
    ];
    this.appendUtteranceAudio(this.audioChunks);
    pushPrivateTimeline('speech_start_detected', ...);
  }
}
```

Why it matters:

```text
h1_2 and h1_6 both start with short, low-energy first chunks. The first accepted audio was about 1.0 second, and the model produced weak first guesses.
```

### Rolling live decode and silence/low-energy gates

Relevant lines: 926-1099.

```ts
pushPrivateTimeline('process_audio_ready', ...);
...
const isBufferSilent = energy.rms < SESSION_PAUSE.SILENCE_RMS_THRESHOLD;
const isLowEnergyPauseTail = isMeaningfullySilent && energy.rms < SESSION_PAUSE.SILENCE_RMS_THRESHOLD * 3;
const isPostTranscriptLowEnergy = hasTranscript && energy.rms < SESSION_PAUSE.SILENCE_RMS_THRESHOLD * 3;
...
const processedAudio = force ? concatenated : this.capLiveDecodeWindow(concatenated);
this.clearAudioBuffer();
const result = await this.privateSTT.transcribe(processedAudio);
```

Why it matters:

```text
Live UI is fed by rolling chunks. In h1_2 the second rolling chunk decoded as "Peace too"; in h1_6 rolling chunks decoded as "day" and "and" and were mostly withheld.
```

### First-transcript hold and provisional emit

Relevant lines: 1266-1301.

```ts
if (!canPromoteToFinal) {
  pushPrivateTimeline('first_transcript_substance_retain', ...);
  if (canEmitPartial) {
    this.emitProvisionalPartial(newText, 'pre_final_threshold');
  }
  this.retainSpeechLikeAudioForRetry(processedAudio, energy, 'first_transcript_substance');
  return;
}
```

Why it matters:

```text
h1_2 emitted weak provisional text to the UI. h1_6 withheld weak one-word outputs, leaving the user with no useful live text.
```

### Stop-time final decode

Relevant lines: 1573-1605 and 1846-1915.

```ts
while (this.isProcessing && performance.now() - waitStartedAt < TRANSCRIPTION_TIMEOUT_MS) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
...
this.onStatusChange?.({ message: 'Processing speech locally…' });
await this.processAudio({ force: true });
await this.commitWholeUtteranceTranscript();
...
const result = await this.privateSTT.transcribe(audio);
const transcript = sanitizePrivateTranscriptCandidate(rawText);
this.wholeUtteranceTranscript = transcript;
this.currentTranscript = transcript;
this.onTranscriptUpdate?.({ transcript: { final: transcript } });
```

Why it matters:

```text
The app waits for any active live inference, runs forced tail processing, then runs a whole-utterance decode. This explains why final text appears much later than first draft. In h1_2/h1_6, that final decode still produced wrong text.
```

## Current Verdict

```text
Private STT is journey-functional but not parity-green.
Do not claim Private meets or exceeds drop-in vendor behavior.
Do not rely on a stall/progress UI until final text is consistently correct.
```
