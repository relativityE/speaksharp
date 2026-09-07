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
export function evaluateReviewQualification({
  currentSha,
  reviewedSha,
  reviewStatus,
  findingCount,
  changedFiles,
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

  return {
    qualified: reasons.length === 0,
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
