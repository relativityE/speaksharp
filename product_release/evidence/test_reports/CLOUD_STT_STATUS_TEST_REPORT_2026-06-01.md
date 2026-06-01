# Cloud STT Status Test Report — Current Open Work, 2026-06-01

## Current Verdict

```text
Cloud STT: strongest current STT path, but not fully release-proven
Evidence type: prior app corpus + provider A/B artifact with invalid-session handling
Primary blockers: valid prompt/keyterms A/B, filler recall proof, current app trace proof
```

Current artifacts:

```text
Prior app corpus:      /private/tmp/speaksharp-cloud-harvard10-app.json
Prior provider A/B:    /private/tmp/assemblyai-ab-26776256219/assemblyai-streaming-ab-proof.json
```

Completed or obsolete items removed from this report:

```text
A/B invalid empty sessions being scored as real 0% rows: fixed.
closeCode/closeReason/firstMessageRaw/messageCount capture: implemented.
Summary validRowCount/invalidRowCount/evidenceValid fields: implemented.
Cloud 95% batch target mismatch: superseded by corrected streaming target.
```

## Current Accuracy Context

Latest available SpeakSharp Cloud app corpus:

```text
Accuracy: 91.53%
WER: 8.47%
```

Corrected comparable AssemblyAI streaming target:

```text
Accuracy: 91.86%
WER: 8.14%
```

Interpretation:

```text
Cloud is near the corrected AssemblyAI streaming target. It is not currently a
broad integration failure. The remaining work is validation, filler preservation,
and full boundary proof.
```

## Open Issue P0.1 — Valid AssemblyAI Prompt/Keyterms A/B

Issue:

```text
Prior A/B run had valid credentials, but keyterms/prompt variants returned empty
or no-Termination sessions. The script now marks those rows invalid instead of
scoring them as real model failures, but valid prompt/keyterms behavior is still
not proven.
```

Dev-agent responsibility:

```text
None unless the next credentialed run shows a concrete script/provider request
construction bug. Do not refactor Cloud architecture preemptively.
```

STT test-agent responsibility:

```text
Run a small credentialed A/B subset with real AssemblyAI credentials available
in the environment. This is testing work, not dev work.
```

Required variants:

| Variant | Purpose |
| --- | --- |
| `baseline` | Current default/control |
| `keyterms` | Keyterm boosting only |
| `prompt` | Verbatim/disfluency instruction only |
| `prompt_keyterms` | Candidate combined behavior |

Required fixtures:

```text
h1_1
h1_6
h1_8
one filler-heavy conversational script
one clean non-filler script
```

Required output:

| Field | Required |
| --- | --- |
| transcript | yes |
| WER / accuracy | yes |
| expected fillers | yes |
| recognized fillers | yes |
| filler recall | yes |
| false filler insertions | yes |
| tail preserved | yes |
| invalidSession / invalidReason | yes |
| closeCode / closeReason / firstMessageRaw | yes, especially on invalid rows |

What I will do with the result:

```text
If prompt/keyterms variants are valid and improve filler recall without harming
clean transcription, I will mark Cloud A/B as passing and recommend the best
variant.

If variants remain invalid, I will hand dev the close/reason/provider payload so
they can fix request construction or provider compatibility.
```

Bright-line boundary:

```text
Credentials and live provider A/B are STT testing.
Provider request construction bugs are dev work only after live evidence proves them.
```

## Open Issue P0.2 — Cloud Filler Preservation

Issue:

```text
Cloud is generally accurate, but current evidence does not prove it preserves
the filler/disfluency signals SpeakSharp cares about.
```

Known concerns from prior evidence:

| Fixture | Concern |
| --- | --- |
| `h1_1` | `Um` missed; `like` fragile |
| `h1_6` | onset/filler fragile |
| `h1_8` | `like` preservation fragile |

Dev-agent responsibility:

```text
None until the valid A/B run identifies whether the selected provider params are
wrong. Do not tune Cloud blindly.
```

STT test-agent responsibility:

```text
Measure filler recall and false filler insertion in the credentialed A/B and
app proof runs.
```

Expected handoff if it fails:

```text
I will provide per-variant transcripts and filler counts showing exactly which
fillers were missed or inserted. Dev can then adjust AssemblyAI prompt/keyterms
construction or product expectations.
```

Scope limit if Cloud dev work becomes necessary:

```text
Do not ask dev to "improve Cloud accuracy" broadly.
If A/B fails, hand dev only the worst one or two concrete rows/variants.
Expected likely focus rows: h1_1, h1_6, h1_8, or the filler-heavy script.
```

Example acceptable dev deliverable after a failed A/B:

```text
Root cause found:
The prompt+keyterms variant is rejected or silently closed by AssemblyAI streaming
when keyterms_prompt is JSON-encoded in the current URL shape. Provider evidence:
closeCode=<code>, firstMessageRaw=<message>, invalidReason=<reason>.

Code changed:
- AssemblyAICloudProvider.ts or assemblyai-streaming-ab-proof.mts: request
  construction adjusted to match AssemblyAI v3 streaming expectations.

Unit/no-browser proof:
- buildWebSocketUrl emits the exact expected query parameters for baseline,
  keyterms, prompt, and prompt+keyterms.
- invalid-session classifier still excludes empty/no-Termination sessions.

Expected live-observable change:
prompt/keyterms variants produce valid non-empty sessions for h1_1/h1_6/h1_8,
with filler recall reported.

Files changed:
<list files + commit SHA>
```

Example unacceptable dev deliverable:

```text
"Changed the Cloud prompt; try it again."
```

Why unacceptable:

```text
It does not identify the failing provider variant, does not cite close/provider
evidence, and does not tell STT testing which row/metric should improve.
```

## Open Issue P1 — Trace-Complete Cloud App Proof

Issue:

```text
The latest Cloud provider A/B artifact is provider-level. Cloud still needs a
fresh app proof using the shared boundary schema.
```

Required app trace fields:

| Field | Required |
| --- | --- |
| engine/provider message received | yes |
| service normalized event | yes |
| controller lifecycle update | yes |
| store update | yes |
| UI visible before stop | yes |
| stopSelectedSource | yes |
| savedTranscriptLength | yes |
| historyVisible | yes |
| detailVisible | yes |
| firstBrokenBoundary | if failed |

Dev-agent responsibility:

```text
Only add instrumentation if the app proof cannot capture these fields from the
current harness.
```

STT test-agent responsibility:

```text
Run the Cloud app proof and report the trace fields. If a field is missing due
to harness/instrumentation limitations, identify the exact missing field and
where it should be emitted.
```

What I will do with the result:

```text
If Cloud passes A/B and trace-complete app proof, I will classify Cloud as the
first candidate STT path for launch/bragging, subject to any remaining product
journey checks.
```

## Cloud Launch Blockers

| Blocker | Owner | Launch Impact |
| --- | --- | --- |
| Valid prompt/keyterms A/B not run after invalid-session fix | STT test agent | Cannot choose or reject filler-preservation variant. |
| Filler recall not proven | STT test agent first; dev if provider params fail | Cannot claim SpeakSharp-quality filler coaching for Cloud. |
| Trace-complete app proof stale/missing | STT test agent first; dev only if instrumentation missing | Cannot compare Cloud to Native/Private under same lifecycle contract. |
