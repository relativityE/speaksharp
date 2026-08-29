# Frozen 600 — machine-contention record

The frozen 600 measures latency (cold load, warm p50/p95, RTF p50/p95), and those fields are only
meaningful on a quiet machine. Work I ran in parallel during the early arms was not quiet. This records
exactly which arms are affected, so a contaminated latency figure is never read as a measurement.

**Accuracy is unaffected.** Decoding is deterministic: CPU contention changes how long a transcript
takes to produce, not what it says. WER and S/D/I stand for every arm.

## Timeline (2026-08-29, local time)

| time | event |
|---|---|
| ~05:05 | frozen 600 started; `v2:tiny.en` decoding |
| 05:05–05:08 | **contention**: certification suite (includes a real-model control), `pnpm quality` |
| ≤05:08:14 | `v2:tiny.en` completed |
| 05:08–05:36 | `v2:base.en` decoding |
| ~05:30–05:34:41 | **contention**: `pnpm quality` in the docs worktree (end bounded by commit `97b4d9a7` at 05:34:41) |
| ~05:36:10 | `v2:base.en` completed; `v2:small.en` started |
| 05:36 onward | machine quiet; no local builds, tests, browser sessions or dependency operations |

## Disposition

| arm | accuracy | latency |
|---|---|---|
| `v2:tiny.en` | **valid** — WER 0.0991, S/D/I 820/104/156 | **CONTAMINATED** |
| `v2:base.en` | **valid** — WER 0.0690, S/D/I 568/71/113 | **CONTAMINATED** |
| `v2:small.en` onward | valid | expected clean — the last heavy command ended 05:34:41, before this arm began |

I originally flagged only the docs-worktree `pnpm quality`. Reconstructing the timeline showed several
earlier commands overlapping `v2:tiny.en` as well, including a certification suite that loads a real
model. Both early arms are marked, not one.

## Required before either contaminated arm can clear the RTF gate

Rerun **only** the contaminated arms, on the same execution tree (`a299c805`), on a quiet machine, and
replace their performance fields — accuracy fields are retained from this run. The full 600 is not
rerun: nothing about the decode changed, only the conditions its clock was read under.

Until replaced, `qualify()` must treat those arms as failing rule 4. A contaminated latency is not a
slow one and not a fast one; it is unmeasured, and the policy already refuses `null` RTF for that
reason.
