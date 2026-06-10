# v4 base-q4 decode root-cause experiment (`invalid data location: undefined for input "a"`)

Owner: Dev. Purpose: isolate the root cause of the v4 decode failure surfaced by the app-path
proof, WITHOUT blocking the already-shipped AUTO-path decode fallback (`dev/v4-decode-fallback`).

## The failing path (confirmed from code + proof evidence)

```
variant   = base_q4   (onnx-community/whisper-base.en)
dtype      = { encoder_model: 'fp32', decoder_model_merged: 'q4' }
device     = auto -> getPreferredDevice() -> WebGPU if usable, else undefined => WASM/CPU
backend    = onnxruntime-web WASM  (headless CI / no-GPU = the failing environment)
stage      = DECODE (transcribe), not init/load (the pipeline LOADS; decode throws)
error      = onnxruntime-web "invalid data location: undefined for input \"a\""
```

`sttConstants.PRIV_STT_V4_VARIANTS.base_q4.requiresWebGPU = false` + the comment "Works on
WASM (RTF ~0.72)" is the **assumption under test**. The proof artifact showed `transcript:""`,
`privateProvider:null`, no save/history on the strict-override (no-fallback) path.

## Hypothesis

The **q4-quantized decoder graph cannot bind an input on the onnxruntime-web WASM backend**
(works on WebGPU). I.e. the failure is **q4-specific AND WASM-specific**, not worker-specific
or app-path-specific (audio reached the engine; the harness/auth are fine).

## Experiment matrix (device A/B × decoder dtype × model × execution)

Run each cell as a single short decode (fixture `h1_6`), record PASS / FAIL(+error). Hold
encoder dtype = fp32 throughout (only the decoder dtype varies) unless a row says otherwise.

| # | Model | Device | decoder dtype | Primary question it answers |
|---|---|---|---|---|
| A1 | base | **WASM** | q4 | Reproduce the failure (control). Expect FAIL. |
| A2 | base | **WebGPU** | q4 | Is q4 OK on WebGPU? PASS ⇒ failure is **WASM-specific**. |
| B1 | base | WASM | **fp32** | Is it the quantization? PASS ⇒ failure is **q4-specific** on WASM. |
| B2 | base | WASM | **int8** | Does any quantized decoder work on WASM? Distinguishes "q4 only" vs "all quant". |
| B3 | base | WASM | **q8** | Narrows q4 vs q8 on WASM. |
| C1 | distil | WebGPU | q4 | distil_q4 on its intended path — sanity that q4 works somewhere. |
| D1 | base | WASM | q4 (**main-thread, no worker**) | PASS ⇒ worker-specific; FAIL ⇒ NOT worker-specific (model/backend). |

### Decision tree (what each result implies for the FIX)

```
A2 PASS + A1 FAIL                  -> q4 works on WebGPU, not WASM.
  + B1 PASS (fp32 on WASM works)   -> FIX: on WASM use an fp32 (or B2/B3 int8/q8) decoder for
                                      base; keep q4 for WebGPU. base_q4 then works everywhere.
  + B1 FAIL                        -> base decode broken on WASM beyond dtype -> FIX: mark
                                      base_q4 requiresWebGPU=true (resolver already routes
                                      no-WebGPU -> v2-base; the shipped fallback covers users).
A2 FAIL (q4 fails on WebGPU too)   -> model/export bug -> try a different q4 export or pin
                                      @huggingface/transformers + onnxruntime-web versions.
D1 PASS (main-thread OK)           -> worker payload/transfer bug -> fix the worker init/IO.
```

## Knobs required (dev/test-only experiment overrides — NOT shipped to users)

Today device + dtype are fixed (`PRIV_STT_V4.DEVICE=null`; variant `DTYPE`). The A/B needs
runtime overrides, gated EXACTLY like the existing `?privateEngine` override
(`isPrivateOverrideContextAllowed()` — dev/test/E2E only, never production):

```
STT_V4_DEVICE         = 'webgpu' | 'wasm' | 'auto'      # force getPreferredDevice()
STT_V4_DECODER_DTYPE  = 'q4' | 'q8' | 'int8' | 'fp32'   # override decoder_model_merged dtype
STT_V4_NO_WORKER      = '1'                              # force main-thread pipeline (no worker)
```

Minimal enabling change (engine `loadModel` → worker `init` message already carry model+dtype;
extend by ~10 lines, dev/test-gated):
1. `TransformersJSV4Engine.loadModel`: when in a dev/test context, read the 3 overrides and
   (a) override `v4Model.DTYPE.decoder_model_merged`, (b) pass a `device` hint in the init
   message, (c) bypass `shouldUseWorker()` if `STT_V4_NO_WORKER`.
2. `transformers-js-v4.worker.ts`: `getPreferredDevice()` honors an init-message `device`
   override before WebGPU detection; `init()` uses the overridden dtype (already threaded).
These are inert unless the override is set AND the context is dev/test (production unchanged).

## Run procedure (Test / a human — needs a real browser + the proof env)

For each cell, run the existing harness with the new knobs, e.g. cell B1:
```bash
STT_PRIVATE_ENGINE=transformers-js-v4 STT_V4_DEVICE=wasm STT_V4_DECODER_DTYPE=fp32 \
STT_MODES=private STT_FIXTURES=h1_6 STT_USE_FAKE_AUDIO_CAPTURE=true STT_FAKE_AUDIO_FILE=<wav> \
STT_AUTH=<storageState/creds> node scripts/manual-stt-corpus-proof.mjs
```
Record per cell: PASS/FAIL, the exact onnxruntime error (if any), firstTextMs, RTF.

## Guardrails

Experiment-only overrides are dev/test-gated (production unchanged); v2-base default unchanged;
no Stripe; the shipped AUTO-path fallback (`dev/v4-decode-fallback`) protects users regardless of
the outcome. The strict-override path stays strict so the experiment can see the real error.

## Status

DRAFT — matrix + knob design ready. Next: implement the 3 dev/test override knobs (~10 lines,
gated), then Test/a-human runs the matrix and we apply the indicated fix.
