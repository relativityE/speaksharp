import { describe, expect, it } from 'vitest';
import {
  qualifyComparison, timingMetric, validatePromotionPolicy, PROMOTION_POLICY_SCHEMA, type PromotionPolicy,
} from './qualification.mjs';

const INCUMBENT = 'v2:base.en';
const CANDIDATE = 'v4:distil:q4';
const DIGEST = 'a'.repeat(64);
const POLICY_SHA = 'c'.repeat(64);
const POPULATION = ['1:clip-a', '1:clip-b', '2:clip-a', '2:clip-b'];
const policy: PromotionPolicy = {
  schema: PROMOTION_POLICY_SCHEMA, incumbent: INCUMBENT, maxWerRegression: 0.01, maxStopToCompletionRatio: 1.5,
  approvedBy: 'synthetic test policy',
};
const bound = { policySha256: POLICY_SHA, expectedPolicySha256: POLICY_SHA, population: POPULATION,
  expectedPackages: { [INCUMBENT]: null, [CANDIDATE]: DIGEST } };

type Row = { candidate: string; trial: number; clip: string; measured: boolean; packageDigest: string | null;
  stopToCompletionMs: unknown; productEvidence: { productProof: { verdict: string } } };
const take = (candidate: string, key: string, stopToCompletionMs: unknown, packageDigest: string | null): Row => {
  const [trial, clip] = key.split(':');
  return { candidate, trial: Number(trial), clip, measured: true, packageDigest, stopToCompletionMs,
    productEvidence: { productProof: { verdict: 'PASS' } } };
};

/** Rows first; the summary timings come from the runner's own aggregation over those rows. */
function evidence({ candidateWer = 0.05, candidateStop = 900, candidateValid = 4,
  digests = [DIGEST, DIGEST, DIGEST, DIGEST] as (string | null)[],
  incumbentStops = [800, 800, 800, 800] as unknown[], candidateStops = null as unknown[] | null,
  candidateKeys = POPULATION } = {}) {
  const rows = [
    ...POPULATION.map((key, i) => take(INCUMBENT, key, incumbentStops[i], null)),
    ...candidateKeys.map((key, i) => take(CANDIDATE, key, candidateStops ? candidateStops[i] : candidateStop, digests[i] ?? null)),
  ];
  const timings = (id: string) => ({ stopToCompletionMs: timingMetric(rows.filter(r => r.candidate === id).map(r => r.stopToCompletionMs)) });
  const summary = {
    status: 'MEASURED_PRODUCT_COMPARISON',
    models: {
      [INCUMBENT]: { validSampleCount: 4, expectedSampleCount: 4, timings: timings(INCUMBENT) },
      [CANDIDATE]: { validSampleCount: candidateValid, expectedSampleCount: 4, timings: timings(CANDIDATE) },
    },
    commonMatchedPopulation: { samplesPerModel: 4, models: {
      [INCUMBENT]: { samples: 4, wer: 0.05 }, [CANDIDATE]: { samples: 4, wer: candidateWer },
    } },
  };
  return { summary, rows, candidates: [INCUMBENT, CANDIDATE] };
}

