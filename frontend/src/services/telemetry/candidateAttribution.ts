/**
 * #1259 T2 — WHICH MODEL PRODUCED THIS SESSION?
 *
 * A three-way ear test compares candidates by listening. If the session record cannot say which model
 * decoded, the comparison yields impressions with no attribution — the same uninterpretable silence as
 * before, one layer up.
 *
 * THE ID MUST BE THE ONE THAT RAN, NOT THE ONE THAT WAS ASKED FOR. This exact bug already happened
 * once: `PrivateSTT.getMetadata()` reported the model from a DEFAULT constant, so an int8 session was
 * recorded as q4. Reading the config here would repeat it in telemetry — the config states an
 * INTENTION, and only the engine knows what it resolved and initialised.
 */
import type { CandidateId } from '../transcription/candidateRegistry';

/** The attribution fields every governed event carries. Absent, never guessed, when unresolved. */
export interface CandidateAttribution {
    candidate_id: CandidateId | null;
    engine: string | null;
    runtime_version: string | null;
    asset_digest: string | null;
}

/** What the ENGINE reports about the run it actually performed. */
export interface ResolvedEngineMetadata {
    candidateId?: CandidateId;
    modelIdentity?: {
        engine?: string;
        configuredRuntime?: { version?: string };
        configuredAssets?: { pinDigest?: string | null };
    };
}

const EMPTY: CandidateAttribution = Object.freeze({
    candidate_id: null, engine: null, runtime_version: null, asset_digest: null,
});

/**
 * Derive attribution from the engine's RESOLVED metadata.
 *
 * Returns nulls when the engine could not identify what it ran. A null is honest — it says the session
 * is unattributable — whereas a value taken from the config would assert that a specific model
 * produced a transcript it may not have produced.
 */
export function attributionFromEngine(
    metadata: ResolvedEngineMetadata | null | undefined,
): CandidateAttribution {
    if (!metadata?.candidateId) return { ...EMPTY };
    return {
        candidate_id: metadata.candidateId,
        engine: metadata.modelIdentity?.engine ?? null,
        runtime_version: metadata.modelIdentity?.configuredRuntime?.version ?? null,
        asset_digest: metadata.modelIdentity?.configuredAssets?.pinDigest ?? null,
    };
}

/** True when this session can be attributed to a specific model. */
export function isAttributable(a: CandidateAttribution): boolean {
    return Boolean(a.candidate_id && a.engine && a.runtime_version);
}
