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
import { currentJourneyId, currentAttemptId, currentAttemptSeq } from './journeyIdentity';

export interface EventEnvelope extends CandidateAttribution {
    release_sha: string | null;
    traffic_type: TrafficType;
    /**
     * #1259 — THE CORRELATION IDENTITY, ambient like every other envelope field.
     *
     * It belongs here rather than in each event's schema for the reason `candidate_id` does: a
     * producer can forget it, and a producer that supplies it can claim a journey it does not belong
     * to. Attaching it at the seam makes both impossible. `attempt_id` is null outside a recording
     * attempt and `attempt_seq` is 0 — honest absence, never a fabricated join key.
     */
    journey_id: string;
    attempt_id: string | null;
    attempt_seq: number;
}

/** The keys the envelope owns. A producer may never set these; the seam always does. */
export const ENVELOPE_KEYS: readonly string[] = Object.freeze([
    'release_sha', 'traffic_type', 'candidate_id', 'engine', 'runtime_version', 'asset_digest',
    'journey_id', 'attempt_id', 'attempt_seq',
]);

export interface EnvelopeSources {
    /** The deployed release this build is. Null when the marker is absent, never a guess. */
    releaseSha?: string | null;
    /** What the ENGINE resolved and ran — not what the config requested. */
    engineMetadata?: ResolvedEngineMetadata | null;
    trafficSignals?: TrafficSignals;
}

/**
 * The empty attribution. Every model field null, stated once so "unverified" cannot drift into a
 * partially-populated shape that reads as a measurement.
 */
export const UNVERIFIED_ATTRIBUTION: CandidateAttribution = Object.freeze({
    candidate_id: null,
    engine: null,
    runtime_version: null,
    asset_digest: null,
});

export function buildEnvelope(
    sources: EnvelopeSources = {},
    /**
     * A PRODUCER THAT KNOWS IT CANNOT ATTRIBUTE OVERRULES THE AMBIENT STATE.
     *
     * The envelope always read `resolvedEngine()` — whatever model is live in this tab right now. For
     * most events that is the right answer. For a Report Issue whose linked session cannot be verified,
     * it is precisely the wrong one: the producer had already worked out that it must not name a model,
     * emitted `engine_variant: null`, and then the envelope helpfully supplied `candidate_id`, `engine`,
     * `runtime_version` and `asset_digest` from the current tab on the way to the wire.
     *
     * So a report about a Moonshine session, filed after switching to v2, reached PostHog attributed to
     * v2 — with the honest null sitting beside it. Release and traffic type stay ambient: they are
     * independently known and have nothing to do with which model ran.
     */
    modelAttributionVerified = true,
): EventEnvelope {
    return {
        release_sha: sources.releaseSha ?? null,
        traffic_type: resolveTrafficType(sources.trafficSignals ?? {}),
        // Read at BUILD time, which for a buffered event is push time — the same snapshot discipline
        // that keeps `candidate_id` from drifting to whatever model resolved by the time the queue drained.
        journey_id: currentJourneyId(),
        attempt_id: currentAttemptId(),
        attempt_seq: currentAttemptSeq(),
        ...(modelAttributionVerified
            ? attributionFromEngine(sources.engineMetadata ?? null)
            : UNVERIFIED_ATTRIBUTION),
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
