/**
 * Evidence-based package qualification for a measured product comparison.
 *
 * PASS needs an explicit owner-approved promotion policy and a complete measured comparison. Each
 * non-incumbent candidate must also bind one sealed package digest, cover every expected sample,
 * and stay within the policy's bounds relative to the incumbent on the same matched population.
 * Anything else is HOLD with its reasons. No threshold defaults exist here: without a policy the
 * result is HOLD (`no_promotion_policy`), never a relabelled PASS.
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

/** One sealed digest per candidate, carried by every verified row; a mixed or missing digest binds nothing. */
function boundDigest(rows) {
  const digests = new Set(rows.map(row => row.packageDigest));
  if (digests.size !== 1) return null;
  const [digest] = digests;
  return typeof digest === 'string' && HASH.test(digest) ? digest : null;
}

export function qualifyComparison({ summary, rows, candidates, policy }) {
  const hold = reasons => ({ qualification: 'HOLD', qualifiedPackages: [], reasons, candidates: {} });
  if (!policy) return hold(['no_promotion_policy']);
  try { validatePromotionPolicy(policy); } catch { return hold(['promotion_policy_invalid']); }
  if (summary?.status !== 'MEASURED_PRODUCT_COMPARISON') return hold(['comparison_incomplete']);
  if (!candidates.includes(policy.incumbent)) return hold(['incumbent_not_measured']);
  const matched = summary.commonMatchedPopulation;
  const incumbent = summary.models?.[policy.incumbent];
  const incumbentWer = matched?.models?.[policy.incumbent]?.wer;
  const incumbentStop = incumbent?.timings?.stopToCompletionMs;
  if (!incumbent || incumbent.validSampleCount !== incumbent.expectedSampleCount
    || !Number.isFinite(incumbentWer) || incumbentStop?.status !== 'MEASURED' || !Number.isFinite(incumbentStop.median)) {
    return hold(['incumbent_evidence_incomplete']);
  }
  const verdicts = {};
  const qualified = [];
  for (const id of candidates) {
    if (id === policy.incumbent) continue;
    const model = summary.models?.[id];
    const verified = rows.filter(row => row.candidate === id && row.measured && row.productEvidence?.productProof?.verdict === 'PASS');
    const reasons = [];
    if (!model || model.validSampleCount !== model.expectedSampleCount) reasons.push('samples_incomplete');
    if (matched?.models?.[id]?.samples !== matched?.samplesPerModel || !matched?.samplesPerModel) reasons.push('matched_population_incomplete');
    const digest = boundDigest(verified);
    if (!digest) reasons.push('package_digest_unbound');
    const wer = matched?.models?.[id]?.wer;
    if (!Number.isFinite(wer)) reasons.push('wer_not_measured');
    else if (wer > incumbentWer + policy.maxWerRegression) reasons.push('wer_regression');
    const stop = model?.timings?.stopToCompletionMs;
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
