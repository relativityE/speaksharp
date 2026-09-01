/**
 * privateV4Experiment.ts — DEV/TEST-ONLY v4 decode root-cause overrides (device A/B + dtype).
 *
 * Forces the runtime device / decoder dtype / no-worker so the `invalid data location`
 * decode failure can be isolated (see product_release/V4_DECODE_ROOT_CAUSE_EXPERIMENT.md).
 * Gated EXACTLY like the private-engine override (dev/test/E2E only) — INERT in production:
 * a normal user can never change the v4 device/dtype via URL or localStorage.
 *
 * Read on the MAIN thread only (Web Workers have no localStorage); the values are threaded
 * to the worker via the init message. Never throws.
 *
 * Knobs (URL param OR localStorage key):
 *   ?v4Device=webgpu|wasm|auto        / speaksharp.v4.device
 *   ?v4DecoderDtype=q4|q8|int8|fp32    / speaksharp.v4.decoderDtype
 *   ?v4Variant=base_q4|distil_q4       / speaksharp.v4.variant
 *   ?v4NoWorker=1                      / speaksharp.v4.noWorker
 */

export type V4ExperimentDevice = 'webgpu' | 'wasm' | 'auto';
export type V4ExperimentDecoderDtype = 'q4' | 'q8' | 'int8' | 'fp32';
export type V4ExperimentVariant = 'base_q4' | 'distil_q4';

export interface V4ExperimentOverrides {
    /** Force the runtime device, bypassing WebGPU auto-detection. */
    device?: V4ExperimentDevice;
    /** Override decoder_model_merged dtype (the suspected q4-on-WASM failure). */
    decoderDtype?: V4ExperimentDecoderDtype;
    /**
     * DEV/TEST-HARNESS-ONLY Gate A candidate selector (the base_q4 vs distil_q4 bakeoff). Honored
     * ONLY with forceAuto, allowlisted to EXACTLY the two known candidates (unknown values fail
     * closed to base_q4 — never an arbitrary model/path), and inert in production. NOT a PostHog/prod
     * selector: the real distil control plane is the `private_stt_v4_distil_enabled` flag. Do NOT
     * widen this allowlist or accept arbitrary model IDs/dtypes/devices here.
     */
    variant?: V4ExperimentVariant;
    /** Force the main-thread pipeline (no Web Worker) to isolate worker-specific issues. */
    noWorker: boolean;
    /** Force the AUTO resolver to ATTEMPT v4 even without WebGPU — so headless CI can prove the
     *  AUTO-path decode fallback (v4 attempt -> decode fail -> v2-base). Dev/test/E2E only. */
    forceAuto: boolean;
}

/**
 * RETIRED: every URL parameter and localStorage key this used to read.
 *
 * It resolved `v4Device`, `v4DecoderDtype`, `v4Variant`, `v4NoWorker` and `v4ForceAuto` from the query
 * string and matching storage keys, gated to dev/test. The gate was real, but two things survived it:
 * the parameters NAME INTERNAL ENGINE INTERNALS — device, decoder precision, model variant — to anyone
 * reading a URL, and a per-visitor channel is one mistaken gate from becoming a production selector.
 * `?privateModel=` proved that risk was not hypothetical: it had no gate at all.
 *
 * Which model runs, on which device, is now one reviewable config value, with an internal-build-only
 * in-page switch for the human comparison. Returning the inert default keeps every caller compiling
 * while removing the channel itself.
 */
export function getV4ExperimentOverrides(): V4ExperimentOverrides {
    return { noWorker: false, forceAuto: false };
}