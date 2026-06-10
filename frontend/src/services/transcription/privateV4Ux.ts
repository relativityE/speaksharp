/**
 * privateV4Ux.ts — customer-safe v4 UX copy + variant-aware download sizing (task #75).
 *
 * v4 swaps in a larger on-device model (base-q4 ~142MB, distil-q4 ~251MB) than the v2
 * default (~80MB), so the setup/consent surface must show the RIGHT size for the resolved
 * variant — otherwise the consent understates the download. v4 can also silently fall back
 * to the standard v2-base model; that must read as safe, not broken.
 *
 * HARD RULE: this copy NEVER exposes engine internals — no "WebGPU", "WASM", "ONNX",
 * "dtype", "quantized", "q4", etc. Pure, framework-free so the consent surface and the
 * fallback messaging share one source.
 */
import {
    PRIV_STT_V4_VARIANTS,
    PRIV_STT_V4_DEFAULT_VARIANT,
    type PrivSttV4VariantId,
} from './sttConstants';

/** Customer-safe v4 UX strings. No engine internals. */
export const PRIVATE_V4_UX_COPY = {
    /** Shown when v4 falls back to the standard on-device model — reads as safe, not broken. */
    fallbackToStandard: 'Using the standard on-device transcription. Your audio stays on your device.',
    /** Setup heading for the higher-accuracy local model (no internal terms). */
    setupHeading: 'Set up higher-accuracy Private transcription on this device. All audio processing stays local.',
} as const;

/** One-time download size (MB) for the resolved v4 variant. */
export function privateV4DownloadMB(
    variant: PrivSttV4VariantId = PRIV_STT_V4_DEFAULT_VARIANT,
): number {
    return PRIV_STT_V4_VARIANTS[variant].EXPECTED_SPLIT_DOWNLOAD_MB;
}

/**
 * Customer-safe download-consent message for the resolved v4 variant. Shows the ACTUAL
 * size so the user consents to the real download. No engine internals.
 */
export function privateV4DownloadConsentMessage(
    variant: PrivSttV4VariantId = PRIV_STT_V4_DEFAULT_VARIANT,
): string {
    const mb = privateV4DownloadMB(variant);
    return `One-time download of the higher-accuracy on-device speech model (about ${mb} MB). Your audio is transcribed in your browser and never uploaded. If site storage is cleared, setup may be required again.`;
}