describe('evidence-based package qualification', () => {
  it('qualifies only the verified campaign seal of a candidate inside every policy bound', () => {
    const decision = qualifyComparison({ ...evidence(), policy, ...bound });
    expect(decision).toMatchObject({ qualification: 'PASS', qualifiedPackages: [DIGEST], reasons: [] });
    expect(decision.candidates[CANDIDATE]).toEqual({ verdict: 'PASS', packageDigest: DIGEST, reasons: [] });
  });

  it('never relabels a complete comparison as PASS without an owner-approved policy', () => {
    expect(qualifyComparison({ ...evidence(), policy: null, ...bound }))
      .toMatchObject({ qualification: 'HOLD', qualifiedPackages: [], reasons: ['no_promotion_policy'] });
  });

  it.each([
    ['missing schema', { ...policy, schema: 'other' }],
    ['negative WER tolerance', { ...policy, maxWerRegression: -0.01 }],
    ['zero latency ratio', { ...policy, maxStopToCompletionRatio: 0 }],
    ['no approver', { ...policy, approvedBy: ' ' }],
  ])('refuses an invalid policy (%s)', (_, bad) => {
    expect(() => validatePromotionPolicy(bad)).toThrow('PROMOTION_POLICY_INVALID');
    expect(qualifyComparison({ ...evidence(), policy: bad as PromotionPolicy, ...bound }).reasons).toEqual(['promotion_policy_invalid']);
  });

  // A signer string is not authority: the policy counts only through the digest the approval bound.
  it.each([
    ['no approval binding', { expectedPolicySha256: null }],
    ['no observed policy digest', { policySha256: null }],
    ['a different approved digest', { expectedPolicySha256: 'd'.repeat(64) }],
    ['a malformed matching digest', { policySha256: 'nothex', expectedPolicySha256: 'nothex' }],
  ])('holds a valid-looking policy with %s', (_, patch) => {
    expect(qualifyComparison({ ...evidence(), policy, ...bound, ...patch }))
      .toMatchObject({ qualification: 'HOLD', qualifiedPackages: [], reasons: ['promotion_policy_unbound'] });
  });

  it('holds an incomplete comparison even when every candidate row looks good', () => {
    const input = evidence();
    expect(qualifyComparison({ ...input, summary: { ...input.summary, status: 'INCOMPLETE_OR_FAILED' }, policy, ...bound }).reasons)
      .toEqual(['comparison_incomplete']);
  });

  it('holds without a bound expected population', () => {
    expect(qualifyComparison({ ...evidence(), policy, ...bound, population: [] }).reasons).toEqual(['population_unbound']);
  });

  it('holds when the incumbent baseline itself is incomplete', () => {
    const input = evidence();
    input.summary.models[INCUMBENT].validSampleCount = 3;
    expect(qualifyComparison({ ...input, policy, ...bound }).reasons).toEqual(['incumbent_evidence_incomplete']);
  });

  // The runner's aggregation drops invalid timings, so its median alone looks healthy. Each of these
  // actual summaries keeps a finite median while one paired take carries no valid completion timing.
  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, '900'])(
    'holds when one incumbent take has completion timing %s', invalid => {
      const input = evidence({ incumbentStops: [800, 800, 800, invalid] });
      expect(input.summary.models[INCUMBENT].timings.stopToCompletionMs).toMatchObject({ status: 'MEASURED', samples: 3, median: 800 });
      expect(qualifyComparison({ ...input, policy, ...bound }).reasons).toEqual(['incumbent_evidence_incomplete']);
    });

  it.each([null, Number.NaN, -1])('holds a candidate when one take has completion timing %s', invalid => {
    const input = evidence({ candidateStops: [900, 900, 900, invalid] });
    expect(input.summary.models[CANDIDATE].timings.stopToCompletionMs).toMatchObject({ status: 'MEASURED', samples: 3, median: 900 });
    const decision = qualifyComparison({ ...input, policy, ...bound });
    expect(decision).toMatchObject({ qualification: 'HOLD', qualifiedPackages: [] });
    expect(decision.candidates[CANDIDATE].reasons).toContain('stop_to_completion_incomplete');
  });

  it.each([
    ['a WER regression beyond tolerance', { candidateWer: 0.07 }, 'wer_regression'],
    ['a completion-latency regression', { candidateStop: 1300 }, 'stop_to_completion_regression'],
    ['missing samples', { candidateValid: 3 }, 'samples_incomplete'],
    ['no seal on any take', { digests: [null, null, null, null] }, 'package_digest_mismatch'],
    ['mixed packages across takes', { digests: [DIGEST, DIGEST, DIGEST, 'b'.repeat(64)] }, 'package_digest_mismatch'],
    // Internally consistent, well-formed and wrong: not the seal the campaign verified.
    ['a consistently wrong digest', { digests: ['b'.repeat(64), 'b'.repeat(64), 'b'.repeat(64), 'b'.repeat(64)] }, 'package_digest_mismatch'],
    ['a missing take', { candidateKeys: POPULATION.slice(0, 3) }, 'population_mismatch'],
    ['a duplicated take in place of another', { candidateKeys: [...POPULATION.slice(0, 3), POPULATION[0]] }, 'duplicate_rows'],
    ['a take outside the population', { candidateKeys: [...POPULATION.slice(0, 3), '3:clip-a'] }, 'population_mismatch'],
  ] as const)('holds a candidate with %s', (_, override, reason) => {
    const decision = qualifyComparison({ ...evidence(override as Parameters<typeof evidence>[0]), policy, ...bound });
    expect(decision).toMatchObject({ qualification: 'HOLD', qualifiedPackages: [], reasons: ['no_candidate_met_policy'] });
    expect(decision.candidates[CANDIDATE].reasons).toContain(reason);
  });

  it('holds a candidate whose campaign entry carries no verified seal', () => {
    const decision = qualifyComparison({ ...evidence(), policy, ...bound, expectedPackages: { [CANDIDATE]: null } });
    expect(decision.candidates[CANDIDATE]).toMatchObject({ verdict: 'HOLD', packageDigest: null });
    expect(decision.candidates[CANDIDATE].reasons).toContain('package_digest_unbound');
  });
});
