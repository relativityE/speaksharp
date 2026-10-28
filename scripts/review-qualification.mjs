#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { FULL_LANE_PATTERNS } from './ci-change-scope.mjs';

const FULL_SHA = /^[0-9a-f]{40}$/;

// Owner-selected #1674 handoff: reviewed source 985e45332313b2aaf27f9581e0df42be26e618df.
// These are trusted-base Git postimages, never loaded from a candidate manifest.
export const DOCUMENTATION_EVIDENCE_ADMISSION = Object.freeze({
  repository: 'relativityE/speaksharp', number: 1674,
  reviewedSource: '985e45332313b2aaf27f9581e0df42be26e618df',
  files: Object.freeze([
    Object.freeze({"path":".agent/workflows/pr-merge-workflow.md","oid":"6a0e8a9127e8a00c49b8fa8dfb55a97312015399","mode":"100644","size":11491}),
    Object.freeze({"path":"AGENTS.md","oid":"6adc37f6b874df6ea513e157f4b788b0ace5aa5c","mode":"100644","size":29891}),
    Object.freeze({"path":"README.md","oid":"793f8ce534980a7320ae50bd557c309a5d88ba7c","mode":"100644","size":16244}),
    Object.freeze({"path":"product_release/ARCHITECTURE.md","oid":"48aa2d5dcea5e790754547ebff574ff85dd1cd30","mode":"100644","size":26812}),
    Object.freeze({"path":"product_release/ENTITLEMENTS_AND_BILLING.md","oid":"de07d38ce125e686472016dbc3cae351ba762db0","mode":"100644","size":12084}),
    Object.freeze({"path":"product_release/EVIDENCE_INDEX.md","oid":"14af5505758f054683036cdfee2e224fa156f084","mode":"100644","size":60792}),
    Object.freeze({"path":"product_release/OPERATIONS_AND_SECURITY.md","oid":"597c259a314c8bd7e0fa8a4c992716f14828d988","mode":"100644","size":48016}),
    Object.freeze({"path":"product_release/PRODUCT_REQUIREMENTS.md","oid":"510662d2f8cc5c5a23c1abc25b36e460dd476245","mode":"100644","size":25659}),
    Object.freeze({"path":"product_release/PROGRESS_AND_NEXT_ACTION.md","oid":"538107fa8560f1fbdf32bd3e3c37b0a59b92f67d","mode":"100644","size":27269}),
    Object.freeze({"path":"product_release/QUALITY.md","oid":"697a015eddf84345e435b6453a5310cdd7718d67","mode":"100644","size":40229}),
    Object.freeze({"path":"product_release/README.md","oid":"414134476c46a3827af3f8f7634eb299e051d84a","mode":"100644","size":18306}),
    Object.freeze({"path":"product_release/RELEASE_PROCESS.md","oid":"fa0c5dbdd976090bdaf4f787b2b5c35898bb0ffc","mode":"100644","size":46686}),
    Object.freeze({"path":"product_release/RELEASE_STATUS.md","oid":"cb7ef279d39e6022002cfcff38d7135b254a4ee9","mode":"100644","size":54396}),
    Object.freeze({"path":"product_release/ROADMAP.md","oid":"f2ff24fa57fd6a3c879aba32c898019fa60fdf21","mode":"100644","size":22999}),
    Object.freeze({"path":"product_release/STT.md","oid":"74eedae8219d8e5a277838f7b646260a5800ff90","mode":"100644","size":28836}),
    Object.freeze({"path":"product_release/TESTER_OPERATIONS.md","oid":"b621fd3138d0a7f3687b21320440d54a85d6dd29","mode":"100644","size":22478}),
    Object.freeze({"path":"product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/README.md","oid":"fb43f0782ece43a026b5468803f5d4db011f6ca2","mode":"100644","size":3232}),
    Object.freeze({"path":"product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/SHA256SUMS","oid":"397561be488d0ba8a5d60bfbf4648988da6188fe","mode":"100644","size":1350}),
    Object.freeze({"path":"product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/manifest.json","oid":"e167721969953d2ff0c4535af4b580f5ffb81b04","mode":"100644","size":5459}),
    Object.freeze({"path":"product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.14bcb70c-b6f3-4ca8-8020-59a810217ac4.readback.log","oid":"8a2623b5ac22342f823675dbb51b6d990841e80e","mode":"100644","size":975}),
    Object.freeze({"path":"product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.385b988b-a182-4bd7-b6f9-b6d08ec0e0c8.user-stage.readback.log","oid":"2faedceef162c3feec55185a2e05e0feb15125ea","mode":"100644","size":1380}),
    Object.freeze({"path":"product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.4233c347-c344-4f9b-870d-2afe6e4f25b3.user-stage.readback.log","oid":"93bc75313c00a6ec8eb97c444fedc57020570c43","mode":"100644","size":1380}),
    Object.freeze({"path":"product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.4c411373-7659-4d72-b523-df83a888f9e3.user-stage.readback.log","oid":"bf1cc7e3e8e2aeca807bc770c9d0fc8896ac3244","mode":"100644","size":1380}),
    Object.freeze({"path":"product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.6b29d535-c093-4969-a149-2018e6dafd74.readback.log","oid":"48993631d27fe99141c0acc11ef6bdc0cd48e0dc","mode":"100644","size":2413}),
    Object.freeze({"path":"product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.b87fff60-dc85-4a89-a820-77bd16c3d8d1.user-stage.readback.log","oid":"a7d6316f20dec432b9d23852817bb0b5cfe0f75c","mode":"100644","size":1455}),
    Object.freeze({"path":"product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.e6d6e411-6273-481d-8df4-82f62ce79b62.user-stage.readback.log","oid":"96be83b9d8a66d1567d4769261ad3833fe2c0107","mode":"100644","size":1380}),
    Object.freeze({"path":"product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.human-worksheet.md","oid":"26e664d96f445ca825637036de7727ffd7221b6b","mode":"100644","size":1155}),
    Object.freeze({"path":"product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.readback-verdicts.json","oid":"32ccc2fcdfa07e141c3b6634ced495c269a2259e","mode":"100644","size":582}),
    Object.freeze({"path":"product_release/evidence/retained/2026-10-11-rwt-run1-38104864048-attempt-1/open-mic-first-session.receipt.json","oid":"725ff4415595e03fceda5ccdaefd79da8aebaca6","mode":"100644","size":21869}),
    Object.freeze({"path":"product_release/evidence/retained/documentation-clause-receiving-2026-10-28.json","oid":"1bad0cb5f298977921688c4a5f303eb739280f34","mode":"100644","size":6894004}),
    Object.freeze({"path":"product_release/evidence/stt/README.md","oid":"659040be5d64abaf34cc5b96a817e3eb6e12a26e","mode":"100644","size":4364}),
  ]),
});

