# Parakeet TDT adapter

The adapter selects explicit WASM/int8 encoder and combined decoder/joiner files.
It uses the existing `PrivateSTT` facade, consent and verified acquisition path.
It adds no microphone owner, transcript store, model catalogue or default change.

The selected export is
`ysdede/parakeet-tdt-0.6b-v3-onnx@e5356bf6e24bdb7a269536b0e9e7869bc034b893`.
The four model/configuration entries total 670,488,236 bytes. The graph hashes
come from immutable Hugging Face LFS metadata; graph bytes have not been fetched
or executed. The small vocabulary and configuration texts were fetched at that
revision, checked against Git blob IDs, and SHA256 hashed. The vocabulary has
8,193 entries and blank ID 8,192. The older package catalogue's 4,097 count must
not replace those exported bytes.

The export records conversion provenance from
`istupakov/parakeet-tdt-0.6b-v3-onnx@8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce`.
The original NVIDIA checkpoint revision is unknown and remains null. The model
export is CC-BY-4.0; preserve its NVIDIA and converter attribution when packaging.

## Runtime binding prerequisite

The published runtime source is MIT-licensed `parakeet.js@1.4.4`, npm gitHead
`44fe54aaaaf8074f64c69f2647cfcd8f96f93a58`. Its 53,387-byte archive was verified
against npm SHA512 and SHA1. Registry integrity is retained in `assetPins.json`.
It depends on `onnxruntime-web@1.24.1`. The delivered JavaScript, glue and WASM
bytes were downloaded and SHA256 verified against matching jsDelivr and UNPKG
metadata. The WASM is 12,297,086 bytes, SHA256
`fd078a39438a65660fc6c9df8d42fc886b5bf2931d6dbdd8dc51a17b1221499f`.

The npm registry returns 404 for `parakeet.js@1.4.9`. Source commit
`c346fd04888272b05ed820896df0b188e92463b9` declares that development version;
it is not a published npm executable and is not silently substituted.

Published 1.4.4 ignores its `fromUrls` `wasmPaths` argument. Its Hub loader can
silently promote an int8 encoder to FP32 for WebGPU. This integration does not
patch vendor code or use that Hub loader. The owned, hash-pinned binding module
exports `ParakeetModel`, its exact internal ORT module, and `bindingIdentity`.
The build resolves the model's relative backend import and the binding's backend
alias to the identical source module. The worker also checks `model.ort === ort`.
Before `fromUrls`, the worker
sets that public ORT environment to verified glue/WASM blob URLs and one CPU thread.
The model URLs are owned blobs created from verified model buffers.

ORT 1.24.1 source at `470ae16099a74fe05e31f2530489332c0525edb5`
(`js/common/lib/env.ts` and `js/web/lib/wasm/wasm-factory.ts`) confirms that
the public environment accepts a WASM binary buffer and an explicit glue-module
override. Native browser testing found that supplying `wasmBinary` still makes
the generated glue resolve its default filename against the blob module URL.
The adapter instead supplies both public `wasmPaths.mjs` and `wasmPaths.wasm`
as owned URLs of the verified bytes. ORT fetches only those blobs; no vendor
patch or unverified network fallback is used.

`frontend/public/models/parakeet-runtime/1.4.4-ort1.24.1/` contains the built binding,
runtime artifacts and unchanged upstream source with MIT licenses. Rebuild with
`node scripts/model-evaluator/build-parakeet-runtime.mjs`; it checks every source
and ORT artifact hash first. The installed lock's Vite 7.2.2 bundles the sources,
removing vendor console output to prevent upstream debug paths logging transcripts.
The package lock and app-wide ORT resolution are unchanged. The seven-file
descriptor now has a complete executable inventory and `browser.ok=true`.
`activationReady=false` and `comparisonReady=false` retain the actual model and
product qualification requirements. The production selector remains `v2:base.en`.

`node scripts/model-evaluator/parakeet-runtime.smoke.mjs` checks local runtime
bytes, starts a loopback-only server and an isolated sandboxed browser, executes
a tiny Identity ONNX graph with the actual WASM, and invokes stock `fromUrls`
against tiny graphs to verify the same ORT singleton and real JS mel frontend.
It does not qualify the Parakeet weights or speech accuracy.

## Execution and lifetime contract

The TDT runtime must use its real recurrent token/duration decoding and NeMo
128-bin frontend. The worker probes exact encoder and combined decoder tensor
names, finite feature/logit outputs, duration-logit presence and recurrent state
shape, then requires a successful transcription warmup. Upstream compatibility
warnings or nonfatal preprocessor warmup do not establish READY.

There is no public `ParakeetModel.dispose`, `close` or cancellation method in the
verified package. The adapter aborts asset fetches, invalidates generations,
rejects pending requests and terminates its own worker. It does not invent an
upstream lifecycle API. No browser resource-release or inference qualification
is claimed by source tests with doubles.

All upstream `webgpu*` modes retain a WASM decoder, including `webgpu-strict`.
They cannot be labelled GPU-only. This adapter rejects them and supports only
the explicitly described WASM/int8 profile. Runtime evidence is successful
strict WASM warmup; loaded model identity stays null rather than being inferred
from a requested descriptor.

No package/lock changes, large model/runtime downloads, live inference, default
activation or production-comparison authorization are part of this preparation.
