# Private STT Release Evidence — Current

**Updated:** 2026-06-04T13:26Z
**Scope:** Private v2 local/browser STT, explicit setup consent, accuracy, trust UI, save/history/detail  
**Canonical matrix:** `product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.json`

## Verdict

```text
Private STT: NOT RELEASE-GREEN
```

Explicit local model setup consent is now proven, but the current human transcript is too inaccurate and the detail journey still fails.

## Current Controlling Proof

Artifacts:

```text
/private/tmp/speaksharp-private-human-20260604-rerun.json
/private/tmp/speaksharp-private-human-20260604-rerun.jsonl
```

| Field | Current result |
| --- | --- |
| Setup consent | user clicked visible `Set Up`; no harness auto-click |
| Recording | started after model ready |
| Save source | `service_result` |
| Reference words | `55` |
| Saved words | `39` |
| Accuracy / WER | `56.36%` / `43.64%` |
| Filler recall | `66.67%`; `um` missed |
| False filler insertions | `0` |
| Detail transcript | empty / not extracted |
| Duplication | no loop in this final transcript |

Saved transcript:

```text
Speak sharp microphone proof starts now. Basically, I want to make one simple point before we move on. Like, the memory transcript should still keep prior sentences, or the final words. Next step is to see or explain's quality.
```

## Open Blockers

| Priority | Blocker | Evidence | Owner |
| --- | --- | --- | --- |
| P0 | Accuracy/parity failure | Expected `the main idea is that every transcript...`; saved `the memory transcript...`. This is semantic STT error, not punctuation. | @dev-agent |
| P0 | Detail transcript empty | `detailTranscript=""`, `detailContainsSelected=false`, session `8e578cdf-c4d3-4e42-815a-d9a3c1ba3e78`. | @dev-agent |
| P1 | Filler recall below product need | `um` missed; filler recall `66.67%`. | @dev-agent / product confidence |
| P1 | Live trust/progress suspect | Chunks decoded every ~1.4-2.1s, but logs repeatedly showed `Holding first transcript until it has speech-like substance`; useful text appeared at Stop. | @dev-agent |

## Latest Test-Release Result — Decode-Parameter A/B

Owner: **test-release-agent / Codex**  
Branch/proof: `test/private-decode-param-ab-hook`, h1_6 browser worker proof, fake-audio fixture  
Artifacts: `/private/tmp/speaksharp-private-decode-ab-h1_6-real-auth`

| Variant | Decode options | Saved text | Accuracy / WER | Result |
| --- | --- | --- | --- | --- |
| Baseline | current app defaults | `A. Like. Told Wild Tales to Frighten.` | `75.00%` / `25.00%` | Best of this A/B, but still not parity-green. |
| Anti-hallucination | `return_timestamps:true`, `condition_on_previous_text:false`, `compression_ratio_threshold:2.4`, `no_repeat_ngram_size:3`, `temperature:[0,0.2,0.4]` | `They, like, told Wild Tales to Fridonham, they, like. Told Wild Tales To Fridinham.` | `0.00%` / `100.00%` | Rejected. It worsened h1_6 with repetition/substitution. |

Conclusion: reversible decode knobs are **not** the current Private accuracy fix. Keep app defaults while dev investigates the semantic substitution/detail/live-trust blockers.

## Test-Release Plan — VAD Prototype Gate

Owner: **test-release-agent / Codex** to execute only after `@dev-agent` ships an explicit VAD prototype flag.  
Required flag shape: one clear runtime toggle such as `PRIVATE_VAD_PROTOTYPE=1` or a browser hook with the exact candidate thresholds in the artifact. Do not test unlabelled threshold changes.

Fixtures:

```text
h1_1, h1_6, h1_8, h1_10
washington_01
latest Private human script
one silence-leading fixture with >=5s pre-speech silence
one low-energy tail fixture
```

Required metrics per row:

| Phase | Required fields |
| --- | --- |
| Setup | auth/tier, explicit setup click, model status, mic/input route |
| Runtime | `speech_start_detected`, `speechStartOffsetMs`, `retainedPrerollMs`, `peakBufferedSeconds`, `utteranceSeconds`, `lowEnergyPauseTailThreshold`, `silenceThreshold` |
| Timing | `timeToFirstProvisionalMs`, `timeToFirstFinalMs`, `finalizeWaitMs`, `finalizePrepMs`, `finalizeDecodeMs`, RTF |
| Accuracy | WER/accuracy, word completeness, semantic substitutions, filler recall, false filler insertion |
| Journey | visible transcript, `saveCandidate`, history, detail, duplicate detection |

Pass rule: VAD prototype must improve or preserve baseline accuracy on h1_6 and the human script, preserve onset/tail words, preserve fillers, and not regress first progress/finalization timing by more than 10%. Any onset clipping, low-energy tail loss, or worse semantic substitution fails the prototype.

## Trust-Copy Contract

Private may use local language only for actual local processing states.

| State | Required copy |
| --- | --- |
| Recording, no speech yet | `Listening locally…` |
| Speech/activity, no useful words yet | `Processing speech locally…` |
| Visible provisional words | `Draft transcript` |
| Stop/final decode running | `Processing speech locally…` or `Finalizing local transcript…` |
| Final accepted | normal final transcript styling |
| Forbidden | Gemini/server formatter by default; punctuation cleanup that hides semantic substitutions |

## Next Test After Dev Fix

Owner: **test-release-agent / Codex** after `@dev-agent` lands a fix.

Completed **test-release-agent / Codex** work is recorded in the canonical matrix: decode-parameter A/B, VAD prototype proof plan, session-to-analytics coherence, browser UX sweep, and report hygiene.

Current **test-release-agent / Codex** action after `@dev-agent` lands fixes:

```text
Rerun the same Private human script and capture the fields below.
If dev ships a named VAD prototype flag or a new decode candidate, run the predeclared proof gates from the canonical matrix.
```

Coordination protocol: do work on a temporary branch; when complete and verified, merge to `main`, delete the temp branch, and keep reports/backlog updated with the merge commit. Do not leave release fixes stranded on long-lived branches.

Rerun the same human script and capture:

```text
__SPEECH_RUNTIME_DEBUG__().saveCandidate
__PRIVATE_TIMING__
__SS_TRUST_STATE__ / __SS_TRUST_TRACE__
data-session-persisted-id
data-session-detail-transcript
filler rows via data-filler-word/data-filler-count
```

Pass only if setup remains explicit, visible draft text is useful/cumulative before Stop, saved transcript is near drop-in/customer expectation, `um` is not silently missed without confidence downgrade, and detail text matches the authoritative save candidate.
