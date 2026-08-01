/**
 * #1037 — STT evidence orchestrator, Lane A (corpus) required artifact schema.
 *
 * WHY THIS EXISTS: STT evidence is at least two distinct classes that must never be ranked together
 * (corpus vs real-browser journey). A row is admissible only when it carries the full schema AND proves
 * the fixture audio actually reached the recognizer. Everything here FAILS CLOSED: a row that cannot
 * prove its route, or that is missing any required field, is marked invalid with a reason and is
 * excluded from rankings rather than silently averaged in.
 *
 * `audio_route_proven` is DERIVED from structured evidence (payload hash + byte/sample counts, and for
 * Cloud the submitted-payload hash + provider job id). It is never a self-attested boolean, and a start
 * timestamp is NOT route proof — a recognizer can start and receive nothing.
 */

/** Evidence class. Corpus and browser-journey rows must never share a WER ranking. */
export type ComparabilityClass = 'corpus_fixture' | 'browser_journey';

export type RunValidity = 'valid' | 'invalid';

/** Closed set — an unrecognized failure is `unknown`, never invented. */
export type FailureClass =
    | 'none'
    | 'model_load_failed'
    | 'decode_failed'
    | 'audio_route_unproven'
    | 'timeout'
    | 'provider_error'
    | 'unknown';

/**
 * Structured proof that the fixture audio entered the recognizer.
 *
 * `adapterInputPayloadSha256` is the hash of the PCM/payload actually handed to the adapter — not the
 * source file — so a fixture that was loaded but never routed cannot pass. Byte and sample counts bound
 * it further: a zero-length or truncated payload is not a proven route.
 */
export interface AudioRouteEvidence {
    /** SHA-256 of the fixture as read from disk. */
    fixtureSha256: string;
    /** SHA-256 of the PCM/payload handed to the adapter input. THE route-entry proof. */
    adapterInputPayloadSha256: string;
    /** Byte length of that adapter-input payload. Must be > 0. */
    adapterInputBytes: number;
    /** Decoded sample count handed to the adapter. Must be > 0. */
    decodedSampleCount: number;
    /** Decoded duration in seconds. Must be > 0. */
    decodedDurationSeconds: number;
    /** Cloud only: SHA-256 of the payload actually submitted to the provider. */
    submittedPayloadSha256?: string;
    /** Cloud only: the provider's job/request identity for the submission. */
    providerJobId?: string;
}

/**
 * Runtime capability. Threads are reported at three distinct levels because CONFIGURATION IS NOT PROOF
 * OF USE: only `workerReportedThreads` reflects what the worker actually reports running with. The word
 * "effective" is deliberately absent from this type.
 */
export interface RuntimeCapability {
    /** `null` when no specific count was requested (e.g. the Node corpus harness leaves it to the default). */
    requestedThreads: number | null;
    /** `null` when the achieved count was not configured/observed — never invented. */
    configuredThreads: number | null;
    /** What the worker actually reported. `null` when the runtime does not report it — never inferred. */
    workerReportedThreads: number | null;
    /**
     * `node-onnxruntime` is the Node corpus harness (onnxruntime-node native bindings) — model-equivalent
     * to, but NOT the same runtime as, the production browser worker (`wasm`/`wasm-multithread`/`webgpu`).
     */
    runtimePath: 'wasm' | 'wasm-multithread' | 'webgpu' | 'node-onnxruntime';
    crossOriginIsolated: boolean;
    sharedArrayBufferAvailable: boolean;
    /** Populated when the achieved configuration differs from the requested one. */
    fallbackReason: string | null;
}

/**
 * Versioned inputs that make two rows comparable. Ranking requires ALL of these to match, so a corpus
 * change, a normalization change, or a runtime upgrade cannot silently shift a comparison.
 */
/** Revisions that move over time — pinning to them makes a "comparable" cohort silently incomparable. */
export const MUTABLE_REVISIONS = new Set(['main', 'master', 'latest', 'head', 'HEAD', '']);

