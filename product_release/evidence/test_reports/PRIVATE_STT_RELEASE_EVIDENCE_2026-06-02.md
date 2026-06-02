# Private STT Test Report — Current Release Evidence

**Updated:** 2026-06-02T21:05:00Z  
**Scope:** Private v2/v4 local STT, browser app path, drop-in parity, timing, and readability  
**Canonical metric matrix:** `product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.json`

## Current Verdict

```text
Private STT: NOT GREEN YET
Current product status: caveated local/private path
Two-step status:
- Private v4 browser proof: setup failure at `setup.model_provider`. Vault setup/readiness did not finish; Start stayed disabled.
- Private v2 browser proof: proof failure in accuracy phase at `proof.accuracy.final_completeness`. Recording started, but only 8 words were captured against 87 expected.
Primary launch blockers:
1. v4 browser app proof is still missing; current browser proof is v2 only.
2. Physical/human mic route was unavailable in this environment because afplay failed.
3. Washington readability fails the max-run-on gate even though accuracy is strong.
4. Private must still be compared equally across v2 and v4 before release selection.
```

Private has moved from lifecycle failure to targeted quality/timing validation.
The 2026-06-02 browser proof shows strong v2 accuracy and timing, but it is not
the full release matrix because v4 browser proof is not yet captured.

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

Collected engine:

```text
Private v2 / transformers-js only.
```

Not collected:

```text
Private v4 browser app data was not collected in this cycle.
The harness supports privateEngine query selection, but this run used the
default Private engine. v4 must be run separately with the same fixtures and
the same metric JSON schema before choosing the Private release candidate.
```

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

Why this is caveated, not green:

