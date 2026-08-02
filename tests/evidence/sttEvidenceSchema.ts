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

/** Closed set of how a browser_journey may be driven — enforced at RUNTIME (types are erased). */
export const BROWSER_EXECUTION_MODES = new Set(['automated', 'manual-assisted']);

/** Cloud/Private engine keys a browser_journey MUST prove its guard protected (installed before app code). */
export const REQUIRED_FORBIDDEN_ENGINE_KEYS = ['assemblyai', 'transformers-js', 'transformers-js-v4', 'whisper-turbo'];

/**
 * #1037: a browser_journey row must declare an HONEST runtime_capability (the Browser/Web-Speech runtime
 * path + a well-typed capability shape), validated at runtime rather than skipped. Returns problems (empty
 * = admissible). Mirrors scripts/validate-stt-evidence.mjs.
 */
function browserRuntimeCapabilityProblems(rc: unknown): string[] {
    if (typeof rc !== 'object' || rc === null || Array.isArray(rc)) {
        return ['browser_journey runtime_capability must be an object'];
    }
    const cap = rc as Record<string, unknown>;
    const problems: string[] = [];
    if (cap.runtimePath !== 'browser-webspeech') problems.push(`browser_journey runtime_capability.runtimePath must be 'browser-webspeech', got '${String(cap.runtimePath)}'`);
    for (const k of ['requestedThreads', 'configuredThreads', 'workerReportedThreads']) {
        if (!(cap[k] === null || (typeof cap[k] === 'number' && Number.isFinite(cap[k])))) problems.push(`browser_journey runtime_capability.${k} must be a finite number or null`);
    }
    for (const k of ['crossOriginIsolated', 'sharedArrayBufferAvailable']) {
        if (typeof cap[k] !== 'boolean') problems.push(`browser_journey runtime_capability.${k} must be a boolean`);
    }
    if (!(cap.fallbackReason === null || typeof cap.fallbackReason === 'string')) problems.push('browser_journey runtime_capability.fallbackReason must be a string or null');
    return problems;
}

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
    runtimePath: 'wasm' | 'wasm-multithread' | 'webgpu' | 'node-onnxruntime' | 'browser-webspeech';
    crossOriginIsolated: boolean;
    sharedArrayBufferAvailable: boolean;
    /** Populated when the achieved configuration differs from the requested one. */
    fallbackReason: string | null;
}

/** Browser/Web Speech assertions that distinguish a real recording from an availability smoke. */
export interface BrowserJourneyEvidence {
    supportState: 'supported' | 'unavailable' | 'start-failure';
    executionMode: 'automated' | 'manual-assisted';
    recognitionStarted: boolean;
    timerAdvanced: boolean;
    transcriptProduced: boolean;
    sessionProduced: boolean;
    browserManagedTranscription: true;
    applicationServerWrites: number;
    cloudProviderCalls: number;
    /**
     * SHA-256 of the PROMPT/utterance text the operator spoke — informational provenance only. It is NOT
     * an audio-fixture hash and never proves an audio route (attended speech is played through a physical
     * speaker/mic; Web Speech's capture is opaque). Kept off `fixtureHash` deliberately.
     */
    promptSha256?: string;
    /**
     * Forbidden-engine tripwire result carried IN THE ROW (not just the artifact envelope) so the offline
     * validator — the runtime boundary for arbitrary JSON — can independently enforce it. Each entry records
     * a Cloud/Private engine that was constructed/started during the journey. Admissibility REQUIRES this to
     * be present and EMPTY: a missing field cannot prove the guard ran, and a non-empty list proves a
     * forbidden engine fired. See scripts/browser-webspeech-evidence.mts.
     */
    forbiddenEngineInvocations: Array<{ key: string; phase: string; at: number }>;
    /**
     * Proof the forbidden-engine guard was INSTALLED (atomically, before any application module could
     * resolve an engine) and the exact key set it protected. An empty invocation list is only meaningful if
     * the guard is proven installed and covers every required Cloud/Private key — so admissibility REQUIRES
     * `installed === true` and `protectedKeys ⊇ REQUIRED_FORBIDDEN_ENGINE_KEYS`.
     */
    forbiddenEngineGuard: { installed: boolean; protectedKeys: string[] };
    /**
     * Release-proof eligibility as the LOADED build reported it (`__APP_RUNTIME_CONFIG__.releaseProofEligible`).
     * Admissibility REQUIRES `true` — a diagnostic/mock runtime (which reports false) cannot back release
     * evidence even if it exposes a 40-char `__APP_RELEASE__`.
     */
    releaseProofEligible: boolean;
}

