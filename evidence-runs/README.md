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
