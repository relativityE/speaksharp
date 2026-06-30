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
- **Moonshine STREAMING v2: blocked in our stack (probed 2026-06-30).** Streaming ONNX weights EXIST
  (`Mazino0/moonshine-streaming-small-onnx`, `model_type: moonshine_streaming`, int8 encoder/decoder/
  decoder_with_past). BUT transformers.js cannot load them: the `moonshine_streaming` class was added to
  *Python* transformers (2026-02-04), NOT the JS port — latest `@huggingface/transformers` on npm = **4.2.0**
  (= our installed), no streaming class. (`UsefulSensors/moonshine-streaming-small` ships no ONNX at all.)
  → Requires an upstream transformers.js release (no ETA) OR a hand-rolled onnxruntime-web streaming loop
  (substantial; authors note the current code path "does not yet implement fully efficient streaming").
  Verdict: NOT a near-term path. Future watch item — revisit when transformers.js adds `moonshine_streaming`.

## FINAL DISPOSITION (all three paths resolved by measurement)
1. Moonshine base — OUT (long-audio: slower than Whisper + loop hallucination).
2. Moonshine streaming v2 — NOT viable now (no transformers.js support; needs upstream or custom ORT loop).
3. **Whisper + segmentation — PROVEN, uses the model+lib we already ship → the beta path.** (Branch B.)
