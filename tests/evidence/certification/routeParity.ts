/**
 * #1304 Task 3C — GATE: the arm must decode on the SAME ROUTE as the shipping product.
 *
 * This is the gate that disqualified both previous harnesses. `benchmark-whisper-ceiling.mts` forced a
 * 5-second stride onto clips far shorter than the context window and omitted timestamps;
 * `stt-corpus-lane.ts` called a bare `asr(audio)` with no options at all. Neither was wrong about the
 * model — they were measuring a configuration no user runs, which makes the resulting number a fact
 * about the harness.
 *
 * Parity is checked at THREE points because the decode path BRANCHES on duration. A harness that
 * agreed with the product on short clips would still diverge on everything past the window, and the
 * boundary itself is where an off-by-one lives: the product uses `<`, so the window is long-form.
 */
import {
    resolveDecodeRoute,
    routeHash,
    DECODE_WINDOW_SECONDS,
    type DecodeRoute,
} from '../../../frontend/src/services/transcription/decodeRoute';
import { CERTIFICATION_RULES, type RouteParityProbe } from './rules';
import type { DecodeArm } from './engineArm';

/** The three durations, derived from the product's own window rather than restated as literals. */
export const PARITY_PROBE_SECONDS: Record<RouteParityProbe, number> = {
    short: 4.2,
    /** EXACTLY the window. The product's `<` puts this on the long-form branch. */
    boundary: DECODE_WINDOW_SECONDS,
    long: DECODE_WINDOW_SECONDS * 3 + 7.5,
};

export interface RouteParityProbeResult {
    probe: RouteParityProbe;
    audioSeconds: number;
    shippingHash: string;
    armHash: string;
    matched: boolean;
    shippingRoute: DecodeRoute;
    armRoute: DecodeRoute;
}

export interface RouteParityResult {
    ok: boolean;
    probes: RouteParityProbeResult[];
}

/**
 * Compare the arm's DECLARED route against the shipping route, by identity hash.
 *
 * The hash, not a field-by-field comparison written here: the hash covers the whole resolved route, so
 * a field added to `DecodeRoute` later is included automatically. A hand-written comparison would
 * silently stop covering it.
 */
export function checkRouteParity(arm: DecodeArm, engine: 'v2' | 'v4', modelId: string): RouteParityResult {
    const probes = CERTIFICATION_RULES.routeParityProbes.map((probe) => {
        const audioSeconds = PARITY_PROBE_SECONDS[probe];
        const shippingRoute = resolveDecodeRoute(engine, modelId, audioSeconds);
        const armRoute = arm.declareRoute(audioSeconds);
        const shippingHash = routeHash(shippingRoute);
        const armHash = routeHash(armRoute);
        return { probe, audioSeconds, shippingHash, armHash, matched: shippingHash === armHash, shippingRoute, armRoute };
    });

    return { ok: probes.every((p) => p.matched), probes };
}
