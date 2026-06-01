# Cloud STT Status Test Report — Latest State, 2026-06-01

---

## ⇄ DEV → TEST AGENT REVIEW REQUEST (2026-06-01)

**What dev changed (merged to main):** `scripts/assemblyai-streaming-ab-proof.mts`
no longer scores invalid empty/no-Termination sessions as real 0% rows — they are
classified invalid and excluded from averages; summaries now report
`validRowCount`/`invalidRowCount`/`invalidReasons`/`evidenceValid` and capture
`closeCode`/`closeReason`/`firstMessageRaw`/`messageCount`.

**What dev verified (no browser):** against the real artifact `assemblyai-ab-26776256219` —
baseline 5 valid/5 invalid; keyterms/prompt/prompt+keyterms 10/10 invalid →
`evidenceValid=false` instead of "0%".

**What dev needs the test agent to verify (live, I cannot run — needs credentials):**
rerun a small VALID A/B subset to actually prove prompt/keyterms filler behavior on
non-empty sessions. The runner no longer poisons averages but cannot manufacture
valid provider sessions.

---

## DEV UPDATE (2026-06-01, post-report) — A/B invalid-session detection landed

Addressed the P0 "A/B runner treats invalid provider sessions as real 0% rows".

`scripts/assemblyai-streaming-ab-proof.mts` now:
- captures `closeCode`, `closeReason`, `firstMessageRaw`, `messageCount` per session;
- `classifyInvalidSession` flags empty+no-Termination and empty single-message
  sessions as invalid (provider/script defects, not model results);
- variant summaries EXCLUDE invalid rows from WER/filler averages and report
  `validRowCount` / `invalidRowCount` / `invalidReasons` / `evidenceValid`.

Verified (no browser) against the real artifact `assemblyai-ab-26776256219`:
baseline = 5 valid / 5 invalid; keyterms, prompt, prompt+keyterms = 10/10 invalid
(empty, 0 Terminations) → now `evidenceValid=false` instead of a misleading "0%".

Still required (test agent): rerun a small VALID A/B subset with real credentials to
actually prove prompt/keyterms filler behavior on non-empty sessions. The runner no
longer poisons averages, but it cannot manufacture valid provider sessions.

---

## Executive Summary

Cloud STT remains the strongest SpeakSharp STT path, but the latest credentialed A/B verification failed as an evidence run. The app path is near AssemblyAI's corrected streaming target, but filler-preservation validation is not complete because the A/B runner produced invalid empty rows for prompt/keyterms variants.

Current classification:

```text
Cloud product journey: strongest current STT path
Cloud accuracy: near corrected AssemblyAI streaming target
Cloud A/B filler proof: FAIL / INVALID EVIDENCE
Cloud drop-in parity: not fully proven with latest trace schema
```

## Latest Evidence

Credentialed A/B workflow:

```text
Controlled STT Benchmarks, run 26776256219
```

Downloaded artifact:

```text
/private/tmp/assemblyai-ab-26776256219/assemblyai-streaming-ab-proof.json
```

Latest app corpus reference still used for current status:

```text
/private/tmp/speaksharp-cloud-harvard10-app.json
```

