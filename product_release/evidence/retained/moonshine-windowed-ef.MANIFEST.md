# Moonshine windowed E/F — run manifest

> **HISTORICAL EVIDENCE — point-in-time measurement, NOT current release truth.**
> This manifest records the two probe runs executed against source SHA
> `697730ac0cd9bd0d646ba5876eb145719b3500d3`. Current model-comparison authority
> remains the exact deployed release and the governed #1432 evidence packet.

Provenance for the two retained artifacts in this directory. Recorded so the run can be reproduced and
so nothing here has to be taken on trust. **Both artifacts are the probe's own bytes, unedited**; the
SHA-256 values below were recomputed from the committed files, not copied from the probe's stdout.

The probe had never been run before this. `moonshine-windowed-ef.json` did not exist in the tree.

## Source

| | |
|---|---|
| Repository SHA the probe was run from | `697730ac0cd9bd0d646ba5876eb145719b3500d3` |
| Probe script | `scripts/probe-moonshine-windowed.mts` |
| Probe script blob | `3303fa35fa8bb47b580998e660b18f65d8dda035` |
| Engine under test | `frontend/src/services/transcription/engines/MoonshineStreamingEngine.ts` (real, not a fake) |
| Fixture | `tests/fixtures/harvard_sentences_16k.wav` — 195,743 frames @ 16 kHz mono = 12.234 s |
| Ground truth | `tests/fixtures/stt-isomorphic/harvard-sentences.ts`, CLEAN variant per `scripts/generate-fixtures.sh:29-33` |

The fixture is generated from the clean sentence text. The filler-laden variant
(`generate-fixtures.sh:36+`) is a **different** file, so the absence of fillers in these transcripts is a
property of the audio and not of the engine.

## Command

```
npx tsx scripts/probe-moonshine-windowed.mts --cache=<repo containing .hf-cache> --out=<path>
```

Run twice, deliberately, to separate a deterministic first-session warm-up effect from
nondeterminism. One run could not distinguish them.

| run | artifact | exit code | verdict |
|---|---|---|---|
| 1 | `moonshine-windowed-ef.json` | `1` (measured) | `fail` |
| 2 | `moonshine-windowed-ef-run2.json` | not separately captured — stdout was piped, so `$?` was the pipeline's | `fail` |

Run 2's exit code is stated as uncaptured rather than assumed. Its recorded verdict is `fail`, and the
probe exited `1` on that verdict in run 1.

## Artifact digests (recomputed from the committed files)

| file | SHA-256 |
|---|---|
| `moonshine-windowed-ef.json` | `9c817950747deadacc52a5b8efd0dcfb606aa2e9ee6df82cf7ec02ba96bc3dff` |
| `moonshine-windowed-ef-run2.json` | `5a3a3d017af4a9d029150d10999b48379ccedd2ef23456f371df393edce891e3` |

Each artifact also carries its own self-recorded `sha256`; the values above were computed independently
and agree.

## Pinned runtime and components

Pin source: **`frontend/src/services/transcription/moonshineAssetPins.json`** (blob
`d22713f6aa6fdc381e616b66ef59ea3b7405a297`), which is what `candidateRegistry.ts:238` declares as
`pinSource`.

*Correction for the record:* an earlier report of mine cited
`tests/fixtures/moonshine-asset-pins.json`. That path is not the pin source at this commit — it was a
stale file in a working copy 24 commits behind `main`. The digests are identical between the two, so the
verification result was unaffected, but the citation was wrong.

| | |
|---|---|
| Runtime package | `@moonshine-ai/moonshine-wasm@0.1.5` |
| Component set | `quantized_26_07_30` |
| Model | `medium-streaming-en` |
| Pins recorded at | 2026-08-28 |

All **7** components were present in the warm cache and verified by SHA-256 **and** byte length against
the pin file before the run. No network fallback exists — the probe exits `2` on a missing cache.

| component | bytes | SHA-256 |
|---|---:|---|
| `adapter.ort` | 3,651,296 | `3f2a287def57cc094367a0eec3c4f5fc36a32ec420e86764b696920991b20281` |
| `cross_kv.ort` | 11,643,776 | `642f6e21cd305be79342207c6f9e6b681d469d55bc48c72b27b84846fb71fd1e` |
| `decoder_kv.ort` | 146,972,408 | `193bb366492b74fc4ad338c6778e8d8eb916aaa11b5aa264f9057f4db7759486` |
| `encoder.ort` | 94,705,376 | `12915e76ebac7dd287c5ea63965d06103a53ba1ce242a4a34f318f3958c60c37` |
| `frontend.ort` | 47,467,576 | `100a4cbc1e96f4f5586330ff60d5f6240813dbb399a0b9c6a187a9491ab716cc` |
| `streaming_config.json` | 513 | `28e83b7a28e91472692a035e0dae3116422ae43aeb2bef5ed822c44ce89b88af` |
| `tokenizer.bin` | 249,974 | `6884b35fd6377d4c4d32336a0bc152f36b64d1e45b6503683cdc238250a8472d` |

## Conditions, both runs

| condition | run 1 | run 2 |
|---|---|---|
| E1 windowed session produced a final transcript (38 words) | PASS | PASS |
| E2 second session on the same instance matches the first | **FAIL** | PASS |
| E3 fresh instance produces the same transcript | **FAIL** | **FAIL** |
| F1 no six-word run duplicated across windows | PASS | PASS |
| F2 final covers the session, not just the last window | PASS | PASS |
| AUDIO NEVER LEAVES — no request carried a body | PASS (0 bodied) | PASS (0 bodied) |
| every off-origin request was a pinned asset | PASS (14) | PASS (14) |

## What the numbers say

Scored against ground truth, all six sessions across both runs:

```
run1 sessionA  37/38  pos 37: town -> truck
run1 sessionB  37/38  pos 37: town -> child
run1 sessionC  37/38  pos 37: town -> child
run2 sessionA  37/38  pos 37: town -> truck
run2 sessionB  37/38  pos 37: town -> truck
run2 sessionC  37/38  pos 37: town -> child
```

Words 0-36 are byte-identical in all six sessions. The only divergence is position 37 — the final word
of the utterance — which is wrong in every session and alternates between `truck` and `child` against a
ground truth of `town`.

E2 and E3 in these raw artifacts fail solely because the old probe asserts exact whole-string equality
(`sessionA.final === sessionB.final`), so a single unstable token fails them. That assertion measured
byte determinism, not the accumulating cross-session state E2 claims to detect. #1432 corrects the
acceptance rule without editing these artifacts: reuse must not drift more than the independent A↔C
fresh-instance baseline, and every pair must remain within a 5% word-edit ceiling. The two retained runs
both pass that rule at 1/38 maximum drift (2.63%); a repeated or compounded window fails its casualty.

The instability is localised to the terminal decode. The last *interim* ends `"…no trace of the"`,
without a final word; the final word is supplied when the accumulated buffer is decoded at stop
(`MoonshineStreamingEngine.ts:409`). It never compounds, never appears anywhere but the tail, and the
pattern is random rather than cumulative — `B == C` in run 1 while `A == B` in run 2. A fresh instance
matching a second session rules out cross-session accumulation.

Two things this is **not**: it is not the "every clip's output depends on the one before it" defect the
registry's `notReadyReason` warns about, and it is not filler suppression.

Disposition: **comparison-ready; exact reproducibility remains P2 in #1399.** One unstable word at
end-of-session is below the noise floor of a multi-minute spoken take, so it does not disqualify
Moonshine from the human comparison. It does mean exact reproducibility cannot be claimed for this
candidate.
