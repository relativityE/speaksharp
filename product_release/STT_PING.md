# STT Ping Log — tight dev⇄test feedback loop

This is the **fast channel**. It is **append-only**: never edit or delete a prior line,
never rewrite another agent's text. One line per signal, newest at the bottom.

- **Durable state** stays in `CURRENT_WORK.md` (thin index: owner / branch@SHA / status).
- **Evidence/detail** stays in the STT reports (proof recipes, artifacts, numbers).
- **This file** is just the back-and-forth so neither side has to re-parse a giant board cell
  to learn "what do I do next, and whose ball is it."

## Rules

1. **Append, don't rewrite.** Add a line; never touch existing lines or each other's board cells.
2. **One handoff = one testable claim.** A REQ names exactly one branch@SHA, the exact command,
   and the single expected result. Test replies with one RESULT (PASS/FAIL + the one delta).
3. **Check before you build.** Before starting work on an ID, read its latest line here. If the
   ball isn't yours, don't touch it. (This is the rule that stops crossed work.)
4. **Every line ends with the ball.** `=> test` or `=> dev` or `=> product`.

## Line format

```
<ISO8601-UTC> | <from>→<to> | <ID> | <KIND> | <branch@sha | —> | <one line> => <ball>
```

`KIND` ∈ `REQ` (please test/decide) · `RESULT` (pass/fail) · `ACK` · `BLOCKED` · `NOTE` · `DONE`.

## Log

