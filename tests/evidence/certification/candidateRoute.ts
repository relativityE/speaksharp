/**
 * #1304 Task 3C — ROUTE IDENTITY ACROSS MODEL FAMILIES.
 *
 * The first version had exactly one route shape — Whisper's — and compared every candidate against it.
 * That made Moonshine fail for a reason that was not true: it was recorded as unable to return Whisper
 * timestamp chunks, when the PRODUCT CONSUMES TRANSCRIPT TEXT, not model timestamps. A requirement the
 * product does not have is not a rejection; it is a bug in the gate.
 *
 * A route is therefore a FAMILY plus that family's resolved decode parameters. Two arms are comparable
 * when each matches the canonical route of its OWN family — which is what "the harness did not distort
 * the decode" actually means. It never meant "every model decodes like Whisper".
 */
import {
    resolveDecodeRoute,
    DECODE_WINDOW_SECONDS,
    type DecodeRoute,
} from '../../../frontend/src/services/transcription/decodeRoute';
import type { PRIV_STT_V4_VARIANTS } from '../../../frontend/src/services/transcription/sttConstants';

export type RouteFamily = 'whisper' | 'moonshine';

export interface WhisperCandidateRoute {
    family: 'whisper';
    engine: 'v2' | 'v4';
    modelId: string;
    variantId?: keyof typeof PRIV_STT_V4_VARIANTS;
    decode: DecodeRoute;
}

/**
 * Moonshine's NATIVE route.
 *
 * It is not a windowed log-mel model: it consumes the raw 16 kHz waveform, its positional budget is
 * 512, and it has no timestamp tokens — so it never requests them. `condition_on_previous_text` is
 * Whisper-only and must never be passed. The generation bound is derived from duration, which is the
 * parameter an earlier long-form test omitted entirely and then wrongly concluded the model looped.
 */
export interface MoonshineCandidateRoute {
    family: 'moonshine';
    modelId: string;
    rawWaveform: true;
    maxPositionEmbeddings: number;
    returnTimestamps: false;
    /** Tokens allowed, derived from audio length. Absent, generation is unbounded — which is how a
     *  looped fixture once produced a "model loops" conclusion that had to be retracted. */
    maxNewTokens: number;
}

export type CandidateRoute = WhisperCandidateRoute | MoonshineCandidateRoute;

/** Moonshine's documented positional budget. */
export const MOONSHINE_MAX_POSITION_EMBEDDINGS = 512;

/**
 * Moonshine's published guidance is roughly 6 output tokens per second of audio. The bound is capped
 * by the positional budget, because asking for more than the model can position is not a bound.
 */
export const MOONSHINE_TOKENS_PER_SECOND = 6;

export function resolveMoonshineRoute(modelId: string, audioSeconds: number): MoonshineCandidateRoute {
    return {
        family: 'moonshine',
        modelId,
        rawWaveform: true,
        maxPositionEmbeddings: MOONSHINE_MAX_POSITION_EMBEDDINGS,
        returnTimestamps: false,
        maxNewTokens: Math.min(
            MOONSHINE_MAX_POSITION_EMBEDDINGS,
            Math.max(1, Math.ceil(audioSeconds * MOONSHINE_TOKENS_PER_SECOND)),
        ),
    };
}

export function resolveWhisperRoute(
    engine: 'v2' | 'v4',
    modelId: string,
    audioSeconds: number,
    variantId?: keyof typeof PRIV_STT_V4_VARIANTS,
): WhisperCandidateRoute {
    return {
        family: 'whisper',
        engine,
        modelId,
        // Included ONLY when the product registry ships this combination, and included on BOTH sides
        // of a comparison. Omitting it on one side made a correct v4 arm fail parity against a
        // variant-less route that is not what ships.
        ...(variantId ? { variantId } : {}),
        decode: resolveDecodeRoute(engine, modelId, audioSeconds, variantId),
    };
}

/**
 * A stable identity over the WHOLE route, family included. Keys are sorted at every level so property
 * order cannot change the hash, and a field added to either family's shape is covered automatically —
 * a hand-written field-by-field comparison would silently stop covering it.
 */
export function candidateRouteHash(route: CandidateRoute): string {
    const canonical = JSON.stringify(route, (_key, value) =>
        value && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
            : value,
    );
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < canonical.length; i++) {
        const c = canonical.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
    }
    return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12);
}

/** Does this route request timestamps? Only Whisper ever does. */
export function routeRequestsTimestamps(route: CandidateRoute): boolean {
    return route.family === 'whisper' ? route.decode.return_timestamps : false;
}

export { DECODE_WINDOW_SECONDS };
