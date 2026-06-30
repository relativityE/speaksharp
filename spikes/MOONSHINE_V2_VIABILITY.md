# Moonshine v2 Viability — SPIKE (Branch A, #891)

**Goal:** prove or KILL Moonshine v2 (streaming ergodic encoder, arXiv 2602.12241) as a browser-local
streaming ASR path that avoids Whisper segmentation. **Time-box 1–2 days. Stage 1 first; do not build a
full engine until Stage 1 passes.**

## ⚠️ Why this is a branch/CI task, not done by Dev locally
The Dev sandbox **cannot reach HuggingFace** (`us.aws.cdn.hf.co` → ENOTFOUND), so the model
load/transcribe steps MUST run on a networked machine or this branch's CI. Code is prepared; the
empirical answers are not obtainable in the sandbox.

## Stage 1 — viability (STOP if any fails)
- [ ] **Exact model repo exists** — find the Moonshine v2 ONNX weights on HF (e.g. `onnx-community/moonshine-v2-*` or `UsefulSensors/*`). NOTE: the INSTALLED `@huggingface/transformers@4.2.0` registers only `MoonshineForConditionalGeneration` (original v1, encoder-decoder/batch). **v2/streaming is NOT in 4.2.0** — check the LATEST `@huggingface/transformers` for a v2/streaming-encoder class before assuming support.
- [ ] **License acceptable** for our distribution (verify the model card; "Flavors of Moonshine" cites permissive — confirm the exact repo).
- [ ] **Browser-loadable artifact** — ONNX + transformers.js (WASM/WebGPU), not just Python/C++.
- [ ] **One short WAV transcribes in Chrome** (not just node) — `self.crossOriginIsolated` not required for WASM single-thread.
- [ ] Model size acceptable for a Private download (≈ whisper-base.en budget).

## Stage 2 — bakeoff vs whisper-base.en (only if Stage 1 passes)
Use the same fixed corpus + the same instrumentation as the segmentation spike:
| Metric | Required |
|---|---|
| Model size / load time | acceptable for Private download |
| Time-to-first-text | ≥ comparable to v2-base |
| **5-min stop-to-final** | < 30s (the whole point — streaming should make Stop ~free) |
| WER / quality on Harvard corpus | acceptable vs whisper-base.en |
| Loop/duplication | none |
| Save/history shape | compatible with SpeakSharp metadata |

## How to run (networked machine / CI)
`node spikes/moonshine_viability.mjs <hf-model-id>` — loads the model + transcribes the baseline fixture,
reports decode RTF + 5-min-implied latency + opening preservation. (Edit the model id once the exact v2
repo is confirmed; the script defaults to `onnx-community/moonshine-base-ONNX` = v1, a control.)

## Decision
- Stage 1 fails (no browser-viable v2) → **KILL**; Branch B (segmentation, already PROVEN) is the path.
- Stage 1+2 pass and beat Whisper → Moonshine becomes the primary path.
