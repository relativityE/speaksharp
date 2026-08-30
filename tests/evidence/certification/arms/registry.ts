/**
 * #1304 Task 3C — THE COMPLETE CANDIDATE MATRIX.
 *
 * Every arm in the corrected #1304 specification appears here. An arm that cannot run is recorded as a
 * REJECTION WITH A REASON — never dropped. A silently omitted candidate is indistinguishable from one
 * that was never considered, and a down-select whose losers cannot be enumerated is not a down-select.
 *
 * A rejection must name what was tried and what happened. "Unsupported" on its own is an opinion.
 */
/**
 * `moonshine-wasm` is Moonshine's OWN browser runtime (`@moonshine-ai/moonshine-wasm`), loading
 * official `.ort` components. It is a separate runtime from transformers.js, and that is fine: a
 * primary and a fallback on different inference libraries have less correlated failure risk, and the
 * runtime is part of each deployable candidate rather than a property of the comparison.
 */
export type ArmRuntime = 'v2' | 'v4' | 'moonshine' | 'moonshine-wasm';

/**
 * THREE STATES, and the middle one matters most.
 *
 * `pending_harness` is NOT a rejection. "This harness cannot run it" is a fact about the harness, and
 * recording it as a property of the candidate is how a capable model gets eliminated by an accident of
 * tooling. A WASM or WebGPU cell that Node cannot execute is PENDING a browser arm — the cell stays
 * open, and the report says what is missing.
 *
 * `rejected` is reserved for a property of the CANDIDATE itself.
 */
export type ArmAdmission =
    | { status: 'admitted'; lane: 'node' | 'browser' }
    | {
          status: 'pending_harness';
          /** What this harness cannot do — a fact about the tooling, not the model. */
          reason: 'requires_browser_wasm' | 'requires_browser_webgpu';
          evidence: string;
          /** The harness work that would resolve it. */
          resolvedBy: string;
      }
    | {
          status: 'rejected';
          /** A property of the CANDIDATE. Machine-readable cause. */
          reason:
              | 'licence_blocked'
              | 'weights_unavailable'
              | 'long_audio_refuted'
              /** The runtime does not implement the control this arm exists to vary. */
              | 'runtime_option_unsupported';
          /** What was actually run, and what actually happened. Not a citation. */
          evidence: string;
          /** What would be required to admit it. */
          admissiblePath: string;
      };

export interface ArmSpec {
    /**
     * The HISTORICAL arm identity. Preserved verbatim for artifact and frozen-policy compatibility, and
     * NOT a description of the configuration: `v4:base:int8-decoder:cpu` executes on browser WASM.
     * Read `candidate` and `executionBackend` for what an arm actually is.
     */
    id: string;
    /** The product/test candidate this arm measures. Two arms may share one candidate (int8 == q8). */
    candidate?: string;
    /** Where it ACTUALLY executed, as measured — never inferred from the id's `:cpu`/`:wasm` suffix. */
    executionBackend?: 'browser_wasm' | 'browser_webgpu' | 'node_cpu';
    /** Echo of `id`, so a row carrying the compatibility identifier is self-describing. */
    historicalArmId?: string;
    /**
     * SELECTION arms are the 12 cells of the corrected #1304 matrix — the candidates a primary and
     * fallback may be chosen from. A DIAGNOSTIC cell answers a question about the harness or the
     * runtime and is never eligible for selection. Keeping them in one list but distinctly labelled is
     * what stops a stand-in from being read as a candidate.
     */
    role: 'selection' | 'diagnostic';
    /**
     * Why a diagnostic cell exists, and why it can never be selected. Required on every diagnostic:
     * an unexplained cell in a results table reads as a candidate.
     */
    diagnosticPurpose?: string;
    /**
     * This cell requests a DIFFERENT dtype name that resolves to the SAME published artifact as
     * another cell. Recorded rather than deleted, so the matrix still shows both dtypes were tried
     * and where they landed — but the two must never appear as independent results.
     */
    dtypeAliasOf?: string;
    /**
     * A diagnostic cell that becomes a DUPLICATE of another cell in a given lane. `v4:...:cpu` is a
     * distinct configuration in Node (onnxruntime-node) but collapses onto the WASM cell in a browser,
     * where `cpu` is not a backend at all — so its browser row is the same experiment run twice under
     * two names. Recording that is what stopped one row being described as both "Node/onnxruntime-node"
     * and "browser WASM proven": it is neither one thing, it is lane-dependent.
     */
    duplicateInBrowserLaneOf?: string;
    runtime: ArmRuntime;
    modelId: string;
    /** Human label for the report table. */
    label: string;
    dtype?: Record<string, string> | string;
    device: 'onnxruntime-node' | 'cpu' | 'wasm' | 'webgpu';
    /** Which family's canonical route this arm must match. */
    family: 'whisper' | 'moonshine';
    /** Present only where the PRODUCT registry ships this exact combination. */
    variantId?: 'base_q4' | 'distil_q4';
    /** Extra generation options for a deliberate variation of the shipping decode. */
    decodeOverrides?: Record<string, unknown>;
    /** Self-hosted directory name, for arms that load the product's own weights. */
    localModelId?: string;
    revision?: string;
    admission: ArmAdmission;
}

