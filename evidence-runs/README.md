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
| `harvard` (counted WER) | 85 | smoke | **6 / 14 admitted arms** | 8 admitted arms have no 85-word WER row |
| `preflight` | 459 | preflight | **0 arms** | the entire set — artifact never written |
| `corpus` | 600 utterances / 10,894 words | **selection** | run in flight | — |

The 85-word and 459-word sets are **characterization, not targets**, and the harness refuses to let any
non-`selection` row inform the down-select. Their absence therefore does not invalidate the selection
decision — but it does leave the qualification trail incomplete, and both must be re-run with retention once
the benchmark host is free.

At 85 reference words one word is ~1.2% WER, so small differences on that set are not differences.
