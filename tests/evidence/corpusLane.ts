/**
 * #1037 Lane A — corpus row assembly + honest latency summarization.
 *
 * Turns one Private-v2 fixture execution into a schema `SttEvidenceRow` through the merged `finalizeRow`
 * (the caller can never mark its own row valid). WER is computed ONLY when the route is proven AND a real
 * recognizer transcript AND a known ground truth are present — otherwise it stays `null`. A single
 * execution yields observations, never a percentile (`PERCENTILE_POLICY`).
 */
import {
    finalizeRow,
    cohortKey,
    PERCENTILE_POLICY,
    type SttEvidenceRow,
    type AudioRouteEvidence,
    type RuntimeCapability,
    type ComparabilityInputs,
    type FailureClass,
} from './sttEvidenceSchema';
import { wordErrorRate, NORMALIZATION_VERSION } from './werMetric';

export type ThermalState = 'cold' | 'warm';

export interface CorpusRunInput {
    engine: 'private';
    engineVersion: string;
    modelName: string;
    attributionStatus: 'verified' | 'pending' | 'unverified' | 'legacy_unknown';
    environment: { browser: string; browserVersion: string; os: string; device: string; networkCondition: string };
    fixtureId: string;
    releaseSha: string;
    audioRoute: AudioRouteEvidence;
    runtime: RuntimeCapability;
    comparabilityInputs: ComparabilityInputs;
    firstPartialLatencyMs: number | null;
    finalizationLatencyMs: number | null;
    failureClass: FailureClass;
    /** The KNOWN fixture transcript. Absent → WER stays null (unmeasurable). */
    groundTruth?: string | null;
    /** The recognizer's transcript. Absent (e.g. offline / no route) → WER stays null. */
    recognizerTranscript?: string | null;
    thermalState: ThermalState;
}

export interface CorpusRow extends SttEvidenceRow {
    thermal_state: ThermalState;
    wer_detail: ReturnType<typeof wordErrorRate> | null;
}

/**
 * Assemble one corpus row. Route/validity/attribution are enforced by `finalizeRow`; WER is added only
 * when honestly measurable. `normalizationVersion` is forced to match the WER module so a row can never
 * claim a WER under a different normalization than the one that produced it.
 */
export function buildCorpusRow(input: CorpusRunInput): CorpusRow {
    // Precompute WER only if we have both a real transcript and a ground truth. finalizeRow decides
    // whether the route is proven; if it is not, WER is dropped there regardless of what we pass.
    let werDetail: ReturnType<typeof wordErrorRate> | null = null;
    if (input.groundTruth != null && input.recognizerTranscript != null) {
        werDetail = wordErrorRate(input.groundTruth, input.recognizerTranscript);
    }

    const row = finalizeRow({
        comparability_class: 'corpus_fixture',
        engine: input.engine,
        engine_version: input.engineVersion,
        attribution_status: input.attributionStatus,
        model_name: input.modelName,
        browser: input.environment.browser,
        browser_version: input.environment.browserVersion,
        os: input.environment.os,
        device: input.environment.device,
        network_condition: input.environment.networkCondition,
        fixture_id: input.fixtureId,
        wer: werDetail?.wer ?? null,
        first_partial_latency_ms: input.firstPartialLatencyMs,
        finalization_latency_ms: input.finalizationLatencyMs,
        failure_class: input.failureClass,
        release_sha: input.releaseSha,
        audio_route_evidence: input.audioRoute,
        runtime_capability: input.runtime,
        comparability_inputs: { ...input.comparabilityInputs, normalizationVersion: NORMALIZATION_VERSION },
    } as Parameters<typeof finalizeRow>[0]);

    return { ...row, thermal_state: input.thermalState, wer_detail: row.audio_route_proven ? werDetail : null };
}

export interface ThermalDistribution {
    thermalState: ThermalState;
    runs: number;
    observations: number[];
    min: number | null;
    max: number | null;
    /** null unless THIS class alone has a defined distribution (>= policy minimum). Never faked, never mixed. */
    p95: number | null;
}

export interface LatencySummary {
    metric: 'first_partial_latency_ms' | 'finalization_latency_ms';
    cohortKey: string;
    runs: number;
    /** Cold and warm are reported SEPARATELY — never combined into one percentile. */
    cold: ThermalDistribution;
    warm: ThermalDistribution;
    note: string;
}

function distribution(state: ThermalState, values: number[]): ThermalDistribution {
    const enough = values.length >= PERCENTILE_POLICY.minRunsForPercentile;
    let p95: number | null = null;
    if (enough) {
        const sorted = [...values].sort((a, b) => a - b);
        const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
        p95 = sorted[Math.max(0, idx)];
    }
    return {
        thermalState: state,
        runs: values.length,
        observations: values,
        min: values.length ? Math.min(...values) : null,
        max: values.length ? Math.max(...values) : null,
        p95,
    };
}

/**
 * Summarize a metric across repeated runs of a SINGLE cohort. Two guards the earlier version lacked:
 *  1. All rows MUST share one `cohortKey()` — mixing cohorts is meaningless, so it throws rather than
 *     silently averaging across fixtures/runtimes/models.
 *  2. Cold and warm observations are NEVER combined into one p95 — each thermal class gets its own
 *     classified distribution, and each still requires the policy minimum before a percentile appears.
 */
export function summarizeLatency(
    rows: CorpusRow[],
    metric: 'first_partial_latency_ms' | 'finalization_latency_ms',
): LatencySummary {
    const admissible = rows.filter((r) => r.run_validity === 'valid' && r.audio_route_proven);
    const keys = new Set(admissible.map((r) => cohortKey(r)));
    if (keys.size > 1) {
        throw new Error(`summarizeLatency: refusing to aggregate ${keys.size} distinct cohorts — summarize one cohort at a time (use rankableCohorts)`);
    }
    // A negative latency is a clock/harness error, not a measurement — it passes Number.isFinite but must
    // be excluded so it can never enter a min/max/percentile. Only finite, non-negative values count.
    const obs = (state: ThermalState): number[] =>
        admissible
            .filter((r) => r.thermal_state === state)
            .map((r) => r[metric])
            .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0);

    const cold = distribution('cold', obs('cold'));
    const warm = distribution('warm', obs('warm'));
    const anyP95 = cold.p95 !== null || warm.p95 !== null;

    return {
        metric,
        cohortKey: keys.size === 1 ? [...keys][0] : '',
        runs: admissible.length,
        cold,
        warm,
        note: anyP95
            ? 'per-thermal-class percentiles over defined repeated-run distributions; cold and warm are never combined'
            : PERCENTILE_POLICY.note,
    };
}
