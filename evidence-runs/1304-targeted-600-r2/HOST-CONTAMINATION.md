# Targeted 600 (r2) — host contamination record

**Written during the run, from observed timestamps.** Latency for the arms below is CONTAMINATED and
must not be used. WER, reliability counters, hypotheses, insertion profiles and per-utterance
comparisons are unaffected: decoding is deterministic given model and audio, and every counter is a
count, not a duration.

## Timeline (host clock)

| Event | Start | End |
|---|---|---|
| Targeted 600 (r2) begins — `run.log` created | 07:30:47 | running |
| **Local full test suite** (`wt-1258`, 445 files / 5000 tests) | **07:27:28** | **07:47:59** |
| **Local quality + suite** (`wt-registry`, stopped early) | **07:59:14** | **08:03:02** |
| Load average during the second overlap | — | **11.88** |

No further local test, build or browser work was started after 08:03:02.

## Per-arm disposition

| Arm | Overlap | Latency |
|---|---|---|
| `v2:base.en` | ~07:31–07:48, essentially its ENTIRE execution | **CONTAMINATED — unusable** |
| `v4:base:q4-decoder:wasm` | ~4 min of its execution (07:59–08:03) | **CONTAMINATED — unusable** |
| `v4:base:int8-decoder:cpu` | none observed (began ~08:19, after 08:03) | clean, pending confirmation at exit |
| `moonshine:streaming-medium` | none (not yet started at 08:03) | clean, pending confirmation at exit |

**Precision limit, stated rather than glossed:** the artifact does not record per-row `startedAt` /
`finishedAt`, and `run.log` lines carry no timestamps. Arm boundaries above are bracketed by direct
observations of the log at 07:48 (`v2:base.en` still running), 07:57 (`v4:base:q4` running), 08:14
(`v4:base:q4` still running) and 08:19 (`int8` running). The two contaminated arms are therefore
certain; the two clean arms are asserted from the fact that no local load existed after 08:03:02.

## Consequence

Replacement timing for `v2:base.en` and `v4:base:q4` requires a rerun on a quiet host, reconciled
600/600 against this run on utterance ids, S/D/I, reliability counters and WER. A timing rerun that
does not reconcile on those fields is measuring a different experiment.

## Cause

Repository work was run on the same host as the benchmark. Recorded here rather than left for a
reviewer to infer from a latency distribution.
