# Retained benchmark evidence

Each artifact records the exact command that produced it and the `main` SHA it was produced on. An
artifact whose generator cannot be identified is not evidence — the retained offline-load JSON was
once described as self-standing while the code that produced it existed only in a working tree, so the
merged repository could not have generated it.

## `offline-load-0e2fffd1.json` / `.log`

Proves every admitted arm loads with the network prohibited.

```bash
git checkout 0e2fffd1                      # or any later SHA; see the note below
pnpm benchmark:verify-cache                # must report 58/58 before running
npx tsx scripts/run-browser-matrix.mts --set=harvard --pins-only \
  --out=evidence-runs/offline-load-0e2fffd1.json
```

The runner REFUSES to write an artifact that does not account for every arm in the matrix
(`artifactCompleteness.ts`), so an incomplete file cannot be produced and later called complete.

Expected content: one row per admitted arm with `loaded: true` and `offlineEnforced: true`, plus one
row per registry-excluded arm carrying its rejection reason.

## `frozen-600-main-0e2fffd1.json`

The selection benchmark. Produced by:

```bash
npx tsx scripts/run-browser-matrix.mts --set=corpus \
  --out=evidence-runs/frozen-600-main-0e2fffd1.json
```

**Its frozen identity is `main@0e2fffd1`.** The tree it executed also carries the `pinsOnly`
serialization correction, which the corpus path never enters — the measurement is identical, and the
name records the frozen SHA rather than the tree hash so the run's identity does not drift with a
serialization fix.

## Retention is mandatory

A measuring run retains by default. Omitting `--out` no longer discards the result — the runner derives
`evidence-runs/<set>-<sha>.json` and says so. Discarding requires `--no-retain`, which is refused outright on
the selection set and prints a warning that nothing the run printed may be cited.

**This rule exists because we lost a measurement.** The 459-word preflight was executed and its result
discussed, but it was invoked without `--out`; the write was behind `if (outPath)`, so it silently kept
nothing. Benchmark hours produced no citable evidence, and the loss was invisible until the evidence was
enumerated. The runner also refuses to overwrite an existing artifact, so a later run cannot quietly replace
a retained measurement.

## Known evidence gaps (as of 2026-08-29)

Stated here rather than discovered later at down-select.

| Set | Words | Class | Retained | Gap |
|---|---:|---|---|---|
| `harvard` (offline-load) | — | smoke | **15 / 15 arms** — 14 loaded, 1 documented rejection | none |
| `harvard` (counted WER) | **10 clips / 85 normalized words** | smoke | **6 / 14 admitted arms** | 8 admitted arms have no 85-word WER row |
| `preflight` | **23 clips / 459 normalized words** | preflight | **0 arms** | the entire set — artifact never written |
| `corpus` | **600 utterances / 10,894 words** | **selection** | run in flight | — |

The 85-word and 459-word sets are **characterization, not targets**, and the harness refuses to let any
non-`selection` row inform the down-select. Their absence therefore does not invalidate the selection
decision — but it does leave the qualification trail incomplete, and both must be re-run with retention once
the benchmark host is free.

At 85 reference words one word is ~1.2% WER, so small differences on that set are not differences.

## Set names, stated once so they are not paraphrased

- **Harvard** — 10 clips / 85 normalized words. Evidence class `smoke`.
- **Preflight** — 23 clips / 459 normalized words. Evidence class `preflight`. (Not 485. Its prior numbers are
  **not durable evidence**: no raw artifact was retained, so they cannot be cited.)
- **Corpus** — 600 utterances / 10,894 normalized words. Evidence class `selection`. **Never call this a
  "600-word test"** — it is 600 utterances.

## Closure requirements before any down-select is announced

1. Preserve the completed 600 artifact **unchanged**, including every per-utterance score and timing row.
2. Quiet-rerun `v2:tiny.en` and `v2:base.en` for **performance only**. Reconcile all 600 per-utterance
   S/D/I profiles before replacing contaminated timing fields; **any accuracy difference fails
   reconciliation**. The retained digest is an **error-profile digest**, not a transcript digest.
3. Rerun the **complete registered matrix** on Harvard (10/85) and Preflight (23/459).
4. Retain raw immutable artifacts for both reruns. Every model × set cell must carry measurements **or** a
   named `rejected` / `alias` / `diagnostic` / `invalid` / `not_run` reason. **A printed console table is not
   retained evidence.**
5. Apply the already-frozen selection policy **only** to the complete 600-utterance / 10,894-word artifact.
   Exclude the q8→int8 alias and the q4 CPU diagnostic duplicate from ranking, but **preserve them in the
   matrix**.
6. Publish `tests/STT_BENCHMARKS.json`, a dated report under `product_release/evidence/stt/reports/`, the
   immutable raw per-utterance artifacts, and the complete 85 / 459 / 600 matrix with provenance — linked
   from `STT.md` and `EVIDENCE_INDEX.md`.
7. State **technical winner**, **activation readiness**, and **failure-diverse fallback** separately.
   SwiftShader proves WebGPU **compatibility**, never hardware speed.
