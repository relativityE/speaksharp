# Native STT Required-Fields Test Report — Current Open Work, 2026-06-01

## Current Verdict

```text
Native STT: NOT RELEASE-GREEN
Evidence type: automated diagnostic + prior human-mic observations
Primary blockers: human real-mic proof still needed, punctuation/casing unresolved
```

Current artifact:

```text
/private/tmp/speaksharp-native-current-required-fields-20260601.json
```

Completed or obsolete items removed from this report:

```text
Invalid fake-audio Native harnesses: removed from active script set.
One-word meaningless-session guard: working in latest diagnostic run.
Duplicate final/interim unit regression coverage: present.
Formatter seam identity default: present.
Parallel capture required fields: present in latest diagnostic artifact.
```

## Latest Diagnostic Result

Latest automated route:

```text
Chrome headed + macOS say playback into real mic path.
Diagnostic only; not release WER proof.
```

Result:

| Field | Value |
| --- | --- |
| Visible at stop | `Native` |
| Post-stop transcript | `Native` |
| Selected for save | `Native` |
| Final result count | 0 |
| Result event count | 1 |
| Saved/history/detail | not saved, correctly |
| Parallel capture duration | 16.291 sec |
| Parallel capture RMS / peak | 0.006956 / 0.080567 |
| Speech window | 2200-7850 ms |
| Segment count | 4 |

Interpretation:

```text
The automated say/mic route under-captured Chrome Web Speech. The app correctly
refused to save a one-word "Native" session. This is not enough to call Native
good or bad for real users.
```

## Open Issue P0.1 — Human Real-Mic Native Proof

Issue:

```text
Native release readiness depends on real Chrome microphone behavior. Automated
WAV/say/fake-audio routes are diagnostic only and cannot be the release gate.
```

Dev-agent responsibility:

```text
None unless human-mic proof finds app-side corruption. Do not patch Native based
only on the latest say-route diagnostic.
```

STT test-agent responsibility:

```text
Run human real-mic proof through the endorsed CDP/human path and collect the
required transcript states and timing fields.
```

Expected test output:

| Field | Required |
| --- | --- |
| `micClickedAt` | yes |
| `firstInterimAt` / first visible text ms | yes |
| `firstFinalAt` | yes, if Chrome emits final |
| `visibleAtStop` | yes |
| `postStopFinal` | yes |
| `selectedForSave` | yes |
| `savedTranscript` | yes |
| `detailTranscript` | yes |
| duplicate full transcript? | yes |
| transcript disappeared on Stop? | yes |
| punctuation/readability notes | yes |
| save/history/detail pass | yes |

What I will do with the result:

```text
If Chrome final is good but saved/detail is duplicated, erased, or different,
I will hand dev a concrete app-side merge/save bug.

If Chrome itself emits poor or no final in a clean human run, I will classify
Native as browser-dependent/quality-limited rather than app-corrupted.
```

Bright-line boundary:

```text
Dev does not own human-mic collection.
STT testing owns the browser/human proof and evidence classification.
```

## Open Issue P0.2 — Native Punctuation/Casing

Issue:

```text
Prior human Native runs showed readable recognition but poor formatting:
run-on text, missing sentence stops, and bad capitalization such as "Starts Now".
```

Current code state:

```text
Formatter seam exists and defaults to identity.
No trusted punctuation/casing formatter is registered.
No off-the-shelf formatter/provider has been selected.
```

Dev-agent responsibility:

```text
Research and propose a trusted punctuation/casing formatter option compatible
with the product privacy/architecture requirements. Do not implement a bespoke
regex formatter as the final answer.
```

Expected dev handoff interface:

```text
1. Recommended formatter/API/library and why it is trusted.
2. Privacy implications: does transcript leave the browser/device?
3. Cost/latency implications.
4. Integration point through the existing Native formatter seam.
5. Unit tests for identity fallback, formatter success, formatter failure, and
   empty/unsafe output fallback.
6. Clear statement of whether the formatter applies only to saved final text or
   also to live interim text.
```

What I will do with dev results:

```text
I will run the human Native scripts and compare raw Chrome output vs formatted
saved/detail transcript for punctuation, casing, duplication, and preservation.
```

Bright-line boundary:

```text
Dev chooses/integrates the formatter.
STT testing verifies real browser output and user-visible saved/detail quality.
```

## Open Issue P0.3 — Stop/Finalization Merge Human Verification

Issue:

```text
A prior human run showed Chrome produced a good final transcript, then SpeakSharp
duplicated stale interim text on Stop. Unit regression coverage exists, but human
proof after the latest changes is still required.
```

Dev-agent responsibility:

```text
No new code unless the next human proof reproduces duplication or save mismatch.
Keep existing unit tests for duplicate-final/interim merge behavior.
```

STT test-agent responsibility:

```text
In the next human proof, explicitly capture:
visibleAtStop, postStopFinal, selectedForSave, savedTranscript, detailTranscript,
and duplicate flag.
```

Expected handoff if it fails:

```text
I will provide the exact trace event sequence showing where the duplicate or
mismatch entered: Chrome result, service event, controller merge, store update,
save candidate, or detail read.
```

Scope limit if Native dev work becomes necessary:

```text
Do not ask dev to improve Native Harvard WER broadly.
Native automated Harvard/say/fake-audio routes are diagnostic only.
If dev work is needed, it must be tied to one failed human-mic script and one
specific app boundary.
```

Example acceptable dev deliverable after a human-mic app-side failure:

```text
Root cause found:
Chrome emitted a good final transcript for Script B, but NativeBrowser appended
the pending interim after final because the normalized overlap guard did not
handle punctuation/casing differences in the final event.

Code changed:
- NativeBrowser.ts: pending-interim append guard updated.

Unit/no-browser proof:
- final + same pending interim -> no append.
- final + punctuation/casing variant pending interim -> no append.
- no final + meaningful interim -> promote interim.
- one-word/junk interim -> do not save.

Expected browser-observable change:
On the same human Script B, saved/detail transcript should contain the speech once,
not duplicated.

Files changed:
<list files + commit SHA>
```

Example unacceptable dev deliverable:

```text
"Adjusted Native recognition settings."
```

Why unacceptable:

```text
It does not identify whether the failure was Chrome output, service normalization,
controller merge, store state, save candidate, or detail read. It also gives STT
testing no specific human script or transcript-state expectation to verify.
```

## Native Launch Blockers

| Blocker | Owner | Launch Impact |
| --- | --- | --- |
| Human real-mic proof missing | STT test agent | Cannot classify Native as viable quick-start. |
| Punctuation/casing unresolved | Dev proposal/integration, STT verify | Native may look amateurish even if recognition is accurate. |
| Duplicate/stop merge needs human proof | STT test agent first; dev only if reproduced | Saved transcript trust risk. |
