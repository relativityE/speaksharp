# Native STT Release Evidence — Current

**Updated:** 2026-06-04T11:40Z  
**Scope:** Chrome Web Speech Native STT, real human mic, formatter, trust UI, save/history/detail  
**Canonical matrix:** `product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.json`

## Verdict

```text
Native STT: NOT RELEASE-GREEN
```

Native is still the Free/conversion-funnel path, but the current human proof does not support a polished transcript claim.

## Current Controlling Proof

Artifact:

```text
/private/tmp/speaksharp-native-human-20260604-rerun2.json
```

| Field | Current result |
| --- | --- |
| Browser/input | Real Chrome mic, headed, no fake audio |
| Recording / transcript / save / history / analytics | all true |
| Save source | `service_result` |
| Saved word count | `55` |
| Detail transcript | empty |
| Formatter telemetry | `attempted=true`, `latencyMs=853`, `errorCode=null`, `fallbackToRaw=false`, `wordPreserving=true` |

Saved transcript:

```text
Speak sharp microphone proof Starts Now basically I want to make one simple point before we move on like the main idea is that every transcript should stay readable keep prior sentences and preserve the final words next step is to save this session open the detail page and confirm the score explains transcript quality.
```

## Open Blockers

| Priority | Blocker | Evidence | Owner |
| --- | --- | --- | --- |
| P0 | Detail transcript empty | `detailTranscript=""`, `detailTranscriptMatchesSelected=false`, while save/history/analytics were true and `saveCandidate` was non-empty. | @dev-agent |
| P1 | Formatter quality still weak | Formatter returned quickly and word-preserving, but transcript still has bad truecasing (`Starts Now`) and weak punctuation. Do not special-case this phrase. | @dev-agent |
| P1 | Trust-label spacing bug | Extracted banner text glues words: `Draft transcriptText may change...`. | @dev-agent |

## Trust-Copy Contract

Native and Cloud must use generic trust language only.

| State | Required copy |
| --- | --- |
| Recording / provisional words | `Draft transcript` |
| Stop/finalizing | `Processing transcript…` or `Finalizing transcript…` |
| Final accepted | normal final transcript styling |
| Forbidden | `local`, `locally`, `on this device` for Native/Cloud STT processing |

## Next Test After Dev Fix

Owner: **test-release-agent / Codex** after `@dev-agent` lands a fix.

Run the same real Chrome mic proof and capture:

```text
__SPEECH_RUNTIME_DEBUG__().saveCandidate
__NATIVE_FORMATTER_LAST__
__NATIVE_FORMATTING_STATUS__
__SS_TRUST_STATE__ / __SS_TRUST_TRACE__
data-session-persisted-id
data-session-detail-transcript
```

Pass only if detail text matches the authoritative save candidate, formatter improves readability without changing words/fillers, and trust copy remains generic.
