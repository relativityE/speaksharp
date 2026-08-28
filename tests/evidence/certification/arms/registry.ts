/**
 * #1304 Task 3C — THE COMPLETE CANDIDATE MATRIX.
 *
 * Every arm in the corrected #1304 specification appears here. An arm that cannot run is recorded as a
 * REJECTION WITH A REASON — never dropped. A silently omitted candidate is indistinguishable from one
 * that was never considered, and a down-select whose losers cannot be enumerated is not a down-select.
 *
 * A rejection must name what was tried and what happened. "Unsupported" on its own is an opinion.
 */
export type ArmRuntime = 'v2' | 'v4' | 'moonshine';

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
    id: string;
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
        // Loads and scores under onnxruntime-node, but ONNX Runtime WEB refuses to create a session:
        //   qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits
        //   Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale
        // The browser is the backend the product ships, so this precision is unusable there whatever
        // its accuracy — a product-relevant result, recorded from the run rather than assumed.
        admission: { status: 'admitted', lane: 'node' },
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
        // Loads and scores under onnxruntime-node, but ONNX Runtime WEB refuses to create a session:
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
export const SELECTION_ARMS = ARM_MATRIX.filter((a) => a.role === 'selection');
export const DIAGNOSTIC_ARMS = ARM_MATRIX.filter((a) => a.role === 'diagnostic');
export const NODE_ARMS = ARM_MATRIX.filter((a) => a.admission.status === 'admitted' && a.admission.lane === 'node');
export const BROWSER_ARMS = ARM_MATRIX.filter((a) => a.admission.status === 'admitted' && a.admission.lane === 'browser');