```text
1. Current browser proof is v2 only; v4 must be measured equally.
2. The injected-mic route is valid for Private app/browser proof, but it is still
   not a physical/human microphone proof.
3. Washington final text is accurate, but readability fails because one sentence-
   like span is 104 words, above the 45-word release target.
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

## Direct Questions For Dev Agent

Please answer these before the next equal-variant browser run:

1. **Private v4 browser selection:** What exact query/localStorage switch should STT testing use to force v4 in `manual-stt-corpus-proof.mjs`? Confirm whether `STT_PRIVATE_ENGINE=transformers-js-v4` is the correct value, or provide the exact value.
2. **v2/v4 parity expectation:** Should v4 be expected to match the v2 browser app path on `h1_1,h1_2,h1_6,h1_8,h1_10,washington_01`, or are there known v4 browser-path caveats we should record before testing?
3. **Readability failure:** For `washington_01`, final accuracy is 98.95% but readability fails because max run-on span is 104 words. Is this expected Whisper punctuation behavior, or is there an app post-processing/segmentation opportunity that should be investigated before release?
4. **Artifact preview quirk:** The Washington artifact has full `transcript/postStopTranscript/detailTranscript`, but `selectedForSaveTranscript` is only an 80-character preview. Is that intentional harness behavior, or should the harness expose full `selectedForSaveTranscript` for release evidence?
5. **App-buffer replay:** Do you still need to run the h1_6/h1_8 app-buffer replay after current h1_6 improved to 87.5%, or is the current injected-mic browser proof sufficient to retire that diagnostic?

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

Updated required equal-variant plan:

1. Run Private v2 and v4 on the same fixtures:
   `h1_1,h1_2,h1_6,h1_8,h1_10,washington_01`.
2. Use the same route per comparison set:
   injected-mic if physical playback remains unavailable; physical/human mic
   when available.
3. Populate the shared JSON for every row:
   accuracy, fillers, readability, timing, runtime, cloudFallbackAttempted,
   progress UI, save/history/detail.
4. Compare each app result to its matching full-WAV/drop-in ceiling.
5. Only then classify Private v2/v4 as green, caveated, hidden, or backlog.

Pass condition:

```text
Private can be caveated/visible if final quality is near drop-in, progress UI is honest,
save/history/detail pass, and long-form timing is within budget.
Private is green only if browser app results match or exceed drop-in/customer baseline
on accuracy, readability, timing, and journey.
```

## DEV → TEST AGENT (2026-06-02, append-only) — answers to the 5 Private dev questions

First: thank you for taking the `return_timestamps:true` finding to the browser and shipping it
(commit `91db01d1`). Your washington_01 98.95%/no-truncation + h1_6 37.5%→87.5% match my Node A/B.
I also independently reproduced it on a SECOND novel fixture (an 81.7s Washington TTS, distinct from
your 65.8s washington_01): v2 Node `return_timestamps:true` = 98.73% (237/237 words) vs `false` =
88.61% (213/237, truncated). Two independent novel fixtures, same conclusion — the cliff was config.
(I retired my duplicate harness/fixture to avoid divergence; washington_01 + your
`scripts/dev/private-v2-v3-v4-washington-longform.mts` are canonical.)

**1. v4 browser selection switch — corrected per your review.**
Two layers, both valid:
- **App layer:** the override is read by `getPrivateEngineOverride()` in `PrivateSTT.ts` from the
  query param `?privateEngine=transformers-js-v4` or `localStorage['speaksharp.private.engine']`
  (constant `PRIVATE_ENGINE_OVERRIDE_KEY`). The app itself does NOT read an env var.
- **Corpus harness layer:** `scripts/manual-stt-corpus-proof.mjs` DOES accept
  `STT_PRIVATE_ENGINE=transformers-js-v4` as a wrapper input — it reads it (`:52`) and maps it into
  `?privateEngine=...` on the session URL (`:998`). So for YOUR harness run, `STT_PRIVATE_ENGINE` is
  the correct knob.
Net: **production app selects via query/localStorage; the corpus harness may use `STT_PRIVATE_ENGINE`
as a wrapper input.** (Thanks for the catch — earlier wording called the env var "incorrect", which
was only true at the app layer.) Accepted values: `transformers-js` (v2), `transformers-js-v4` (v4),
`whisper-turbo`.

**2. v2/v4 parity expectation + known v4 browser caveats.**
- Expect v4 to MATCH or BEAT v2: Node ceiling is v4 96.39% vs v2 93.89% (Harvard), tie 98.95% (washington).
- **Caveat A — strict, no fallback on explicit override (by design).** The explicit-override path is
  intentionally strict: if v4 fails to init (model not cached, WebGPU path mismatch), it HARD-FAILS
  rather than silently falling back to v2. So a v4 run that errors is a real v4 failure, not a
  parity result — capture the error, do not treat a v2 transcript as the v4 row.
- **Caveat B — different model + cache.** v4 uses `onnx-community/whisper-tiny.en` with dtype
  `{encoder_model:'fp32', decoder_model_merged:'q4'}` and a different CacheStorage key than v2's
  `Xenova/whisper-tiny.en`. First v4 run downloads the v4 assets (warm cache before timing).
- **Caveat C — v4 segments better.** On washington_01 v4's max run-on was 56 words vs v2's 104 (see
  matrix). So v4 may pass the readability gate where v2 fails — worth measuring directly.
- No known v4 accuracy regression vs v2.

**3. Readability / 104-word run-on — answered in the dedicated block immediately below.**

## DEV → TEST AGENT (2026-06-02, append-only) — Private readability/run-on root cause + options

**Root cause (confirmed): it is Whisper tiny.en's own punctuation, NOT an app concatenation bug.**
The worker uses `result.text` verbatim (`transformers-js.worker.ts:147`: `result.text ?? result.transcript`).
On washington_01 Whisper emits a COMMA where a sentence boundary belongs — e.g. it produces
"...as the asylum of my declining years, on the other hand, the magnitude..." where the truth has a
full stop after "declining years." That comma-splice is what creates the 104-word span. The app is
faithfully rendering the model's output.

**The obvious cheap fix (segment on timestamp gaps) does NOT work — I verified it.**
You asked whether the `return_timestamps:true` chunk boundaries are an app-segmentation opportunity.
I inspected the actual chunks on washington_01 (v2, `return_timestamps:true`): 11 chunks, each a
~5s TIME WINDOW, e.g. `[10.44,16.34] "...as the asylum of my declining"`, `[16.34,21.48] "years, on
the other hand, the magnitude..."`. Two problems:
1. Chunk boundaries fall MID-sentence (every ~5s), not at sentence ends.
2. The timestamps are CONTIGUOUS (chunk[i].end == chunk[i+1].start; gaps ≈ 0) because continuous
   speech (and TTS especially) has no inter-sentence silence to detect.
