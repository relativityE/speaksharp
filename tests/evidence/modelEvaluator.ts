import { aggregateCorpusArm, scoreCorpusUtterance, type AggregateWer, type CorpusScore } from './benchmarkScore';

export interface ModelIdentity {
  engine: string;
  modelId: string;
  revision: string | null;
  assetDigest: string;
  runtime: string;
  backend: string;
}

export interface CorpusClip {
  id: string;
  clusterId: string;
  sha256: string;
  reference: string;
  slices: string[];
}

export interface ModelArm {
  manifest: ModelIdentity;
  /** The adapter must obtain these values from the running engine, not copy its manifest. */
  observed: ModelIdentity | null;
  results: Array<{
    clipId: string;
    trial: number;
    transcript: string | null;
    finalLatencyMs: number | null;
    audioDurationMs?: number;
    realTimeFactor?: number | null;
    fillerDetection?: { referenceCount: number; detectedCount: number; detectedByKey: Record<string, number> } | null;
    inputSha256: string;
    error?: string;
  }>;
}

export interface EvaluatorPolicy {
  version: 1;
  minTrials: number;
  minClusters: number;
  maxPooledWerIncrease: number;
  maxSliceWerIncrease: number;
  maxFinalLatencyIncreaseMs: number;
  maxFinalLatencyMs: number;
}

export interface EvaluatorReport {
  verdict: 'PASS' | 'FAIL' | 'HOLD';
  reasons: string[];
  baseline: AggregateWer;
  candidate: AggregateWer;
  slices: Record<string, { baseline: AggregateWer; candidate: AggregateWer }>;
  finalLatencyMs: { baseline: number | null; candidate: number | null };
}

const identityFields: Array<keyof ModelIdentity> = [
  'engine', 'modelId', 'revision', 'assetDigest', 'runtime', 'backend',
];

function validIdentity(identity: ModelIdentity | null): boolean {
  return identity !== null && identityFields.every((key) =>
    key === 'revision' ? identity[key] === null || typeof identity[key] === 'string'
      : typeof identity[key] === 'string' && identity[key]!.length > 0,
  );
}

function identityMatches(expected: ModelIdentity, observed: ModelIdentity | null): boolean {
  return validIdentity(observed) && identityFields.every((key) => expected[key] === observed?.[key]);
}

function finiteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function validPolicy(policy: EvaluatorPolicy | null): policy is EvaluatorPolicy {
  return policy !== null && policy.version === 1 && Number.isInteger(policy.minTrials) &&
    policy.minTrials >= 2 && Number.isInteger(policy.minClusters) && policy.minClusters >= 3 &&
    finiteNonnegative(policy.maxPooledWerIncrease) &&
    finiteNonnegative(policy.maxSliceWerIncrease) &&
    finiteNonnegative(policy.maxFinalLatencyIncreaseMs) &&
    finiteNonnegative(policy.maxFinalLatencyMs);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Deterministic cluster bootstrap; the paired arms receive the same sampled clusters. */
function upperPairedWerDelta(
  clips: readonly CorpusClip[], baseScores: readonly CorpusScore[], nextScores: readonly CorpusScore[],
): number | null {
  const clusters = [...new Set(clips.map((clip) => clip.clusterId))];
  if (clusters.length < 3) return null;
  const byId = (scores: readonly CorpusScore[]) => new Map(scores.filter((score) => score.ok)
    .map((score) => [score.utteranceId, score.row]));
  const baseRows = byId(baseScores);
  const nextRows = byId(nextScores);
  if (baseRows.size !== baseScores.length || nextRows.size !== nextScores.length) return null;
  const clusterRows = clusters.map((cluster) => {
    const ids = clips.filter((clip) => clip.clusterId === cluster).map((clip) => clip.id);
    const matching = (rows: typeof baseRows) => [...rows].filter(([key]) => ids.some((id) => key.startsWith(`${id}:`)))
      .map(([, row]) => row);
    return { base: matching(baseRows), next: matching(nextRows) };
  });
  let seed = 0x1565;
  const nextRandom = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 0x1_0000_0000;
  };
  const deltas: number[] = [];
  for (let replicate = 0; replicate < 2000; replicate += 1) {
    let baseErrors = 0, nextErrors = 0, words = 0;
    for (let draw = 0; draw < clusters.length; draw += 1) {
      const pair = clusterRows[Math.floor(nextRandom() * clusters.length)];
      for (const row of pair.base) {
        baseErrors += row.substitutions + row.deletions + row.insertions;
        words += row.referenceWords;
      }
      for (const row of pair.next) nextErrors += row.substitutions + row.deletions + row.insertions;
    }
    if (words === 0) return null;
    deltas.push((nextErrors - baseErrors) / words);
  }
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length * 0.95)];
}

