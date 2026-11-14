import { describe, expect, it } from 'vitest';
import {
  evaluateReviewQualification,
  formatReviewQualification,
  isHumanTestEvidenceDocument,
  isSubstantiveImplementationFile,
} from '../../scripts/review-qualification.mjs';

const SHA = 'a'.repeat(40);
const NOW = Date.parse('2026-11-14T03:00:00Z');
// Exact changed-file list of #1816, previously rejected as no_substantive_implementation.
const FILES = [
  'product_release/evidence/human-test/coaching-usefulness-protocol-2026-11-11.md',
  'product_release/evidence/human-test/coaching-usefulness-tally.template.md',
];
const receipt = (overrides = {}) => evaluateReviewQualification({
  currentSha: SHA, reviewedSha: SHA, reviewStatus: 'completed', findingCount: 0,
  changedFiles: FILES, generatedAt: new Date(NOW).toISOString(), now: NOW, ...overrides,
});

describe('human-test evidence documentation review scope', () => {
  it('admits #1816 only as reviewed documentation, never implementation', () => {
    const result = receipt();
    expect(result).toMatchObject({ qualified: true, reasons: [], substantiveFiles: [],
      reviewScope: 'human_test_evidence_documentation' });
    expect(FILES.every(file => !isSubstantiveImplementationFile(file))).toBe(true);
    expect(formatReviewQualification(result)).toBe(
      `REVIEW-QUALIFIED: completed zero-finding review covers current human-test evidence documentation head ${SHA}`);
  });

  it.each([
    'README.md', 'product_release/evidence/other/protocol.md',
    'product_release/evidence/human-test-extra/protocol.md',
    'product_release/evidence/human-test/run.json',
    'product_release/evidence/human-test/run.mjs',
    'product_release/evidence/human-test/run.md.mjs',
    'product_release/evidence/human-test/../QUALITY.md',
    'product_release/evidence/human-test/./run.md',
    'product_release/evidence/human-test//run.md',
    'product_release/evidence/human-test/run\\other.md',
    'product_release/evidence/human-test/.md',
    'product_release/evidence/human-test/run.md ',
    ' product_release/evidence/human-test/run.md',
    '/product_release/evidence/human-test/run.md',
    'product_release/evidence/human-test/run.md\n',
    null,
  ])('rejects out-of-scope or noncanonical path %s', file => {
    expect(isHumanTestEvidenceDocument(file)).toBe(false);
    expect(receipt({ changedFiles: [...FILES, file] }).qualified).toBe(false);
  });

  it('allows nested evidence docs but not empty or mixed documentation/test scopes', () => {
    expect(isHumanTestEvidenceDocument('product_release/evidence/human-test/run-1/notes.md')).toBe(true);
    for (const changedFiles of [[], [...FILES, 'product_release/QUALITY.md'],
      [...FILES, 'tests/unit/example.test.js']]) {
      expect(receipt({ changedFiles }).reasons).toContain('no_substantive_implementation');
    }
  });

  it.each([
    [{ reviewedSha: undefined }, 'reviewed_sha_missing_or_invalid'],
    [{ reviewedSha: 'b'.repeat(40) }, 'reviewed_sha_is_not_current_head'],
    [{ reviewStatus: undefined }, 'review_not_completed:missing'],
    [{ reviewStatus: 'pending' }, 'review_not_completed:pending'],
    [{ findingCount: 1 }, 'open_findings:1'],
    [{ findingCount: undefined }, 'finding_count_missing_or_invalid'],
    [{ currentSha: undefined }, 'current_sha_missing_or_invalid'],
    [{ generatedAt: undefined }, 'receipt_generated_at_missing_or_invalid'],
    [{ generatedAt: new Date(NOW - 31 * 60 * 1000).toISOString() }, 'receipt_stale:1860s'],
    [{ generatedAt: new Date(NOW + 1000).toISOString() }, 'receipt_generated_in_the_future'],
  ])('preserves every review requirement (case %#): %j', (overrides, reason) => {
    expect(receipt(overrides)).toMatchObject({ qualified: false });
    expect(receipt(overrides).reasons).toContain(reason);
  });

  it('keeps mixed implementation under implementation review, including exact-head enforcement', () => {
    const changedFiles = [...FILES, 'scripts/review-qualification.mjs'];
    expect(receipt({ changedFiles })).toMatchObject({ qualified: true, reviewScope: 'implementation' });
    expect(receipt({ changedFiles, reviewedSha: 'b'.repeat(40) })).toMatchObject({
      qualified: false, reviewScope: 'implementation', reasons: ['reviewed_sha_is_not_current_head'],
    });
  });

  it('does not bypass named pinned-documentation carrier checks', () => {
    expect(receipt({ repository: 'relativityE/speaksharp', pullRequestNumber: 1674 }).reasons)
      .toContain('pinned_documentation_postimages_unverified');
  });
});
