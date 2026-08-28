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
          reason: 'licence_blocked' | 'weights_unavailable' | 'long_audio_refuted';
          /** What was actually run, and what actually happened. Not a citation. */
          evidence: string;
          /** What would be required to admit it. */
          admissiblePath: string;
      };

export interface ArmSpec {
    id: string;
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
        runtime: 'v2',
        modelId: 'whisper-base.en',
        localModelId: 'whisper-base.en',
        label: 'v2 whisper-base.en, previous-text conditioning OFF',
        device: 'onnxruntime-node',
        // Whisper-only, and NOT part of the route identity — window, stride and timestamps are
        // unchanged, so this arm still decodes on the shipping route.
        decodeOverrides: { condition_on_previous_text: false },
        family: 'whisper',
        admission: { status: 'admitted', lane: 'node' },
    },
    {
        id: 'v2:small.en',
        runtime: 'v2',
        modelId: 'Xenova/whisper-small.en',
        label: 'v2 whisper-small.en (HuggingFace)',
        device: 'onnxruntime-node',
        family: 'whisper',
        admission: { status: 'admitted', lane: 'node' },
    },

    // ---------------------------------------------------------------- v4 base (@huggingface/transformers)
    {
        id: 'v4:base:q4-decoder:wasm',
        runtime: 'v4',
        modelId: 'onnx-community/whisper-base.en',
        label: 'v4 base, fp32 encoder + q4 decoder, WASM',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        device: 'wasm',
        variantId: 'base_q4',
        family: 'whisper',
        admission: {
            status: 'pending_harness',
            reason: 'requires_browser_wasm',
            evidence:
                'pipeline(..., { device: "wasm" }) threw: Unsupported device: "wasm". Should be one of: '
                + 'coreml, webgpu, cpu. The browser ships ONNX Runtime Web (WASM); Node has no such '
                + 'execution provider. That is a limit of THIS HARNESS, not of the candidate.',
            resolvedBy: 'the browser lane, which runs the real WASM backend and reports what instantiated',
        },
    },
    {
        id: 'v4:base:q4-decoder:cpu',
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
        runtime: 'v4',
        modelId: 'onnx-community/whisper-base.en',
        label: 'v4 base, q4 decoder, WebGPU',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        device: 'webgpu',
        variantId: 'base_q4',
        family: 'whisper',
        admission: {
            status: 'pending_harness',
            reason: 'requires_browser_webgpu',
            evidence:
                'device: "webgpu" was ACCEPTED in Node and produced a transcript, but navigator.gpu is '
                + 'undefined there — the request was served by something else and the library said '
                + 'nothing. Inspected directly, the loaded session exposes only input/output names and '
                + 'metadata: there are no execution providers to read. Node cannot substantiate the claim.',
            resolvedBy: 'the browser lane, which reports the GPU adapter obtained and whether a device was created',
        },
    },
    {
        id: 'v4:base:fp32-decoder:cpu',
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
        runtime: 'v4',
        modelId: 'onnx-community/whisper-base.en',
        label: 'v4 base, int8 decoder',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'int8' },
        device: 'cpu',
        family: 'whisper',
        admission: { status: 'admitted', lane: 'node' },
    },
    {
        id: 'v4:base:q8-decoder:cpu',
        runtime: 'v4',
        modelId: 'onnx-community/whisper-base.en',
        label: 'v4 base, q8 decoder',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
        device: 'cpu',
        family: 'whisper',
        admission: { status: 'admitted', lane: 'node' },
    },

    // ---------------------------------------------------------------- v4 distil
    {
        id: 'v4:distil-small.en:q4-decoder:webgpu',
        runtime: 'v4',
        modelId: 'onnx-community/distil-small.en',
        label: 'v4 distil-small.en, q4 decoder, WebGPU',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        device: 'webgpu',
        variantId: 'distil_q4',
        family: 'whisper',
        admission: {
            status: 'pending_harness',
            reason: 'requires_browser_webgpu',
            evidence:
                'Same silent acceptance as the base WebGPU arm. The product registry marks this variant '
                + 'requiresWebGPU: true and records WASM RTF ~2.2 as unusable, so a CPU stand-in would '
                + 'not answer the question this arm exists to ask.',
            resolvedBy: 'the browser lane on confirmed WebGPU, which is the only configuration it ships in',
        },
    },

    // ---------------------------------------------------------------- Moonshine
    {
        id: 'moonshine:tiny',
        runtime: 'moonshine',
        modelId: 'onnx-community/moonshine-tiny-ONNX',
        revision: 'a6da1241cd305dcd64eab1edbd615f2bb9aabb95',
        label: 'Moonshine tiny',
        dtype: 'q8',
        device: 'cpu',
        family: 'moonshine',
        // ADMITTED on its OWN route. My first version rejected it for not returning Whisper timestamp
        // chunks — a requirement the product does not have, since it consumes transcript TEXT. The
        // licence question (MIT at every link, but no LICENSE file travelling with the artifacts) is a
        // SHIPPING blocker and is tracked separately; it does not bar evaluation.
        admission: { status: 'admitted', lane: 'node' },
    },
    {
        id: 'moonshine:base',
        runtime: 'moonshine',
        modelId: 'onnx-community/moonshine-base-ONNX',
        revision: 'b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad',
        label: 'Moonshine base',
        dtype: 'q8',
        device: 'cpu',
        family: 'moonshine',
        // Admitted for evaluation on its native route. #891's long-audio refutation (199s of varied,
        // non-looped speech at 0.684x RTF with a hallucinated loop) still stands and is exactly what
        // the long-form control is for — it is a result to reproduce or overturn, not a reason to skip.
        admission: { status: 'admitted', lane: 'node' },
    },
]);

export const ADMITTED_ARMS = ARM_MATRIX.filter((a) => a.admission.status === 'admitted');
export const PENDING_ARMS = ARM_MATRIX.filter((a) => a.admission.status === 'pending_harness');
export const REJECTED_ARMS = ARM_MATRIX.filter((a) => a.admission.status === 'rejected');
export const NODE_ARMS = ARM_MATRIX.filter((a) => a.admission.status === 'admitted' && a.admission.lane === 'node');
export const BROWSER_ARMS = ARM_MATRIX.filter((a) => a.admission.status === 'admitted' && a.admission.lane === 'browser');
