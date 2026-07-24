# Proposal / PR scaffold: unified four-engine STT evidence harness

**Status:** DRAFT — scaffold only. No code change in this commit. Implementation to follow after the documentation-canonicalization effort, per Product Owner sequencing.
**Type:** Test/evidence infrastructure. No product-code or product-behavior change.
**Owner:** Prod Owner (relativityE)
**Related:** roadmap step 8 (depends on step 7, the STT evidence/SLO contract); consolidates the per-engine evidence noted in [`product_release/DOC_MIGRATION_LEDGER.md`](../../product_release/DOC_MIGRATION_LEDGER.md) §2.

> Scaffold opened for tracking. Not to be implemented until its turn — and only **after** the STT evidence/SLO contract (step 7) defines the thresholds this harness enforces.

---

## Problem

STT evidence today is **fragmented and per-engine**, produced by separate reports and runbooks:

- `product_release/evidence/test_reports/CLOUD_STT_RELEASE_EVIDENCE_*.md`
- `product_release/evidence/test_reports/NATIVE_STT_RELEASE_EVIDENCE_*.md`
- `product_release/evidence/test_reports/PRIVATE_STT_RELEASE_EVIDENCE_*.md`
- `product_release/evidence/stt_product_metrics_release_matrix_*.md`
- `product_release/stt-perf-proof-protocol.md`, `product_release/PRIVATE_STT_ACCURACY_LEVERS.md`
- `product_release/v4_work/*` (v4, hard-off)

There is no single harness that runs all four engines against the same fixtures and emits one comparable evidence artifact against declared thresholds. This makes cross-engine claims hard to substantiate and easy to overstate.

## The four engines (current truth)

| Engine | Path | Benchmarkable as | Notes |
|---|---|---|---|
| **Private v2** (`whisper-base.en`) | on-device Whisper, Transformers.js CPU/WASM | corpus WER (in our control) | default Private; ≈90s finalize for 5-min is an **accepted limitation, not a measured p95** |
| **Cloud** (AssemblyAI) | streaming | corpus WER (in our control) | paid-Pro only; live proof needs non-placeholder transcript + WER < 8% |
| **Quick Preview (Browser)** (Web Speech, internal token `native`) | browser recognizer | **browser behavior only** | Chrome routes audio to Google; NOT corpus-grade unless the exact fixture-audio route is separately proven to reach the recognizer |
| **Private v4** (WebGPU) | hard-disabled | — | not a release path; harness runs it only as opt-in acceleration evidence |

## Target design

A single harness that, per engine, runs the canonical fixture(s), computes WER/latency/finalize metrics, and emits **one** machine-readable artifact + a rendered summary, gated on the step-7 SLO contract. Requirements:

1. **Shared fixtures, per-engine adapters.** Same ground-truth `.wav` + reference text across engines; adapters handle the route differences (fixture audio must actually reach each recognizer, or the run is marked non-corpus).
2. **Honest labeling.** Quick Preview (Browser) results are labeled *browser behavior*, never corpus-WER, unless the audio route is proven. Private v2 finalize time is reported as the accepted-limitation figure, not a percentile SLO, until measured.
3. **Thresholds from the contract, not hard-coded.** WER/latency gates come from the step-7 STT evidence/SLO contract; a newer failing run returns the parent gate to red (Evidence Freshness Contract).
4. **No product-code change.** Test/CI infrastructure only. No secrets, operational emails, raw transcripts, or sensitive artifacts copied into the repo — synthetic fixtures/hashes/metrics only.

## Guardrails / non-goals

- Never imply our STT beats the vendor (corpus/path artifact); vendor is reference-only. Private's value framing = privacy/cost/local-first/fallback, not accuracy.
- v4 stays hard-off in the product; the harness may exercise it only as opt-in acceleration evidence.
- Depends on step 7 landing first; do not hard-code thresholds here.

## Acceptance criteria

- One harness entry point runs all in-scope engines against shared fixtures and emits a single comparable artifact + summary.
- Artifact schema versioned; summary rendered into `product_release/evidence/` on CI (not into contracts/PRD).
- Labeling rules enforced in output (browser-behavior vs corpus-WER; accepted-limitation vs measured p95).
- Full RC gate battery green before merge.