/** A strict paired corpus comparison. Invalid clips never disappear from an arm's denominator. */
export function compareModelArms(
  clips: readonly CorpusClip[], baseline: ModelArm, candidate: ModelArm, policy: EvaluatorPolicy | null,
): EvaluatorReport {
  const fail: string[] = [];
  const hold: string[] = [];
  const ids = clips.map((clip) => clip.id);
  if (ids.length === 0 || new Set(ids).size !== ids.length ||
      clips.some((clip) => !clip.id.trim() || !clip.clusterId.trim() || !/^[a-f0-9]{64}$/.test(clip.sha256) ||
        !clip.reference.trim() || !clip.slices.length || new Set(clip.slices).size !== clip.slices.length)) {
    fail.push('invalid_or_duplicate_corpus_manifest');
  }
  for (const [name, arm] of [['baseline', baseline], ['candidate', candidate]] as const) {
    if (!validIdentity(arm.manifest) || !identityMatches(arm.manifest, arm.observed)) {
      fail.push(`${name}_identity_mismatch_or_fallback`);
    }
  }
  if (!validPolicy(policy)) hold.push('missing_or_invalid_predeclared_policy');

  const trials = validPolicy(policy) ? policy.minTrials : Math.max(1,
    ...baseline.results.map((result) => result.trial + 1),
    ...candidate.results.map((result) => result.trial + 1));
  const perArm = (name: string, arm: ModelArm) => {
    const scores: CorpusScore[] = [];
    const seen = new Set<string>();
    for (const result of arm.results) {
      const clip = clips.find((item) => item.id === result.clipId);
      const key = `${result.clipId}:${result.trial}`;
      if (!clip || !Number.isInteger(result.trial) || result.trial < 0 || result.trial >= trials || seen.has(key)) {
        fail.push(`${name}_unexpected_or_duplicate_result:${key}`);
        continue;
      }
      seen.add(key);
      if (result.inputSha256 !== clip.sha256) fail.push(`${name}_input_mismatch:${key}`);
      if (result.error) fail.push(`${name}_decode_error:${key}`);
      if (result.finalLatencyMs === null || !finiteNonnegative(result.finalLatencyMs)) {
        hold.push(`${name}_latency_unavailable:${key}`);
      }
      scores.push(scoreCorpusUtterance(key, clip.reference, result.transcript));
    }
    const expected = clips.flatMap((clip) => Array.from({ length: trials }, (_, trial) => `${clip.id}:${trial}`));
    for (const key of expected) if (!seen.has(key)) fail.push(`${name}_missing_result:${key}`);
    const aggregate = aggregateCorpusArm(scores, expected);
    if (aggregate.wer === null) fail.push(`${name}_unscoreable:${aggregate.armInvalidReason}`);
    return { aggregate, scores };
  };
  const base = perArm('baseline', baseline);
  const next = perArm('candidate', candidate);
  const slices: EvaluatorReport['slices'] = {};
  for (const slice of new Set(clips.flatMap((clip) => clip.slices))) {
    const sliceIds = clips.filter((clip) => clip.slices.includes(slice)).flatMap((clip) =>
      Array.from({ length: trials }, (_, trial) => `${clip.id}:${trial}`));
    const baseSlice = aggregateCorpusArm(base.scores.filter((score) => sliceIds.includes(score.utteranceId)), sliceIds);
    const nextSlice = aggregateCorpusArm(next.scores.filter((score) => sliceIds.includes(score.utteranceId)), sliceIds);
    slices[slice] = { baseline: baseSlice, candidate: nextSlice };
    if (baseSlice.wer === null || nextSlice.wer === null) fail.push(`unscoreable_slice:${slice}`);
    else if (validPolicy(policy) && nextSlice.wer - baseSlice.wer > policy.maxSliceWerIncrease) {
      fail.push(`slice_wer_regression:${slice}`);
    }
    if (validPolicy(policy)) {
      const bound = upperPairedWerDelta(clips.filter((clip) => clip.slices.includes(slice)),
        base.scores.filter((score) => sliceIds.includes(score.utteranceId)),
        next.scores.filter((score) => sliceIds.includes(score.utteranceId)));
      if (bound === null || new Set(clips.filter((clip) => clip.slices.includes(slice)).map((clip) => clip.clusterId)).size < policy.minClusters) {
        hold.push(`insufficient_slice_clusters:${slice}`);
      } else if (bound > policy.maxSliceWerIncrease) hold.push(`slice_margin_not_proven:${slice}`);
    }
  }
  if (base.aggregate.wer !== null && next.aggregate.wer !== null && validPolicy(policy) &&
      next.aggregate.wer - base.aggregate.wer > policy.maxPooledWerIncrease) fail.push('pooled_wer_regression');
  if (validPolicy(policy)) {
    const bound = upperPairedWerDelta(clips, base.scores, next.scores);
    if (bound === null || new Set(clips.map((clip) => clip.clusterId)).size < policy.minClusters) {
      hold.push('insufficient_corpus_clusters');
    } else if (bound > policy.maxPooledWerIncrease) hold.push('pooled_margin_not_proven');
  }
  const latency = (arm: ModelArm) => median(arm.results.map((result) => result.finalLatencyMs)
    .filter((value): value is number => value !== null && finiteNonnegative(value)));
  const baseLatency = latency(baseline);
  const nextLatency = latency(candidate);
  if (validPolicy(policy) && baseLatency !== null && nextLatency !== null) {
    if (nextLatency - baseLatency > policy.maxFinalLatencyIncreaseMs) fail.push('final_latency_regression');
    if (nextLatency > policy.maxFinalLatencyMs) fail.push('absolute_final_latency_budget');
  }
  return {
    verdict: fail.length ? 'FAIL' : hold.length ? 'HOLD' : 'PASS',
    reasons: [...new Set([...fail, ...hold])],
    baseline: base.aggregate,
    candidate: next.aggregate,
    slices,
    finalLatencyMs: { baseline: baseLatency, candidate: nextLatency },
  };
}