/** Worker-origin facts required before a browser-WASM row can claim production-worker coverage. */
export interface PrivateWorkerEvidence {
    workerUsed: boolean;
    modelSource: 'self-hosted';
    modelLoaded: string;
    modelProvenance: {
        modelId: string;
        modelRevision: string;
        verdict: 'identical' | 'differs' | 'unverifiable';
        files: Array<{
            file: string;
            expectedSha256: string;
            actualSha256: string | null;
            identical: boolean;
        }>;
    };
    mainThreadInputSha256: string;
    mainThreadInputSamples: number;
    mainThreadInputBytes: number;
    mainThreadInputDurationSeconds: number;
    workerInputSha256: string;
    workerInputSamples: number;
    workerInputBytes: number;
    workerInputDurationSeconds: number;
    inputHashesMatch: boolean;
    cloudProviderCalls: number;
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
    browser_journey_evidence?: BrowserJourneyEvidence;
    private_worker_evidence?: PrivateWorkerEvidence;
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
export const SHA256_RE = /^[0-9a-f]{64}$/i;
export const PRIVATE_PCM_SAMPLE_RATE_HZ = 16_000;
export const PRIVATE_PCM_DURATION_TOLERANCE_SECONDS = 1e-6;
export const PRIVATE_V2_PROVENANCE_REQUIRED_FILES = [
    'added_tokens.json',
    'config.json',
    'generation_config.json',
    'merges.txt',
    'normalizer.json',
    'onnx/decoder_model_merged_quantized.onnx',
    'onnx/encoder_model_quantized.onnx',
    'preprocessor_config.json',
    'special_tokens_map.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'vocab.json',
] as const;

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

    // Two distinct admissibility contracts. A corpus row is admissible on a PROVEN audio route +
    // VERIFIED engine attribution + comparability inputs. A browser_journey row cannot prove either — Web
    // Speech's recognizer capture is opaque and it exposes no trustworthy provider/model identity — so it
    // is admissible on JOURNEY evidence instead (recognition actually started, timer advanced, transcript
    // + session produced, zero app-server/Cloud calls), stays honestly `unverified`, carries no WER, and
    // is never ranked (see rankableRows). Its `audio_route_proven` is false by construction, which for a
    // browser_journey is expected — NOT a failure.
    const isBrowser = row.comparability_class === 'browser_journey';
    let routeProven = false;

    if (isBrowser) {
        const journey = row.browser_journey_evidence;
        if (!journey) {
            problems.push('browser_journey row missing browser_journey_evidence');
        } else {
            if (journey.supportState !== 'supported') problems.push(`Browser support state is '${journey.supportState}', not supported`);
            if (!journey.recognitionStarted) problems.push('Browser recognition did not actually start');
            if (!journey.timerAdvanced) problems.push('Browser recording timer did not advance beyond 00:00');
            if (!journey.transcriptProduced) problems.push('Browser journey produced no transcript');
            if (!journey.sessionProduced) problems.push('Browser journey produced no session');
            if (journey.applicationServerWrites !== 0) problems.push('Browser evidence made an application-server write');
            if (journey.cloudProviderCalls !== 0) problems.push('Browser evidence invoked a SpeakSharp Cloud provider');
            if (journey.browserManagedTranscription !== true) problems.push('browser_journey must affirm browserManagedTranscription === true');
            if (!BROWSER_EXECUTION_MODES.has(journey.executionMode)) problems.push(`browser_journey executionMode must be one of ${[...BROWSER_EXECUTION_MODES].join('/')}, got '${journey.executionMode}'`);
            // Forbidden-engine guard proof must be IN the row: present (guard ran) and empty (no Cloud/Private
            // engine constructed or started). A missing field or any invocation is inadmissible.
            if (!Array.isArray(journey.forbiddenEngineInvocations)) problems.push('browser_journey must carry a forbiddenEngineInvocations array (tripwire proof)');
            else if (journey.forbiddenEngineInvocations.length !== 0) problems.push(`browser_journey recorded a forbidden engine construction/start: ${JSON.stringify(journey.forbiddenEngineInvocations)}`);
            // Guard-installation proof: an empty invocation list is only meaningful if the guard is proven
            // installed (atomically, before app code) and protected every required Cloud/Private key.
            const guard = journey.forbiddenEngineGuard;
            if (!guard || guard.installed !== true) problems.push('browser_journey must prove forbiddenEngineGuard.installed === true (guard authoritative before app execution)');
            else {
                const missing = REQUIRED_FORBIDDEN_ENGINE_KEYS.filter(k => !Array.isArray(guard.protectedKeys) || !guard.protectedKeys.includes(k));
                if (missing.length) problems.push(`browser_journey guard did not protect required forbidden engines: ${missing.join(', ')}`);
            }
            // Release-proof attestation: a diagnostic/mock runtime (releaseProofEligible=false) cannot back
            // release evidence even with a valid __APP_RELEASE__.
            if (journey.releaseProofEligible !== true) problems.push('browser_journey must be produced by a release-proof runtime (releaseProofEligible === true)');
        }
        // Runtime capability is validated for Browser rows too (not skipped): Browser/Web-Speech runtime
        // path + a well-typed capability shape.
        problems.push(...browserRuntimeCapabilityProblems(row.runtime_capability));
        // Honesty guards: browser_journey is the canonical Browser engine, exactly 'unverified', never
        // rankable — a class label alone must not admit another engine's row.
        if (row.engine !== 'browser-webspeech') problems.push(`browser_journey requires engine 'browser-webspeech', got '${row.engine}'`);
        if (row.attribution_status !== 'unverified') problems.push(`browser_journey attribution must be exactly 'unverified', got '${row.attribution_status}'`);
        if (row.wer !== null && row.wer !== undefined) problems.push('browser_journey is non-rankable — wer must be null');
    } else {
        const route = deriveAudioRouteProven(row.audio_route_evidence, row.engine);
        routeProven = route.proven;
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

    }

