import { describe, expect, it } from 'vitest';
import { qualifyComparison, validatePromotionPolicy, PROMOTION_POLICY_SCHEMA, type PromotionPolicy } from './qualification.mjs';

const INCUMBENT = 'v2:base.en';
const CANDIDATE = 'v4:distil:q4';
const DIGEST = 'a'.repeat(64);
const policy: PromotionPolicy = {
  schema: PROMOTION_POLICY_SCHEMA, incumbent: INCUMBENT, maxWerRegression: 0.01, maxStopToCompletionRatio: 1.5,
  approvedBy: 'synthetic test policy',
};
const timings = (median: number) => ({ stopToCompletionMs: { status: 'MEASURED', samples: 4, median } });
function evidence({ candidateWer = 0.05, candidateStop = 900, candidateValid = 4, digests = [DIGEST, DIGEST, DIGEST, DIGEST] } = {}) {
  const summary = {
    status: 'MEASURED_PRODUCT_COMPARISON',
    models: {
      [INCUMBENT]: { validSampleCount: 4, expectedSampleCount: 4, timings: timings(800) },
      [CANDIDATE]: { validSampleCount: candidateValid, expectedSampleCount: 4, timings: timings(candidateStop) },
    },
    commonMatchedPopulation: { samplesPerModel: 4, models: {
      [INCUMBENT]: { samples: 4, wer: 0.05 }, [CANDIDATE]: { samples: 4, wer: candidateWer },
    } },
  };
  const passed = { measured: true, productEvidence: { productProof: { verdict: 'PASS' } } };
  const rows = [
    ...Array.from({ length: 4 }, () => ({ ...passed, candidate: INCUMBENT, packageDigest: null })),
    ...digests.map(packageDigest => ({ ...passed, candidate: CANDIDATE, packageDigest })),
  ];
  return { summary, rows, candidates: [INCUMBENT, CANDIDATE] };
}

describe('evidence-based package qualification', () => {
  it('qualifies only the bound package digest of a candidate inside every policy bound', () => {
    const decision = qualifyComparison({ ...evidence(), policy });
    expect(decision).toMatchObject({ qualification: 'PASS', qualifiedPackages: [DIGEST], reasons: [] });
    expect(decision.candidates[CANDIDATE]).toEqual({ verdict: 'PASS', packageDigest: DIGEST, reasons: [] });
  });

  it('never relabels a complete comparison as PASS without an owner-approved policy', () => {
    expect(qualifyComparison({ ...evidence(), policy: null }))
      .toMatchObject({ qualification: 'HOLD', qualifiedPackages: [], reasons: ['no_promotion_policy'] });
  });

  it.each([
    ['missing schema', { ...policy, schema: 'other' }],
    ['negative WER tolerance', { ...policy, maxWerRegression: -0.01 }],
    ['zero latency ratio', { ...policy, maxStopToCompletionRatio: 0 }],
    ['no approver', { ...policy, approvedBy: ' ' }],
  ])('refuses an invalid policy (%s)', (_, bad) => {
    expect(() => validatePromotionPolicy(bad)).toThrow('PROMOTION_POLICY_INVALID');
    expect(qualifyComparison({ ...evidence(), policy: bad as PromotionPolicy }).reasons).toEqual(['promotion_policy_invalid']);
  });

  it('holds an incomplete comparison even when every candidate row looks good', () => {
    const input = evidence();
    expect(qualifyComparison({ ...input, summary: { ...input.summary, status: 'INCOMPLETE_OR_FAILED' }, policy }).reasons)
      .toEqual(['comparison_incomplete']);
  });

  it('holds when the incumbent baseline itself is incomplete', () => {
    const input = evidence();
    input.summary.models[INCUMBENT].validSampleCount = 3;
    expect(qualifyComparison({ ...input, policy }).reasons).toEqual(['incumbent_evidence_incomplete']);
  });

  it.each([
    ['a WER regression beyond tolerance', { candidateWer: 0.07 }, 'wer_regression'],
    ['a completion-latency regression', { candidateStop: 1300 }, 'stop_to_completion_regression'],
    ['missing samples', { candidateValid: 3 }, 'samples_incomplete'],
    ['an unbound package', { digests: [null, null, null, null] }, 'package_digest_unbound'],
    ['mixed packages across takes', { digests: [DIGEST, DIGEST, DIGEST, 'b'.repeat(64)] }, 'package_digest_unbound'],
  ] as const)('holds a candidate with %s', (_, override, reason) => {
    const decision = qualifyComparison({ ...evidence(override as Parameters<typeof evidence>[0]), policy });
    expect(decision).toMatchObject({ qualification: 'HOLD', qualifiedPackages: [], reasons: ['no_candidate_met_policy'] });
    expect(decision.candidates[CANDIDATE].reasons).toContain(reason);
  });
});