/**
 * WHY SO MANY REJECTIONS ARE ABOUT THE HARNESS, NOT THE MODEL.
 *
 * The product runs ONNX Runtime Web (WASM) in a browser worker, or WebGPU where available. A Node
 * harness has neither: `@huggingface/transformers` in Node supports `coreml`, `webgpu` and `cpu`, and
 * `navigator.gpu` does not exist there — so a `webgpu` request is ACCEPTED and quietly served by
 * something else. Both facts were established by running the library, not by reading its docs.
 *
 * Accuracy arms are therefore measurable here; DEVICE claims are not. Saying so is the difference
 * between a benchmark and a number.
 */
export const ARM_MATRIX: readonly ArmSpec[] = Object.freeze([
    // ---------------------------------------------------------------- v2 (@xenova/transformers)
    {
        id: 'v2:tiny.en',
        role: 'selection',
        runtime: 'v2',
        modelId: 'whisper-tiny.en',
        localModelId: 'whisper-tiny.en',
        label: 'v2 whisper-tiny.en (self-hosted)',
        device: 'onnxruntime-node',
        family: 'whisper',
        admission: { status: 'admitted', lane: 'node' },
    },
    {
        id: 'v2:base.en',
        role: 'selection',
        runtime: 'v2',
        modelId: 'whisper-base.en',
        localModelId: 'whisper-base.en',
        label: 'v2 whisper-base.en — SHIPPING',
        device: 'onnxruntime-node',
        family: 'whisper',
        admission: { status: 'admitted', lane: 'node' },
    },
    {
        id: 'v2:base.en:no-conditioning',
        role: 'selection',
        runtime: 'v2',
        modelId: 'whisper-base.en',
        localModelId: 'whisper-base.en',
        label: 'v2 whisper-base.en, previous-text conditioning OFF',
        device: 'onnxruntime-node',
        decodeOverrides: { condition_on_previous_text: false },
        family: 'whisper',
        // RUNTIME-UNSUPPORTED, proven twice and NOT assumed equivalent.
        //
        //  1. On the frozen 37.87s fixture — which genuinely spans TWO decode windows, counted by
        //     hooking `model.generate` (2 calls, num_frames 3000 then 1786) — the option reached BOTH
        //     windows and the output was byte-identical to the baseline: same transcript sha256, same
        //     S=5 D=0 I=0 over 95 words, same WER 0.0526, 0 repeated 5-grams and tail preserved in
        //     both. Harvard clips are 2-4s and cross no window at all, so they could never test it.
        //  2. The string `condition_on_previous_text` appears ZERO times in both transformers.js
        //     bundles. The runtime does not implement it; it is accepted and ignored.
        //
        // So this is "no measured effect", not "the option works and changes nothing". It cannot be a
        // selection arm until a runtime that honours the option exists.
        admission: {
            status: 'rejected',
            reason: 'runtime_option_unsupported',
            evidence:
                'condition_on_previous_text is absent from @xenova/transformers and '
                + '@huggingface/transformers alike (0 occurrences in either bundle). On the 37.87s '
                + 'two-window fixture the option reached both windows and produced a byte-identical '
                + 'transcript, S/D/I and WER — no measured effect, which is not the same as no effect.',
            admissiblePath:
                'a runtime that implements the option, or a product-side equivalent; until then the '
                + 'debug allow-list should stop accepting controls the runtimes ignore',
        },
    },
    {
        id: 'v2:small.en',
        role: 'selection',
        runtime: 'v2',
        modelId: 'Xenova/whisper-small.en',
        label: 'v2 whisper-small.en (HuggingFace — NOT self-hosted)',
        device: 'onnxruntime-node',
        family: 'whisper',
        // The product does not self-host these weights, so this arm fetches them from HuggingFace and
        // its provenance records `assets.verdict: 'unverifiable'` — the files were not read from the
        // app's own directory, and claiming they are identical to it would assert something unmeasured.
        // IF THIS ARM IS SELECTED, byte-identical files must be self-hosted and verified against the
        // measured ones before activation; a model that scored well from a CDN is not the model the
        // product would ship.
        admission: { status: 'admitted', lane: 'node' },
    },

    // ---------------------------------------------------------------- v4 base (@huggingface/transformers)
    {
        id: 'v4:base:q4-decoder:wasm',
        role: 'selection',
        runtime: 'v4',
        modelId: 'onnx-community/whisper-base.en',
        label: 'v4 base, fp32 encoder + q4 decoder, WASM',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        device: 'wasm',
        variantId: 'base_q4',
        family: 'whisper',
        // RESOLVED by the browser lane. Node cannot offer a `wasm` device at all — the supported set
        // there is coreml/webgpu/cpu — but the browser runs the real ONNX Runtime Web backend, and the
        // harness proves it by counting WebAssembly instantiations rather than trusting the request.
        admission: { status: 'admitted', lane: 'browser' },
    },
    {
        id: 'v4:base:q4-decoder:cpu',
        // DIAGNOSTIC, not a candidate: in the NODE lane this runs on onnxruntime-node, which the
        // product does not ship. It exists to answer "is the q4 accuracy figure a property of the
        // MODEL or of the browser runtime?" — a question about the harness, not about a candidate.
        role: 'diagnostic',
        diagnosticPurpose:
            'Node/onnxruntime-node accuracy stand-in for the browser WASM cell: separates a model '
            + 'property from a runtime property. onnxruntime-node is not a backend the product ships.',
        // In a BROWSER there is no `cpu` backend, so this cell maps onto `wasm` and becomes the same
        // experiment as `v4:base:q4-decoder:wasm` under a second name.
        duplicateInBrowserLaneOf: 'v4:base:q4-decoder:wasm',
        runtime: 'v4',
        modelId: 'onnx-community/whisper-base.en',
        label: 'v4 base, fp32 encoder + q4 decoder, onnxruntime-node CPU (accuracy stand-in for WASM)',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        device: 'cpu',
        variantId: 'base_q4',
        family: 'whisper',
        admission: { status: 'admitted', lane: 'node' },
    },
    {
        id: 'v4:base:q4-decoder:webgpu',
        role: 'selection',
        runtime: 'v4',
        modelId: 'onnx-community/whisper-base.en',
        label: 'v4 base, q4 decoder, WebGPU',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        device: 'webgpu',
        variantId: 'base_q4',
        family: 'whisper',
        // RESOLVED by the browser lane, which obtains a real adapter, creates a device, and counts
        // compute pipelines and queue submissions. CAVEAT recorded on every row: headless Chromium
        // falls back to `google/swiftshader`, a SOFTWARE rasterizer. WebGPU compatibility is therefore
        // proven; WebGPU PERFORMANCE is not, and the timings run 20-60x slower than WASM, which is the
        // opposite of what a GPU does. A hardware-GPU run is still required before any latency claim.
        admission: { status: 'admitted', lane: 'browser' },
    },
    {
        id: 'v4:base:fp32-decoder:cpu',
        role: 'selection',
        runtime: 'v4',
        modelId: 'onnx-community/whisper-base.en',
        label: 'v4 base, fp32 decoder',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'fp32' },
        device: 'cpu',
        family: 'whisper',
        admission: { status: 'admitted', lane: 'node' },
    },
    {
        id: 'v4:base:int8-decoder:cpu',
        role: 'selection',
        runtime: 'v4',
        modelId: 'onnx-community/whisper-base.en',
        label: 'v4 base, int8 decoder',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'int8' },
        device: 'cpu',
        family: 'whisper',
        /**
         * CORRECTED FROM MEASUREMENT. This entry previously read:
         *
         *   "Loads and scores under onnxruntime-node, but ONNX Runtime WEB refuses to create a session:
         *    qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits / Missing required scale …
         *    this precision is unusable there whatever its accuracy"
         *
         * That is FALSE at ort-web 1.27.0. The retained preflight
         * `evidence-runs/1304-preflight-r6/decode-4cell.json` records this arm with
         * `requestedDevice: wasm`, `resolvedBackend: wasm`, `backendProven: true`,
         * runtime `@huggingface/transformers+ort-web-1.27.0`, loading
         * `onnx/decoder_model_merged_int8.onnx` (53,692,803 bytes) and decoding 23/23 at WER 0.0479.
         *
         * The old text was a true observation of an older runtime that became a standing claim about the
         * model. It was also self-contradictory in place: the browser runner admitted this ID while the
         * registry called it Node-only.
         *
         * `device: 'cpu'` and the arm ID are retained ONLY as historical/frozen-policy identifiers.
         * What the arm actually IS now travels in explicit fields rather than being read out of a string.
         */
        candidate: 'base_int8',
        executionBackend: 'browser_wasm',
        historicalArmId: 'v4:base:int8-decoder:cpu',
        admission: { status: 'admitted', lane: 'browser' },
    },
    {
        id: 'v4:base:q8-decoder:cpu',
        role: 'selection',
        runtime: 'v4',
        modelId: 'onnx-community/whisper-base.en',
        label: 'v4 base, q8 decoder',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
        device: 'cpu',
        family: 'whisper',
        // ALIAS, proven by digest — not inferred from a matching WER.
        //
        //   dd4761a3f7add26afda3512abff4706920404c2517e85a9f2ff090b0c0987909  decoder_model_merged_int8.onnx
        //   dd4761a3f7add26afda3512abff4706920404c2517e85a9f2ff090b0c0987909  decoder_model_merged_quantized.onnx
        //   cmp: byte-identical, 53,692,803 bytes each
        //
        // transformers.js maps `int8` -> `_int8.onnx` and `q8` -> `_quantized.onnx`, and
        // onnx-community/whisper-base.en published the SAME BYTES under both names. Both arms load
        // that decoder against the same fp32 encoder, so they are ONE candidate. Both scored 0.0479
        // on the 459-word set, which is what a single model measured twice looks like — and equal
        // file size alone would not have proven it, which is why the bytes were hashed and compared.
        dtypeAliasOf: 'v4:base:int8-decoder:cpu',
        candidate: 'base_int8',
        executionBackend: 'browser_wasm',
        historicalArmId: 'v4:base:q8-decoder:cpu',
        // The stale ORT-Web refusal claim below is corrected on the int8 entry above; retained here only
        // as the historical note it was. This arm remains a BYTE-IDENTICAL alias and never ranks
        // separately — `alias_of_int8` is its standing disposition.
        // (historical) Loads and scores under onnxruntime-node, but ONNX Runtime WEB refused a session:
        //   qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits
        //   Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale
        // The browser is the backend the product ships, so this precision is unusable there whatever
        // its accuracy — a product-relevant result, recorded from the run rather than assumed.
        admission: { status: 'admitted', lane: 'node' },
    },

    // ---------------------------------------------------------------- v4 distil
    {
        id: 'v4:distil-small.en:q4-decoder:webgpu',
        role: 'selection',
        runtime: 'v4',
        modelId: 'onnx-community/distil-small.en',
        label: 'v4 distil-small.en, q4 decoder, WebGPU',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        device: 'webgpu',
        variantId: 'distil_q4',
        family: 'whisper',
        // RESOLVED by the browser lane, with the same SwiftShader caveat: the product registry marks
        // this variant requiresWebGPU: true, so a hardware-GPU run is required before its latency can
        // be compared with anything.
        admission: { status: 'admitted', lane: 'browser' },
    },

    // ------------------------------------------------- Moonshine Streaming (official WASM runtime)
    {
        id: 'moonshine:streaming-small',
        role: 'selection',
        runtime: 'moonshine-wasm',
        modelId: 'moonshine-ai/streaming-small',
        // The runtime resolves components from its own catalog; the revision is the quantized
        // component set it served, recorded from the probe.
        revision: 'quantized_26_07_30',
        label: 'Moonshine Streaming Small (official @moonshine-ai/moonshine-wasm)',
        dtype: 'quantized',
        device: 'wasm',
        family: 'moonshine',
        // Load-proven: 165.5 MB over 7 files, 4,973 ms cold load, WASM counted, decoded a known
        // fixture. Registered so it runs through `runArm` and the certified scorer like every other
        // arm — a probe script is not a benchmark.
        admission: { status: 'admitted', lane: 'browser' },
    },
    {
        id: 'moonshine:streaming-medium',
        role: 'selection',
        runtime: 'moonshine-wasm',
        modelId: 'moonshine-ai/streaming-medium',
        revision: 'quantized_26_07_30',
        label: 'Moonshine Streaming Medium (official @moonshine-ai/moonshine-wasm)',
        dtype: 'quantized',
        device: 'wasm',
        family: 'moonshine',
        // 304.7 MB over 7 files — near the ~255 MB the docs cite, not the 1.06 GB fp32 checkpoint.
        // Technically viable on size; the download remains a major ACTIVATION disadvantage that must
        // stay visible beside its accuracy rather than being folded into one score.
        admission: { status: 'admitted', lane: 'browser' },
    },

    // ---------------------------------------------------------------- Moonshine
    {
        id: 'moonshine:tiny',
        role: 'selection',
        runtime: 'moonshine',
        modelId: 'onnx-community/moonshine-tiny-ONNX',
        revision: 'a6da1241cd305dcd64eab1edbd615f2bb9aabb95',
        label: 'Moonshine tiny (fp32 — the precision ORT Web can load)',
        dtype: 'fp32',
        device: 'cpu',
        family: 'moonshine',
        // fp32 RATHER THAN q8, and the reason is a BACKEND limit, not a model one. At `q8` ONNX
        // Runtime Web refuses to create a session at all:
        //   qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits
        //   Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale
        // The same weights load fine under onnxruntime-node. Stopping at that first browser failure
        // would have recorded "Moonshine is not browser-viable" — the same premature rejection as the
        // timestamp one, in a new place. At fp32 it loads and runs.
        //
        // ADMITTED on its OWN route. My first version rejected it for not returning Whisper timestamp
        // chunks — a requirement the product does not have, since it consumes transcript TEXT. The
        // licence question (MIT at every link, but no LICENSE file travelling with the artifacts) is a
        // SHIPPING blocker and is tracked separately; it does not bar evaluation.
        admission: { status: 'admitted', lane: 'node' },
    },
    {
        id: 'moonshine:base',
        role: 'selection',
        runtime: 'moonshine',
        modelId: 'onnx-community/moonshine-base-ONNX',
        revision: 'b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad',
        label: 'Moonshine base (fp32 — the precision ORT Web can load)',
        dtype: 'fp32',
        device: 'cpu',
        family: 'moonshine',
        // fp32 for the same backend reason as Moonshine tiny — q8 cannot be loaded by ORT Web.
        // Admitted for evaluation on its native route. #891's long-audio refutation (199s of varied,
        // non-looped speech at 0.684x RTF with a hallucinated loop) still stands and is exactly what
        // the long-form control is for — it is a result to reproduce or overturn, not a reason to skip.
        admission: { status: 'admitted', lane: 'node' },
    },
]);

