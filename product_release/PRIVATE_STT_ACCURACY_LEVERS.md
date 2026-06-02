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
| SpeakSharp app focused run | varies; h1_6 = 37.5% | Product path behavior | Whether the gap is model-only (no matched constraints yet) |

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

## Lever 2 — Cross-origin isolation → WASM multithreading (LATENCY, not accuracy)

- **Effect:** speeds CPU decode (multi-threaded WASM), does NOT change accuracy.
- **Blocker:** requires `crossOriginIsolated === true` (COOP/COEP headers). The P3
  thread code is shipped and guarded — currently inert in prod because headers were
  removed (the "Stripe.js" backlog item, now likely stale; see BACKLOG.md).
- **Order:** independent of accuracy; pursue for latency only after Lever 1 settles
  the accuracy boundary. Needs the header re-enablement + third-party validation.

## Lever 3 — WebGPU / whisper-turbo acceleration (LATENCY + maybe accuracy)

- **Effect:** much faster decode on GPU-capable machines; turbo may improve quality.
- **State:** dual-engine routing + WebGPU detection shipped; promotion gated on a
  cached turbo model (no surprise ~75MB download) → currently unreachable without a
  turbo-enablement UX (BACKLOG P1). GPU-only; CPU users unaffected.
- **Order:** after Lever 1; helps the GPU subset, not the CPU floor.

## Lever 4 — Model upgrade tiny.en → base.en / small.en (ACCURACY ceiling)

- **Effect:** the only lever that raises the 93.89% **model ceiling** (fixes genuine
  tiny.en errors like h1_6 "They→day", h1_8 "chewed→chooed").
- **Cost:** larger download + slower CPU decode; size/latency/quality tradeoff.
- **Order:** LAST. **Do not pull until Levers 1–3 are settled.** Per test agent: a
  bigger model does not excuse the app being worse than the same-model drop-in.

## Recommended sequence

1. Test agent runs Lever 1 A/B (toggle is ready). → classifies the gap.
2. If app-side audio degradation is found, dev localizes that one boundary (gate /
   windowing / buffer) with a unit-proven fix.
3. Separately, pursue Lever 2 (isolation→threads) for CPU latency.
4. Lever 3 (WebGPU enablement UX) for GPU users.
5. Only then weigh Lever 4 (model upgrade) for the ceiling.