## Current Cloud Accuracy Status

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
Cloud app is within 0.33 percentage points of the corrected streaming target.
This is near target, not a broad Cloud integration failure.
```

## Latest Credentialed A/B Result

The A/B run had real credentials, but the artifact is not valid proof of prompt/keyterm behavior.

| Variant | Rows | Average Accuracy | Average Filler Recall | Result |
| --- | ---: | ---: | ---: | --- |
| baseline | 10 | 47.78% | 45% | partially valid; first five rows transcribed, last five empty |
| keyterms | 10 | 0% | 0% | invalid; all rows empty |
| prompt | 10 | 0% | 0% | invalid; all rows empty |
| prompt + keyterms | 10 | 0% | 0% | invalid; all rows empty |

Example rows:

| Variant | Fixture | Transcript | Termination Seen | Accuracy |
| --- | --- | --- | --- | ---: |
| baseline | `h1_1` | The stale smell of old beer, like, lingers. | yes | 88.89% |
| baseline | `h1_2` | Basically, a dash of pepper spoils beef stew. | yes | 100% |
| baseline | `h1_6` | empty | no | 0% |
| keyterms | `h1_1` | empty | no | 0% |
| prompt | `h1_1` | empty | no | 0% |
| prompt + keyterms | `h1_1` | empty | no | 0% |

The repeated failure shape:

```text
empty transcript
turnCount=1
terminationSeen=false
```

This should be treated as a verification/script defect until provider close/error details prove otherwise.

## Current Blockers

### P0 — A/B Runner Treats Invalid Provider Sessions As Real Zero-Accuracy Rows

The runner currently scores empty rows as WER=`1` even when the stream never reaches `Termination` and no usable Turn transcript arrives.

Consequence if not fixed:

We may reject good Cloud behavior or accept bad prompt/keyterm behavior based on invalid A/B data. Reviewers cannot trust filler-preservation conclusions.

Benefit of fixing:

Cloud prompt/keyterms can be judged on valid provider sessions only, with close codes and provider messages explaining failures.

Required fix:

```text
Mark close-without-Termination, no usable Turn, or one-message empty sessions as invalid.
Capture WebSocket close code/reason and raw first provider message.
Do not include invalid rows in WER/filler averages.
```

> **DEV RESPONSE (2026-06-01): FIXED — exactly to your spec.** `assemblyai-streaming-ab-proof.mts`
> now: `classifyInvalidSession` marks empty+no-Termination and empty single-message
> sessions invalid; captures `closeCode`/`closeReason`/`firstMessageRaw`/`messageCount`;
> variant summaries exclude invalid rows from averages and report `validRowCount`/
> `invalidRowCount`/`invalidReasons`/`evidenceValid`. Verified against the real artifact
> `assemblyai-ab-26776256219`: baseline 5 valid/5 invalid; keyterms/prompt/prompt+keyterms
> 10/10 invalid → `evidenceValid=false` instead of "0%". Ready for your next A/B run.

### P0 — Prompt/Keyterms Variant Is Not Proven

All keyterms/prompt variants returned empty rows in the latest artifact.

Consequence if not fixed:

We cannot claim the AssemblyAI prompt/keyterms work improves filler preservation. Worse, if the app uses a variant that provider streaming rejects or degrades, Cloud's strongest path could be damaged.

Benefit of fixing:

We can safely decide whether to use baseline, keyterms, prompt, or prompt+keyterms for Cloud filler preservation.

Required proof:

| Fixture Type | Required |
| --- | --- |
| `h1_1` | filler-leading Harvard row |
| `h1_6` | filler/onset-sensitive Harvard row |
| `h1_8` | `like` preservation row |
| filler-heavy conversational script | SpeakSharp product value |
| clean non-filler script | regression guard |

> **DEV RESPONSE (2026-06-01):** Unblocked, not proven — yours to run. The runner no
> longer poisons averages, so a re-run can now actually judge prompt/keyterms on valid
> sessions. But I cannot manufacture valid provider sessions (needs credentials/live WS).
> Please run a small VALID A/B subset; if variants still come back all-invalid, the
> `closeCode`/`firstMessageRaw` fields I added will show the provider's reason.

### P0 — Filler Preservation Is Not Proven

Current Cloud app evidence still shows missed fillers in key rows:

| Fixture | Truth Concern | Cloud Output Issue |
| --- | --- | --- |
| `h1_1` | `Um`, `like` | `Um` missed; `like` became `light` |
| `h1_6` | `They, like...` | beginning/filler dropped |
| `h1_8` | `like` | `like` dropped |

Consequence if not fixed:

Cloud may be accurate in general but miss the exact filler/disfluency signals SpeakSharp is supposed to coach.

Benefit of fixing:

Cloud becomes the first STT path we can credibly brag about: strong transcription plus SpeakSharp-relevant filler recall.

> **DEV RESPONSE (2026-06-01):** Not addressed by code — this is a measurement gap that
> depends on the valid A/B re-run above, not an app change. Filler recall can only be
> judged once variants produce valid (non-empty) sessions. No dev action until that run
> exists; then if fillers are genuinely dropped we can look at provider params vs app
> handling.

### P1 — Current Shared Trace Schema Is Not Yet Proven For Cloud Corpus

The latest Cloud A/B artifact is provider-level, not a full app journey trace.

Required fields for next app proof:

```text
engine/provider message received
service normalized event
controller lifecycle update
store update
UI visible before stop
stopSelectedSource
savedTranscriptLength
historyVisible
detailVisible
firstBrokenBoundary
```

Consequence if not fixed:

Cloud may pass transcription but still lack the same boundary proof required of Native and Private.

Benefit:

All STTs can be compared with the same evidence standard.

## Drop-In / Vendor Parity Status

Cloud is close to published streaming target, but latest A/B/drop-in parity is not complete.

| Target | Current Cloud Status | Verdict |
| --- | --- | --- |
| AssemblyAI corrected streaming target | App corpus is within -0.33pp accuracy | near target |
| Direct provider/drop-in behavior | A/B evidence invalid for prompt/keyterms | not proven |
| SpeakSharp product journey | strongest current product path | needs fresh trace-complete proof |
| Filler preservation | current evidence misses fillers | not proven |

What prevents Cloud from being the pristine STT today:

1. The A/B runner produced invalid empty sessions for prompt/keyterms variants.
2. Filler recall is not proven.
3. The latest provider A/B does not include the full app boundary trace.

## Immediate Development Needs

| Priority | Need | Consequence If Missing | Benefit If Fixed |
| --- | --- | --- | --- |
| P0 | Harden A/B runner invalid-session detection | Bad averages drive wrong provider decisions | Trustworthy Cloud validation |
| P0 | Capture provider close/error details | Empty rows remain unexplained | Clear root cause for prompt/keyterms failures |
| P0 | Rerun small valid A/B subset before full matrix | 40 rapid sessions can hide/rate-limit failures | Fast, reliable filler proof |
| P1 | Rerun Cloud app corpus with shared trace fields | Cloud cannot be compared apples-to-apples | Complete release evidence |

## Current Verdict

```text
Cloud remains the best candidate for one pristine STT.
Do not refactor Cloud architecture without a concrete app-path bug.
Fix the A/B evidence path and prove filler recall before claiming Cloud is complete.
```