// Owner-selected #1599 receiver; approved archive correction frozen in 0124d8ed.
// Historical verification source is archived as data; exact postimages are Git metadata only.
export const FINANCIAL_EVIDENCE_ADMISSION = Object.freeze({
  repository: 'relativityE/speaksharp', number: 1599,
  reviewedSource: '0124d8ed1c83f7cb37b3acb04e870166d10bef18',
  files: Object.freeze([
    Object.freeze({"path":"local-packets/1599-model-status-control/README.md","oid":"23e345dea0da592e1c6a9cd9765d8ab22a21e57b","mode":"100644","size":2624}),
    Object.freeze({"path":"local-packets/1599-model-status-control/edit.mjs","oid":"9942d9759b6ed2e09183fea1dff432212f1bb523","mode":"100644","size":1459}),
    Object.freeze({"path":"local-packets/1599-model-status-control/inspect-native.py","oid":"e02ed0ca701232bdfa37eacbdebcd1f93b409363","mode":"100644","size":723}),
    Object.freeze({"path":"local-packets/1599-model-status-control/native-receipts.json","oid":"058fbb2cb968b85d0cf66aee9aff08977064dc93","mode":"100644","size":3906}),
    Object.freeze({"path":"local-packets/1599-model-status-control/preserve-package.py","oid":"ac271ead1d1c58d30a069a4b437cd6893eaf7acf","mode":"100644","size":2442}),
    Object.freeze({"path":"local-packets/1599-model-status-control/verify-native-source.txt","oid":"f0808c29474edb983b46358ea8931037e85800aa","mode":"100644","size":6570}),
    Object.freeze({"path":"product_release/ROADMAP.md","oid":"1769c07635ead0df59990bcdb6fb949e182e0838","mode":"100644","size":23129}),
    Object.freeze({"path":"product_release/work_items/financial-analysis/FINANCIAL_MODEL_REVIEW_2026-10-12.md","oid":"b14f1633eb5abdf72664e17d9990a0497e11e3a4","mode":"100644","size":20725}),
    Object.freeze({"path":"product_release/work_items/financial-analysis/SpeakSharp_Updated_Financial_Model_2026-10-12.xlsx","oid":"c78f60fa0383ae2461f209bdb96a0a50b2909f5e","mode":"100644","size":76656}),
  ]),
});

