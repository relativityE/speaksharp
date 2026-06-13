/**
 * Shared Whisper decode-option proof hook (BL-1 / B-prevent-2).
 *
 * A test/release-proof seam that lets a browser proof A/B supported Whisper generation options
 * WITHOUT changing product defaults. It is inert unless `window.__PRIVATE_STT_DECODE_OPTIONS__` is
 * set, and only allow-listed keys are honored. The anti-loop knobs are included so Test can measure
 * `condition_on_previous_text=false` / `no_repeat_ngram_size` / `compression_ratio_threshold` on the
 * real WebGPU v4 model against the repetition-loop artifact, then we set a v4 default from evidence
 * (a separate, evidence-backed change) rather than shipping a blind default.
 *
 * NOTE: the v2 engine (`TransformersJSEngine.ts`) currently carries its own private copy of this
 * logic; consolidating it onto this module is a low-risk future cleanup (left out here to avoid
 * touching the just-proven v2 path).
 */

export type WhisperDecodeOptions = Record<string, unknown>;

/**
 * Generation options a browser proof may override. Kept deliberately small and explicit — anything
 * not in this set is ignored, so the hook can never inject arbitrary pipeline options.
 */
export const ALLOWED_DECODE_OPTIONS: ReadonlySet<string> = new Set([
    'return_timestamps',
    'condition_on_previous_text',
    'compression_ratio_threshold',
    'logprob_threshold',
    'no_speech_threshold',
    'no_repeat_ngram_size',
    'temperature',
]);

/**
 * Allow-list + type-guard a raw override object. Accepts only `boolean | number | number[]` values
 * for allow-listed keys. Returns `undefined` when nothing valid is present (so callers can treat
 * "no override" and "empty override" identically and keep product defaults).
 */
export function sanitizeDecodeOptions(source: unknown): WhisperDecodeOptions | undefined {
    if (!source || typeof source !== 'object') return undefined;

    const out: WhisperDecodeOptions = {};
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
        if (!ALLOWED_DECODE_OPTIONS.has(key)) continue;
        if (typeof value === 'boolean' || typeof value === 'number') {
            out[key] = value;
        } else if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
            out[key] = value;
        }
    }

    return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Main-thread only: read the proof-hook override from `window`. Returns `undefined` in a worker or
 * SSR context (no `window`), or when the hook is unset/empty — i.e. product defaults are preserved.
 */
export function readPrivateDecodeOptionsOverride(): WhisperDecodeOptions | undefined {
    if (typeof window === 'undefined') return undefined;
    const source = (window as unknown as { __PRIVATE_STT_DECODE_OPTIONS__?: unknown }).__PRIVATE_STT_DECODE_OPTIONS__;
    return sanitizeDecodeOptions(source);
}
