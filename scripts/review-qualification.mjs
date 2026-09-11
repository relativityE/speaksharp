#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * A scope-only finding document is not implementation. Keep this predicate deliberately narrow:
 * release-qualification code must change an executable source, workflow, or repository configuration.
 */
export function isSubstantiveImplementationFile(file) {
  if (typeof file !== 'string' || file.trim() === '') return false;
  const path = file.trim();
  if (path.startsWith('docs/findings/')) return false;
  if (/\.(md|txt)$/i.test(path)) return false;
  if (/(^|\/)(__tests__|tests?)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) return false;
  return path.startsWith('.github/workflows/')
    || path.startsWith('scripts/')
    || path.startsWith('frontend/src/')
    || path.startsWith('backend/')
    || ['package.json', 'pnpm-lock.yaml', 'vite.config.mjs', 'vercel.json'].includes(path);
}

/**
 * Qualify an automated review without treating a zero finding count as the review itself.
 *
 * The caller must supply the current PR head and the SHA reported by the completed review. A review
 * of a scaffold or an older head is historical evidence, even when it found nothing.
 */
/**
 * #1430 P1 — A RECEIPT MUST BE FRESH, BECAUSE A REOPENED THREAD EMITS NO EVENT.
 *
 * GitHub emits no workflow event when a review thread is resolved or unresolved, so a green
 * qualification can outlive the state it described: reopen a P0/P1 thread after the run and the check
 * stays green until some unrelated event happens to re-fire it. No trigger list can close that, and
 * inventing one is not available.
 *
 * Freshness closes it without a webhook and without elevated credentials. A receipt states when it was
 * produced; a merge decision requires one produced immediately beforehand; anything older is stale and
 * disqualifies. A thread reopened after the receipt was written makes that receipt stale by
 * construction, so the merge must re-qualify and the reopen is then seen.
 *
 * This replaced an earlier attempt that held on unverifiable branch-protection enforcement. That
 * deadlocked every candidate, because `github.token` cannot read the admin surfaces and a PR-controlled
 * workflow must not be given `GH_PAT` — so the hold could never be cleared by anyone. Freshness is
 * something the release lane genuinely controls.
 */
export const RECEIPT_MAX_AGE_MS = 30 * 60 * 1000;

export function evaluateReviewQualification({
  currentSha,
  reviewedSha,
  reviewStatus,
  findingCount,
  changedFiles,
  generatedAt,
  now = Date.now(),
  maxAgeMs = RECEIPT_MAX_AGE_MS,
} = {}) {
  const reasons = [];
  const normalizedCurrent = typeof currentSha === 'string' ? currentSha.toLowerCase() : '';
  const normalizedReviewed = typeof reviewedSha === 'string' ? reviewedSha.toLowerCase() : '';

  if (!FULL_SHA.test(normalizedCurrent)) reasons.push('current_sha_missing_or_invalid');
  if (!FULL_SHA.test(normalizedReviewed)) reasons.push('reviewed_sha_missing_or_invalid');
  if (reviewStatus !== 'completed') reasons.push(`review_not_completed:${reviewStatus ?? 'missing'}`);

  if (!Number.isInteger(findingCount) || findingCount < 0) {
    reasons.push('finding_count_missing_or_invalid');
  } else if (findingCount !== 0) {
    reasons.push(`open_findings:${findingCount}`);
  }

  const files = Array.isArray(changedFiles) ? changedFiles : [];
  const substantiveFiles = files.filter(isSubstantiveImplementationFile);
  if (substantiveFiles.length === 0) reasons.push('no_substantive_implementation');

  if (FULL_SHA.test(normalizedCurrent)
      && FULL_SHA.test(normalizedReviewed)
      && normalizedCurrent !== normalizedReviewed) {
    reasons.push('reviewed_sha_is_not_current_head');
  }

  /*
   * MISSING AND UNPARSEABLE ARE BOTH STALE, never "assume fresh". A receipt that cannot say when it was
   * produced cannot support a merge decision, and defaulting an absent timestamp to `now` is exactly
   * how a stale receipt would slip through.
   */
  const producedAt = Date.parse(String(generatedAt ?? ''));
  if (!Number.isFinite(producedAt)) {
    reasons.push('receipt_generated_at_missing_or_invalid');
  } else {
    const ageMs = now - producedAt;
    // A receipt from the future is not fresh either — it is a clock or a fabrication problem.
    if (ageMs < 0) reasons.push('receipt_generated_in_the_future');
    else if (ageMs > maxAgeMs) reasons.push(`receipt_stale:${Math.round(ageMs / 1000)}s`);
  }

  return {
    qualified: reasons.length === 0,
    generatedAt: Number.isFinite(producedAt) ? new Date(producedAt).toISOString() : null,
    reasons,
    currentSha: normalizedCurrent || null,
    reviewedSha: normalizedReviewed || null,
    reviewStatus: reviewStatus ?? null,
    findingCount: Number.isInteger(findingCount) ? findingCount : null,
    substantiveFiles,
  };
}

export function formatReviewQualification(result) {
  return result.qualified
    ? `REVIEW-QUALIFIED: completed zero-finding review covers current implementation head ${result.currentSha}`
    : `NOT REVIEW-QUALIFIED: ${result.reasons.join(', ')}`;
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('usage: node scripts/review-qualification.mjs <review-receipt.json>');
    process.exit(2);
  }

  let input;
  try {
    input = JSON.parse(readFileSync(inputPath, 'utf8'));
  } catch (error) {
    console.error(`NOT REVIEW-QUALIFIED: unreadable input (${error instanceof Error ? error.message : String(error)})`);
    process.exit(1);
  }

  const result = evaluateReviewQualification(input);
  console.log(formatReviewQualification(result));
  if (!result.qualified) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
