# Moonshine v2 streaming — three-lead RECOVERY probe (Branch A, #891)

**Verdict (precise): Moonshine v2 is NOT blocked by model architecture. It is blocked for beta by the absence of a browser-runnable STATEFUL streaming runtime in the paths checked.** (Artifact-level, 2026-06-30.)

## Disposition (precise close/keep-open)
- **CLOSE** the HF / transformers.js / available-ONNX path — no streaming model class (4.2.0=latest) + the export has no state I/O.
- **CLOSE MoonshineJS** as a beta alternative — it is Moonshine **v1** (`model/tiny`) + VAD = *simulated* streaming, not v2 true streaming. (Useful later only as a UX/API reference, not the v2 solution.)
- **CLOSE sherpa-onnx WASM** as a beta alternative — its Moonshine v2 path is **non-streaming/offline** ASR + VAD, not stateful streaming.
- **KEEP OPEN: official Moonshine Voice** as the FUTURE architecture — it has true streaming/caching (`add_audio`, decoder-state caching), but is native (C++/mobile/desktop) with no browser/WASM target.
- **Future unblocker (one concrete item):** a browser/WASM port of the official Moonshine Voice stateful streaming runtime, OR an upstream stateful web runtime from Moonshine AI. Until then, v2 cannot gate beta.

| Lead | Browser-runnable? | True v2 streaming? | What it actually is |
|---|---|---|---|
| **MoonshineJS** (`@moonshine-ai/moonshine-js@0.1.29`) | ✅ yes | ❌ no | Loads `"model/tiny"` = **Moonshine v1** + `@ricky0123/vad-web` + `@huggingface/transformers ^3.3.3` (batch, no streaming class). "Streaming mode" just disables VAD and re-runs the **non-streaming** model on the growing buffer → same long-audio blowup. = **v1 + simulated streaming.** |
| **sherpa-onnx** | ✅ yes (WASM exists) | ❌ no | ONNX = `preprocess / encode / uncached_decode / cached_decode` — classic **non-streaming** batch enc-dec (no state I/O), run as Offline recognizer + VAD. Node README labels Moonshine v2 "non-streaming"; issue #3471 = v2 crashes >10s (must VAD-bound). = **non-streaming + simulated streaming.** |
| **Official `moonshine-ai/moonshine`** | ❌ no | ✅ yes | Examples = android/c++/ios/macos/python/raspberry-pi/windows; **no web/wasm**, README never mentions browser. True streaming (caching/`add_audio`/decoder-state) lives in the **native C++ core only** → needs a C++→WASM port. |

## The strategic insight
**Every browser-available Moonshine option is VAD + non-streaming model = simulated streaming — the SAME architectural class as our Whisper segmentation** (segment at pauses → decode each → assemble). So the real beta choice is NOT "Moonshine v2 streaming vs Whisper segmentation." The three buckets are:

1. **True Moonshine v2 streaming** = C++→WASM port of the official runtime (or transformers.js adding the streaming class + a stateful ONNX re-export). Weeks, research-grade. **NOT beta.** The genuine future architecture.
2. **Ready-made browser Moonshine** (MoonshineJS / sherpa-WASM) = simulated streaming, **v1 / non-streaming** model. Ready-made, but: v1-tiny accuracy (< whisper-base.en), owns-the-mic integration, loop risk on long buffers, and the downstream contract (visible-final == saved History, analytics/WPM/filler/PDF) is unproven through a 3rd-party lib.
3. **Our Whisper segmentation** = simulated streaming, whisper-base.en, **we build it**: full control of the downstream contract, proven model robustness (Whisper's forced 30s chunking), Phase-1 already proven (~2-6s stop-to-final, 100% recall).

## Recommendation
**Whisper segmentation stays the beta path.** The ready-made Moonshine libs offer no true-streaming advantage (they're segmentation-class too) while adding v1-quality + integration + downstream-contract risk that outweighs the build savings. Document **Moonshine v2 true streaming** as the future upgrade, gated on a browser-runnable stateful runtime (C++→WASM port OR transformers.js streaming class + stateful re-export).

**Open option (owner's call):** if minimizing our STT build matters more than model quality/control, a strictly-timeboxed MoonshineJS browser spike (measure TTFT/cadence/Stop-to-final/5-min/loop + test the downstream-contract fit) is a legitimate alternative to building Whisper segmentation — with the v1/integration/contract caveats above.
