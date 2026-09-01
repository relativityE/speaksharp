/**
 * #1259 T2 — THE GOVERNED EVENT ENVELOPE.
 *
 * Every governed event carries the same ambient context: which release, which model, which kind of
 * traffic. Without it the launch is unmeasurable in the two ways that already cost us a release —
 * we could not tell testers from our own smoke traffic, and we could not tell which model produced a
 * session.
 *
 * ATTACHED AT THE SEAM, NOT SUPPLIED BY PRODUCERS. A producer can forget a field, and
 * `candidate_id` must record what ACTUALLY RAN rather than what a caller believes it asked for — the
 * bug that once logged an int8 session as q4. So this is ambient context added at the single
 * `posthog.capture` boundary, and a producer that tries to supply these keys has them DROPPED by the
 * T1 allowlist before the envelope is applied. The seam's value is the only one that can win.
 *
 * This EXTENDS T1's single governed path. It is not a second envelope and not a second capture point:
 * the allowlist still decides which producer fields survive, and this adds context the producer never
 * had.
 */
import { attributionFromEngine, type CandidateAttribution, type ResolvedEngineMetadata } from './candidateAttribution';
import { resolveTrafficType, type TrafficSignals, type TrafficType } from './trafficType';

export interface EventEnvelope extends CandidateAttribution {
    release_sha: string | null;
    traffic_type: TrafficType;
}

/** The keys the envelope owns. A producer may never set these; the seam always does. */
export const ENVELOPE_KEYS: readonly string[] = Object.freeze([
    'release_sha', 'traffic_type', 'candidate_id', 'engine', 'runtime_version', 'asset_digest',
]);

export interface EnvelopeSources {
    /** The deployed release this build is. Null when the marker is absent, never a guess. */
    releaseSha?: string | null;
    /** What the ENGINE resolved and ran — not what the config requested. */
    engineMetadata?: ResolvedEngineMetadata | null;
    trafficSignals?: TrafficSignals;
}

export function buildEnvelope(sources: EnvelopeSources = {}): EventEnvelope {
    return {
        release_sha: sources.releaseSha ?? null,
        traffic_type: resolveTrafficType(sources.trafficSignals ?? {}),
        ...attributionFromEngine(sources.engineMetadata ?? null),
    };
}

/**
 * Strip envelope keys from producer-supplied props.
 *
 * Belt and braces: the allowlist already drops unknown keys, but a producer key that happened to be
 * allowlisted for one event must still never override the seam's ambient value — otherwise a caller
 * could label its own traffic `user` or claim a model it did not run.
 */
export function stripEnvelopeKeys(props: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!props) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) if (!ENVELOPE_KEYS.includes(k)) out[k] = v;
    return out;
}
