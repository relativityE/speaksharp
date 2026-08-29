/**
 * #1304 Task 3C — GATE: the arm must decode on the route its FAMILY actually ships.
 *
 * This is the gate that disqualified both previous harnesses. `benchmark-whisper-ceiling.mts` forced a
 * 5-second stride onto clips far shorter than the context window and omitted timestamps;
 * `stt-corpus-lane.ts` called a bare `asr(audio)` with no options at all. Neither was wrong about the
 * model — they measured a configuration no user runs, which makes the number a fact about the harness.
 *
 * TWO CORRECTIONS SINCE THE FIRST VERSION, both of which produced wrong verdicts:
 *
 *   1. VARIANT-AWARE. The shipping route was resolved WITHOUT the variant id while the arm declared it
 *      WITH one, so the dtype appeared on one side only and a correctly-configured `base_q4` arm
 *      failed parity against a variant-less route that is not what ships. Both sides now carry the
 *      same variant, and a test proves that changing or omitting it FAILS.
 *   2. FAMILY-AWARE. Moonshine was compared against a Whisper route and recorded as unable to return
 *      Whisper timestamp chunks. The product consumes transcript TEXT, not model timestamps, so that
 *      was a requirement the product does not have. Each family is now compared against its own
 *      canonical route.
 *
 * Parity is checked at THREE durations because decode behaviour branches on length — Whisper at the
 * context window, Moonshine through its duration-derived generation bound. The Whisper boundary probe
 * is EXACTLY the window: the product uses `<`, so the window itself is long-form, and an off-by-one
 * there is invisible to short and long probes alike.
 */
import {
    resolveWhisperRoute,
    resolveMoonshineRoute,
    candidateRouteHash,
    DECODE_WINDOW_SECONDS,
    type CandidateRoute,
} from './candidateRoute';
import { CERTIFICATION_RULES, type RouteParityProbe } from './rules';
import type { PRIV_STT_V4_VARIANTS } from '../../../frontend/src/services/transcription/sttConstants';
import type { DecodeArm } from './engineArm';

/** The three durations, derived from the product's own window rather than restated as literals. */
export const PARITY_PROBE_SECONDS: Record<RouteParityProbe, number> = {
    short: 4.2,
    /** EXACTLY the window. The product's `<` puts this on the long-form branch. */
    boundary: DECODE_WINDOW_SECONDS,
    long: DECODE_WINDOW_SECONDS * 3 + 7.5,
};

/** What the arm is expected to match: identity of engine, model, variant and family. */
export interface RouteExpectation {
    family: 'whisper' | 'moonshine';
    engine: 'v2' | 'v4';
    modelId: string;
    variantId?: keyof typeof PRIV_STT_V4_VARIANTS;
}

export interface RouteParityProbeResult {
    probe: RouteParityProbe;
    audioSeconds: number;
    canonicalHash: string;
    armHash: string;
    matched: boolean;
    canonicalRoute: CandidateRoute;
    armRoute: CandidateRoute;
}

export interface RouteParityResult {
    ok: boolean;
    family: RouteExpectation['family'];
    probes: RouteParityProbeResult[];
}

/** The route a candidate of this family and identity is expected to take. */
export function canonicalRouteFor(expectation: RouteExpectation, audioSeconds: number): CandidateRoute {
    return expectation.family === 'moonshine'
        ? resolveMoonshineRoute(expectation.modelId, audioSeconds)
        : resolveWhisperRoute(expectation.engine, expectation.modelId, audioSeconds, expectation.variantId);
}

/**
 * Compare the arm's DECLARED route against its family's canonical route, by identity hash.
 *
 * The hash rather than a field-by-field comparison written here: it covers the whole resolved route,
 * so a field added to either family's shape is included automatically.
 */
export function checkRouteParity(arm: DecodeArm, expectation: RouteExpectation): RouteParityResult {
    const probes = CERTIFICATION_RULES.routeParityProbes.map((probe) => {
        const audioSeconds = PARITY_PROBE_SECONDS[probe];
        const canonicalRoute = canonicalRouteFor(expectation, audioSeconds);
        const armRoute = arm.declareRoute(audioSeconds);
        const canonicalHash = candidateRouteHash(canonicalRoute);
        const armHash = candidateRouteHash(armRoute);
        return { probe, audioSeconds, canonicalHash, armHash, matched: canonicalHash === armHash, canonicalRoute, armRoute };
    });

    return { ok: probes.every((p) => p.matched), family: expectation.family, probes };
}
