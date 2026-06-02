# Private STT Test Report — Current Release Evidence

**Updated:** 2026-06-02  
**Scope:** Private v2/v4 local STT, browser app path, drop-in parity, timing, and readability  
**Canonical metric matrix:** `product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.json`

## Current Verdict

```text
Private STT: NOT GREEN YET
Current product status: caveated local/private path
Primary launch blockers:
1. Browser proof for washington_01 with return_timestamps:true is pending.
2. h1 guard rows need rerun after current return_timestamps fixes.
3. User-visible progress/trust states must be verified during blank/late-draft periods.
4. Longer-speech behavior must prove segment/timestamp completeness, not just short WER.
```

Private has moved from lifecycle failure to targeted quality/timing validation. Save/history/detail passed in the latest focused browser proof, and Cloud fallback was false. That is good, but not enough for release-green because users can still see late or unstable draft text and because browser long-form proof is not complete.

## Current Release Metrics

All future Private runs must populate the shared JSON with these fields:

| Metric group | Required fields |
| --- | --- |
| Accuracy | accuracy, error/WER, app-vs-drop-in delta, row-level failures |
| Product signals | filler recall, false filler insertion, transcript confidence |
| Readability | terminal punctuation, sentence count, max run-on words, capitalization errors, duplicate detection, readability verdict |
| Timing | first progress, first draft, first inference start/end, final inference start/end, finalization wait, stop-to-detail |
| Journey | selected source, saved transcript, history visible, detail visible |
| Runtime | provider, runtime, WebGPU availability, cross-origin isolation, WASM thread count, cloudFallbackAttempted |

Release gate:

```text
Private must not materially degrade its own drop-in/full-WAV baseline.
For user-visible release, Private must also make uncertainty obvious:
Listening/Processing -> Draft transcript -> Final transcript.
```

## Latest Preserved Browser Evidence

Focused Private app run:

| Fixture | App Final Transcript | App Accuracy | First Text | Stop Finalization | Runtime | Save/History/Detail | Current Read |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| `h1_1` | `Um, the stale smell of old beer. Like, lingers.` | 100% | 5633 ms | 3382 ms | `wasm-singlethread` | pass | Accurate final; first text late. |
| `h1_2` | `Basically, a dash of pepper spoils beeps too.` | 75% | 4880 ms | 3007 ms | `wasm-singlethread` | pass | Final corrupts `beef stew`. |
| `h1_6` | `Day, light, told Wildtailed to brighten him.` | 37.5% | 6899 ms | 4249 ms | `wasm-singlethread` | pass | App-worse parity blocker in this run. |
| `h1_8` | `The puppy, light, chewed up the new shoe.` | 75% | 6709 ms | 5594 ms | `wasm-singlethread` | pass | Better than drop-in, still not exact. |
| `h1_10` | `Basically, the quick brown fox jumps over the lazy dog.` | 100% | 4646 ms | 2450 ms | `wasm-singlethread` | pass | Parity. |

Focused app-vs-drop-in comparison:

| Fixture | App Accuracy | Drop-In Accuracy | Delta | Current Read |
| --- | ---: | ---: | ---: | --- |
| `h1_1` | 100% | 88.89% | +11.11pp | App better by WER; late first text remains a UX issue. |
| `h1_2` | 75% | 75% | 0pp | Same WER, different errors. |
| `h1_6` | 37.5% | 75% | -37.5pp | Must be rerun after current fixes; row-level blocker if repeated. |
| `h1_8` | 75% | 37.5% | +37.5pp | App better in this run. |
| `h1_10` | 100% | 100% | 0pp | Parity. |

Artifacts:

```text
App focused run:     /private/tmp/speaksharp-private-official-focused-20260601173817.json
Drop-in all-10 run:  /private/tmp/speaksharp-private-dropin-official-all-20260601175117.json
```

## Latest Current Browser Evidence — 2026-06-02

Route:

```text
page getUserMedia override with per-fixture WAV injected at mic request time
```

Reason:

```text
Physical afplay failed in this environment with AudioQueueStart failed (-66680).
Chrome fake-audio launch-time capture is timing-ambiguous. The injected route
starts the selected WAV when the app requests mic input, which is valid for
Private browser/app proof but not Native Web Speech proof.
```

Guard-row results after `return_timestamps:true`:

| Fixture | Accuracy | First progress | First draft | Finalization wait | Readability | Journey | Transcript |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| `h1_1` | 88.89% | 1341 ms | 3044 ms | 1927 ms | pass | pass | `Umm, the stale smell of old beer, like, lingers.` |
| `h1_2` | 100% | 1546 ms | 3029 ms | 1817 ms | pass | pass | `Basically, a dash of pepper spoils beef stew.` |
| `h1_6` | 87.5% | 1422 ms | 3036 ms | 1788 ms | fail: capitalization | pass | `Day, Like, Told Wild Tales to Frighten Him.` |
| `h1_8` | 100% | 1357 ms | 3021 ms | 1851 ms | pass | pass | `The puppy, like, chewed up the new shoes.` |
| `h1_10` | 100% | 1482 ms | 3039 ms | 1869 ms | pass | pass | `Basically, the quick brown fox jumps over the lazy dog.` |