export const ADMITTED_ARMS = ARM_MATRIX.filter((a) => a.admission.status === 'admitted');
export const PENDING_ARMS = ARM_MATRIX.filter((a) => a.admission.status === 'pending_harness');
export const REJECTED_ARMS = ARM_MATRIX.filter((a) => a.admission.status === 'rejected');
/**
 * DISTINCT candidates: aliases collapsed onto the arm they duplicate.
 *
 * A ranking built from `SELECTION_ARMS` would list one model twice and read as two independent
 * results agreeing with each other.
 */
export const DISTINCT_CANDIDATES = ARM_MATRIX.filter((a) => a.role === 'selection' && !a.dtypeAliasOf);
export const ALIASED_ARMS = ARM_MATRIX.filter((a) => a.dtypeAliasOf !== undefined);

export const SELECTION_ARMS = ARM_MATRIX.filter((a) => a.role === 'selection');
export const DIAGNOSTIC_ARMS = ARM_MATRIX.filter((a) => a.role === 'diagnostic');
export const NODE_ARMS = ARM_MATRIX.filter((a) => a.admission.status === 'admitted' && a.admission.lane === 'node');
export const BROWSER_ARMS = ARM_MATRIX.filter((a) => a.admission.status === 'admitted' && a.admission.lane === 'browser');

