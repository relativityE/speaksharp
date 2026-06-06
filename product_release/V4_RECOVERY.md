# Private v4 Recovery — historical recovery notes

> **Current status (2026-06-06):** this document contains the older WASM-first recovery history.
> It is superseded for active coordination by `product_release/STT_PING.md` / `STT-V4` in
> `product_release/CURRENT_WORK.md`: v4 is active again as a WebGPU `base.en` candidate. Current
> gate: v4 must match/beat v2 base accuracy and be materially
> faster; latest no-auth bakeoff attempt hung in the first `v4-base q8/q8` cell and is now routed
> to dev for probe hardening. Keep the historical failures below as context only.

**Original first milestone:** make the modern `@huggingface/transformers` (v4) + onnx-community
Whisper path decode **ONE WAV in the browser to a non-empty transcript** — i.e. eliminate
`invalid data location: undefined for input "a"`. This is an infrastructure/runtime project,
**not** an STT candidate, until it produces one valid transcript.

**Non-goals / guardrails:**
- v4 is **not** a release candidate while it returns empty transcripts. Stay on v2 for release
  unless the current WebGPU base.en path passes the active bakeoff and app-lifecycle gates.
- Do **not** run WER comparisons before a successful decode.
- Do **not** mix v4 runtime debugging with Private UX bugs.
- Do **not** assume WebGPU fixes a WASM/runtime binding error — get **WASM** decode first.

Branch: `dev/v4-recovery`. Owner: dev-agent (build) → test-release-agent (browser run).

## Phase 0 — reproducibility (done; record corrected)

The earlier "phantom/unpinned" framing was **partly wrong**:
- `@huggingface/transformers@4.2.0` **is** declared in the **root** `package.json` (the real
  install source — `frontend/package.json` is the minimal, non-installed one), **installed**,
  and **locked**. Now pinned `^4.2.0` → exact `4.2.0`.
- The genuine reproducibility risk is the **transitive ONNX Runtime**: v4 pins
  `onnxruntime-web@1.26.0-dev.20260416-b7804b056c` (a **dev build**), while v2 uses
  `onnxruntime-web@1.14.0`. **Two ORT runtimes** in the tree; v4 runs on the dev build. A
  mismatched/dev ORT is the classic cause of `invalid data location`.
- The existing v4 worker (`transformers-js-v4.worker.ts`) loads `dtype { encoder fp32,
  decoder q4 }` and sets **no `wasmPaths` / threads** — prime suspects.

The probe **reports the resolved ORT version + dtype + wasmPaths at runtime**, so each run is
interpretable.

## Phase 1 — minimal standalone decode (built; needs browser run)

`/v4-decode-probe.html` + `src/benchmark/v4-decode-probe.ts` — imports
`@huggingface/transformers` directly, decodes one WAV, **no app code** (no session, controller,
store, save, analytics, lifecycle). Output → `window.__V4_PROBE_RESULT__` (transcript OR exact
error + meta).

Run (served via the app dev server so resolution matches the build):
```text
pnpm dev   # 5174
open /v4-decode-probe.html?wav=<harvard-wav-url>&encoder=fp32&decoder=q8&device=wasm
# or open the page and pick a local WAV
```
**Pass gate:** one WAV → **non-empty transcript** (`__V4_PROBE_RESULT__.ok === true`).

## Phase 2 — dtype/backend matrix (run via the same probe, vary params)

Start with WASM + **q8 decoder** (q4 split is the current fragile/failing config). Do NOT
start with WebGPU.

| device | encoder | decoder | URL params | expectation |
|---|---|---|---|---|
| wasm | fp32 | q8 | `?...&encoder=fp32&decoder=q8&device=wasm` | likely safest — try first |
| wasm | q8 | q8 | `&encoder=q8&decoder=q8&device=wasm` | possible |
| wasm | fp32 | q4 | `&encoder=fp32&decoder=q4&device=wasm` | current/fragile (repro the failure) |
| webgpu | fp32 | q4/q8 | `&device=webgpu` | later, only after WASM works |

For each cell capture `window.__V4_PROBE_RESULT__`: `ok`, `transcript` or `error{name,message}`,
`meta.ortVersions`, `meta.wasmPathsSet`, `meta.loadMs/decodeMs`.

## TEST → DEV result (2026-06-05, `test/stt-v4r-probe@f2274628`)

Artifact: `/private/tmp/stt-v4r-wasm-matrix.json`

Input WAV: `tests/fixtures/stt-isomorphic/audio/h1_6.wav` (3.1 s, 49,575 samples after browser decode)

| device | encoder | decoder | result | exact error | runtime metadata |
|---|---|---|---|---|---|
| wasm | fp32 | q8 | **FAIL** | `Can't create a session. ERROR_CODE: 1, ERROR_MESSAGE: qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale for node: model.decoder.embed_tokens.weight_transposed_DequantizeLinear` | `@huggingface/transformers` `4.2.0`; ORT common `1.24.0-dev.20251116-b39e144322`; ORT web `1.26.0-dev.20260416-b7804b056c`; `wasmPathsSet=true` |
| wasm | q8 | q8 | **FAIL** | same missing decoder scale error | same ORT metadata |
| wasm | fp32 | q4 | **FAIL** | `invalid data location: undefined for input "a"` | same ORT metadata; `loadMs=2169` |

Verdict:

```text
v4 still runtime-blocked.
No WASM dtype combination produced a non-empty standalone browser transcript.
Do not run app-path WER or release comparisons for v4.
```

Signal for dev:

