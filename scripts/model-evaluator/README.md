# Model evaluator (#1565)

## Shared candidate adoption

The application and `candidate-browser.ts` construct the same `PrivateSTT` facade.
The existing registry carries model/runtime/revision/pins/backend/precision and
typed profiles; algorithms live in the Whisper, Granite CTC and Parakeet TDT adapters.
Once an internal comparison build is configured with
`acknowledgeNotProductionReady: true`, model selection is the single `candidate`
line in `frontend/src/config/private-stt.config.json`. The checked-in production
default remains `v2:base.en` and unqualified candidates still fail production boot.

The literal selection diff in that file is one line:

```diff
-  "candidate": "v2:base.en"
+  "candidate": "granite:turboctc-q4f16"
```

Or replace the same line with `"candidate": "parakeet:tdt-v3:int8"`.
The internal-build acknowledgement is a prerequisite, not permission to promote
a candidate. This change selects a **registered compatible** candidate; a new
architecture can require a new typed adapter. Keep the production configuration
at `v2:base.en` until the owner separately approves promotion.

| Candidate | Configured runtime | Evaluation backend |
| --- | --- | --- |
| `v2:base.en` | Xenova Transformers.js 2.17.2 | WASM |
| `v4:base:q4` | Hugging Face Transformers.js 4.3.0 | Explicit WASM or WebGPU |
| `granite:turboctc-q4f16` | Pinned IBM export / ORT Web 1.26.0 | Explicit WASM or WebGPU |
| `parakeet:tdt-v3:int8` | Published parakeet.js 1.4.4 / ORT Web 1.24.1 | WASM/int8 |

For the account-free model-only page, start the existing test server with
`VITE_INTERNAL_BUILD=true` in addition to the disposable mock configuration below,
then open `/model-evaluator.local.html`. Its one-line acquisition call is:

```js
await window.__MODEL_EVALUATOR__.initialize('parakeet:tdt-v3:int8', 'wasm', true);
```

The final `true` explicitly consents to the descriptor's possible download.
The evaluator calls the same `checkAvailability` and `grantModelConsent` facade
methods as the product. In a `candidate-browser` adapter manifest set
`adapterOptions.candidateId` to the selected registry ID and `adapterOptions.consentToDownload`
to `true` after approving that acquisition. Changing the candidate ID then uses
the same path. Missing consent fails before acquisition when consent is required.
Parakeet's full pinned inventory is 682,972,569 bytes; Granite's is 339,374,194 bytes.

The checked-in `baseline-shared-v2.json`, `candidate-granite-turboctc.json` and
`candidate-parakeet-tdt-v3.json` manifests all use this shared facade adapter.
They keep `consentToDownload: false`: setting it to true requires specific prior
approval of acquisition, including source, size, destination and cost. Consent
is not an offline-network guarantee; only run with an already verified cache or
an approved acquisition. Missing cached assets must not trigger an unannounced
download. The adapter explicitly launches **installed Google Chrome** in a fresh
automation context, with sandboxing enabled. It does not install Chrome, use a
personal profile, or fall back to a bundled browser. Browser changes require
separate approval.

## Command-line and shared SpeakSharp modes

Use the existing frozen dependency tree matching `pnpm-lock.yaml`, Node 22.12.0,
pnpm 10.29.1 and installed Chrome. A clean checkout alone does not include ignored
speech weights or dependencies. Obtain approval before installing dependencies
(including offline linking) or downloading missing models/runtimes; verify each
registered inventory's SHA-256 and bytes. Preserve the separate pinned runtimes
in the table below. No account, credential, paid provider or UI login is needed
for the model-only CLI/page. Product Start/Stop/save/Focus proof is a separate
journey and must use the approved Track A campaign and source/model binding.

After setup, start the existing server with disposable mock values:

```sh
VITE_INTERNAL_BUILD=true VITE_SUPABASE_URL=https://localhost.invalid \
VITE_SUPABASE_ANON_KEY=mock_eval VITE_AUTH_MODE=mock pnpm dev:test
```

Invoke the existing command-line runner (fresh output paths are required):

```sh
pnpm model:evaluate \
  --baseline tests/evidence/fixtures/model-evaluator/baseline-shared-v2.json \
  --candidate tests/evidence/fixtures/model-evaluator/candidate-granite-turboctc.json \
  --corpus tests/evidence/fixtures/model-evaluator/corpus-synthetic-smoke.json \
  --device tests/evidence/fixtures/model-evaluator/device-local-wasm.json \
  --out /tmp/granite-shared-report.json
```

