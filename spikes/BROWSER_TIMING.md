# In-browser timing (pre-wiring path-validation, #891) — 2026-06-30

The path-validating measurement pulled forward BEFORE wiring (per review): does the node-proven latency win
survive the actual browser? Headless chromium (playwright), @xenova/transformers WASM, **single-thread** (=prod,
COOP/COEP off), self-hosted whisper-base.en (allowRemoteModels=false), local SIMD ORT wasm, word timestamps.
Harness: `spikes/index.html` + `spikes/run.mjs` (served dir with symlinked /models + a fixture).

## Measured (headless, single-thread SIMD)
| decode | ms | RTF |
|---|---|---|
| model load | ~1100ms | — |
| 20s segment (typical tail) | ~7,700ms | **0.38×** |
| 30s segment (max tail) | ~13,900ms | **0.46×** |

## Verdict: PATH SURVIVES THE BROWSER
- **Stop-to-final = tail decode ≈ 8–14s (≤30s bounded segment) < 30s ceiling.** ✓ The architectural win holds.
- Browser RTF ~0.4× is ~2–2.5× node (~0.19×) — the reviewers were right that browser≠node and it matters; but
  the TAIL is bounded, so stop-to-final is bounded regardless. Likely CONSERVATIVE vs real prod hw (prior prod
  measure ~0.27× -> tail ~8s). Either way < 30s.
- RTF 0.4× < 1.0× realtime => during-recording segment decodes KEEP PACE (no backlog); only the final tail lands
  at Stop. The full segmentation timing model holds in-browser.
- A whole-utterance 5-min decode in-browser ≈ 120–150s -> segmentation is REQUIRED, not optional.

## Caveats (honest)
- Headless chromium on a loaded dev machine — not a real target device; treat ~0.4× as an upper-bound estimate.
- Harness decodes on the MAIN thread; prod runs the engine in a Web Worker -> same decode time, but non-blocking
  (UI-blocking is handled by the worker, not tested here).
- Single measurement per slice (warmup discarded). Real continuous 5-min take (with the worker) is still the gate.
