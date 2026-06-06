# STT Performance Proof Protocol (tiered ladder + layered measurement)

Governing reference for any STT engine speed/accuracy comparison (v2/v4/future). Two principles:
1. **Tiered ladder with early-exit** — start at the highest tier that answers the release question; only go lower when the result is bad, ambiguous, or needs root-cause.
2. **Layered measurement** — never report one blended number; separate harness from engine, cold from warm.

> Hard rule: **do not trust any v4 speed number until the v2 control cells produce plausible warm/hot numbers in the same harness.** Validate the instrument on the known-good (v2) before trusting it on v4.

---

## Tiered ladder (run top-down; early-exit)

**Tier 1 — Product/app lifecycle (the decider).** Real authed app: record → first transcript → stop→final → save → detail. Measure firstVisibleMs, stopToFinalMs, saveMs, detailHydrationMs, WER/quality, deviceResolved, fallbackOccurred.
- *Early-exit:* **clear pass with margin → STOP. No lower-tier decomposition needed.**
- Currently env-blocked (needs real-auth `5174` + WebGPU). Unblocking this is higher-leverage than gold-plating lower tiers.

**Tier 2 — Engine/worker benchmark.** Real engine in a worker, no auth/UI. Same fixtures: modelLoad, firstText, decode, RTF, WER, resolvedDevice, fallback. Use when Tier 1 is unavailable/ambiguous. *Early-exit:* clear win + Tier 1 only env-blocked → proceed to one targeted Tier 1 later; close/bad → don't wire app yet.

**Tier 3 — Direct pipeline/probe.** Model/runtime/device viability only. *Early-exit:* fails → STOP, don't build integration; passes-but-slower-than-v2 → STOP unless it unlocks a future model.

**Tier 4 — Component timing breakdown.** download/cache · worker startup · model load · audio decode · feature extraction · inference · post-process · save/detail. **Expensive — run ONLY when higher tiers are close, implausible, or failing and need root cause.**

Decision tree: Tier1 if runnable (pass→stop; fail→isolate lower; ambiguous→Tier4). Else Tier2 (pass→await one Tier1; fail→stop/Tier3; ambiguous→Tier4). Else Tier3 (fail→stop; pass→not release-ready until Tier1).

---

## Layered measurement (what each run must separate)
- **L0 asset:** modelBytes, downloadMs, cacheState (cold/warm/hot), modelSource (local|HF)
- **L1 init:** workerStartMs, pipelineCreate/modelLoadMs, runtimeCompileMs, deviceResolveMs
- **L2 audio prep:** wavFetchMs, decodeAudioDataMs, resampleMs, featureExtractionMs, audioDurationSec
- **L3 inference (most important):** firstTextMs, decodeMs, **RTF = decodeMs / (audioDurationSec×1000)**
- **L4 post:** tokenDecodeMs, normalizationMs, repetitionGuardMs, candidateSelectionMs
- **L5 app:** recordStartToReadyMs, stopToFinalMs, saveMs, detailHydrationMs

## Cold / warm / hot (mandatory)
- **cold** = empty cache, first model load (first-time user) — includes WebGPU shader compile.
- **warm** = model cached, fresh pipeline (returning user).
- **hot** = same worker/pipeline reused (same-session repeat).
- **Never compare v4 cold against v2 warm.** Report RTF from **warm/hot**, not cold.

## Controls (to attribute slowdowns)
- **Control A — null engine:** same harness path (fetch wav → decode → post to worker → canned transcript → render) with NO inference → `harnessOverheadMs`. Then `netInferenceMs = measuredDecodeMs` and total-minus-harness isolates engine vs harness.
- **Control B — direct vs worker vs app:** if direct probe fast but worker slow → worker marshalling; if worker fast but app slow → app lifecycle/save/render; if all slow → model/runtime.

## Minimum matrix (next pass)
| Engine | Model | Device | Dtype | Runs |
|---|---|---|---|---|
| v2 | tiny.en | WASM | q8/q8 | cold+warm+hot |
| v2 | base.en | WASM | q8/q8 | cold+warm+hot |
| v4 | base.en | WebGPU | fp32-enc/q4-dec (HF-demo) | cold+warm+hot |
| v4 | base.en | WebGPU | q4/q4 | cold+warm+hot |

Fixtures (NOT h1_6 alone — 8 words exaggerates WER/onset): **h1_6, conv_01, conv_02, washington, one 30–60s natural sample, one noisy sample.** Long clips reveal finalize latency, memory, repetition.

## Report fields
engine, model, dtype, deviceRequested, deviceResolved, fallbackOccurred, browser, gpuAdapter(+shader-f16), modelBytes, cacheState, audioDurationSec, wavDecodeMs, workerStartMs, modelLoadMs, firstTextMs, decodeMs(cold/warm/hot), postProcessMs, saveMs, detailHydrationMs, RTF, WER, transcript, errors. Calculated: RTF, coldPenaltyMs (cold−warm), harnessOverheadMs, netInferenceMs.

## Slowdown classification (every result must classify)
model/runtime · model download/cache · harness overhead · worker marshalling · app lifecycle/save/detail · invalid measurement.

## Decision thresholds (set BEFORE running)
v4 base continues only if, vs v2 base on the multi-fixture corpus:
- **Quality:** WER ≤ v2 base (+ small tolerance) — no material regression.
- **Speed:** warm stop-to-final / decode **≥ 30% faster** than v2 base. (5–10% faster is NOT worth the runtime/model complexity → too close, do not ship.)
- **Correctness:** save/detail match; `deviceResolved=webgpu` if marketed as accelerated; `fallbackOccurred=false` (no mislabeling).
- **Stability:** no repeated decode failure; no empty transcript on valid audio.
Else → stays hidden / stop.