Change only the candidate manifest argument to `candidate-parakeet-tdt-v3.json`
for Parakeet or to `baseline-shared-v2.json` for baseline-versus-baseline, with a
different `--out` each time. This CLI launches the internal SpeakSharp page and
calls its shared `PrivateSTT` path; it is not a second decoder implementation.
The same initialized page can be inspected directly at
`/model-evaluator.local.html` with the call documented below. No authenticated
product journey is implied by that model-only page.

On a shared host, the server **and** evaluator must run within the existing
host-wide interlock from the coordinator's absolute cwd. The child explicitly
targets this checkout (for example, `pnpm --dir <checkout> model:evaluate ...`).
Do not acquire a worktree-local lock and call it host-wide. Coordinate the slot
with Track A; if the coordinator is inaccessible or occupied, hold execution.

Each report retains the manifest and WAV/PCM hash bindings, complete trial rows,
per-input corpus scores, raw runtime observations, observed Chrome version, and
configured identity provenance. `observed` is a compatibility identity;
`adapterExecutionEvidence.runtimeObservation` preserves the facade's actual
observations, including an unknown model ID. Pinned metadata is not introspected
weight identity. `adapterInitializeMs` covers the whole attempt;
`adapterExecutionEvidence.timings` separates completed pin verification, browser
launch, page readiness and facade initialization. Facade initialization includes
acquisition and warmup, so it is not pure model loading. Decode/final latency is
separate on each input. Unavailable measurements stay null/unavailable.

WER uses the existing Track A normalizer and `(S + D + I) / N`, pooled by reference
word count. Track A removes fillers; the separate raw-text filler counts do not
prove acoustically annotated filler accuracy. Complete failure rows remain in
the population; an adapter/retirement failure makes the run FAIL even after good
decodes. Without approved policy and full product/metric proof, a successful
synthetic smoke remains HOLD (exit 2), never model promotion. FAIL exits 1.

The frozen package lock is unchanged. Parakeet's unchanged published MIT source
and exact ORT browser inputs are retained under
`frontend/public/models/parakeet-runtime/1.4.4-ort1.24.1/source/`.
Reproduce its single-module binding with
`node scripts/model-evaluator/build-parakeet-runtime.mjs`; verify the real native
worker/runtime with `node scripts/model-evaluator/parakeet-runtime.smoke.mjs`.
That smoke uses a tiny Identity graph and proves runtime loading, the same ORT
singleton and the real 128-bin frontend. It does not qualify speech recognition.
The Parakeet worker requires real recurrent TDT tensor/duration/state warmups
before publishing READY; Granite requires its CTC warmup. Both reject fallback.

Full candidate-weight/corpus and product journey qualification belong to Eval.
`activationReady` and production `comparisonReady` remain false for Granite and
Parakeet. Consolidating Whisper onto one runtime follows successful shared-path
qualification; both current locked Whisper runtimes remain until that evidence.

`pnpm model:evaluate` runs a **model-only corpus lane**. It does not change the product selector, activate a model, or prove an Open Mic/Focus journey. The old `benchmark-v4.live.spec.ts` remains disabled because its retired selector and fake microphone timing cannot qualify a candidate. Today the checked-in product default is v2; v4 is optional, with a roadmap toward v4 primary and v2 backup. The evaluator does not encode that roadmap as an activation decision.

The command accepts versioned baseline, candidate, corpus, and device manifests. A model-specific adapter implements `initialize`, `decode`, `finalize`, and `dispose` in `adapter.ts`. The runner reads each WAV once, verifies WAV and Float32 PCM SHA256, gives the same PCM samples and boundaries to each arm, and alternates AB/BA order across trials. It writes one JSON report with manifest hashes and refuses to overwrite an existing path. Missing policy yields HOLD. A candidate's observed model/runtime/assets/backend must match its manifest; a silent v4→v2 fallback fails.

The corpus manifest must explicitly declare integer `trials >= 2`. Before adapter execution, the runner freezes the independent corpus × trials population with raw-reference SHA256, Track-A reference-word count and speaker cluster. It attaches that identity at dispatch and calls the accepted paired-evidence validator before comparison. Missing/duplicate/substituted rows, including the same omitted final trial in both arms, leave statistics unavailable and acceptance HOLD. Complete failed-trial rows and observed identities remain in the immutable report; disposal rejections are retained in `inputFailures`. Completeness is separate from quality, acoustic annotation, trial adequacy and policy approval.

