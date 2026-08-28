/**
 * #1304 Task 3C — THE CERTIFICATION RULES.
 *
 * These are IMMUTABLE and NOT caller-selectable. That is the point, and it is why they live in their
 * own module with no parameters threaded through them: a gate a caller can choose is a gate a caller
 * can choose to pass. Every earlier benchmark in this repository was configurable in exactly the way
 * that let it report a number it had not earned.
 *
 * WHAT REPLACED `0.0936`, AND WHY. The retired gate asked the harness to reproduce a historical
 * figure that was a MEAN of per-utterance WERs over SUCCESSFUL ROWS ONLY (`benchmark-whisper-
 * ceiling.mts` divides by `successCount`, and the `catch` above it swallows failures — so a failed
 * decode improved the number), produced by the scorer #1356 disqualified, on the browser product path
 * rather than the corpus path, from an artifact that no longer exists. Tuning a new harness to
 * reproduce it would have certified the new work against the old defect.
 *
 * What certifies a harness is not agreement with a remembered number. It is that the harness decodes
 * on the SAME ROUTE as the shipping product, normalizes exactly as the official scorer does, and
 * arithmetically turns audio into a pooled WER — each proven by running it.
 */

/** Frozen so a caller cannot mutate a rule at runtime and then claim certification under it. */
export const CERTIFICATION_RULES = Object.freeze({
    version: 'cert_v1',

    /**
     * Route parity is checked at THREE points, because the decode path branches on duration and a
     * harness that agreed with the product only on short clips would still measure a configuration no
     * user runs on everything longer.
     *
     * The boundary is included explicitly: the product uses `<`, so the window itself is long-form.
     * An off-by-one there is invisible to short and long samples alike.
     */
    routeParityProbes: Object.freeze(['short', 'boundary', 'long'] as const),

    /** Every official vector, through the harness's own scoring path. Not a sample of them. */
    requiredOracleVectors: 68,

    /**
     * The official normalizer is NOT IDEMPOTENT on these inputs: `"..."` normalizes to `"."`, and `"."`
     * normalizes to nothing. For such a vector the "score input against expected and expect WER 0" form
     * of the oracle check cannot hold, because re-normalizing the already-normalized reference changes
     * it. That is harmless in real scoring, where both sides are raw text normalized exactly once.
     *
     * They are ENUMERATED rather than covered by a general "skip unmeasurable vectors" rule, because a
     * general exemption is somewhere a real divergence could hide. A new one fails the gate.
     */
    nonIdempotentOracleInputs: Object.freeze(['...'] as readonly string[]),

    /**
     * Pooled: Σ(S+D+I) / Σ(referenceWords). NEVER the mean of per-utterance WERs, which over-weights
     * short clips and is not comparable with any published figure.
     */
    aggregation: 'pooled' as const,

    /** Track A — official normalization, fillers removed — is the only track a WER row may claim. */
    track: 'track_a' as const,

    /** Provenance fields that must ALL be present. A row with an incomplete record is not emitted. */
    requiredProvenance: Object.freeze([
        'model', 'runtime', 'assets', 'device', 'route', 'corpus', 'resources',
    ] as const),
});

export type CertificationRules = typeof CERTIFICATION_RULES;
export type RouteParityProbe = CertificationRules['routeParityProbes'][number];
export type RequiredProvenanceField = CertificationRules['requiredProvenance'][number];
