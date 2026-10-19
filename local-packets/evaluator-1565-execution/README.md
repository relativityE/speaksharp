# #1565: real v2 BASE / v4 BASE q4 diagnostic execution

Completed 2026-10-19 at 01:49:28.807 UTC. **HOLD**, exit 2. Both real models decoded all six scheduled rows; no final-attempt initialization or decode failure. This is a three-clip, one-synthetic-speaker diagnostic, not the required 600-row qualification or a model-selection decision.

## Source and inputs

- Unchanged runner and engine source: `6846c01e27499d1e27d09d105434e9bddb3958fe`, preserved #1567 implementation. CLI retains current-main integration ownership.
- Existing baseline-v2-smoke, candidate-v4-base-q4-4.3.0, corpus-synthetic-smoke and device-local-wasm manifests under `tests/evidence/fixtures/model-evaluator/`. Their exact hashes are in the final report.
- Real Chromium 143.0.7499.4, Linux CPU/WASM. Mock auth configuration only; the E2E mock-model bridge was not set. Both adapters supplied observed execution identities and matching per-row PCM hashes.
- v2: `Xenova/whisper-base.en`, Xenova 2.17.2, asset digest `c7eaa6a9f8ccacbdafce2092d8e03752e2540acf0d4d87b01aebb05f6ba1d110`.
- v4: `onnx-community/whisper-base.en`, HuggingFace 4.3.0, fp32 encoder and q4 decoder, asset digest `19e79a9e383779a6763c9e766ccd4e3067d5481d6468164c4b86147ddb356644`.
- Seven v4 files fetched at immutable HF revision `51eefc0af78b103839eda9e7e4f4186acc6517fe`. Each matched the existing committed pin; see `v4-asset-verification.json`. The runner's observed revision remains null; the separate byte receipt must not be mistaken for an introspected runtime revision.

## Actual results

| Measure | v2 BASE | v4 BASE q4 |
|---|---:|---:|
| Successful decode rows | 6/6 | 6/6 |
| Unique clips / trials | 3 / 2 | 3 / 2 |
| Pooled WER | 20% | 10% |
| Reference words, including repeated trial | 80 | 80 |
| Substitutions / deletions / insertions | 4 / 2 / 10 | 2 / 2 / 4 |
| Clear-slice WER | 3.23% | 3.23% |
| Synthetic filler-slice WER | 77.78% | 33.33% |
| Reported median finalized decode latency | 11.182 s | 12.461 s |

Transcripts repeated identically within each arm across the two trials. The observed WER difference comes entirely from the single synthetic filler clip; it is not evidence of general superiority or statistical non-inferiority. Both arms reported zero in the shipping regex's total filler count for that clip, against reference total three (the separate key map includes `so:1`). This does not establish contextual filler usefulness.

Latency is an observation on this shared hosted CPU, not a qualified device or controlled performance result. Earlier diagnostic workloads overlapped part of setup/execution. AB/BA ordering and exact PCM pairing do not remove host contention or the tiny sample limitation.

## Execution plumbing and retained failures

No product, engine, decoder, manifest or comparator source was modified. The separately retained Node preload `pm-eval-local-transport.mjs` changes only asset transport and records diagnostics. It serves exactly pin-matched model bytes through a loopback HTTP cache and the installed ONNX Runtime Web 1.30.0 asyncify module/WASM through a bounded route. Runtime-file hashes are in `transport-evidence.jsonl`.

The original runner was executed under `scripts/host-interlock.mjs hold local`, with Node `--import tsx --import <transport-preload> scripts/model-evaluator/run.mts` and the existing four manifests. `PM_EVAL_CACHE_ORIGIN=http://127.0.0.1:5174`; Vite was loopback-only on 5173 with test-mode mock auth and `VITE_INTERNAL_BUILD=true`. Server and runner must share one execution context on this host. The preload records the exact original workspace layout; relocate its root explicitly when reproducing elsewhere. It is diagnostic transport, not a new evaluator implementation or a product patch.

Earlier reports a-e remain included rather than being overwritten:

1. a: browser could not reach a server started in a separate execution context.
2. b: Vite dependency optimization reloaded during v2 initialization; direct browser HF fetch failed for v4.
3. c/d: fulfilling the 123,600,371-byte decoder through Playwright exceeded Chrome's DevTools pipe capacity. Debug stderr stated `capacity=104857600, max_buffer_size=104857600` and `Connection closed, not enough capacity`. The corrected transport streams that file over local HTTP.
4. e: model transfer succeeded but direct CDN imports of ONNX Runtime 1.30.0 failed. The final attempt uses the matching installed runtime files.
5. f: both actual models initialized and decoded successfully; HOLD is for missing approved policy/product proof, not an execution failure.

The runtime also queried an unlisted quantized encoder while estimating metadata. That optional request received 404. Subsequent actual loading fetched the pinned fp32 encoder and q4 decoder successfully. The earlier suspicion of wrong inference precision is **not confirmed** and must not be presented as a product defect.

## Limits and next ownership

- No approved numeric policy was supplied; no thresholds were tuned from these results.
- Full licensed 600-clip execution, paired completeness validation, required natural/noisy/accent/long-take/Focus slices, predeclared cluster uncertainty and blind usefulness review remain open. Two trials of one speaker are not six independent samples.
- Model-only execution does not prove useful Open Mic or full/partial Focus journeys, human/device acceptance, release readiness or model activation.
- Cache/proxy transport invalidates public-network download or cold-cache interpretations. V4's worker acquisition receipt is explicitly partial (`requests_outside_scope`, network bytes null). The browser-level candidate byte counter is incomplete and must not be quoted as model size. Initialization time includes browser launch, validation and warm-up, not isolated loading.
- CLI owns integration of this retained runner with current main and the paired-evidence validator; PM owns acceptance worksheet/rubric corrections and independent review. Sam/PO retain dispositions and numeric-policy decisions.
- No Production journey, account operation, paid provider call, deployment, merge, migration or product activation was performed.

The final JSON is the primary receipt. `checksums.json` binds all packet files; it intentionally excludes itself.