export interface ComparabilityInputs {
    /** Single canonical fixture hash — the same value as AudioRouteEvidence.fixtureSha256. */
    fixtureHash: string;
    groundTruthVersion: string;
    normalizationVersion: string;
    decodeConfiguration: string;
    modelRevision: string;
    /** e.g. { onnxruntime: '1.27.0', transformers: '3.x' } */
    runtimeVersions: Record<string, string>;
}

/** One measured corpus row. Every field in the #1037 required schema is present. */
export interface SttEvidenceRow {
    // ── #1037 required schema (all 17) ──
    comparability_class: ComparabilityClass;
    engine: string;
    engine_version: string;
    /**
     * #1033 persisted producing-engine attribution. Engine-specific evidence is admissible ONLY when
     * the recording's attribution was durably verified — a `pending`/`unverified`/`legacy_unknown` row
     * cannot be published under its claimed engine.
     */
    attribution_status: 'verified' | 'pending' | 'unverified' | 'legacy_unknown';
    model_name: string;
    browser: string;
    browser_version: string;
    os: string;
    device: string;
    network_condition: string;
    fixture_id: string;
    /** DERIVED by `deriveAudioRouteProven` — never supplied by the adapter. */
    audio_route_proven: boolean;
    run_validity: RunValidity;
    invalid_reason: string | null;
    /** Only present when route is proven AND ground truth exists. Never estimated. */
    wer: number | null;
    first_partial_latency_ms: number | null;
    finalization_latency_ms: number | null;
    failure_class: FailureClass;
    release_sha: string;

    // ── Structured supporting evidence ──
    audio_route_evidence: AudioRouteEvidence;
    runtime_capability: RuntimeCapability;
    comparability_inputs: ComparabilityInputs;
}

/**
 * Derives route proof from structured evidence. Cloud rows must additionally carry the submitted-payload
 * hash and a provider job id — otherwise we only know we *intended* to send audio, not that the provider
 * received it.
 */
export function deriveAudioRouteProven(
    ev: AudioRouteEvidence,
    engine: string,
): { proven: boolean; reason: string | null } {
    if (!ev.fixtureSha256) return { proven: false, reason: 'missing fixture hash' };
    if (!ev.adapterInputPayloadSha256) return { proven: false, reason: 'missing adapter-input payload hash' };
    if (!(ev.adapterInputBytes > 0)) return { proven: false, reason: 'adapter-input payload is empty' };
    if (!(ev.decodedSampleCount > 0)) return { proven: false, reason: 'no decoded samples reached the adapter' };
    if (!(ev.decodedDurationSeconds > 0)) return { proven: false, reason: 'decoded duration is zero' };
    if (engine === 'cloud') {
        if (!ev.submittedPayloadSha256) return { proven: false, reason: 'cloud row missing submitted-payload hash' };
        if (!ev.providerJobId) return { proven: false, reason: 'cloud row missing provider job id' };
    }
    return { proven: true, reason: null };
}

/** Release evidence must identify the EXACT deployed commit — an abbreviated SHA is ambiguous. */
export const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

const REQUIRED_STRING_FIELDS = [
    'comparability_class', 'engine', 'engine_version', 'browser', 'browser_version',
    'os', 'device', 'network_condition', 'fixture_id', 'release_sha', 'model_name',
] as const satisfies readonly (keyof SttEvidenceRow)[];

/**
 * Fail-closed validation. Returns the row with `run_validity` / `invalid_reason` / `audio_route_proven`
 * set from the evidence — the caller cannot mark its own row valid.
 */
