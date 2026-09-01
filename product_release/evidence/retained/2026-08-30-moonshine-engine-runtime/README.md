# #1263 — the Moonshine engine on the REAL runtime

Produced by `scripts/probe-moonshine-engine-runtime.mts` at engine head `bcdd2d4c`.

## What this closes

Every unit test of `MoonshineStreamingEngine` injects a fake transcriber. That is correct for lifecycle
rules and useless for three questions, because a fake answers all of them by construction:

| Question | Why a fake cannot answer it |
| --- | --- |
| Does the **default loader** work? | The injected path never calls `Transcriber.load`, never reads the runtime's `ModelArch` enum, never fetches a byte. |
| Is the 3-second live window a **different transcript** from the final pass? | Against a fake returning `len:${audio.length}` the two differ trivially, proving nothing about decoding. |
| Does recorded audio **stay on the device**? | A fake issues no requests, so an egress assertion around it asserts nothing. |

It found a real defect: the loader indexed `ModelArch` with the engine's own token
(`MOONSHINE_STREAMING_MEDIUM`) rather than the runtime's member name (`MediumStreaming`), yielding
`undefined`. Fixed in `bcdd2d4c` with a CI-runnable binding test that needs no weights.

## Results — both arches PASS

Same engine bundle (`sha256 ebdb9269…`), 12.23 s of real 16 kHz speech fed as half-second frames.

| | SMALL | MEDIUM |
| --- | --- | --- |
| window @4.0 s fed | `Old beer lingers, a dash of pepper-spoiled` (8 words) | `All beer lingers. A dash of pepper spoils.` (8 words) |
| final, 12.23 s clip | 38 words | 38 words |
| components fetched | `small-streaming-en/quantized_26_07_30/*` | `medium-streaming-en/quantized_26_07_30/*` |
| requests with a body | 0 | 0 |
| off-origin requests | 7, all pinned | 7, all pinned |

The two arches fetch **different component sets** and produce **different transcripts** (`no trace of the
track` vs `no trace of the truck`) from one identical bundle — the arch binding is verified end to end at
the network layer, not merely asserted in a unit test.

The window transcript is a genuine 3-second span, not a truncation of the final: it begins mid-sentence
(`Old beer lingers`) where the final begins at `The stale smell of`.

## Audio egress

Every request was intercepted before it left the browser. Zero requests carried a body of any size, so no
audio was uploaded; the only off-origin requests were the seven pinned model components, each served from
the local cache **after** its SHA-256 matched `tests/fixtures/moonshine-asset-pins.json`. An unpinned,
missing or altered asset aborts the request and fails the run — there is no network fallback.

## Bounded limitations — read before citing this

1. **Model identity is not observable from the runtime.** `runtimeVersion` and `assetIdentity` are `null`
   in both runs: `@moonshine-ai/moonshine-wasm@0.1.5` exposes neither on the loaded transcriber. The
   engine reports `null` rather than inventing a value, which is correct, but it means a session record
   alone cannot prove which component set decoded. Here that identity comes from outside the engine — the
   fetched URLs and pin digests in these artifacts. **A human test that must attribute a transcript to a
   model needs that gap closed first.**
2. **Not a CI test.** The pinned components live in a 448 MB local `.hf-cache/external` that CI does not
   have. A test that silently skips when its evidence is absent is worse than none, so this is a probe
   producing a retained artifact. The CI-runnable slice is `moonshineArchBinding.test.ts`.
3. **One clip, read speech, one host.** This is a functional proof of the live path, not an accuracy
   measurement and not a device-matrix result. Accuracy remains the frozen-600 benchmark's question.
4. **No accuracy claim, no activation claim.** Nothing here selects, activates, or defaults any model.

## Reproduce

```
npx tsx scripts/probe-moonshine-engine-runtime.mts \
  --arch=MOONSHINE_STREAMING_SMALL \
  --cache=<repo containing .hf-cache/external> \
  --out=engine-runtime-small.json
```

Exit status is the verdict. `SHA256SUMS` covers both artifacts.