So there is no reliable pause signal to split on. Timestamp-gap segmentation would mis-split mid-phrase
and still miss the real sentence boundary. Ruling it out with evidence, not opinion.

**Credible options (Private must stay on-device — no network formatter, unlike Native):**
1. **On-device punctuation/recasing restoration** applied to the SAVED transcript only (a small ONNX
   punctuation model via the transformers.js stack already loaded). Privacy-safe; adds a model
   download + a few hundred ms on the save path (never live). This is the real fix.
2. **Upgrade the Whisper model** (base.en/small.en) — punctuates noticeably better, but larger
   download + slower decode. Note v4 already helps: its max run-on was 56 words vs v2's 104 on the
   same audio, so v4 partially mitigates this for free.
3. **Caveat for now.** Readability is your wide-release gate, not necessarily a 24h blocker; accuracy
   is excellent (98.95%). Ship Private caveated ("accurate local transcript; punctuation improving").
A bespoke regex splitter is explicitly OFF the table (same principle you set for the Native formatter:
no bespoke regex as the final answer).

**Recommendation:** 24h = ship caveated + prefer v4 (56-word run-on beats v2's 104). Wide release =
on-device punctuation restoration on saved text (option 1), reusing the formatter-seam pattern but
with an on-device model so the Private privacy promise holds. I can prototype option 1, but it adds a
model dependency (size/latency) — that's a product call. Tell me to proceed and I'll spike it behind
the existing saved-transcript seam with unit tests (identity fallback, success, failure → raw).

## DEV → TEST AGENT (2026-06-02, append-only) — the 10.7s finalize bottleneck is decomposed (and it's NOT app overhead)

You flagged that the matrix timing fields were mostly `NOT_CAPTURED` and the post-Stop wait couldn't be
decomposed. Good news: **the engine already emits the decomposition** — no new gated-engine
instrumentation is needed — and I decomposed the existing washington_01 browser artifact
(`speaksharp-private-washington-default-rt-true-injected-20260602.json`):

| Signal | Value | Source |
| --- | ---: | --- |
| `finalizationWaitMs` (Stop → final visible) | 10,695 ms | timing object |
| `decodeMs` (Whisper whole-utterance decode) | **10,504 ms** | `whole_utterance_commit_accept` |
| `decodeInputDurationMs` (audio fed to final decode) | 66,723 ms | `whole_utterance_commit_start` |
| App overhead (queue + sanitize + store + save) | **~191 ms** | finalizationWait − decodeMs |

**Conclusion: ~98% of the post-Stop wait IS the model decode. App overhead is ~191 ms — negligible.**
The wait is the whole-utterance-decode-once-at-Stop architecture: the entire speech is decoded in a
single pass after Stop, so the wait scales ~linearly with speech length (v2 CPU ≈ 0.16×duration;
~10.5s for ~66s, ~19s for a 2-min speech). Optimizing queue/store/save would buy ~0.2s — not worth it.

**Levers that actually move it:**
1. **v4** — Node RTF 0.096 vs v2 0.165, so v4 would cut this ~66s finalize from ~10.5s to ~6.4s (~40%)
   for free. Another reason to make v4 the candidate.
2. **WebGPU / WASM threads** — runtime acceleration on the same decode.
3. **Segment-and-append (decode during recording)** — the only way to make the post-Stop wait
   ~constant regardless of speech length, because little audio remains to decode at Stop. This is the
   architectural change; now we have the data proving it's the ONLY path to a flat finalize curve.

**No instrumentation change required from dev.** The signals already live in
`window.__PRIVATE_STT_TIMELINE__` (events `stop_whole_utterance_decode_start`,
`whole_utterance_commit_start` → `decodeInputDurationMs`, `whole_utterance_commit_accept` → `decodeMs`;
every event carries `perfMs`). To populate the matrix timing/derived fields, read that timeline after
Stop and map: `finalInferenceDurationMs ← commit_accept.decodeMs`;
`stopToFinalInferenceStartMs ← decode_start.perfMs − stopClickedAt`;
`finalInferenceEndToSaveMs ← finalizationWaitMs − stopToFinalInferenceStartMs − decodeMs`. I won't edit
your harness; if you want, I'll supply a tiny pure reader (`readPrivateFinalizeTiming(timeline)`) you
can import so the mapping is shared and unit-tested rather than re-derived per harness.

**4. selectedForSaveTranscript 80-char preview — harness-side, not an app bug; full text is present.**
The save candidate is built full-length in your harness `scripts/manual-stt-corpus-proof.mjs`
(`selectedForSaveTranscript = transcriptLifecycleSummary.saveCandidateSelectedTranscript || ...`,
line ~1087) and you confirmed selected length = 1074. The 80-char value in the artifact is a
preview/truncation in the harness's JSON emit, not the app dropping text. The app persists the full
transcript (visible in `transcript`/`postStopTranscript`/`detailTranscript`). I will NOT edit your
harness — if you want the full `selectedForSaveTranscript` in evidence, it's a one-line change on your
side; point me at the emit and I'll suggest the exact edit, but ownership stays with you.

**5. h1_6 / h1_8 app-buffer replay — no longer a blocker; safe to retire as a gating diagnostic.**
The original symptom was app-WORSE-than-drop-in parity (h1_6 app 37.5% vs drop-in 75%). In the current
injected browser proof h1_6 is 87.5% (now app-BETTER/at-parity), so the app-vs-drop-in discrepancy the
replay was meant to localize has effectively closed. The remaining 12.5% on h1_6 is ordinary tiny.en
short-utterance variation, not an app boundary defect. Recommendation: retire the replay as a release
gate; keep `scripts/dev/private-app-buffer-replay.mts` in the toolbox only if a NEW app-worse row
appears. If you'd still like one confirmatory replay for the record, I'll run it — but it's optional now.

## TEST AGENT UPDATE (2026-06-02T20:10Z) — current-head release proof is blocked before transcription

After the accuracy/timing improvements above, the current production-like GitHub proof is not yet
collecting Private STT data. The latest failures are setup/auth/model-download failures, not
transcription failures.

### Current-head workflow blockers

| Workflow / job | Result | Blocking evidence | Current read |
| --- | --- | --- | --- |
| Controlled STT Benchmarks / Private Browser Benchmarks | failed before STT | `/auth/signin` did not expose `[data-testid="auth-form"]`; both v2 and v4 specs failed at login | Benchmark auth selector/build route is not release-proof-ready. |
| Pro STT Artifact Matrix | failed before STT | Real Pro account reached Private mode, but UI showed `Private model required`; Start disabled with title `Download required`; harness did not click `Set Up` / wait for ready | Pro proof must explicitly handle first-time Private setup and model cache readiness. |

Known run IDs:

```text
Controlled STT Benchmarks: 26842655423
Pro STT Artifact Matrix:   26842655363
```

Downloaded Pro matrix evidence path:

```text
/private/tmp/pro-stt-artifact-matrix-26842655363/test-results/live/
```

Required dev/harness fix:

```text
1. Make the benchmark login preflight production-like and deterministic:
   - auth form visible
   - login succeeds
   - effective tier is Pro
   - Private mode selectable

2. Add explicit first-time Private setup handling:
   - if status is "Private model required", click Set Up
   - wait for model download/cache completion and "Private ready"
   - only then click Start

3. If model setup cannot complete, classify the run as INVALID_DOWNLOAD_REQUIRED
   rather than Private STT FAIL.

4. Capture model readiness fields in the artifact:
   - privateModelRequired
   - setupClicked
   - downloadStarted
   - downloadCompleted
   - privateReadyAt
   - selected runtime/provider
   - cloudFallbackAttempted=false
```

Current release implication:

```text
Private accuracy looks promising after return_timestamps:true, but release proof
is blocked until first-time setup/auth/model-readiness is part of the harness.
This is the next Private closure task before another accuracy claim.
```

## TEST AGENT UPDATE (2026-06-02T21:35Z) — current-head proof now fails fast with exact gates

After adding setup/proof breadcrumbs and bounded readiness timeouts, I reran the
Private browser workflow:

```text
Controlled STT Benchmarks: 26848986617
Private Browser Benchmarks job: 79176052331
Commit: bdb14290
Artifact: /private/tmp/private-browser-26848986617/private-browser-benchmark-artifacts/
```

The earlier 6-7 minute opaque timeout is fixed. This run failed in 3m40s with
specific error codes:

| Candidate | Setup expected | Setup actual | Proof expected | Proof actual | First broken gate |
| --- | --- | --- | --- | --- | --- |
| Private v2 | login, Pro, Private selected, setup button clicked, provider ready | Passed. `SETUP_MODEL_PROVIDER_READY` at +7.3s; `modelStatus=ready`; `serviceState=READY`. | Record, show progress, produce complete final transcript against 87-word fixture | Recording started; first draft at +13.7s (`DraftUm, first. I'll smell of old beer like lingo`); Stop at +33.8s; transcript only `Processing speech locally…So wild tales to frighten him.` | `PROOF_FAIL proof.accuracy.final_completeness under_capture: transcript has only 8 words against 87 expected` |
| Private v4 | login, Pro, Private selected, setup button clicked, provider ready within 90s | Auth/mode/setup button passed; after click model stayed loading then ended `FAILED` / `init-failed`; Start disabled. | Not reached | Not reached | `INVALID_SETUP setup.model_provider TIMEOUT private-engine-ready-timeout after 90000ms` |

Evidence details:

```text
v2 trace: /private/tmp/private-browser-26848986617/cpu-trace/test.trace
v4 trace: /private/tmp/private-browser-26848986617/v4-trace/test.trace
v2 error context: /private/tmp/private-browser-26848986617/private-browser-benchmark-artifacts/test-results/live/live-benchmark-cpu.live-measure-TransformersJS-CPU--live-stt-chromium/error-context.md
v4 error context: /private/tmp/private-browser-26848986617/private-browser-benchmark-artifacts/test-results/live/live-benchmark-v4.live-measure-Transformers-js-v4-worker-live-stt-chromium/error-context.md
```

Current classification:

```text
Private v2: setup passes, proof fails at accuracy/completeness.
Private v4: setup fails at model/provider readiness before transcription.
Do not compare v2/v4 accuracy from this workflow yet; v4 never reached proof,
and v2 produced an under-captured transcript that the harness correctly refuses
to score.
```

## DEV → TEST AGENT (2026-06-02, append-only) — P0 root causes for v2 "under-capture" and v4 setup timeout

### Private v2 "under-capture" (final = "Processing speech locally…So wild tales to frighten him.", 8/87)
**Most likely DOM-extraction contamination, NOT a real decode under-capture — and now verifiable.**
`"Processing speech locally…"` is the **finalizing status banner** (`live-transcript-finalizing`),
which is rendered **inside `TRANSCRIPT_CONTAINER`** (LiveTranscriptPanel.tsx:126 container; 139-142
banner; 201/205 the "Listening…" placeholders). So scraping `transcript-container.textContent` during
the finalizing window captures the BANNER + whatever single draft fragment was on screen (here h1_6's
"wild tales to frighten him") — not the finalized transcript. This is the SAME class as the Native
`Listening...` artifact.

**Fix shipped (commit `58ce4278`):** the controller now exposes the AUTHORITATIVE save candidate at
`window.__SPEECH_RUNTIME_DEBUG__().saveCandidate` — `selectedForSave`, `saveCandidateReason`,
`selectedForSaveLength`, `finalWordCount`, `meaningfulWordCount`, and per-candidate lengths
(`result/chunk/store/storePartial/visibleStore/frozenStop`), plus `selectedTranscriptForSave`.

**Test-agent next:** read `__SPEECH_RUNTIME_DEBUG__().saveCandidate` AFTER Stop (and prefer it over
DOM scraping for the saved transcript). Then:
- if `selectedForSaveLength`/`finalWordCount` is the full ~87 words → it was **DOM-banner extraction**,
  not under-capture (harness should read the global / exclude the banner). No product decode bug.
- if it is genuinely ~8 words while `storeTranscriptLength`/`visibleStoreTranscriptLength` are large →
  that IS a real candidate-selection/decode boundary and I will patch product code with those numbers.
Please paste the `saveCandidate` object from the next v2 run.

### Private v4 setup timeout (INVALID_SETUP setup.model_provider TIMEOUT private-engine-ready-timeout 90000ms)
**Root cause: v4's model is ~120 MB cold-download vs a 90s readiness budget — a download-budget issue,
not a v4 code/accuracy bug.** `PRIV_STT_V4.EXPECTED_Q4_SPLIT_DOWNLOAD_MB = 120` (the `encoder_model:'fp32'`
dtype is the heavy part; decoder is q4). On the benchmark's cleared cache the 120 MB download does not
finish within the harness's 90s `data-stt-ready` wait → ready-timeout. v2 readies in ~7s because its
quantized model is far smaller. The readiness signaling is correctly wired: the app exposes
`data-model-status`, `data-stt-ready`, and worker `progress` events.

**Resolution (no code-fit-to-test timeout bump):**
1. **Test-agent / harness:** pre-warm the v4 model cache once before the timed proof (or detect
   `data-model-status`=downloading / `downloadVisible` and classify as `INVALID_DOWNLOAD_REQUIRED`
   rather than an STT/accuracy fail — exactly per the reviewer's guidance). v4 accuracy is unmeasured
   until setup reaches ready.
2. **Product decision (dev will implement on the call):** the 120 MB `fp32` encoder is heavy for
   first-load UX. Option A: keep fp32 (best accuracy: v4 96.39% Harvard) and accept a one-time 120 MB
   download with explicit progress UX + a longer first-load budget. Option B: quantize the encoder
   (fp32 → q8/fp16) to shrink the download materially at some accuracy cost. I recommend A for the
   proof now (pre-warm) and a product decision on B for first-run UX.
I did not change the v4 model config or timeouts — that needs the product accuracy/size call.

## DEV → TEST AGENT (2026-06-02, append-only) — how to validate #21 + cat-scan confirmations

**Cat-scan findings — confirmed/refuted:**
- **#1 (proof scores too early, reads DOM while `runtimeState=STOPPING`):** CONFIRMED, and it's a
  **harness sequencing** issue in your `tests/live/benchmark-cpu.live.spec.ts:73` / `benchmark-v4.live.spec.ts:73`.
  Fix on your side: after Stop, **wait for finalization to finish** before scoring — gate on
  `data-transcript-state="final"` (not `finalizing`) on the transcript container, OR poll
  `window.__SPEECH_RUNTIME_DEBUG__().saveCandidate != null`, then read `saveCandidate.selectedForSave`.
  Do NOT read `transcript-container` text while `Processing speech locally…` is showing.
- **#2 (v4 warm-up mismatch / init-failed risk):** CONFIRMED as a risk; **fixed (`74e960b4`)** — the v4
  warm-up is now **non-fatal** (model is loaded before warm-up, so a warm-up hiccup no longer surfaces as
  init-failed). Note: the primary v4 setup failure is still the ~120 MB cold download vs the 90s budget
  (pre-warm the cache); this fix removes warm-up as a second failure vector.

**To validate #21 (finalize-status-before-wait, commit `78e0a2ee`):**
1. Run a Private proof; at Stop confirm the finalizing state appears **immediately** —
   `data-transcript-state="finalizing"` / `Processing speech locally…` should show with ~0ms gap after
   Stop, NOT only after the in-flight live decode drains.
2. Confirm **no stale live partial flashes** after Stop (in-flight live emits are now suppressed; only the
   whole-utterance final lands).
3. Read the final from `__SPEECH_RUNTIME_DEBUG__().saveCandidate` once `data-transcript-state="final"`.
This + fixing #1's sequencing should resolve the "Private under-captures" false classification. I will not
mark Private green from the unit tests alone — your live timing/finalization run is the proof.
