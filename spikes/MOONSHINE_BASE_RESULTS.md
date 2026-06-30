# Moonshine base ONNX — MEASURED RESULTS (Branch A, #891)

**Verdict: Moonshine BASE is REFUTED as the 5-min latency fix. Self-hosting works; long-audio behavior fails (slower than Whisper + loop hallucination).**

Self-hosted the SAME way as whisper-base.en: `curl -L` the ONNX from `onnx-community/moonshine-base-ONNX`
(the Xet/DNS "wall" was node's downloader, not real), served locally, loaded with `allowRemoteModels=false`.
All measured on the SAME node/onnxruntime as the Whisper baseline (apples-to-apples ratio).

## Measured (2026-06-30, raw pipeline output, NO sanitizer in path)
| Input | Model | RTF | 5-min implied | output |
|---|---|---|---|---|
| 53s real clip | Moonshine base | 0.049× | (~15s extrapolated — MISLEADING) | correct, opening preserved |
| 53s real clip | whisper-base.en | 0.191× | ~57s | correct |
| **199s VARIED real speech** | **Moonshine base** | **0.684×** | **~205s** | **LOOP: "i'm going to be a good person" ×100** |
| **199s VARIED real speech** | whisper-base.en | 0.142× | ~43s | correct (454 words) |

`detectRepetitionRisk(raw Moonshine 199s)` = **TRUE / adjacent_loop / "i'm going to be a good person" ×5+**.

## Conclusion
- ✅ Viability (loads/transcribes self-hosted, short audio, ~4× faster on 53s): YES.
- ❌ Long-audio (the actual gate): **catastrophic failure** — batch Moonshine breaks past its trained length:
  decode blows up super-linearly (0.049×→0.684×) AND output degenerates into a hallucinated loop.
- The 53s→15s extrapolation was meaningless (reviewer was right). node-vs-browser is moot — it fails in node.

## Disposition
- **Moonshine base: OUT** as the 5-min path.
- **Whisper + segmentation (Branch B): PROVEN** — the beta path (stop-to-final ~2-6s, 100% recall).
- **Moonshine STREAMING v2: only remaining Moonshine candidate** — its ergodic/sliding-window encoder
  (arXiv 2602.12241) is designed to avoid exactly this long-input blowup. Needs a transformers.js build
  with the streaming model class (added to Python transformers 2026-02-04; NOT in installed 4.2.0) + a
  streaming ONNX export (e.g. `Mazino0/moonshine-streaming-small-onnx`, `UsefulSensors/moonshine-streaming-*`).
  Now an OPTIMIZATION, not the blocker — segmentation already clears the bar.
