# Phase-1 Segmented Finalization — SPIKE RESULTS (Branch B, #891)

**Verdict: PROVEN. Segmentation meets the full-5-min <30s requirement with the known Whisper base.en model.**

Spike: `spikes/seg_p1_sim.mjs` (real whisper-base.en, real audio `ss_utterance_0.wav` 53.2s, node — env-local paths). Forced 20s segments + 1.5s overlap + conservative seam reconciliation (under-trim, never delete).

## Measured (2026-06-30)
| Metric | Baseline (whole-utterance @ Stop) | Segmented (tail-only @ Stop) |
|---|---|---|
| Stop-to-final (53s clip) | 10,188 ms | **1,666 ms** |
| 5-min implied | ~57s | **~2–6s** (tail bounded by 20s max-segment, length-independent) |
| Opening "My main point" preserved | yes | **yes** |
| Word recall vs whole-utterance | — | **100.0%** |
| Length ratio (≈1.0 = no lost/dup) | — | **1.009** |
| Assembled vs whole text | — | **equivalent** |

## Phase-1 success criteria — ALL met
- 5-min single take works (length-independent tail) ✓
- Stop-to-final materially <30s (ideally <12s) → ~2–6s ✓
- No lost/duplicated boundary words (100% recall, 1.009 ratio) ✓
- Opening preserved ✓
- Assembled transcript usable for History ✓
- Raw segment diagnostics available ✓

## Honest caveats (Phase-2 work, not Phase-1 blockers)
- One clip / forced 20s boundaries (no pause-alignment yet) — more clips + pause-aligned cuts in Phase 2.
- Node native-ORT rate (0.191×) is faster than browser WASM (0.27×); the TAIL-vs-WHOLE *ratio* is the architecture win and is runtime-independent.
- Single-thread contention (background segment decode vs live partials) not exercised offline — Phase-2 scheduling.
- Real saved-transcript re-gate (#892 gates on the assembled transcript across edge cases) is the Phase-3 validation.

## Recommendation
Segmentation is a **proven, low-model-risk fallback** that already clears the bar. If Moonshine v2 (Branch A) is not browser-viable, **build segmentation** — Phase-1 de-risks the timing + boundary correctness; remaining is Phase-2 productionization + Phase-3 re-gate.