/**
 * #1304 — the SELECTION EXECUTION SET (PM ruling, 2026-08-29).
 *
 * Completeness of the matrix and expenditure of selection compute are different things. Every arm keeps
 * a row; only these ten are measured on the frozen 600. Running the others would delay the down-select
 * without producing usable evidence:
 *
 *  - an alias cannot rank against the thing it is byte-identical to;
 *  - a diagnostic duplicate answers a harness question, not a candidate question;
 *  - SwiftShader is a software rasterizer. It proves WebGPU COMPATIBILITY and nothing about hardware
 *    speed, so its timings can never clear a performance or activation gate. Real WebGPU performance is
 *    deferred to a real hardware adapter.
 */
export const SELECTION_EXECUTION_SET = [
    'v2:tiny.en',
    'v2:base.en',
    'v2:small.en',
    'v4:base:q4-decoder:wasm',
    // `device: 'cpu'` maps onto the WASM backend in the browser lane — there is no `cpu` backend there.
    'v4:base:fp32-decoder:cpu',
    'v4:base:int8-decoder:cpu',
    'moonshine:tiny',
    'moonshine:base',
    'moonshine:streaming-small',
    'moonshine:streaming-medium',
] as const;

/** Preserved in the matrix with a named reason; never executed, never ranked. */
export const NOT_EXECUTED_REASONS: Record<string, string> = {
    'v4:base:q8-decoder:cpu': 'alias_of_int8',
    'v4:base:q4-decoder:cpu': 'diagnostic_duplicate_of_q4_wasm',
    'v4:base:q4-decoder:webgpu': 'not_run_hardware_unrepresentative',
    'v4:distil-small.en:q4-decoder:webgpu': 'not_run_hardware_unrepresentative',
    'v2:base.en:no-conditioning': 'invalid_runtime_option_unsupported',
};

/**
 * Every arm must be accounted for exactly once: measured, or preserved with a named reason. This is the
 * `required` list a checkpoint is validated against before it may become the final artifact.
 */
export const REQUIRED_MATRIX_ROWS: string[] = ARM_MATRIX.map((a) => a.id);
