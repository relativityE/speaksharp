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
import { ENV } from '@/config/TestFlags';

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

const DEVICES: readonly string[] = ['webgpu', 'wasm', 'auto'];
const DTYPES: readonly string[] = ['q4', 'q8', 'int8', 'fp32'];
const VARIANTS: readonly string[] = ['base_q4', 'distil_q4'];

/** Experiment overrides are honored ONLY in dev/test/E2E. Production build => false.
 *  (Same gate as the private-engine override — see PrivateSTT.isPrivateOverrideContextAllowed.) */
function experimentAllowed(): boolean {
    return import.meta.env.DEV === true || ENV.isTest;
}

export function getV4ExperimentOverrides(
    win: Window | undefined = typeof window !== 'undefined' ? window : undefined,
): V4ExperimentOverrides {
    if (!win || !experimentAllowed()) return { noWorker: false, forceAuto: false };
    const read = (queryKey: string, storageKey: string): string | undefined => {
        try {
            const fromQuery = new URLSearchParams(win.location.search).get(queryKey);
            if (fromQuery) return fromQuery;
            return win.localStorage?.getItem(storageKey) ?? undefined;
        } catch {
            return undefined;
        }
    };
    const device = read('v4Device', 'speaksharp.v4.device');
    const decoderDtype = read('v4DecoderDtype', 'speaksharp.v4.decoderDtype');
    const variant = read('v4Variant', 'speaksharp.v4.variant');
    const noWorker = read('v4NoWorker', 'speaksharp.v4.noWorker') === '1';
    const forceAuto = read('v4ForceAuto', 'speaksharp.v4.forceAuto') === '1';
    return {
        device: DEVICES.includes(device ?? '') ? (device as V4ExperimentDevice) : undefined,
        decoderDtype: DTYPES.includes(decoderDtype ?? '') ? (decoderDtype as V4ExperimentDecoderDtype) : undefined,
        variant: VARIANTS.includes(variant ?? '') ? (variant as V4ExperimentVariant) : undefined,
        noWorker,
        forceAuto,
    };
}
