# Moonshine Streaming/v2 — viability probe (Branch A, #891)

**Verdict: NOT browser-loadable as TRUE streaming in SpeakSharp's ONNX/transformers.js path. Two structural blockers.**

Probed the only browser-runnable streaming artifact: `Mazino0/moonshine-streaming-small-onnx`
(`model_type: moonshine_streaming`; `UsefulSensors/moonshine-streaming-*` ship NO onnx). Inspected via
`spikes/moonshine_streaming_inspect.mjs` (onnxruntime-node).

## Architecture IS real streaming (config)
`moonshine_streaming_encoder`, 10 layers, `sliding_windows [[16,4],[16,4],[16,0]...[16,4],[16,4]]`,
frame_ms 5 (50Hz), exported with `transformers 5.2.0`. The sliding-window/ergodic encoder from the paper.

## But the ONNX export exposes only a BATCH interface
```
encoder_model_int8 :  IN [input_values, attention_mask]  ->  OUT [encoder_hidden_states]
decoder_model_int8 :  IN [decoder_input_ids, encoder_hidden_states] -> OUT [logits, present_self/cross_kv...]
decoder_with_past  :  IN [..., past_self_kv...] -> OUT [logits, present_self/cross_kv...]
```
- Encoder is **whole-input**: no state input, no state output. Sliding-window attention is INTERNAL to the
  graph; the interface still takes the full audio and emits the full encoding in one call.
- Decoder is a standard autoregressive KV-cache decoder (same long-output bottleneck as base Moonshine).
- => Cannot feed audio incrementally, cannot carry encoder state across chunks, cannot "Stop = tail only".

## Exact-blocker checklist (chartered item 7)
| Candidate | Status |
|---|---|
| Missing ONNX export | NO (exists) |
| Unsupported operator in ORT | NO (all 3 graphs loaded cleanly in onnxruntime-node) |
| Tokenizer/config failure | NO (present) |
| **Unsupported model class in transformers.js** | **YES** — no `moonshine_streaming` in 4.2.0 (= latest npm) |
| **No incremental API / state support** | **YES** — whole-input encoder, no state I/O |
| Asset size | FLAG — 355MB int8 (enc 81 + dec 145 + dec_past 129) vs whisper-base.en ~61MB |

## Conclusion
True streaming v2 needs (a) a custom STATEFUL ONNX re-export (encoder accepting+emitting sliding-window
state) from the Python model AND (b) a hand-rolled onnxruntime-web streaming loop with state management —
a multi-week model+runtime engineering effort (authors note the JS path "does not yet implement fully
efficient streaming"). Running the existing export as batch inherits base Moonshine's long-audio decode
bottleneck. => Streaming v2 is a genuine FUTURE architecture, NOT a near-term beta path.

**Whisper + segmentation (Branch B) remains the only path that clears <30s with available, supported components.**
