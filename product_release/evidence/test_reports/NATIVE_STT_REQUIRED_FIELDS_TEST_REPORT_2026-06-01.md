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

> **DEV RESPONSE (2026-06-01):** Acknowledged — no dev action owed here; human-mic
> collection is yours. Prior dev finding stands for context: the latest automated run
> showed Chrome delivered **0 finals** (the app received nothing to drop/duplicate),
> so this was Chrome under-capture of the `say` route, not an app regression. If your
> human run shows a good Chrome final but corrupted saved/detail, hand it back per
> P0.3 and I will trace the exact boundary.

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

> **DEV RESPONSE (2026-06-01) — formatter proposal (answers the 6-field handoff).**
>
> Key constraint that shapes the choice: **Native is NOT promised on-device.** Only
> *Private* mode carries "nothing leaves your browser" (SessionSidebar copy). Native
> is already a browser/server-dependent path (Chrome Web Speech itself sends audio to
> Google). So a server-side formatter is acceptable for Native specifically — it does
> NOT weaken a privacy promise the way it would for Private.
>
> **1. Recommended formatter + why trusted:** reuse the app's existing **Gemini**
> integration (already in-stack via the `get-ai-suggestions` Supabase Edge Function +
> `AISuggestions.tsx`). A tiny dedicated Edge Function (e.g. `format-transcript`) that
> sends ONLY the raw Native final text with a strict "restore punctuation and
> sentence casing; do not add, remove, reorder, or correct words; preserve fillers
> (um, like, you know) verbatim" instruction. Trusted because it's an existing vetted
> provider relationship with a server-side key (no new vendor, no client key).
> Alternative if we want zero network: a small on-device punctuation-restoration ONNX
> model via the transformers.js stack already loaded for Private — heavier, slower,
> deferred unless we later promise Native on-device too.
>
> **2. Privacy implications:** transcript text (not audio) leaves the device to the
> Gemini Edge Function. Acceptable for Native (already non-local). MUST be gated so it
> is NEVER invoked for Private mode. Add a one-line privacy note to Native copy.
>
> **3. Cost/latency:** one short text completion per saved Native session (~hundreds
> of tokens). Latency ~300-800ms on the SAVE path only (never live) — invisible to
> live UX; adds to post-Stop finalize. Cost is negligible at session cadence; reuse
> existing AI quota controls.
>
> **4. Integration point:** the existing seam, unchanged — call
> `registerNativeTranscriptFormatter(async (raw) => callFormatEdgeFn(raw))` at app
> init for Native only. `formatNativeTranscript()` already applies it to SAVED text
> only and falls back to raw on error/empty. No NativeBrowser.ts change needed.
>
> **5. Unit tests (to add with the impl):** identity fallback (no formatter), success
> path (formatter output used), failure path (throws → raw preserved), empty/unsafe
> output (→ raw preserved), Private-mode guard (formatter never registered for
> Private). The seam's first four are already covered by
> `nativeTranscriptFormatter.test.ts`; the Edge-fn adapter + Private guard are new.
>
> **6. Scope:** SAVED final text ONLY — never live interim (the seam already enforces
> this via `getTranscript()`).
>
> **Decision needed from you/product before I implement:** approve Gemini-Edge-fn
> (server-side, Native-only) vs on-device model. I will not wire a vendor without that
> call. No code shipped in this response — proposal only, per the handoff contract.

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

> **DEV RESPONSE (2026-06-01):** Agreed — holding, no code. The duplicate-final/interim
> merge unit coverage is in place and passing (`NativeBrowser.test.ts`: final+identical
> interim → no append; final+case/punct variant → no append; one-word interim → not
> saved). I will write the boundary-localized fix only if your human proof reproduces
> duplication or save mismatch.

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
