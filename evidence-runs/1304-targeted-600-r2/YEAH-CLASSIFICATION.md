# The leading "yeah" is a HARNESS defect, not model behaviour

**Probe:** `scripts/probe-moonshine-yeah.mts`
**Artifact:** `evidence-runs/1304-yeah-classification.json` · sha256 `d3b49eaab0b7e6406fcf371196c752af74fbdbd9c276bab1d2f12627f7f46d8f`
**Verdict:** `HARNESS_SHARED_STATE`

## Result

Same clips, same audio, same model (`MediumStreaming`), same pinned runtime — decoded two ways:

| Condition | Leading "yeah" |
|---|---:|
| ONE transcriber reused across clips (the benchmark's condition) | **3 / 8** |
| A fresh transcriber per clip, in its own page | **0 / 8** |

Raw runtime text, captured BEFORE any normalization, so our scoring pipeline is excluded as a cause:

```
shared: "Yeah Tied to a woman."
fresh : "Tied to a woman."

shared: "Yeah. John Taylor, who had supported her through college, was interested in ..."
fresh : "John Taylor, who had supported her through college, was interested in ..."
```

## Cause

`scripts/run-browser-matrix.mts` loads ONE `Transcriber` per arm and reuses it for all 600 clips:
`w.__asr` closes over a single instance and calls `transcribe()` 600 times with **no reset and no
destroy between clips**. For a STREAMING model that is a state leak across clip boundaries — the
decoder begins the next clip carrying context from the previous one and emits a spurious leading
token.

The signature in the 600 matches exactly and matches nothing else: 101 of 600 clips (16.8%), **every
occurrence at token position 0**, never more than one per clip, no reference containing the word, no
run-order clustering (indices 15–593, roughly geometric gaps), and no meaningful clip-length
difference (17.8 vs 18.2 reference words).

The reproduction rate differs between the two settings (3/8 here vs 8/8 in the full run) because the
leak depends on the preceding clip sequence, and this probe decoded a different, shorter sequence.
The MECHANISM is what the probe establishes: removing cross-clip state removes the token entirely.

## Consequences — this changes the reading of the 600

1. **Moonshine's measured WER is a PENALTY, not a fault.** Of its 212 Track-A insertions, ~101 were
   harness-induced. Its 0.06187 understates the model: with those removed the same run implies
   **~0.05260**, which would widen rather than narrow its margin over v2 (0.06903).
2. **The other three arms are not affected by this mechanism.** They run transformers.js pipelines,
   are not streaming decoders, and their insertions are ordinary function words at ≤7 occurrences with
   zero filler-like tokens.
3. **A third evidence caveat on r2**, alongside contaminated v2/q4 latency: the moonshine arm's
   insertion count — and therefore its WER — is inflated by a harness defect. The accuracy ORDERING is
   unchanged and if anything strengthened, but the moonshine figure is not a clean measurement.
4. **The harness needs a per-clip reset for streaming runtimes** before any moonshine arm is treated
   as a clean accuracy measurement.

## Corrections to my earlier report

Both of my earlier claims about this were wrong, and both were caught in review:

- I said it would inflate SpeakSharp's headline filler metric. **False.** `TRUE_FILLER_WORDS` is
  `[um, uh, ah]` and `DISCOURSE_MARKER_WORDS` is `[like, you know, so, actually, oh, I mean,
  basically, literally, kind of, sort of]` (`frontend/src/config.ts`). "yeah" is in neither.
- I said the model hallucinates. **False.** Our harness produced it.

`yeah` is NOT being added to the product filler vocabulary.

## The 212 vs 213 discrepancy — reconciled, and not an alignment tie-break

`delta = profile − scorer` equals `fillerLikeTotal` for **all four arms**: 0/0, 0/0, 0/0, and 1/1 for
moonshine. The scorer measures Track A, whose normalization strips `um/uh/hmm/…`, so a hallucinated
`uh` never counts as an insertion; the profile measures Track B, which preserves it. 212 and 213 are
each correct for their own track.
