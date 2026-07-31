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

export interface LatencySummary {
    metric: 'first_partial_latency_ms' | 'finalization_latency_ms';
    runs: number;
    coldRuns: number;
    warmRuns: number;
    observations: number[];
    min: number | null;
    max: number | null;
    /** null unless a defined repeated-run distribution exists (>= policy minimum). Never faked. */
    p95: number | null;
    note: string;
}

/**
 * Summarize a metric across repeated runs. Refuses a percentile below the policy minimum and requires
 * warm/cold classification — a single (or handful of) run(s) emits observations only.
 */
export function summarizeLatency(
    rows: CorpusRow[],
    metric: 'first_partial_latency_ms' | 'finalization_latency_ms',
): LatencySummary {
    const admissible = rows.filter((r) => r.run_validity === 'valid' && r.audio_route_proven);
    const observations = admissible
        .map((r) => r[metric])
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const coldRuns = admissible.filter((r) => r.thermal_state === 'cold').length;
    const warmRuns = admissible.filter((r) => r.thermal_state === 'warm').length;

    const enoughRuns = observations.length >= PERCENTILE_POLICY.minRunsForPercentile;
    const classified = coldRuns > 0 && warmRuns > 0; // both classes present
    const canPercentile = enoughRuns && (!PERCENTILE_POLICY.requiresWarmColdClassification || classified);

    let p95: number | null = null;
    if (canPercentile) {
        const sorted = [...observations].sort((a, b) => a - b);
        const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
        p95 = sorted[Math.max(0, idx)];
    }

    return {
        metric,
        runs: admissible.length,
        coldRuns,
        warmRuns,
        observations,
        min: observations.length ? Math.min(...observations) : null,
        max: observations.length ? Math.max(...observations) : null,
        p95,
        note: canPercentile ? 'percentile over a defined repeated-run distribution' : PERCENTILE_POLICY.note,
    };
}