export function documentationEvidenceAdmission(repository, number) {
  return [DOCUMENTATION_EVIDENCE_ADMISSION, FINANCIAL_EVIDENCE_ADMISSION]
    .find(profile => profile.repository === repository && profile.number === number) ?? null;
}

export function isPinnedDocumentationEvidence({
  repository, pullRequestNumber, currentSha, baseSha, changedFiles, documentationEvidence: evidence,
}) {
  const admission = documentationEvidenceAdmission(repository, pullRequestNumber);
  if (!admission || repository !== admission.repository || pullRequestNumber !== admission.number
      || !FULL_SHA.test(currentSha ?? '') || !FULL_SHA.test(baseSha ?? '')
      || !Array.isArray(changedFiles) || changedFiles.length !== admission.files.length
      || new Set(changedFiles).size !== changedFiles.length
      || evidence?.complete !== true || evidence.repository !== repository
      || evidence.number !== pullRequestNumber || evidence.headSha !== currentSha || evidence.baseSha !== baseSha
      || evidence.headRepository !== repository || evidence.baseRef !== 'main'
      || !FULL_SHA.test(evidence.treeSha ?? '') || !Array.isArray(evidence.entries)
      || evidence.entries.length !== admission.files.length) return false;
  const expected = new Map(admission.files.map(row => [row.path, row]));
  if (!changedFiles.every(path => expected.has(path))) return false;
  const observed = new Map();
  for (const row of evidence.entries) {
    if (!row || observed.has(row.path)) return false;
    observed.set(row.path, row);
  }
  return admission.files.every(pin => {
    const actual = observed.get(pin.path);
    return actual?.oid === pin.oid && actual.mode === pin.mode && actual.type === 'blob'
      && Number.isSafeInteger(actual.size) && actual.size === pin.size;
  });
}


export const CANONICAL_PRODUCT_RELEASE_DOCUMENTS = Object.freeze([
  'product_release/ARCHITECTURE.md',
  'product_release/ENTITLEMENTS_AND_BILLING.md',
  'product_release/EVIDENCE_INDEX.md',
  'product_release/OPERATIONS_AND_SECURITY.md',
  'product_release/PRODUCT_REQUIREMENTS.md',
  'product_release/PROGRESS_AND_NEXT_ACTION.md',
  'product_release/QUALITY.md',
  'product_release/README.md',
  'product_release/RELEASE_PROCESS.md',
  'product_release/RELEASE_STATUS.md',
  'product_release/ROADMAP.md',
  'product_release/STT.md',
  'product_release/TESTER_GUIDE.md',
  'product_release/TESTER_OPERATIONS.md',
]);
const CANONICAL_PRODUCT_RELEASE_DOCUMENT_SET = new Set(CANONICAL_PRODUCT_RELEASE_DOCUMENTS);

/**
 * Canonical product authorities are a reviewable documentation claim, not an implementation claim.
 * Keep this allowlist exact: archive/evidence/work-item prose and a fifteenth root document do not
 * gain a merge path merely by being Markdown under product_release/.
 */
export function isCanonicalProductReleaseDocument(file) {
  return typeof file === 'string' && CANONICAL_PRODUCT_RELEASE_DOCUMENT_SET.has(file);
}

