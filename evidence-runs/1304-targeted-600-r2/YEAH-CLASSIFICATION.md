# Persistent transcriber state changes subsequent decodes — a bounded finding

**Probe:** `scripts/probe-moonshine-yeah.mts`
**Artifact:** `evidence-runs/1304-yeah-classification.json` · sha256 `d3b49eaa…`

> **This document was CORRECTED after review.** An earlier version was titled "a HARNESS defect, not
> model behaviour", carried the verdict label `HARNESS_SHARED_STATE` as a conclusion, and derived a
> "corrected" Moonshine WER of 0.05260. Those claims went beyond what the probe supports and are
> withdrawn below, with the reasons. The raw probe JSON, benchmark JSON and run log are unmodified.

## What the probe SUPPORTS

**Persistent state in the Moonshine transcriber changes the output of subsequent decode calls, and the
benchmark violated independent-clip semantics by reusing one transcriber across all 600 clips.**

Same clips, same audio, same model (`MediumStreaming`), same pinned runtime:

| Condition | Hypotheses beginning with "yeah" |
|---|---:|
| ONE transcriber reused across clips (the benchmark's condition) | **3 / 8** |
| A fresh transcriber per clip, each in its own page | **0 / 8** |

Raw runtime text, captured BEFORE any normalization, so our scoring pipeline is excluded as a cause:

```
shared: "Yeah Tied to a woman."
fresh : "Tied to a woman."
```

`scripts/run-browser-matrix.mts` loads ONE `Transcriber` per arm and calls `transcribe()` 600 times on
it with **no reset and no destroy between clips**. For a streaming decoder that is a state leak across
clip boundaries.

Supporting signature in r2: 101 of 600 hypotheses begin with "yeah", **every occurrence at token
position 0**, never more than one per clip, no reference containing the word, no run-order clustering
(indices 15–593, roughly geometric gaps), no meaningful clip-length effect (17.8 vs 18.2 reference
words).

## What the probe does NOT support — claims withdrawn

**1. "It is not the model."** WITHDRAWN. The probe separates *reused instance* from *fresh instance*;
it does not separate *runtime* from *weights*. The correct statement is that persistent transcriber
state changes later decodes. Whether the same runtime behaviour affects the PRODUCT path is open —
and it matters, because `MoonshineStreamingEngine` has the same shape: one transcriber, repeated
overlapping three-second windows, then a full-buffer decode on that same instance at `stop()`.

**2. "Corrected WER ≈ 0.05260."** WITHDRAWN as invalid. It assumed only the leading "yeah" changed.
The probe's own retained output disproves that — clip `1221-135767-0022` differs between shared and
fresh **beyond** the leading token:

```
shared: … amid the close struggle for. For subsistence …
fresh : … amid the close struggle for subjection. For subsistence …
```

State changes recognition generally, so subtracting tokens from the numerator does not yield a WER.
`0.05260` is retained ONLY as a counterfactual diagnostic, not as a measurement.

**3. "~101 of 212 insertions are harness-induced."** WITHDRAWN — the count is wrong. **101** hypotheses
begin with "yeah"; the Track-B profile classifies **100** of them as insertions. Clip
`5484-24318-0015` aligns its leading "yeah" through **substitutions** instead: S/D/I = 2/0/0, because
`"yeah tomorrow"` against reference `"to morrow"` resolves as two substitutions rather than an
insertion plus a substitution.

**4. "The accuracy ordering is strengthened."** WITHDRAWN. Nothing here establishes a better Moonshine
score. Only a corrected rerun can.

**5. "Moonshine's WER/latency remain selection-usable."** WITHDRAWN — see the disposition table in
`SELECTION-PACKET.md`.

## Two earlier product claims, also withdrawn

- **"It inflates SpeakSharp's headline filler metric."** FALSE. `frontend/src/config.ts` defines
  `TRUE_FILLER_WORDS = [um, uh, ah]` and `DISCOURSE_MARKER_WORDS = [like, you know, so, actually, oh,
  I mean, basically, literally, kind of, sort of]`. **"yeah" is in neither.** It damages transcript
  truth and user trust, and would move a count only for a user who added "yeah" as a custom word.
  "yeah" is NOT being added to the product vocabulary to make a diagnostic catch it.
- **"Spontaneous speech is likely worse."** WITHDRAWN as unsupported extrapolation.

## Still open — conditions C–G not yet run

Reordered / affected-clips-first under a shared instance; an explicit runtime reset path if one
exists; benchmark arm vs the **product** engine; full-buffer vs three-second-window decoding; repeated
identical audio in one process; matched controls. Until those run, **no Moonshine disposition —
select or reject — is supported.**

## The 212 vs 213 difference — reconciled, and not an alignment tie-break

`delta = profile − scorer` equals `fillerLikeTotal` for **all four** arms: 0/0, 0/0, 0/0, and 1/1 for
Moonshine. The scorer measures Track A, whose normalization strips `um/uh/hmm/…`, so a hallucinated
`uh` never counts; the profile measures Track B, which preserves it. 212 and 213 are each correct for
their own track.