```
2026-06-04T20:05Z | dev→test | STT-P6  | REQ    | dev/private-model-eval-main@7c04064a | candidate load FIXED (remote-only + onnx-community ids + fail-fast). Run model A/B per report run-spec (tiny/base.en/distil-small.en). TOP PRIORITY. => test
2026-06-04T20:05Z | dev→test | STT-P5  | NOTE   | dev/private-vad-silero-main@52cc2034   | asset+dep staged & ready, but VAD A/B DEFERRED until after STT-P6 per product. Do not run yet. => test
2026-06-04T20:05Z | dev→prod | STT-P8  | NOTE   | dev/private-resampler-parity@58d9ba7d  | your A/B: no WER lift, but timing win (first-text 5879→3355ms) + no regression. Product call = ship as timing-only. Awaiting merge approval. => product
2026-06-04T20:05Z | dev→test | STT-P1D | DONE   | dev/private-p1d-complete@f846d560      | filler fix + display dedup kept; reverted unsafe 2× collapse (would delete genuine repeats). 2× loop routed to STT-P6. No further dev action. => test (optional re-proof)
2026-06-04T20:05Z | dev→test | STT-P7  | NOTE   | dev/stt-p7-soft-frozen-trace@30eb264a  | injected smoke passed (no lifecycle fail / no Engine-Frozen toast). Awaiting human mic re-proof. => test
2026-06-04T23:35Z | test→dev | STT-P6  | RESULT | test/stt-p6-model-ab@2375c1e0          | FAIL: tiny works (h1_6 87.5%, load 739ms), but base/distil both fail before recording with MODEL_LOAD_FAILED [... -> onnx-community/...]: Unsupported model type: whisper. Artifacts: /private/tmp/stt-p6-ab-{tiny,base,distil}-h1_6.json. => dev
2026-06-05T00:10Z | dev→test | STT-P6  | REQ    | dev/private-model-eval-main@6defae00   | ROOT CAUSE: onnx-community/* is transformers.js v3 format → fails on @xenova v2 ("Unsupported model type"). FIX: candidate ids reverted to Xenova/* (v2-native); distil-small.en is v3-only → replaced with whisper-small.en (Xenova/whisper-small.en, ~244MB). Re-run A/B: candidates now tiny/base.en/**small.en** (NOT distil). tsc clean, 5/5. => test
2026-06-05T00:40Z | test→dev | STT-P6  | RESULT | test/stt-p6-model-ab-2@31c5da3e        | h1_6 PASS/PARTIAL: tiny 87.5% (load 702ms), base.en 100% (load 1613ms, finalize 4604ms), small.en 87.5% with bad first word + very slow finalize 46728ms. Base is promising; small should not ship. Expanding base to more fixtures. => test
2026-06-05T00:49Z | test→dev | STT-P6  | RESULT | test/stt-p6-model-ab-2-clean@70e8c0d5  | DONE: base.en holds h1_2/h1_8/h1_10 at 100% and improves h1_6 87.5→100; Washington 98.95→99.48 but first text 2.8→7.9s and finalize 11.3→22.0s. small.en rejected (87.5%, 46.7s finalize). => product
2026-06-05T01:10Z | dev→test | STT-V4R | REQ    | dev/v4-recovery@f2274628               | NEW separate track (NOT release). Phase-1 standalone v4 decode probe built. pnpm dev (5174); open /v4-decode-probe.html?wav=<harvard.wav>&encoder=fp32&decoder=q8&device=wasm (START with q8, NOT q4). Run Phase-2 matrix; capture __V4_PROBE_RESULT__ (transcript OR exact error + meta.ortVersions). Goal: ONE non-empty browser transcript. See product_release/V4_RECOVERY.md. => test
2026-06-05T02:00Z | dev→test | STT-P1  | REQ    | dev/stt-p1-filler-recount@c5b55f5b     | Standalone filler fix (decoupled from P1D). Save path now re-counts fillers from the final transcript instead of stale store.fillerData. Re-run current-main filler proof: a saved "Umm" must report um>=1 (was um:0). tsc clean, sessionAnalysis 10/10. => test
2026-06-05T02:20Z | dev→test | STT-P5  | REQ    | dev/private-vad-silero-main@b88b027f   | FIXED the RMS fallback: ORT wasm now served at /onnxruntime/ (vite-static-copy, serves in dev) + ort.env.wasm.wasmPaths set + numThreads=1 (app not cross-origin-isolated). Re-run RMS-vs-VAD A/B (?privateVad=1) — expect __PRIVATE_VAD_TELEMETRY__.vadFellBackToRms=FALSE. tsc clean, 49/49. => test
2026-06-05T03:42Z | test→dev | STT-V4R | RESULT | test/stt-v4r-probe@f2274628            | FAIL: standalone WASM browser probe produced NO non-empty transcript. fp32/q8 and q8/q8 fail session creation with `Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale`; fp32/q4 reproduces `invalid data location: undefined for input "a"`. Artifact `/private/tmp/stt-v4r-wasm-matrix.json`. => dev
2026-06-05T03:50Z | test→dev | STT-P1  | RESULT | test/stt-p1-filler-recount@c5b55f5b    | PASS: conv_01 saved `Um, basically, we should literally like, wait.` WER 0 / accuracy 100; observedFillers `um=1 basically=1 literally=1 like=1`; detail transcript matches; environmentProof valid 5174 real auth. Artifact `/private/tmp/stt-p1-filler-recount-conv_01.json`. => dev
2026-06-05T03:10Z | dev→test | STT-V4R | REQ    | dev/v4-recovery@6f5f028b               | Node smoke PROVES model+dtype decode (fp32/q8, q8/q8, fp32/q4 all correct in onnxruntime-NODE) -> browser failure is onnxruntime-WEB only. Probe now defaults single-thread/no-proxy (the likely fix). Run /v4-decode-probe.html?wav=<16k>&decoder=q8&device=wasm; capture __V4_PROBE_RESULT__. => test
2026-06-05T03:10Z | dev→test | STT-P6  | NOTE   | dev/private-model-eval-main@4105f475   | Lane B: model telemetry enriched (runtime, selectionSource, fallbackPath, cloudFallbackAttempted:false). Observability-only, NO behavior change (tiny default; base/small flag-only; Xenova-only ids). Use in the base.en RC proof. => test
2026-06-05T04:02Z | test→dev | STT-P5  | RESULT | test/stt-p5-vad-rerun@b88b027f         | FAIL: corrected harness set `?privateVad=1` and artifact shows `vadEnabled:true`, but `vadFellBackToRms:true`, `vadRuntimeVersion:null`, no speech probabilities. `/onnxruntime/*.wasm` serves OK, but `/onnxruntime/ort-wasm-simd-threaded.jsep.mjs?import` returns SPA HTML / aborts. Artifacts `/private/tmp/stt-p5-{rms-h1_6,vad-h1_6-telemetry}.json`; harness patch used `/private/tmp/stt-p5-harness-vad-flag.patch`. => dev
2026-06-05T04:06Z | test→dev | STT-V4R | RESULT | test/stt-v4r-single-thread@6f5f028b     | FAIL: browser still produces NO non-empty transcript with single-thread/no-proxy (`numThreads:1`, `proxy:false`). fp32/q8 and q8/q8 still fail missing decoder scale; fp32/q4 still fails `invalid data location: undefined for input "a"`. Artifact `/private/tmp/stt-v4r-singlethread-matrix.json`. => dev
```
