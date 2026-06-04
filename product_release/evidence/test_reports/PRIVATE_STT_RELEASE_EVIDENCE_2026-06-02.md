# Private STT Release Evidence — Current

**Updated:** 2026-06-04T11:40Z  
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
