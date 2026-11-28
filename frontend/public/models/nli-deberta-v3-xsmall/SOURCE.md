# nli-deberta-v3-xsmall — provenance

Self-hosted model for the default-off Focus Points meaning-based matcher
(`VITE_FOCUS_MEANING_MATCHER_ENABLED`). Served from our own origin under
`/models/nli-deberta-v3-xsmall/`; the app loads it with remote model loading OFF,
only after the user opts in, and runs it on-device in a Web Worker after Stop.

## Source

- Repository: https://huggingface.co/Xenova/nli-deberta-v3-xsmall
- Revision: `2a4f614a701367a02d51389039afc998faeda637`
- Format: ONNX conversion for Transformers.js; only the quantized ONNX export
  (`onnx/model_quantized.onnx`) is shipped.

## Licensing

- The Xenova repository declares no license of its own. It is a format conversion
  (PyTorch → ONNX, quantized) of `cross-encoder/nli-deberta-v3-xsmall`, which is
  licensed Apache-2.0. See `LICENSE-APACHE-2.0.txt`.
- `cross-encoder/nli-deberta-v3-xsmall` is fine-tuned from
  `microsoft/deberta-v3-xsmall`, which is licensed MIT,
  "Copyright (c) Microsoft Corporation." See
  `LICENSE-MIT-microsoft-deberta-v3-xsmall.txt`.

## Files (sha256, bytes)

These are the exact bytes shipped. `frontend/src/services/objective/meaning/meaningAssetPins.json`
pins the same list, and a unit test re-derives it from this directory.

| Path | sha256 | Bytes |
|---|---|---|
| `added_tokens.json` | `dc046d04c9b0ada7ae6f1dc89c465801799acdf0c9a6aab8c15a1b2d5ca4e91f` | 23 |
| `config.json` | `ec0bd14cc28640326474399cd61d38ccd52b64900228799d0f81debda8c4bc53` | 1038 |
| `onnx/model_quantized.onnx` | `3fac2500c45c75af42c7711de0d1b93d59577456100208be0dc1f9e8811946b6` | 87246587 |
| `quantize_config.json` | `97ed567b73503b8d9d373d5a4124243fe6c11aef0fac5f26c2cf9ab661a116cc` | 1193 |
| `special_tokens_map.json` | `311de3f4eed9d76a43bf0d71f10e62e086ca65ccce9f15d5da0d2098bf519ecc` | 173 |
| `tokenizer.json` | `a86f883318afa11c8c10466f1bf4efaeb6ded28a52cbe57217a8fa0d0a2a87df` | 8656551 |
| `tokenizer_config.json` | `d8d3bb123b99317634d5ee3d1d2d8b2ddb01510a0654687fc2639a5347a7291f` | 384 |

Total: 95905949 bytes (about 96 MB).

The license texts and this note are documentation, not model assets, and are not pinned.
