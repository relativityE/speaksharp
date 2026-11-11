# Third-party license attribution for #1760 Increment A (verified 2026-11-06)

This page covers what Increment A **redistributes** (files committed and served by the app) separately from what a
user's browser **fetches from its pinned upstream** after consent (not redistributed by SpeakSharp). No candidate is
activated; `v2:base.en` stays the production default.

## Redistributed in this repository

| Component | Where | License | Attribution shipped | Verification |
|---|---|---|---|---|
| `parakeet.js` 1.4.4 (source + owned Vite bundle) | `frontend/public/models/parakeet-runtime/1.4.4-ort1.24.1/` | MIT (Yunus Seyhan Dede) | `source/parakeet.js-1.4.4/LICENSE` | LICENSE SHA256 `524eeafb…` equals `source/source-hashes.json`; `package.json` declares `"license": "MIT"` |
| ONNX Runtime Web 1.24.1 (WASM glue, WASM binary, wasm bundle) | same directory | MIT (Microsoft) | `source/ORT-LICENSE` and `source/ORT-ThirdPartyNotices.txt` | `ORT-LICENSE` is byte-identical to `LICENSE` at `microsoft/onnxruntime` tag v1.24.1 (commit `470ae16099a74fe05e31f2530489332c0525edb5`, the revision PROVENANCE.md cites), SHA256 `2f07c727…`. `ORT-ThirdPartyNotices.txt` was added in Increment A from that same tag, unchanged, SHA256 `0e07b95f3a8d6230037707c5c4a2b554d12c4cb67369669ac255635528ffcee2`; before this, the compiled third-party notices for the served WASM were missing. |
| Granite CTC core, adapted from IBM `granite-speech-streaming-webgpu` `granite-engine.js` | `frontend/src/services/transcription/engines/granite/` | Apache-2.0, as declared by the Space README | `LICENSE` (Apache-2.0 text); `ctc-core.js` header names the source revision and states SpeakSharp's modifications (Apache-2.0 §4(b)); PROVENANCE.md | No upstream NOTICE file exists at that revision; none is invented |
| Whisper base.en / tiny.en ONNX (self-hosted incumbent) | `frontend/public/models/whisper-*` | Pre-existing; not changed by #1760 | — | Out of scope for this increment |

## Fetched by the user's browser from pinned upstream (not redistributed)

| Model | Pinned source | License | Status |
|---|---|---|---|
| Parakeet TDT 0.6B v3 (ONNX export) | `ysdede/parakeet-tdt-0.6b-v3-onnx@e5356bf6…`, converted from `istupakov/…@8f23f0c0…`, upstream `nvidia/parakeet-tdt-0.6b-v3` | CC-BY-4.0 | Recorded in `engines/parakeet/PROVENANCE.md`. **Before Parakeet can be user-selectable**, the product must show NVIDIA and converter attribution; tracked in the model-decision follow-up. Not a release blocker while it is internal-only. |
| Granite Speech 5.0 470M TurboCTC (+ the Space's ORT Web 1.26.0) | `ibm-granite/granite-speech-streaming-webgpu@b347f5c6…` | Apache-2.0 (Space README); ORT MIT | Fetched intact from the Space, including its bundled ORT notices; nothing re-served by SpeakSharp |
| Moonshine streaming models | `download.moonshine.ai` pins | MIT (moonshine-ai/moonshine) | Notice recorded in `moonshineAssetPins.json` (`licence`) |

## Not verified here

- Whether NVIDIA's original checkpoint revision carries terms beyond CC-BY-4.0: its revision is unknown (`upstreamRevision: null`).
- A legal review. This is an engineering attribution inventory, not legal advice.
