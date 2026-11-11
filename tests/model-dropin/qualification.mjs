/**
 * Evidence-based package qualification for a measured product comparison.
 *
 * PASS needs an explicit owner-approved promotion policy and a complete measured comparison. Each
 * non-incumbent candidate must also bind one sealed package digest, cover every expected sample,
 * and stay within the policy's bounds relative to the incumbent on the same matched population.
 * Anything else is HOLD with its reasons. No threshold defaults exist here: without a policy the
 * result is HOLD (`no_promotion_policy`), never a relabelled PASS.
 *
 * The policy is trusted only through its digest. A signer string inside the policy proves nothing, so
 * the exact policy bytes must match the digest bound in the separately approved execution packet
 * before any take is spent; an unbound or mismatched policy holds.
 */
const HASH = /^[a-f0-9]{64}$/;
export const PROMOTION_POLICY_SCHEMA = 'speaksharp.model-promotion-policy.v1';

export function validatePromotionPolicy(policy) {
  if (!policy || typeof policy !== 'object' || policy.schema !== PROMOTION_POLICY_SCHEMA
    || typeof policy.incumbent !== 'string' || !policy.incumbent
    || !Number.isFinite(policy.maxWerRegression) || policy.maxWerRegression < 0
    || !Number.isFinite(policy.maxStopToCompletionRatio) || policy.maxStopToCompletionRatio <= 0
    || typeof policy.approvedBy !== 'string' || !policy.approvedBy.trim()) {
    throw Error('PROMOTION_POLICY_INVALID');
  }
  return policy;
}

/** A take timing counts only as a finite, non-negative number; anything else is a missing measurement. */
export const validTiming = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

const median = values => {
  const v = [...values].sort((a, b) => a - b);
  return !v.length ? null : v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

/** The runner's timing aggregation. `samples` records how many takes actually carried a valid timing. */
export function timingMetric(values) {
  const measured = values.filter(validTiming);
  return { status: measured.length ? 'MEASURED' : 'NOT RUN', samples: measured.length, median: median(measured) };
}

const verifiedRows = (rows, id) =>
  rows.filter(row => row.candidate === id && row.measured && row.productEvidence?.productProof?.verdict === 'PASS');

/**
 * Every expected (trial, clip) take must appear exactly once, and each one must carry a valid
 * completion timing. A median over the surviving takes is not evidence about the missing ones.
 */
function populationReasons(verified, population, stop) {
  const reasons = [];
  const keys = verified.map(row => `${row.trial}:${row.clip}`);
  if (new Set(keys).size !== keys.length) reasons.push('duplicate_rows');
  if (keys.length !== population.length || population.some(key => !keys.includes(key))) reasons.push('population_mismatch');
  if (!verified.every(row => validTiming(row.stopToCompletionMs)) || stop?.samples !== population.length) {
    reasons.push('stop_to_completion_incomplete');
  }
  return reasons;
}

export function qualifyComparison({
  summary, rows, candidates, policy, policySha256 = null, expectedPolicySha256 = null,
  expectedPackages = {}, population = [],
}) {
  const hold = reasons => ({ qualification: 'HOLD', qualifiedPackages: [], reasons, candidates: {} });
  if (!policy) return hold(['no_promotion_policy']);
  try { validatePromotionPolicy(policy); } catch { return hold(['promotion_policy_invalid']); }
  if (!HASH.test(policySha256 ?? '') || policySha256 !== expectedPolicySha256) return hold(['promotion_policy_unbound']);
  if (summary?.status !== 'MEASURED_PRODUCT_COMPARISON') return hold(['comparison_incomplete']);
  if (!candidates.includes(policy.incumbent)) return hold(['incumbent_not_measured']);
  if (!population.length) return hold(['population_unbound']);
  const matched = summary.commonMatchedPopulation;
  const incumbent = summary.models?.[policy.incumbent];
  const incumbentWer = matched?.models?.[policy.incumbent]?.wer;
  const incumbentStop = incumbent?.timings?.stopToCompletionMs;
  if (!incumbent || incumbent.validSampleCount !== incumbent.expectedSampleCount
    || !Number.isFinite(incumbentWer) || incumbentStop?.status !== 'MEASURED' || !Number.isFinite(incumbentStop.median)
    || populationReasons(verifiedRows(rows, policy.incumbent), population, incumbentStop).length) {
    return hold(['incumbent_evidence_incomplete']);
  }
  const verdicts = {};
  const qualified = [];
  for (const id of candidates) {
    if (id === policy.incumbent) continue;
    const model = summary.models?.[id];
    const verified = verifiedRows(rows, id);
    const reasons = [];
    if (!model || model.validSampleCount !== model.expectedSampleCount) reasons.push('samples_incomplete');
    if (matched?.models?.[id]?.samples !== matched?.samplesPerModel || !matched?.samplesPerModel) reasons.push('matched_population_incomplete');
    const stop = model?.timings?.stopToCompletionMs;
    reasons.push(...populationReasons(verified, population, stop));
    // Every take must carry the exact seal the campaign verified for this candidate; an internally
    // consistent digest that is not that seal binds nothing.
    const expected = expectedPackages[id];
    const digest = HASH.test(expected ?? '') && verified.length && verified.every(row => row.packageDigest === expected)
      ? expected : null;
    if (!HASH.test(expected ?? '')) reasons.push('package_digest_unbound');
    else if (!digest) reasons.push('package_digest_mismatch');
    const wer = matched?.models?.[id]?.wer;
    if (!Number.isFinite(wer)) reasons.push('wer_not_measured');
    else if (wer > incumbentWer + policy.maxWerRegression) reasons.push('wer_regression');
    if (stop?.status !== 'MEASURED' || !Number.isFinite(stop.median)) reasons.push('stop_to_completion_not_measured');
    else if (stop.median > incumbentStop.median * policy.maxStopToCompletionRatio) reasons.push('stop_to_completion_regression');
    verdicts[id] = { verdict: reasons.length ? 'HOLD' : 'PASS', packageDigest: digest, reasons };
    if (!reasons.length) qualified.push(digest);
  }
  return {
    qualification: qualified.length ? 'PASS' : 'HOLD',
    qualifiedPackages: qualified,
    reasons: qualified.length ? [] : ['no_candidate_met_policy'],
    candidates: verdicts,
    policy: { schema: policy.schema, incumbent: policy.incumbent, approvedBy: policy.approvedBy,
      maxWerRegression: policy.maxWerRegression, maxStopToCompletionRatio: policy.maxStopToCompletionRatio },
  };
}
