/**
 * #1304 — turn a completed run into a POPULATED `TechnicalVerdict`.
 *
 * The schema existed and nothing filled it: the runner emitted a WER, one aggregate wall-clock number
 * and an asset count, while cold load, warm p50/p95, RTF, download bytes and the reliability
 * categories stayed empty. A declared table is not a measured one, and discovering that after the
 * frozen 600 would have meant paying for the whole run a second time.
 *
 * Every field here is derived from something the run actually observed, or left NULL. Nothing is
 * defaulted to zero — a zero on a latency chart reads as "instant".
 */
import { percentile, type FootprintMetrics, type ReliabilityMetrics, type SpeedMetrics, type TechnicalVerdict, type DurationBehaviour } from './deploymentMetrics';
import { normalizeOfficialTrackA } from '../normalization/officialNormalizer';
import type { ClipOutcome, ArmRunResult } from './runArm';
import type { AssetRecord } from './browser/server';

export interface VerdictInputs {
    armId: string;
    runtimeLabel: string;
    evidenceSet: string;
    evidenceClass: string;
    dtypeAliasOf?: string;
    result: ArmRunResult;
    /** Time to load the model into a FRESH context — what a new user waits for once. */
    coldLoadMs: number | null;
    /** Stop → final transcript on the long-form control, when that control was run. */
    stopToFinalMs: number | null;
    backendProven: boolean;
    resolvedBackend: string | null;
    hardwareRepresentative: boolean;
    transcriptDigest: string | null;
    fingerprint: string;
    assets: Record<string, AssetRecord>;
    expectedClips: number;
    /** Clips refused before decoding because their bytes did not match the frozen manifest. */
    audioRejected: number;
    /** Long-form control observations, when it was run. */
    longForm?: { tailPreserved: boolean; repeatedNgrams: number };
}

function reliabilityOf(inputs: VerdictInputs): ReliabilityMetrics {
    const outcomes = inputs.result.clipOutcomes;
    const scoredIds = new Set(outcomes.map((o) => o.utteranceId));
    return {
        expectedClips: inputs.expectedClips,
        decoded: outcomes.length,
        threw: outcomes.filter((o) => o.outcome === 'threw').length,
        emptyOutput: outcomes.filter((o) => o.outcome === 'empty').length,
        // A decode that ran past its deadline surfaces as a throw from the arm; counted separately
        // only when an arm reports one, never inferred from a slow clip.
        timedOut: inputs.result.decodeFailures.filter((f) => /timeout|deadline/i.test(f.message)).length,
        audioRejected: inputs.audioRejected,
        // Clips the run never reached at all — the count that makes 599 of 600 visible.
        missing: Math.max(0, inputs.expectedClips - scoredIds.size - inputs.audioRejected),
    };
}

function speedOf(inputs: VerdictInputs): SpeedMetrics {
    // Only clips that actually produced a transcript inform latency. A throw's elapsed time is the
    // time to fail, and averaging it into a decode percentile would flatter or damn an arm arbitrarily.
    const scored = inputs.result.clipOutcomes.filter((o: ClipOutcome) => o.outcome === 'scored');
    const decodeMs = scored.map((o) => o.decodeMs);
    const rtf = scored.map((o) => o.realTimeFactor).filter((v) => Number.isFinite(v));
    return {
        coldLoadMs: inputs.coldLoadMs,
        warmDecodeMsP50: percentile(decodeMs, 50),
        warmDecodeMsP95: percentile(decodeMs, 95),
        realTimeFactorP50: percentile(rtf, 50),
        realTimeFactorP95: percentile(rtf, 95),
        stopToFinalMs: inputs.stopToFinalMs,
    };
}

function footprintOf(inputs: VerdictInputs): FootprintMetrics {
    const records = Object.values(inputs.assets);
    const bytes = records.reduce((n, r) => n + (r.bytes || 0), 0);
    return {
        // Null rather than 0 when nothing was recorded: a zero-byte model is not a small model, it is
        // an unmeasured one.
        modelBytes: records.length > 0 && bytes > 0 ? bytes : null,
        assetCount: records.length > 0 ? records.length : null,
        // A browser page cannot report peak RSS. Never fabricated.
        peakMemoryBytes: inputs.result.ok ? inputs.result.row.provenance.resources.peakRssBytes : null,
    };
}

function durationOf(inputs: VerdictInputs): DurationBehaviour {
    const outcomes = inputs.result.clipOutcomes;
    const seconds = outcomes.map((o) => o.audioSeconds).filter((s) => s > 0);
    // A transcript far shorter than its reference is TRUNCATION, which a WER averages away across a
    // set: three badly-cut clips and a hundred good ones look like a slightly worse model.
    const truncated = inputs.result.scores.filter((score) => {
        if (!score.ok) return false;
        const { referenceWords, deletions } = score.row;
        return referenceWords >= 8 && deletions / referenceWords >= 0.4;
    }).length;
    return {
        shortestClipSeconds: seconds.length > 0 ? Math.min(...seconds) : null,
        longestClipSeconds: seconds.length > 0 ? Math.max(...seconds) : null,
        longFormTailPreserved: inputs.longForm?.tailPreserved ?? null,
        longFormRepeatedNgrams: inputs.longForm?.repeatedNgrams ?? null,
        truncatedClips: truncated,
    };
}

export function buildTechnicalVerdict(inputs: VerdictInputs): TechnicalVerdict {
    const { result } = inputs;
    return {
        armId: inputs.armId,
        ...(inputs.dtypeAliasOf ? { dtypeAliasOf: inputs.dtypeAliasOf } : {}),
        runtimeLabel: inputs.runtimeLabel,
        evidenceSet: inputs.evidenceSet,
        evidenceClass: inputs.evidenceClass,
        wer: result.ok ? result.row.wer : null,
        referenceWords: result.ok ? result.row.referenceWords : (result.aggregate?.referenceWords ?? 0),
        reliability: reliabilityOf(inputs),
        speed: speedOf(inputs),
        footprint: footprintOf(inputs),
        duration: durationOf(inputs),
        backendProven: inputs.backendProven,
        resolvedBackend: inputs.resolvedBackend,
        hardwareRepresentative: inputs.hardwareRepresentative,
        transcriptDigest: inputs.transcriptDigest,
        fingerprint: inputs.fingerprint,
        assetDigestCount: Object.keys(inputs.assets).length,
    };
}

/** Repeated 5-grams in a transcript — the shape a looping decode takes. */
export function countRepeatedNgrams(text: string, n = 5): number {
    const words = normalizeOfficialTrackA(text);
    const seen = new Map<string, number>();
    for (let i = 0; i + n <= words.length; i++) {
        const gram = words.slice(i, i + n).join(' ');
        seen.set(gram, (seen.get(gram) ?? 0) + 1);
    }
    return [...seen.values()].filter((count) => count > 1).length;
}
