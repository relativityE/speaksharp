/**
 * #1304 Task 3A — the DECODE ROUTE and its identity hash.
 *
 * WHY A ROUTE OBJECT AND A HASH. `buildShippingDecodeOptions` already gives the product and the
 * harness one builder, but "they call the same function" was only ever asserted by reading source:
 * a regex looking for the builder's NAME and another looking for a re-derived stride. Both are
 * presence checks — a re-derivation written with different whitespace, or lifted into a local first,
 * passes them while the harness silently decodes differently from the product.
 *
 * A route hash replaces that with BEHAVIOUR. The worker and the harness resolve a route from the same
 * inputs and the hashes must be equal; if either drifts, the hashes differ and the comparison is
 * refused rather than published. Drift is then detected by running the code, not by describing it.
 *
 * The route carries the RESOLVED stride, not the rule that produced it, so a row records what the
 * decode actually did rather than what it was supposed to do.
 */
import { PRIV_STT, PRIV_STT_V4_VARIANTS } from './sttConstants';
import { buildShippingDecodeOptions } from './decodeOptions';

export type DecodeEngine = 'v2' | 'v4';

export interface DecodeRoute {
    engine: DecodeEngine;
    modelId: string;
    /** v4 only — the per-submodel quantization actually requested. Absent for v2. */
    dtype?: Record<string, string>;
    chunk_length_s: number;
    /** RESOLVED value, never the rule: 0 under the context window, the long-form overlap at or above. */
    stride_length_s: number;
    return_timestamps: boolean;
}

/**
 * Resolve the route a decode WILL take.
 *
 * Window/stride/timestamps come from `buildShippingDecodeOptions`, so this cannot drift from the
 * shipping options by construction — it does not re-derive them.
 *
 * `variantId` is the key into `PRIV_STT_V4_VARIANTS` (`base_q4`, `distil_q4`, …), NOT a model id: the
 * variants map is keyed by variant, so looking it up by model id yields `undefined` and would silently
 * drop the dtype from the identity.
 */
export function resolveDecodeRoute(
    engine: DecodeEngine,
    modelId: string,
    audioSeconds: number,
    variantId?: keyof typeof PRIV_STT_V4_VARIANTS,
): DecodeRoute {
    const options = buildShippingDecodeOptions(audioSeconds);
    const dtype = engine === 'v4' && variantId ? PRIV_STT_V4_VARIANTS[variantId]?.DTYPE : undefined;
    return {
        engine,
        modelId,
        ...(dtype ? { dtype: { ...dtype } } : {}),
        chunk_length_s: options.chunk_length_s,
        stride_length_s: options.stride_length_s,
        return_timestamps: options.return_timestamps,
    };
}

/**
 * A stable identity for a route. Two arms may only be compared when their hashes match.
 *
 * Keys are sorted so property order cannot change the hash, and the digest is truncated only for
 * readability in logs and rows — collisions are irrelevant here because the full route travels with it.
 */
export function routeHash(route: DecodeRoute): string {
    const canonical = JSON.stringify(route, Object.keys(route).sort());
    // A synchronous, dependency-free digest: this runs in a browser worker as well as in Node, so
    // `node:crypto` is not available on every path that needs an identity.
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < canonical.length; i++) {
        const c = canonical.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
    }
    return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12);
}

/** The window the shipping product uses, re-exported so callers need not import two modules. */
export const DECODE_WINDOW_SECONDS = PRIV_STT.WHISPER_WINDOW_SECONDS;
