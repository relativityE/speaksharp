# SHA-256 manifest — #1304 selection evidence

Every artifact below is retained verbatim. Rejected and invalid runs are part of the audit trail
and are NOT deleted.

## Provenance

| Field | Value |
|---|---|
| Execution tree (frozen 600) | `3efbcab402fe85e619c7e192b5dfb9b5a518d216` |
| Product baseline | `0e2fffd16224063e18b40174d92393632f1c1e47` |
| Frozen policy authority | `07b49c0027d8c84ca910e1a83f811c0b4acda4bc` |
| Corpus digest | `1f6af011d135b6804f9499da1a2798d0` |
| Normalizer identity | `09217ac31b887ed696f95c1c5d3da579` |
| Registry digest | `7e1c16813a113da4db311295b4f15d0b` |
| Asset digest | `e6466952fd89264001f92b86f4ea6559` |
| Quiet-rerun tree | `527bd179` |

## Checksums

```
38be1a9bac1d555223b0486449ddff306695c045b82b917463351bebc538b797  ./diagnostic/browser-parity.moonshine_base.probe.json
922b1efb49322a919b2211d840e7037bcd6a6b555635b3a39ad9f667fd27bf9f  ./diagnostic/browser-parity.moonshine_tiny.probe.json
d8463bff6fe91ddbd3ad74b1ea686e867126368c96b3ff9b29ade342acbf175e  ./diagnostic/upstream-parity.json
02003df9bf63293f4aa7bd095715cf5aafd7c2f1557bc4aebe1166653f9cc08f  ./frozen-600-selection-3efbcab4.json
b695969fbbbaa46b0b79cbd3893858aeb1cb0ac3d03b0210aaebca9afd9b8b58  ./frozen-600-selection-3efbcab4.log
da306592842a7bc62d7818008763da7f8ba9adcfac7f24bf62828cd25937696e  ./invalid/frozen-600-STOPPED-diagnostic.log
74995733a5fc4c12137152d551cda96ab8547511106991811df4e94387ab67d3  ./invalid/v2-quiet-rerun.log
2abfe47dc3275bb61ed8bf6551e6ebb7b4c186435c382fb6bb1c28c6f7483a86  ./invalid/v2-timing-quiet-rerun-3efbcab4.partial.json
5e84f5bdeec966f5f5ed16491ed227bddaabc477ee47eff62595979d739a2519  ./moonshine-determinism-confirm-3efbcab4.json
af64af3890babd937d87e4b3dd65c648d00a9bad9fa312e4c55d05fa5479cd8b  ./run-environment.txt
d53be1004bf9cd90eb1a99cd05e8d26b9702bbf95143dab469b4e69c0538b1f1  ./v2-timing-quiet-527bd179.json
da5e2c0c7c193c1a903b9b0deb3933ae3d9031e40de225c8c92872caea9aa2f0  ./v2-timing-quiet-527bd179.log
```

## Dispositions

| Artifact | Class | Disposition |
|---|---|---|
| `frozen-600-selection-3efbcab4.json` | selection | **Canonical.** 15 rows: 8 scored, 2 unscoreable, 5 preserved-not-executed. |
| `moonshine-determinism-confirm-3efbcab4.json` | selection | Confirms tiny/base empty-output reproduces exactly; 0 per-utterance differences across 600. |
| `v2-timing-quiet-527bd179.json` | selection | **Replaces timing only** for v2 tiny/base. Score-equivalent: 0 per-utterance S/D/I differences, WER identical. |
| `invalid/v2-timing-quiet-rerun-3efbcab4.partial.json` | **INVALID** | `invalid_resource_pressure_suspected`. 148 throws; cause unassignable because decode-failure messages were not serialized at the time. Never resumed. |
| `invalid/frozen-600-STOPPED-diagnostic.log` | **DIAGNOSTIC** | Log of the stopped uncheckpointed run. Results are diagnostic, never selection evidence. |
| `diagnostic/upstream-parity.json` | diagnostic | Node/onnxruntime-node comparison under a parity manifest. **Ran before the evidence-first preconditions landed**, so not offered as closure evidence. |
| `diagnostic/browser-parity.*.probe.json` | diagnostic | Uncertified route probes. `selectionEligible: false` by construction. |

## Known gaps in the canonical artifact

- `clipOutcomes` were **not** serialized, so p50/p95/RTF cannot be independently recomputed for the eight originally-measured arms.
- The per-arm `assets` map was **not** serialized, so `modelBytes` cannot be decomposed by file. This is why v4-q4-wasm's 233.1 MB against a registered 142 MB is unresolvable from this artifact.
- Both are fixed on the current tree; neither is retro-fixable for these rows.
- Decode-failure messages were not serialized, so the 148-throw run's cause cannot be assigned.