```text
q8 moved failure from the old "input a" signature to an ORT quantized-decoder scale/session-creation failure.
q4 still reproduces the known "invalid data location" failure.
The current blocker is below SpeakSharp app code: v4 + onnx-community model artifact + ORT browser runtime compatibility.
```

## Phase 3 — app integration (only after standalone decode works)

Wire the working config into `TransformersJSV4Engine` → `PrivateSTT` → session → save/history/
detail, then compare WER / filler recall / firstDraft / finalization / load time / size / memory.

## Phase 4 — model ladder (only after Phase 3)

`onnx-community/whisper-tiny.en` (parity) → `whisper-base.en` (accuracy) → distil-small.en (efficient)
→ WebGPU variants (speed).

## Phase 0/2 RESULT (2026-06-05, dev Node isolator) — failure is onnxruntime-web, NOT the model

`scripts/v4-node-decode-smoke.mjs` ran `@huggingface/transformers@4.2.0` on the jfk WAV across
the dtype matrix under **onnxruntime-NODE**:

| enc | dec | result |
|---|---|---|
| fp32 | q8 | ✅ correct JFK transcript |
| q8 | q8 | ✅ correct |
| fp32 | q4 | ✅ correct (even q4 decodes) |

**Conclusion:** the model, all dtypes (incl. q4), and the graph are fine. The browser
`invalid data location` is **specific to `onnxruntime-web`** (the WASM runtime, the 1.26.0-dev
build that v4 pins). Most likely cause: the **threaded/proxy** wasm path (needs SharedArrayBuffer
/ cross-origin isolation, which this app does NOT have). The probe now defaults to
`ort.env.backends.onnx.wasm` **numThreads=1, proxy=false** (override `?threads=N&proxy=1`).

**Next @test-agent (browser, dev/v4-recovery@6f5f028b):** run `/v4-decode-probe.html?wav=<16k-wav>&decoder=q8&device=wasm`
(default single-thread/no-proxy). If it decodes → the threaded/proxy path was the bug. If it still
errors → capture `__V4_PROBE_RESULT__.error` + `meta.ortVersions`; next dev step is pinning a
**stable** onnxruntime-web release instead of the dev build.

## TEST → DEV result (2026-06-05, `test/stt-v4r-single-thread@6f5f028b`)

Artifact: `/private/tmp/stt-v4r-singlethread-matrix.json`

Input WAV: `tests/fixtures/stt-isomorphic/audio/h1_6.wav`

| device | encoder | decoder | result | exact error | runtime metadata |
|---|---|---|---|---|---|
| wasm | fp32 | q8 | **FAIL** | `Can't create a session. ERROR_CODE: 1, ERROR_MESSAGE: qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale for node: model.decoder.embed_tokens.weight_transposed_DequantizeLinear` | `@huggingface/transformers` `4.2.0`; ORT common `1.24.0-dev.20251116-b39e144322`; ORT web `1.26.0-dev.20260416-b7804b056c`; `wasmPathsSet=true`; `numThreads=1`; `proxy=false` |
| wasm | q8 | q8 | **FAIL** | same missing decoder scale error | same ORT metadata; `numThreads=1`; `proxy=false` |
| wasm | fp32 | q4 | **FAIL** | `invalid data location: undefined for input "a"` | same ORT metadata; `numThreads=1`; `proxy=false`; `loadMs=2437` |

Verdict:

```text
v4 still runtime-blocked in browser.
The single-thread/no-proxy hypothesis is falsified for this ORT dev build.
Node decode success proves model/dtype validity, but browser ORT still cannot run the graph.
```

## TEST → DEV result (2026-06-05, `test/stt-v4r-exact-contract@b9f6448c`)

Artifacts:

- `/private/tmp/stt-v4r-b9-q8-result.json`
- `/private/tmp/stt-v4r-b9-a2-matrix.json`

Input WAV: `tests/fixtures/stt-isomorphic/audio/h1_6.wav`, temporarily served as
`/__probe_h1_6.wav` during the local Vite run and removed after the proof.

Runtime:

- URL base: `http://127.0.0.1:5174/v4-decode-probe.html`
- `device=wasm`
- `threads=1`
- `proxy=0`
- `modelId=onnx-community/whisper-tiny.en`

| encoder | decoder | result | exact error | loaded model files |
|---|---|---|---|---|
| `fp32` | `q8` | **FAIL** | `Can't create a session. ERROR_CODE: 1, ERROR_MESSAGE: qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale for node: model.decoder.embed_tokens.weight_transposed_DequantizeLinear` | `encoder_model.onnx`, `decoder_model_merged_quantized.onnx` |
| `q8` | `q8` | **FAIL** | same missing decoder scale error | `encoder_model_quantized.onnx`, `decoder_model_merged_quantized.onnx` |
| `fp32` | `q4` | **FAIL** | `invalid data location: undefined for input "a"` | `encoder_model.onnx`, `decoder_model_merged_q4.onnx` |

Exact-contract note:

- `__V4_PROBE_RESULT__` now emits the requested shape (`ok`, `modelId`, `backend`,
  `encoderDtype`, `decoderDtype`, `proxy`, `threads`, `modelFilesLoaded`, `error`).
- In this failure path, `transformersVersion` and `onnxRuntimeVersion` are present but blank.
  If dev needs version values in every failure, the probe should resolve them from package metadata
  or the imported backend before session creation.

Verdict:

```text
v4 remains browser-runtime blocked.
No b9 exact-contract WASM cell produced a non-empty transcript.
q8 still fails at ORT session creation because the quantized decoder scale is missing.
q4 still reproduces the original "invalid data location" failure.
Keep v4 out of release A/B and treat this as an onnxruntime-web / model-artifact compatibility track.
```
