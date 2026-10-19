import { describe, expect, it } from 'vitest';
import { compareModelArms, type CorpusClip, type EvaluatorPolicy, type ModelArm, type ModelIdentity } from '../modelEvaluator';

const identity: ModelIdentity = {
  engine: 'private-v4', modelId: 'onnx-community/whisper-base.en', revision: 'pinned-v4',
  assetDigest: 'a'.repeat(64), runtime: '@huggingface/transformers@4.2.0', backend: 'wasm',
};
const clips: CorpusClip[] = [
  { id: 'clear', clusterId: 'speaker-1', sha256: '1'.repeat(64), reference: 'one two three four', slices: ['clear'] },
  { id: 'noisy', clusterId: 'speaker-2', sha256: '2'.repeat(64), reference: 'one two three four', slices: ['noisy'] },
  { id: 'filler', clusterId: 'speaker-3', sha256: '3'.repeat(64), reference: 'um one two three', slices: ['filler'] },
];
const policy: EvaluatorPolicy = {
  version: 1, minTrials: 2, minClusters: 3, maxPooledWerIncrease: 0.1,
  maxSliceWerIncrease: 0.1, maxFinalLatencyIncreaseMs: 100, maxFinalLatencyMs: 500,
};

function arm(textFor: (id: string) => string | null, latency = 50): ModelArm {
  return {
    manifest: identity, observed: identity,
    results: clips.flatMap((clip) => [0, 1].map((trial) => ({
      clipId: clip.id, trial, transcript: textFor(clip.id), finalLatencyMs: latency,
      inputSha256: clip.sha256,
    }))),
  };
}

describe('#1565 paired model evaluator', () => {
  it('passes an identical paired corpus when every required slice has enough independent clusters', () => {
    const comparable = clips.map((clip) => ({ ...clip, slices: ['all'] }));
    const baseline = arm((id) => clips.find((clip) => clip.id === id)!.reference);
    const candidate = arm((id) => clips.find((clip) => clip.id === id)!.reference);
    const report = compareModelArms(comparable, baseline, candidate, policy);
    expect(report.verdict).toBe('PASS');
    expect(report.reasons).toEqual([]);
  });

  it('holds when a slice has too few independent speakers, even if both arms match', () => {
    const report = compareModelArms(clips, arm((id) => clips.find((clip) => clip.id === id)!.reference),
      arm((id) => clips.find((clip) => clip.id === id)!.reference), policy);
    expect(report.verdict).toBe('HOLD');
    expect(report.reasons).toContain('insufficient_slice_clusters:noisy');
  });

  it('rejects a noisy-slice regression hidden by favorable aggregate performance', () => {
    const base = arm((id) => id === 'clear' ? 'one two wrong wrong' : clips.find((clip) => clip.id === id)!.reference);
    const next = arm((id) => id === 'noisy' ? 'one two wrong wrong' : clips.find((clip) => clip.id === id)!.reference);
    const report = compareModelArms(clips, base, next, policy);
    expect(report.verdict).toBe('FAIL');
    expect(report.reasons).toContain('slice_wer_regression:noisy');
  });

  it('rejects missing or duplicate clips and empty model output', () => {
    const next = arm((id) => id === 'noisy' ? null : clips.find((clip) => clip.id === id)!.reference);
    next.results.pop();
    next.results.push({ ...next.results[0] });
    const report = compareModelArms(clips, arm((id) => clips.find((clip) => clip.id === id)!.reference), next, policy);
    expect(report.verdict).toBe('FAIL');
    expect(report.reasons.some((reason) => reason.startsWith('candidate_unscoreable:'))).toBe(true);
    expect(report.reasons.some((reason) => reason.startsWith('candidate_unexpected_or_duplicate_result:'))).toBe(true);
  });

  it('rejects wrong observed identity, including a silent backend fallback', () => {
    const next = arm((id) => clips.find((clip) => clip.id === id)!.reference);
    next.observed = {
      engine: 'private-v2', modelId: 'Xenova/whisper-base.en', revision: null,
      assetDigest: 'b'.repeat(64), runtime: '@xenova/transformers@2.17.2', backend: 'wasm',
    };
    expect(compareModelArms(clips, arm((id) => clips.find((clip) => clip.id === id)!.reference), next, policy)
      .reasons).toContain('candidate_identity_mismatch_or_fallback');
  });

  it('rejects relative and absolute finalized latency regressions', () => {
    const report = compareModelArms(clips, arm((id) => clips.find((clip) => clip.id === id)!.reference, 50),
      arm((id) => clips.find((clip) => clip.id === id)!.reference, 600), policy);
    expect(report.reasons).toContain('final_latency_regression');
    expect(report.reasons).toContain('absolute_final_latency_budget');
  });

  it('holds without predeclared policy', () => {
    const report = compareModelArms(clips, arm((id) => clips.find((clip) => clip.id === id)!.reference),
      arm((id) => clips.find((clip) => clip.id === id)!.reference), null);
    expect(report.verdict).toBe('HOLD');
    expect(report.reasons).toContain('missing_or_invalid_predeclared_policy');
  });
});
