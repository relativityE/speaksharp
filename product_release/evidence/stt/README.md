# STT Evaluation and Benchmark Evidence

**Status:** Retained evidence index
**Owner:** Engineering / Quality
**Last Reviewed:** 2026-08-29
**Current interpretation:** [`../../STT.md`](../../STT.md)
**Global evidence index:** [`../../EVIDENCE_INDEX.md`](../../EVIDENCE_INDEX.md)

This directory is the permanent home for SpeakSharp's speech-to-text model evaluations, benchmark reports, raw captures, rejected experiments, and model-selection history. It is deliberately outside `product_release/archive/`: the archive is disposable, while model evidence must remain available when a future runtime or model is compared with earlier work.

## Retention rule

Do not delete or rewrite an STT result because a newer result supersedes it. Record the later requalification beside the earlier result and name why the earlier interpretation changed: corpus, normalizer, runtime, assets, backend, harness defect, contamination, alias, or policy.

Every evaluated model/configuration must remain visible, including:

- scored candidates;
- rejected or invalid arms and their named reasons;
- aliases, such as byte-identical dtype labels;
- diagnostic duplicates excluded from ranking;
- not-run cells;
- contaminated timing runs and their quiet reruns;
- compatibility-only WebGPU runs on SwiftShader.

Historical evidence never becomes current release posture. Current STT requirements and interpretation live in `STT.md`; current release status lives in `RELEASE_STATUS.md`.

## Directory layout

| Path | Purpose |
|---|---|
| `reports/` | Human-readable dated matrices and release/market reviews. |
| `raw/` | Machine-readable historical captures retained without reinterpretation. |
| `historical-browser/` | Browser-route investigations, identity failures, trace reviews, and second-opinion packets. |
| `retained-contracts/` | Superseded benchmark contracts and accuracy/performance protocols kept to explain how earlier evidence was produced. |

## Current model-selection packet contract

The current three evidence classes must never be collapsed into one unlabeled result:

| Evidence class | Size | Permitted use |
|---|---:|---|
| Harvard smoke | 10 clips / 85 normalized words | Plumbing and gross-regression smoke only. It demonstrated ceiling effects and cannot select a model. |
| Deterministic preflight | 23 clips / 459 normalized words | Harness/model differentiation and early failure discovery only. The planning target was 425 words; 459 is the measured corpus. |
| Frozen selection corpus | 600 utterances / 10,894 normalized words | Selection-grade evidence only when the arm is complete, uncontaminated, provenance-complete, and admitted by the frozen policy. Never call this a “600-word test.” |

The final retained packet must include:

1. an immutable raw artifact with per-utterance scores and timings;
2. the versioned registry at `tests/STT_BENCHMARKS.json`;
3. a dated human-readable report in this directory;
4. links from `product_release/STT.md` and `product_release/EVIDENCE_INDEX.md`;
5. the product baseline SHA, measurement execution SHA, and selection-policy SHA as distinct fields;
6. the complete cross-set model matrix—metrics or a named `not_run`/invalid reason in every cell;
7. technical winner, activation readiness, and failure-diverse fallback as separate conclusions.

The matrix schema and evidence requirements are normative in [`../../STT.md`](../../STT.md). Raw artifacts are evidence, not self-interpreting verdicts.

## Historical material retained here

- `reports/` preserves the 2026-06-02 per-engine matrix and Private, Cloud, Native, and market-survival reports.
- `raw/` preserves the June 2026 VAD, base-selector, v4 lifecycle/browser, and stable-WASM captures.
- `historical-browser/` preserves earlier browser-route and model-identity investigations.
- `retained-contracts/` preserves the baseline, accuracy-lever, and performance-proof rules used before `STT.md` became canonical.

No dedicated STT model evaluation or benchmark protocol belongs under `product_release/archive/`.