Washington 65.8s result:

| Fixture | Accuracy | First progress | First draft | Finalization wait | Journey | Readability |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `washington_01` | 98.95% | 1598 ms | 3029 ms | 10695 ms | pass | fail: max run-on 104 words |

Current read:

```text
Private improved materially versus the prior focused run. The sharp h1_6 row is
no longer app-worse in this current injected browser proof: 37.5% -> 87.5%.
The 65.8s Washington proof is accurate and complete with return_timestamps:true.
The remaining Private blockers are punctuation/readability on medium speech,
confirming v4 browser behavior if v4 is selected as the release candidate, and
testing human/physical mic when the environment can play audio.
```

Current artifacts:

```text
/private/tmp/speaksharp-private-washington-default-rt-true-injected-20260602.json
/private/tmp/speaksharp-private-guard-h1_1-rt-true-injected-20260602.json
/private/tmp/speaksharp-private-guard-h1_2-rt-true-injected-20260602.json
/private/tmp/speaksharp-private-guard-h1_6-rt-true-injected-20260602.json
/private/tmp/speaksharp-private-guard-h1_8-rt-true-injected-20260602.json
/private/tmp/speaksharp-private-guard-h1_10-rt-true-injected-20260602.json
```

## Current Node/Drop-In Ceiling Evidence

| Candidate | Corpus | Evidence | Accuracy | Error | Filler recall | Readability | Current Read |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| Private v2 | Harvard h1_1-h1_10 | Node/full-WAV | 93.89% | 6.11% | 90.9% | 9/10 pass | Current baseline. |
| Private v4 | Harvard h1_1-h1_10 | Node/full-WAV | 96.39% | 3.61% | 90.9% | 10/10 pass | Strongest Private candidate so far. |
| Private v2 | `washington_01` 65.8s | Node/full-WAV | 98.95% | 1.05% | n/a | fail | Accuracy strong; run-on readability fails. |
| Private v4 | `washington_01` 65.8s | Node/full-WAV | 98.95% | 1.05% | n/a | fail | Faster than v2; run-on readability fails. |

Important correction:

```text
The earlier "30s cliff" interpretation is superseded by the return_timestamps finding.
Workers must use return_timestamps:true for long-form Whisper chunk stitching.
The browser app path is now being prepared for that proof.
```

## Current Code/Dev Coordination

Current code under verification:

```text
Private Transformers.js worker and engine paths are being switched to return_timestamps:true.
manual-stt-corpus-proof.mjs is being extended to include washington_01.
```

Dev-agent responsibility:

```text
1. Complete the app-buffer replay experiment for h1_6 and h1_8:
   exact app whole-utterance audio buffer -> drop-in/Node decoder.
2. Identify first bad boundary:
   audio prep/windowing, runtime nondeterminism, candidate selection, or cleanup.
3. Provide exported WAV path, duration, sample rate, RMS/peak, decoder config,
   decoded transcript, WER, and conclusion.
4. Do not patch broad accuracy behavior before that result.
```

STT test-agent responsibility:

```text
1. Run browser app proof for washington_01 65.8s with return_timestamps:true.
2. Run h1 guard rows after current fixes.
3. Capture progress UI during blank/late-draft periods:
   Listening/Processing, Draft transcript, Finalizing, Final transcript.
4. Update the shared JSON after each run.
```

## Timing Budget To Verify

| Metric | Target | Hard limit | Why it matters |
| --- | ---: | ---: | --- |
| First progress | <=1s | <=2s | Prevents blank/frozen UI. |
| First draft | <=5s | <=8s for Private CPU | Gives user confidence the mic is working. |
| Stop-to-final for short speech | <=8s | <=12s | Prevents stop from feeling broken. |
| Stop-to-final for ~60s speech | <=20s | <=30s | Maximum tolerable local-processing wait. |
| Stop-to-detail visible | <=25s for ~60s | <=35s | Full journey wait. |

If final text is late but accurate, the UI must still show progress and label draft/final trust state. If final text is late and inaccurate, Private is not release-green.

## Next Required Runs

Ordered current-hour plan:

1. Private browser `washington_01` 65.8s with `return_timestamps:true`.
2. Private h1 guard rows after current fixes.
3. Update JSON/MD matrix with all accuracy, readability, timing, and journey fields.
4. Classify Private as green, caveated, hidden, or backlog.

Pass condition:

```text
Private can be caveated/visible if final quality is near drop-in, progress UI is honest,
save/history/detail pass, and long-form timing is within budget.
Private is green only if browser app results match or exceed drop-in/customer baseline
on accuracy, readability, timing, and journey.
```