export function finalizeRow(
    row: Omit<SttEvidenceRow, 'audio_route_proven' | 'run_validity' | 'invalid_reason'> &
        Partial<Pick<SttEvidenceRow, 'invalid_reason'>>,
): SttEvidenceRow {
    const problems: string[] = [];

    for (const f of REQUIRED_STRING_FIELDS) {
        const v = (row as Record<string, unknown>)[f];
        if (typeof v !== 'string' || v.trim() === '') problems.push(`missing ${f}`);
    }

    if (!FULL_SHA_RE.test(String(row.release_sha ?? ''))) {
        problems.push(`release_sha '${row.release_sha}' must be the FULL 40-character commit SHA`);
    }

    const route = deriveAudioRouteProven(row.audio_route_evidence, row.engine);
    if (!route.proven) problems.push(`audio route unproven: ${route.reason}`);

    if (row.attribution_status !== 'verified') {
        problems.push(`attribution_status is '${row.attribution_status}', not 'verified' — engine evidence inadmissible`);
    }

    const ci = row.comparability_inputs;
    for (const [k, v] of Object.entries({
        fixtureHash: ci?.fixtureHash, groundTruthVersion: ci?.groundTruthVersion,
        normalizationVersion: ci?.normalizationVersion, decodeConfiguration: ci?.decodeConfiguration,
        modelRevision: ci?.modelRevision,
    })) {
        if (!v) problems.push(`missing comparability input ${k}`);
    }
    if (ci?.modelRevision && MUTABLE_REVISIONS.has(ci.modelRevision)) {
        problems.push(`modelRevision '${ci.modelRevision}' is mutable — pin an immutable revision`);
    }
    if (!ci?.runtimeVersions || Object.keys(ci.runtimeVersions).length === 0) {
        problems.push('runtimeVersions must be a non-empty map — a silent runtime upgrade would invalidate any ranking');
    }
    // One canonical fixture hash: the comparability input must be the same value the route proved.
    if (ci?.fixtureHash && row.audio_route_evidence?.fixtureSha256 &&
        ci.fixtureHash !== row.audio_route_evidence.fixtureSha256) {
        problems.push('fixtureHash does not match the routed fixture');
    }

    // WER is only admissible on a proven route. Never estimated, never defaulted to zero.
    const wer = route.proven ? (row.wer ?? null) : null;

    const invalid = problems.length > 0 || row.invalid_reason != null;
    return {
        ...row,
        wer,
        audio_route_proven: route.proven,
        run_validity: invalid ? 'invalid' : 'valid',
        invalid_reason: invalid ? [row.invalid_reason, ...problems].filter(Boolean).join('; ') : null,
        failure_class: !route.proven && row.failure_class === 'none' ? 'audio_route_unproven' : row.failure_class,
    };
}

/**
 * The identity two rows must share before their numbers may be compared. Ranking across differing
 * fixtures, runtimes, models or normalization is meaningless, so the key includes all of them.
 */
export function cohortKey(r: SttEvidenceRow): string {
    const ci = r.comparability_inputs;
    return [
        r.comparability_class, r.engine, r.engine_version, r.model_name,
        ci.fixtureHash, ci.groundTruthVersion, ci.normalizationVersion,
        ci.decodeConfiguration, ci.modelRevision,
        Object.entries(ci.runtimeVersions ?? {}).sort().map(([k, v]) => `${k}@${v}`).join(','),
    ].join('|');
}

/** Admissible rows only — valid, route-proven, verified attribution, and carrying a real WER. */
export function rankableRows(rows: SttEvidenceRow[]): SttEvidenceRow[] {
    return rows.filter(r =>
        r.run_validity === 'valid' &&
        r.audio_route_proven &&
        r.attribution_status === 'verified' &&
        r.wer !== null);
}

/**
 * Group admissible rows into comparable cohorts. Comparison/ranking MUST happen inside one group —
 * `rankableRows()` alone filters bad rows but does not stop two good rows from different cohorts being
 * ranked against each other, which is the subtler error.
 */
export function rankableCohorts(rows: SttEvidenceRow[]): Map<string, SttEvidenceRow[]> {
    const out = new Map<string, SttEvidenceRow[]>();
    for (const r of rankableRows(rows)) {
        const k = cohortKey(r);
        out.set(k, [...(out.get(k) ?? []), r]);
    }
    return out;
}

/**
 * A single corpus execution yields OBSERVATIONS, never a percentile. A p95 requires a defined
 * repeated-run sample with warm/cold classification, so this deliberately refuses to compute one.
 */
export const PERCENTILE_POLICY = {
    minRunsForPercentile: 20,
    requiresWarmColdClassification: true,
    note: 'A single corpus execution emits observations only. p95 requires repeated runs with warm/cold classification and a recorded distribution.',
} as const;