/**
 * A scope-only finding document is not implementation. Keep this predicate deliberately narrow:
 * release-qualification code must change an executable source, workflow, or repository configuration.
 *
 * #1430 fix-forward, Codex P1 `3991325303` — EXECUTABLE CONTROL FILES ARE IMPLEMENTATION.
 *
 * The whitelist named four root files and `.github/workflows/`, so a PR changing only
 * `.github/actions/setup-environment/action.yml` or `frontend/vite.config.mjs` could never qualify, even
 * with a clean exact-head review. Those are the paths the CI lane classifier already treats as full-lane
 * control changes, so the two predicates now share ONE list rather than disagreeing about what controls
 * the build. Prose and tests are still excluded first, whatever directory they sit in.
 */
export function isSubstantiveImplementationFile(file) {
  if (typeof file !== 'string' || file.trim() === '') return false;
  const path = file.trim();
  if (path.startsWith('docs/findings/')) return false;
  if (/\.(md|txt)$/i.test(path)) return false;
  if (/(^|\/)(__tests__|tests?)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) return false;
  return path.startsWith('frontend/src/')
    || path.startsWith('backend/')
    || FULL_LANE_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * #1543 PM RETURN `5896325560` — A REVIEWED TEST-INTEGRITY CHANGE HAS A SCOPE OF ITS OWN.
 *
 * Tests are excluded from `isSubstantiveImplementationFile` so that a test edit can never make a PR
 * "implementation". But a PR whose whole purpose is to correct a test oracle (#1543's Progress/Start
 * deadline, #1542's RWT fixture) then had no scope at all and could never qualify, however clean its
 * exact-head review. This scope is deliberately narrow: EVERY changed file must be executable test source —
 * a JS/TS family file under a `tests/` or `__tests__/` directory, or a `*.test.*` / `*.spec.*` file. Prose,
 * findings, fixtures and data, and any path outside test code keep the PR unscoped, so a docs-only,
 * scaffold or unknown change still cannot use it. It changes only the SCOPE question: the exact-head
 * review, zero findings, freshness and the protected CI lane are required exactly as before.
 */
const TEST_SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/;

export function isTestIntegrityFile(file) {
  if (typeof file !== 'string' || file.trim() === '' || file !== file.trim()) return false;
  if (file.startsWith('docs/') || !TEST_SOURCE_EXTENSION.test(file)) return false;
  return file.startsWith('tests/')
    || /(^|\/)__tests__\//.test(file)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
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
  repository,
  pullRequestNumber,
  baseSha,
  documentationEvidence,
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
  const documentationFiles = files.filter(isCanonicalProductReleaseDocument);
  const canonicalDocumentationOnly = files.length > 0 && documentationFiles.length === files.length;
  const testIntegrityOnly = files.length > 0 && files.every(isTestIntegrityFile);
  const namedDocumentationCarrier = documentationEvidenceAdmission(repository, pullRequestNumber) !== null;
  const pinnedDocumentation = isPinnedDocumentationEvidence({ repository, pullRequestNumber,
    currentSha: normalizedCurrent, baseSha, changedFiles: files, documentationEvidence });
  const reviewScope = namedDocumentationCarrier
    ? pinnedDocumentation ? 'pinned_product_release_documentation_evidence' : null
    : substantiveFiles.length > 0
    ? 'implementation'
    : canonicalDocumentationOnly ? 'canonical_product_release_documentation'
      : testIntegrityOnly ? 'test_integrity' : null;
  if (reviewScope === null) reasons.push('no_substantive_implementation');
  if (namedDocumentationCarrier && !pinnedDocumentation) reasons.push('pinned_documentation_postimages_unverified');

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
    documentationFiles,
    reviewScope,
  };
}

export function formatReviewQualification(result) {
  const subject = result.reviewScope === 'pinned_product_release_documentation_evidence'
    ? 'pinned product-release documentation/evidence'
    : result.reviewScope === 'canonical_product_release_documentation'
    ? 'canonical product-release documentation'
    : result.reviewScope === 'test_integrity' ? 'test-integrity' : 'implementation';
  return result.qualified
    ? `REVIEW-QUALIFIED: completed zero-finding review covers current ${subject} head ${result.currentSha}`
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