**Retained legacy smoke manifests are outside the current qualification route.**
`baseline-v2-smoke.json` and `candidate-v2-smoke.json` select the unchanged
`private-v2-browser.ts` adapter. It uses the bare-runtime `/private-dropin.html`
page and bundled Playwright Chromium, rather than the shared `PrivateSTT` facade
and explicitly installed Chrome. These historical artifacts do not qualify the
current shared path and are not the permitted current-task run. Their presence
does not authorize that browser or execution.

For the current shared-facade baseline-versus-baseline smoke, use
`baseline-shared-v2.json` for **both** arm arguments in the command documented
under "Command-line and shared SpeakSharp modes", with a fresh output path and
the documented setup, consent and shared-host interlock prerequisites.

Using the same shared baseline manifest in both arms proves adapter execution and baseline-vs-baseline mechanics, not candidate non-inferiority. The three synthetic WAVs are one speaker cluster, lack required noisy/accented/long-take/Focus slices, and have no approved numeric policy; a successful smoke therefore returns HOLD (exit code 2). FAIL exits 1. This first increment never emits an overall PASS: even if its model-only comparison passes, missing product-path and required metrics hold acceptance. A report's transcript content is from public synthetic fixtures only; do not publish private recordings or user transcripts.

The requested first comparison is v2 BASE against explicitly pinned v4 BASE q4 on WASM. Retained manifests also cover distil and Moonshine; retaining them does not select those alternatives. WebGPU is a separate real-device run. A mixed-backend device manifest names each arm's backend and requires a headed browser plus a checked GPU vendor for WebGPU. Their local browser adapter uses `model-evaluator.local.html`, a dev-server-only page excluded from Vite's production build input; it requires `VITE_INTERNAL_BUILD=true`. Current main already pins `@huggingface/transformers@4.3.0` through merged #1592; the adapter still verifies the actual running package rather than treating the source pin as runtime evidence. The adapter recomputes v4's committed pin-set digest but does not yet verify each downloaded response body, so that proof remains outstanding. V4 activation remains separate. Moonshine's runtime does not introspect model ID or revision: those fields come from checked-in pins, while init/decode/backend are observed. Its pinned asset loader hashes downloaded files before giving them to the runtime.

Current scope: pooled and per-slice WER, paired cluster-bootstrap upper bounds, model/input identity, finalized decode latency, audio duration and real-time factor. Each completed transcript records the shipping coachable-filler regex count, the same count on its human reference, and detected keys. This is **final-transcript detection**, not a human-annotated contextual filler score or the product's interim/final counting path.

Filler counting consumes raw final strings before Track-A normalization. Known-string controls distinguish coachable um/uh totals from all-key discourse-marker counts (for example `so`). The retained diagnostic finals already omit um/uh. Audible um/uh in the exact hash-bound input must be verified before assigning that loss to decoding; a written TTS reference alone does not prove acoustic realization.

This successor reconciles retained #1567 source `6846c01e` with current main and accepted validator `0e1be5a5`; it is the sole #1565 integration route. Latest Research `6bab65f` portable source/API/READINESS/69-test delta remains unverified and is not claimed integrated. The repository also records older Library v3 `254b8af5`/53 tests and historical `04cc204c`/31 tests; neither substitutes for that latest delta. PM preparation `ed919f52` is a proposal, not numeric approval. Its zero-reference/silence, failure-denominator, speaker-block/familywise and required-slice rules still need explicit statistical integration before full qualification. The legacy comparator is retained with those limitations, not certified by these new completeness tests.

The browser adapters disable the page's HTTP cache and record model-asset response bytes and the request window visible to Playwright. Dedicated-worker cache state is unproven, and a v4 worker can fetch assets absent from that browser-level counter. For v4, use the separate `workerAcquisition` receipt for model fetch time and coverage; its `completeness`, `reasonCode`, and `unobservableReason` must accompany any reported number. Cross-origin responses without Timing-Allow-Origin can hide byte sizes, so null bytes are not zero. Neither request window isolates network transfer from gaps between requests. Total adapter initialization includes browser launch and asset verification, including elapsed time on failed attempts; it is **not** pure model-load time.

The runner marks first useful partial, isolated cold model load, persistent cache size, browser/worker memory, and product start-stop-next-take as unavailable. Focus keyword coverage, a complete multi-speaker/slice corpus, and separate Open Mic/Focus browser proof remain required before accepting a model. A corpus assembled only from the smoke fixtures cannot produce PASS. Policy margins require Product Owner acceptance before a real candidate run; do not tune them from observed results.
