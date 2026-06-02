# Private STT Long-Form (Speech-Length) Risk Analysis — Dev

**Owner:** dev · **Status:** architectural risk, unvalidated · **Date:** 2026-06-01

> Raised by product: the app is for practicing **speeches half-a-page to over a
> page long**, but all STT validation to date used **single ~7-second Harvard
> sentences**. This doc is the dev-side architectural read of how the current
> Private implementation will hold up at real speech length. It is analysis, not a
> measured result — long-form has **never been run**.

## TL;DR

The current Private "saved transcript = one whole-utterance decode at Stop"
architecture was designed for and validated on single sentences. At speech length
it has four concrete failure modes, two of which can produce a **lost or wrong final
transcript**, not just slowness. **This is a larger risk than h1_6.**

## Evidence from the code (not speculation)

| # | Mechanism | Code | Long-form consequence |
|---|---|---|---|
| 1 | Final transcript is ONE decode of the ENTIRE speech, run only at Stop | `commitWholeUtteranceTranscript()` called only at `onStop` (PrivateWhisper.ts:1633); `concatenateFloat32Arrays(utteranceAudioChunks)` (1920) | A 1–2 min speech is decoded in a single terminal pass — the regime tiny.en is weakest in and we have zero evidence on. |
| 2 | No length cap on the utterance buffer | `utteranceAudioChunks` grows every speech frame; no max-samples bound (only the 1s trailing-silence tail cap from Fix A) | Unbounded memory (~3.8MB/min raw Float32 at 16kHz, plus rolling/trace buffers); scales linearly with no release. |
| 3 | Whisper 30s window + 5s stride stitching | worker: `chunk_length_s:30, stride_length_s:5` (transformers-js.worker.ts) | A page-length speech is internally split into many 30s windows and stitched; tiny.en stitch errors accumulate across boundaries — untested. |
| 4 | Stop finalization is post-hoc and time-capped | decode after Stop; `TRANSCRIPTION_TIMEOUT_MS = 60_000` (PrivateWhisper.ts:110) | CPU RTF ~0.3–0.5× → ~40–60s "Processing speech locally…" for a 2-min speech; **long enough speech can hit the 60s timeout and lose the entire final decode.** |

## Why single-sentence success does not predict long-form

Everything validated this thread — whole-utterance commit, Fix A buffer-bound, the
h1_6 work, the draft/finalizing UI — optimizes the **one-shot, one-sentence** path.
The product's real workload (multi-paragraph, with natural pauses) exercises a path
with **no test coverage and an architecture that disfavors it**: it accumulates the
whole speech and does one giant terminal decode, the opposite of what long-form
needs.

## The architectural mismatch

Long-form wants **streaming / segmented finalization**: commit each
utterance/sentence as the speaker pauses, append to a growing saved transcript, and
release the decoded audio. The current design holds the entire speech and finalizes
once at the end. That choice was correct for a sentence; it is the wrong shape for a
speech.

## Proposed direction (NOT yet implemented — needs product + test-agent buy-in)

1. **Measure first.** Run a half-page (~5–8 sentence) and a full-page (~1–2 min)
   script through Private CPU and capture: total decode time at Stop, whether it hits
   the 60s timeout, peak memory, and WER/readability vs a drop-in/cloud control. This
   is the missing evidence; do it before any redesign.
2. **Segment-and-append finalization** (if measurement confirms the risk): finalize
   per pause-bounded segment into a growing transcript instead of one terminal decode.
   This bounds memory, bounds per-decode latency, and avoids the 60s cliff.
3. **Cloud is the natural long-form path** — it streams and finalizes incrementally by
   design. For long speeches, Cloud (Pro) may be the right product answer, with
   Private positioned for shorter practice until segmented finalization exists.

## Open questions for product / test agent

- What is the **target max speech length** to support on Private CPU specifically?
- Is **long-form a Private requirement**, or is it acceptable for Private to be the
  "short practice" mode and Cloud the "full speech" mode?
- Acceptable **post-Stop wait** for a full-page speech before the saved transcript
  appears?