    if (row.engine === 'private-v2-browser-worker') {
        const worker = row.private_worker_evidence;
        if (!worker) {
            problems.push('Private browser-worker row missing private_worker_evidence');
        } else {
            if (!worker.workerUsed) problems.push('Private evidence did not use the production browser worker');
            if (worker.modelSource !== 'self-hosted') problems.push('Private evidence did not use self-hosted model assets');
            if (!worker.modelLoaded) problems.push('Private worker did not report a loaded model');
            if (!worker.inputHashesMatch || worker.mainThreadInputSha256 !== worker.workerInputSha256) {
                problems.push('Private main-thread and worker PCM hashes do not match');
            }
            if (!SHA256_RE.test(worker.mainThreadInputSha256) || !SHA256_RE.test(worker.workerInputSha256)) {
                problems.push('Private worker PCM hashes must be 64-character SHA-256 values');
            }
            const provenance = worker.modelProvenance;
            if (!provenance || provenance.verdict !== 'identical' || provenance.files.length === 0) {
                problems.push('Private model provenance is not byte-identical to the immutable manifest');
            } else {
                if (provenance.modelRevision !== row.comparability_inputs.modelRevision) {
                    problems.push('Private model provenance revision does not match the comparison cohort');
                }
                if (provenance.modelId !== 'Xenova/whisper-base.en') {
                    problems.push('Private model provenance ID does not match the production v2 model');
                }
                for (const file of provenance.files) {
                    if (file.file.startsWith('/') || file.file.split('/').includes('..') ||
                        !file.identical || !SHA256_RE.test(file.expectedSha256) ||
                        !file.actualSha256 || !SHA256_RE.test(file.actualSha256)) {
                        problems.push(`Private model provenance file '${file.file}' is not byte-identical`);
                    }
                }
                const provenFiles = new Set(provenance.files.map(file => file.file));
                for (const requiredFile of PRIVATE_V2_PROVENANCE_REQUIRED_FILES) {
                    if (!provenFiles.has(requiredFile)) {
                        problems.push(`Private model provenance is missing required file '${requiredFile}'`);
                    }
                }
            }
            if (worker.mainThreadInputSamples !== worker.workerInputSamples) {
                problems.push('Private main-thread and worker PCM sample counts do not match');
            }
            if (worker.mainThreadInputBytes !== worker.workerInputBytes) {
                problems.push('Private main-thread and worker PCM byte counts do not match');
            }
            if (!Number.isInteger(worker.mainThreadInputSamples) || worker.mainThreadInputSamples <= 0 ||
                !Number.isInteger(worker.workerInputSamples) || worker.workerInputSamples <= 0 ||
                !Number.isInteger(worker.mainThreadInputBytes) || worker.mainThreadInputBytes <= 0 ||
                !Number.isInteger(worker.workerInputBytes) || worker.workerInputBytes <= 0 ||
                !Number.isFinite(worker.mainThreadInputDurationSeconds) || worker.mainThreadInputDurationSeconds <= 0 ||
                !Number.isFinite(worker.workerInputDurationSeconds) || worker.workerInputDurationSeconds <= 0) {
                problems.push('Private PCM tuple contains missing or invalid numeric values');
            }
            const expectedBytes = worker.mainThreadInputSamples * Float32Array.BYTES_PER_ELEMENT;
            if (worker.mainThreadInputBytes !== expectedBytes || worker.workerInputBytes !== expectedBytes) {
                problems.push('Private PCM byte counts are inconsistent with Float32 sample counts');
            }
            const expectedDuration = worker.mainThreadInputSamples / PRIVATE_PCM_SAMPLE_RATE_HZ;
            if (Math.abs(worker.mainThreadInputDurationSeconds - expectedDuration) > PRIVATE_PCM_DURATION_TOLERANCE_SECONDS ||
                Math.abs(worker.workerInputDurationSeconds - expectedDuration) > PRIVATE_PCM_DURATION_TOLERANCE_SECONDS) {
                problems.push('Private PCM duration is inconsistent with samples / 16000');
            }
            if (row.audio_route_evidence.adapterInputBytes !== worker.mainThreadInputBytes ||
                row.audio_route_evidence.decodedSampleCount !== worker.mainThreadInputSamples ||
                Math.abs(row.audio_route_evidence.decodedDurationSeconds - expectedDuration) > PRIVATE_PCM_DURATION_TOLERANCE_SECONDS) {
                problems.push('Private audio-route tuple does not match the main-thread PCM input');
            }
            if (worker.cloudProviderCalls !== 0) problems.push('Private evidence invoked a Cloud provider');
        }
        const runtime = row.runtime_capability;
        if (runtime.requestedThreads !== 1) problems.push('Private v2 non-isolated evidence did not request the single-thread floor');
        if (runtime.configuredThreads !== 1) problems.push('Private v2 non-isolated evidence did not configure the single-thread floor');
        if (runtime.workerReportedThreads !== null) problems.push('ORT v1.14 does not report effective threads; workerReportedThreads must be null');
        if (runtime.crossOriginIsolated || runtime.sharedArrayBufferAvailable) {
            problems.push('Private v2 fallback evidence was not collected without cross-origin isolation/SharedArrayBuffer');
        }
        if (runtime.runtimePath !== 'wasm') problems.push('Private v2 single-thread fallback must report runtimePath=wasm');
    }

