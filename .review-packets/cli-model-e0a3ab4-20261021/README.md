# CLI retained model review snapshot — NOT A RELEASE CANDIDATE

Original local head: e0a3ab434c42bf50d4c7b7be416bfe22f0606686
Exact original tree: e8a657ece10abee0ee1afc6aac0736612b96ab1d
Original branch: cli-dev/1304-product-model-interfaces-20261020
Reconstruction base (published main): 724c2e9dc18754390d41564194c768fe2e37adf0
Complete full-index binary patch: source-from-724.patch.gz.b64
Decoded patch SHA256: 00b9252360ff9a0904d3da655ceba944ece38509d9d2091d84b843dd45a5cebd
Decoded patch bytes: 655479

This source archive preserves the entire retained tree, including historical unrelated ancestry. Do not merge it or treat it as a current-main product increment. Review only the selected model paths; later implementation must retain fresh-main boundaries. No PR, runtime dispatch, deployment, activation or source-writer transfer accompanies this archive.

Reconstruct ONLY in a disposable review checkout of base724:
1. Decode source-from-724.patch.gz.b64 as base64 then gzip to source.patch.
2. Verify decoded patch SHA256/length above.
3. Apply source.patch with git apply --index.
4. git write-tree MUST equal e8a657ece10abee0ee1afc6aac0736612b96ab1d.
The archive commit is a transport commit, NOT original e0a3ab4. Original raw commit objects/merge provenance remain in #1304 comment6304538481.

LLM implemented source: optional internal-only Llama provider, saved-context preparation/commit/readback contracts, cancellation/consent/owner boundaries, pinned model/asset and worker transport. Current adapter is WebLLM0.2.86, Llama3.2-1B MLC revision2a37b0a5ecb622d51ddc2fac74de0b95872affd7. wllama3.8.1/SmolLM2 are NOT implemented on this source. Do not imply external availability or device suitability.
LLM actually executed: zero real Llama/Gemini output pairs on this exact source. Useful, grounded, accurate, actionable suggestions and actual product inference remain unproven.

STT implemented source: Moonshine Base adapter through existing PrivateSTT factory/worker route, immutable assets, segmentation/Stop/EOF and shared model unload receipt integration. App's shared530d source is unchanged by CLI. This is distinct from retained Moonshine medium streaming work and STT evaluator863fc0d2/Transformers4.3.0. Transformers4.3.1 WIP is NOT installed/qualified.
STT actually executed on exacte0a3ab4:154 offline/synthetic controls and full quality PASS; no real-audio model inference, device latency/memory, streaming fidelity, finalization/save/review proof on this head. Historical model observations do not qualify this source. Streaming is a UX preference; reliable fidelity/response/final review decides.

Relevant source:
frontend/src/services/coaching/{provider.ts,llamaProvider.ts,provider.test.ts}
frontend/src/components/session/AISuggestions.tsx
backend/supabase/functions/_shared/{coachingContract.ts,coaching.config.json}
backend/supabase/functions/get-ai-suggestions/{index.ts,index.test.ts,contract.json}
backend/supabase/migrations/20261020102859_local_coaching_authority.sql
frontend/src/services/{modelRuntimeWorker.ts,modelRuntime.worker.ts,modelAssetLoader.ts,modelAssetCatalog.ts}
frontend/src/services/transcription/{candidateRegistry.ts,engines/PrivateSTT.ts,engines/MoonshineWebEngine.ts}
frontend/src/services/transcription/engines/__tests__/MoonshineWebEngine*
frontend/src/contracts/{STTEngine.ts,ModelUnloadReceipt.ts}
frontend/src/services/__tests__/engineUnloadReceipt.test.ts
scripts/model-evaluator/{run.mts,paired-run.ts,adapters/moonshine-web-browser.ts}

Qualification provenance: #1304/6304538481;154 focused PASS session21715, full pnpm quality PASS session70513 on exacte0. Synthetic workers, no model downloads/inference. This bounded receipt pass is not blanket acceptance of all source inherited by the branch.

Current offline LLM preflight:
preflight-review-packet.json.gz.b64 contains a JSON file manifest with pinned canonical source, original18 diagnostic inputs and executable test. Gzip-decoded JSON SHA256=aeafd08c958827b391b35df49ea62e4643f36218a2c55332583c9a4aa75c57ad.
Test uses existing Node22 + tsx. Reconstruct file manifest to a new review folder; point CLI_LLM_PREFLIGHT_ARTIFACT_ROOT at that folder and CLI_LLM_PREFLIGHT_SOURCE_ROOT at its source/ subfolder, then run node --test --import tsx <test-file>.
Executed3 tests PASS: exact frozen population/source pins; parser casualty/positive controls; current synthetic pair preparation.12 Open Mic pairs prepared,6 topic rows HOLD missing selected saved Focus context. Original18 diagnostic version is rejected by current provider/product parsers. Outputs are synthetic input preparation, not actual LLM suggestions. Actual local/Gemini outputs0/0. No old run revived, no provider calls.

Minimum next deliverable: independent code/test review of actual Llama selection→saved context→worker generation→commit/readback error lifecycle; confirm concrete defects. Then select/correct a full synthetic Focus context and reconcile exact runtime/model tuple + separately authorized bounded real run. Gemini comparison must use matching real session evidence and observed outputs. No default change or Gemini removal is authorized.
