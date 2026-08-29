/**
 * #1304 — THE FULL MEASUREMENT SCHEMA, defined before the frozen-600 run rather than after.
 *
 * WER alone cannot choose a model. A candidate that is one word better and twice the download, or that
 * silently drops one clip in fifty, is not the better candidate — and a run that measured only accuracy
 * would have to be paid for a second time to find that out. So the schema is fixed here, and the 600
 * produces the whole table in one pass.
 *
 * TWO SEPARATE VERDICTS, deliberately never merged into one score:
 *
 *   TECHNICAL      — accuracy, reliability, speed, memory, bytes, short/long behaviour.
 *   ACTIVATION     — adapter work, self-hosting, finalization strategy, fallback proof, telemetry,
 *                    licence notice.
 *
 * Combining them lets the easiest-to-integrate model beat a materially better one, and buries the
 * reason inside a single number nobody can argue with. They are reported side by side instead.
 */

/** Every clip's fate. "Scored" is not the same as "all of them ran". */
export interface ReliabilityMetrics {
    expectedClips: number;
    decoded: number;
    /** Decode threw. Recorded and still scored — a skip would flatter the arm. */
    threw: number;
    /** Model returned nothing. A RESULT, not an error. */
    emptyOutput: number;
    /** Exceeded its deadline. */
    timedOut: number;
    /** Audio failed its frozen digest or could not be read — never the model's fault, never hidden. */
    audioRejected: number;
    /** Clips absent from the run entirely, against the set's expected ids. Should always be zero. */
    missing: number;
}

export interface SpeedMetrics {
    /** First load, cold cache: what a new user waits for once. */
    coldLoadMs: number | null;
    /** Per-clip decode, warm. */
    warmDecodeMsP50: number | null;
    warmDecodeMsP95: number | null;
    /** Decode wall-clock ÷ audio duration. Below 1.0 is faster than real time. */
    realTimeFactorP50: number | null;
    realTimeFactorP95: number | null;
    /** Stop → final transcript for the long-form control; what the user actually experiences. */
    stopToFinalMs: number | null;
}

export interface FootprintMetrics {
    /** Bytes the user must download and cache before the first transcript. */
    modelBytes: number | null;
    /** Number of asset files, since many small files cost round trips a byte total hides. */
    assetCount: number | null;
    /** Peak resident memory where observable. NULL in a browser page — never fabricated. */
    peakMemoryBytes: number | null;
}

/** Short and >30s behaviour: the failure modes WER averages away. */
export interface DurationBehaviour {
    shortestClipSeconds: number | null;
    longestClipSeconds: number | null;
    /** Long-form control: did the ending survive? */
    longFormTailPreserved: boolean | null;
    /** Repeated 5-grams — the shape a looping decode takes. */
    longFormRepeatedNgrams: number | null;
    /** Output far shorter than the reference: truncation rather than error. */
    truncatedClips: number;
}

export interface TechnicalVerdict {
    armId: string;
    /** Set when this row's assets are byte-identical to another arm's — one candidate, two dtype names. */
    dtypeAliasOf?: string;
    /**
     * `diagnostic` rows answer a question about the harness, not about a candidate, and may never
     * rank. Carried on the row because the ranking is computed from rows, not from the registry — the
     * alias was excluded here while the diagnostic duplicate was not, so one of the two extra measured
     * arms could still have entered a ranking.
     */
    role?: 'selection' | 'diagnostic';
    /** Which browser runtime produced this. Rows from different runtimes MUST NOT be ranked together. */
    runtimeLabel: string;
    evidenceSet: string;
    evidenceClass: string;
    wer: number | null;
    referenceWords: number;
    reliability: ReliabilityMetrics;
    speed: SpeedMetrics;
    footprint: FootprintMetrics;
    duration: DurationBehaviour;
    backendProven: boolean;
    resolvedBackend: string | null;
    hardwareRepresentative: boolean;
    transcriptDigest: string | null;
    fingerprint: string;
    assetDigestCount: number;
}

/** What it would take to SHIP this candidate — never folded into the technical comparison. */
export interface ActivationReadiness {
    armId: string;
    /** A model-family adapter in the production worker (Moonshine is not Whisper-shaped). */
    adapter: 'exists' | 'needs_family_branch' | 'unknown';
    /** Self-hosted from our own origin, with pinned digests and remote loading disabled. */
    selfHosting: 'done' | 'needs_bundling' | 'unknown';
    /** Authoritative multi-minute finalization — the dominant risk for a bounded-context model. */
    finalization: 'whole_utterance_ok' | 'needs_segmented_strategy' | 'unknown';
    /** Automatic fallback proven under forced primary failure. */
    fallbackProof: 'proven' | 'not_proven';
    telemetry: 'model_identity_wired' | 'needs_wiring' | 'unknown';
    /** Licence text and attribution travelling with the self-hosted assets. */
    licenceNotice: 'bundled' | 'needs_bundling' | 'unknown';
    notes: string;
}

export const PERCENTILE_NOTE =
    'p50/p95 over per-clip decodes. With fewer than 20 clips a p95 is one or two samples and is '
    + 'reported as an observation, never as a percentile anyone should plan against.';

/** Nearest-rank percentile. Returns null rather than inventing a value from too few samples. */
export function percentile(values: readonly number[], p: number): number | null {
    const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
    return sorted[rank - 1] ?? null;
}

/**
 * Refuse to rank rows produced under different runtimes.
 *
 * The ORT Web upgrade changes the inference library beneath every v4 and Moonshine arm. Old- and
 * new-runtime numbers are measurements of different systems; a single sorted table would silently
 * compare them and the ordering would be an artifact of which rows had been re-run.
 */
export function assertSingleRuntime(rows: readonly TechnicalVerdict[]): string {
    const labels = new Set(rows.map((r) => r.runtimeLabel));
    if (labels.size > 1) {
        throw new Error(
            `refusing to rank across runtimes: ${[...labels].sort().join(' vs ')}. `
            + 'Old- and new-runtime results are measurements of different systems and must stay '
            + 'separately labelled.',
        );
    }
    return [...labels][0] ?? 'unknown';
}

/** Rank by WER, within ONE runtime and ONE evidence set, and only over selection-grade rows. */
export function rankTechnical(
    rows: readonly TechnicalVerdict[],
    options: { requireSelectionGrade: boolean },
): TechnicalVerdict[] {
    assertSingleRuntime(rows);
    const sets = new Set(rows.map((r) => r.evidenceSet));
    if (sets.size > 1) {
        throw new Error(`refusing to rank across evidence sets: ${[...sets].sort().join(' vs ')}`);
    }
    const eligible = rows.filter((r) =>
        r.wer !== null
        && r.backendProven
        && r.reliability.missing === 0
        // An ALIAS is the same candidate under a second dtype name. Ranking both would list one model
        // twice and read as two independent results agreeing — proven by byte-identical decoder
        // graphs, not inferred from a matching score.
        && r.dtypeAliasOf === undefined
        // A diagnostic row is a fact about the harness, not a candidate.
        && r.role !== 'diagnostic'
        && (!options.requireSelectionGrade || r.evidenceClass === 'selection'));
    return [...eligible].sort((a, b) => (a.wer ?? 1) - (b.wer ?? 1));
}
