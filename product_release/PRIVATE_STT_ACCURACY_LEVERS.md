# Private STT Accuracy & Latency Levers — Decision Doc

**Owner:** [unassigned] · **Status:** proposal for review · **Date:** 2026-06-01

> Scope note (agreed with STT test agent): **do NOT pull the model-upgrade lever
> until the browser mic-constraint boundary is settled.** The browser app is still
> worse than the browser drop-in on h1_6 (app 37.5% vs drop-in 75%); a model ceiling
> does not excuse an app-vs-drop-in gap. Lever order below reflects that.

## Reference baselines (what each number proves)

| Evidence | Value | Proves | Does NOT prove |
|---|---|---|---|
| Node full-WAV `whisper-tiny.en` (CPU) | 93.89% (WER 6.11%), dated 2026-06-02T00:19:51Z | Clean-file tiny.en model ceiling | Browser mic/app parity |
| Browser drop-in (same route) | ~83.14% | Same-route browser/mic comparator | Product lifecycle |
| SpeakSharp app focused run | varies; h1_6 = 37.5%, then 75%/25% in mic-constraint repeats | Product path behavior and repeat variability | Whether the gap is model-only or app-buffer/input related |

The Node ceiling is a **reference only**. It bypasses browser getUserMedia
constraints, mic DSP/AGC/noise-suppression, the app speech-start gate, chunk/
windowing, the whole-utterance buffer, and browser worker/runtime timing — so it
cannot, by itself, explain or close the live app-vs-drop-in gap.

## Lever 1 — Mic-constraint alignment (DO FIRST; gates everything else)

- **Hypothesis:** the live app-vs-drop-in gap is caused by mic DSP (echo
  cancellation / noise suppression / AGC) reshaping the signal before decode.
- **Current state:** the app ALREADY requests raw constraints by default
  (`echoCancellation/noiseSuppression/autoGainControl:false, channelCount:1`),
  matching the drop-in. A test-only toggle is shipped (`5c158a14`) to force the
  opposite for the A/B: `?privateMicConstraints=default` (browser DSP on);
  `=raw`/absent = current default. The mic path logs requested constraints AND the
  actual `MediaStreamTrack.getSettings()` Chrome applied.
- **Test agent A/B (live, their domain):**
  - A. app `?privateMicConstraints=default` (DSP on)
  - B. app `?privateMicConstraints=raw` (DSP off = current default)
  - C. drop-in raw
  - (D. optional: drop-in browser-default)
- **Decision rule:**
  - If B beats A and B ≈ C → DSP is the lever; the app already defaults to B, so
    confirm no regression and we're done — gap was constraints.
  - If A ≈ B and both trail C → NOT constraints; the app degrades audio elsewhere
    (gate / windowing / buffer / runtime) → localize that boundary next.
  - If B ≈ C and the live gap disappears → h1_6 was a stale/again-variable run.
- **Cost:** ~0 (toggle shipped). **Risk:** none (default-off).

### 2026-06-01 update from live h1_6 A/B

The first live A/B did **not** support a simple product-default mic-constraint
change:

| Variant | Observed h1_6 accuracy | Actual Chrome settings captured |
|---|---:|---|
| app raw | 75% once, 25% once | echo cancellation / noise suppression / AGC all `false` |
| app browser-default DSP | 75% twice | echo cancellation / noise suppression / AGC all `true` |

Interpretation:

```text
The toggle works and Chrome settings are now captured.
Raw constraints are not consistently better.
Browser-default DSP did not regress h1_6 in these repeats.
Do not change the product default from this data.
```

If h1_6 remains launch-blocking, the next useful evidence is a multi-repeat live
A/B plus final-decode input-buffer diagnostics, not a one-line mic-default change.

> **LATENCY DIRECTION (2026-06-30 owner ruling):** the 90s recording cap is **REJECTED for beta**;
> a full 5-min single recording with <30s post-stop is **REQUIRED pre-beta**. Levers 2–3 below are
> **secondary accelerators that do NOT clear that bar alone** on the default v2 path. The PRIMARY
> full-5-min path is **Moonshine v2 (streaming) prototype on a branch**; fallback is **segmented
> finalization** (decode only the unfinalized tail at Stop, design at `/private/tmp/SEGMENTATION_DESIGN.md`).
> See RELEASE_STATUS + BACKLOG.

## Lever 2 — Cross-origin isolation → WASM multithreading (LATENCY, not accuracy)

- **Effect:** speeds CPU decode (multi-threaded WASM, ≤4 threads), does NOT change accuracy.
- **Blocker:** requires `crossOriginIsolated === true` (COOP/COEP headers). Thread code
  (`wasmThreads.ts` + `transformers-js.worker.ts`) is shipped + guarded → **inert in prod
  (headers off).** The "Stripe.js blocks it" premise is **CONFIRMED STALE** (checkout is redirect-
  only, not embedded). **Layer-1 static audit (2026-06-30):** `index.html` has ZERO cross-origin
  embeds, fonts are system/self-hosted → the real `credentialless` targets are runtime loads:
  **#1 ORT WASM from jsDelivr** (worker never sets `wasmPaths`; self-host to remove) + PostHog/
  Supabase/Sentry fetch (Bearer/API-key → likely OK). **Multiplier ~2–2.5× UNMEASURED → ~32–36s/5min,
  still over 30s alone.** Remaining: live preview measurement (`crossOriginIsolated===true` + resources + decode speedup).
- **Order:** SECONDARY accelerator — does not substitute for the architecture fix above.

## Lever 3 — WebGPU acceleration (LATENCY)

- **Effect:** much faster decode on GPU-capable machines.
- **State (2026-06-30):** the WebGPU path is **v4** (`@huggingface/transformers`, flag-gated,
  internal/targeted only) — the legacy whisper-turbo promotion is retired/parked. **v2 (the DEFAULT
  engine) has NO WebGPU path at all** (CPU/WASM only, `transformers-js.worker.ts`). So GPU is NOT
  available to default / wave-1 external users; giving the default engine GPU means promoting v4
  or adding a v2-on-v4-runtime path (neither exists). base_q4 floor / distil_q4 accuracy tier.
- **Order:** helps only the flag-gated GPU subset, not the default CPU floor.

## Lever 4 — Model upgrade tiny.en → base.en / small.en (ACCURACY ceiling)

- **Effect:** the only lever that raises the 93.89% **model ceiling** (fixes genuine
  tiny.en errors like h1_6 "They→day", h1_8 "chewed→chooed").
- **Cost:** larger download + slower CPU decode; size/latency/quality tradeoff.
- **Order:** LAST. **Do not pull until Levers 1–3 are settled.** Per test agent: a
  bigger model does not excuse the app being worse than the same-model drop-in.

## Recommended sequence

1. If h1_6 remains launch-blocking, STT testing runs a multi-repeat live A/B using
   the shipped mic-constraint toggle and captured Chrome settings.
2. If stable app-side audio degradation is found, dev localizes that one boundary (gate /
   windowing / buffer) with a unit-proven fix.
3. Separately, pursue Lever 2 (isolation→threads) for CPU latency.
4. Lever 3 (WebGPU enablement UX) for GPU users.
5. Only then weigh Lever 4 (model upgrade) for the ceiling.