    // WER is only admissible on a proven corpus route. Never estimated, never defaulted to zero.
    const wer = routeProven ? (row.wer ?? null) : null;

    const invalid = problems.length > 0 || row.invalid_reason != null;
    return {
        ...row,
        wer,
        audio_route_proven: routeProven,
        run_validity: invalid ? 'invalid' : 'valid',
        invalid_reason: invalid ? [row.invalid_reason, ...problems].filter(Boolean).join('; ') : null,
        // An unproven route is a failure only for corpus rows; for browser_journey it is expected.
        failure_class: !isBrowser && !routeProven && row.failure_class === 'none' ? 'audio_route_unproven' : row.failure_class,
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
 * An isolated worker diagnostic may prove that audio reached a particular worker/model without
 * proving the persisted session attribution required for engine-specific publication. This guard
 * accepts that narrow diagnostic only when missing persisted attribution is its sole admissibility
 * defect. It must stay explicitly unverified, invalid, WER-free, and non-rankable.
 */
export function unverifiedWorkerDiagnosticProblems(row: SttEvidenceRow): string[] {
    const problems: string[] = [];

    if (row.engine !== 'private-v2-browser-worker') {
        problems.push(`diagnostic engine is '${row.engine}', not 'private-v2-browser-worker'`);
    }
    if (row.attribution_status !== 'unverified') {
        problems.push(`diagnostic attribution_status is '${row.attribution_status}', not 'unverified'`);
    }
    if (row.run_validity !== 'invalid') {
        problems.push(`diagnostic run_validity is '${row.run_validity}', not 'invalid'`);
    }
    if (row.wer !== null) {
        problems.push('unverified diagnostic must not publish WER');
    }
    if (rankableRows([row]).length !== 0) {
        problems.push('unverified diagnostic unexpectedly entered the rankable cohort');
    }

    const verifiedControl = finalizeRow({
        ...row,
        attribution_status: 'verified',
        invalid_reason: null,
    });
    if (verifiedControl.run_validity !== 'valid') {
        problems.push(
            `diagnostic has defects beyond missing persisted attribution: ${verifiedControl.invalid_reason ?? 'unknown defect'}`,
        );
    }

    return problems;
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
