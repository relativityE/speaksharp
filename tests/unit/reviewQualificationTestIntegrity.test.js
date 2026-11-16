/**
 * #1543 PM RETURN `5896325560` — a reviewed TEST-INTEGRITY PR has a scope of its own.
 *
 * #1543 (the Progress/Start visibility deadline) and #1542 (the clean RWT Production fixture) change only test code. With
 * tests excluded from `isSubstantiveImplementationFile`, their clean exact-head Draft→Ready reviews still failed
 * `no_substantive_implementation` (run 36597521604, attempt 2). The new scope must admit exactly such PRs and nothing
 * looser, and it must leave every other qualification requirement in force.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateReviewQualification,
  formatReviewQualification,
  isSubstantiveImplementationFile,
  isTestIntegrityFile,
} from '../../scripts/review-qualification.mjs';

const SHA = 'a41b697a11ee936451d0385e767992913ecd8ef9';
const OTHER = 'e85d38a8bbb9d5c8a4f35aa73843a3abb7b07261';
const receipt = (changedFiles, over = {}) => evaluateReviewQualification({
  currentSha: SHA, reviewedSha: SHA, reviewStatus: 'completed', findingCount: 0, changedFiles,
  generatedAt: new Date().toISOString(), ...over,
});

// The exact changed-file lists of the two PRs this scope exists for.
const PR_1543 = [
  'tests/e2e/helpers/setupE2EManifest.ts',
  'tests/e2e/progressRefusalTimeline.ts',
  'tests/e2e/start-during-progress-settle.e2e.spec.ts',
  'tests/unit/progressRefusalTimeline.test.ts',
];
const PR_1542 = [
  'tests/e2e/rwt-production-fixture-surface.e2e.spec.ts',
  'tests/live/helpers/deployedLiveTest.ts',
  'tests/live/helpers/rwtAcceptance.ts',
  'tests/live/helpers/rwtFocusPointsJourney.ts',
  'tests/live/helpers/rwtJourney.ts',
  'tests/live/helpers/rwtProductionTest.ts',
  'tests/live/rwt-focus-points-partial.live.spec.ts',
  'tests/live/rwt-focus-points-session.live.spec.ts',
  'tests/live/rwt-open-mic-first-session.live.spec.ts',
  'tests/live/rwt-products-navigation.live.spec.ts',
  'tests/unit/rwtSurfaceHalt.test.ts',
];

describe('test-integrity review scope', () => {
  it.each([['#1543', PR_1543], ['#1542', PR_1542]])('%s — a clean exact-head review of a test-only PR qualifies as test_integrity', (_pr, files) => {
    const result = receipt(files);
    expect(result).toMatchObject({ qualified: true, reasons: [], reviewScope: 'test_integrity', substantiveFiles: [] });
    expect(formatReviewQualification(result)).toBe(`REVIEW-QUALIFIED: completed zero-finding review covers current test-integrity head ${SHA}`);
  });

  it('test source anywhere in the tree counts: __tests__ directories and *.test.* / *.spec.* files', () => {
    for (const path of [
      'frontend/src/components/__tests__/Navigation.component.test.tsx',
      'frontend/src/services/__tests__/loginSessionLog.test.ts',
      'scripts/billing-qualification/receipt.test.mjs',
      'tests/scripts/gemini-model-currency-proof.test.ts',
      'tests/e2e/helpers.ts',
    ]) expect({ path, test: isTestIntegrityFile(path) }).toEqual({ path, test: true });
  });

  it('CASUALTY: an empty change set has no scope', () => {
    expect(receipt([]).reasons).toEqual(['no_substantive_implementation']);
  });

  it('CASUALTY: prose, findings, fixtures/data and non-test paths do not qualify as test integrity', () => {
    for (const path of [
      'tests/README.md',
      'tests/notes.txt',
      'docs/findings/final-release-qualification.md',
      'docs/example.test.ts',
      'tests/fixtures/sessions.json',
      'tests/e2e/snapshots/home.png',
      'README.md',
      'random.cfg',
      ' tests/unit/padded.test.ts',
      'tests/unit/padded.test.ts ',
    ]) {
      expect({ path, test: isTestIntegrityFile(path) }).toEqual({ path, test: false });
      expect({ path, reasons: receipt([path]).reasons }).toEqual({ path, reasons: ['no_substantive_implementation'] });
    }
  });

  it('CASUALTY: ONE non-test file among test files removes the scope — every file must be test source', () => {
    for (const extra of ['tests/README.md', 'tests/fixtures/sessions.json', 'random.cfg']) {
      expect({ extra, reasons: receipt([...PR_1543, extra]).reasons }).toEqual({ extra, reasons: ['no_substantive_implementation'] });
    }
    // A canonical product-release document is the one exception, and it never becomes test integrity: it takes the
    // documentation-with-tests scope below.
    expect(receipt([...PR_1543, 'product_release/RELEASE_STATUS.md'])).toMatchObject({ qualified: true, reviewScope: 'canonical_product_release_documentation_with_tests' });
  });

  it('CONTROL: tests beside real implementation remain an implementation review; tests are still never implementation', () => {
    expect(receipt([...PR_1543, 'scripts/review-qualification.mjs'])).toMatchObject({ qualified: true, reviewScope: 'implementation' });
    expect(PR_1543.every((path) => isSubstantiveImplementationFile(path) === false)).toBe(true);
  });

  it('CASUALTY: the scope changes nothing else — findings, a wrong or missing review, and staleness still refuse', () => {
    expect(receipt(PR_1543, { findingCount: 1 }).reasons).toEqual(['open_findings:1']);
    expect(receipt(PR_1543, { reviewedSha: OTHER }).reasons).toEqual(['reviewed_sha_is_not_current_head']);
    expect(receipt(PR_1543, { reviewStatus: undefined }).reasons).toEqual(['review_not_completed:missing']);
    expect(receipt(PR_1543, { generatedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString() }).reasons[0]).toMatch(/^receipt_stale:/);
    expect(receipt(PR_1543, { findingCount: 1 }).qualified).toBe(false);
  });
});

// #1796: a canonical product-release document plus the test that guards it had no scope (`no_substantive_implementation`
// on a clean exact-head review). It is a documentation claim with its own guard, so it gets a documentation scope of its own.
const PR_1796 = ['product_release/RELEASE_STATUS.md', 'tests/config/mvpAcceptanceMap.test.ts'];

describe('canonical documentation with its tests', () => {
  it('#1796 — a canonical document plus its test qualifies on a clean exact-head review', () => {
    const result = receipt(PR_1796);
    expect(result).toMatchObject({ qualified: true, reasons: [], reviewScope: 'canonical_product_release_documentation_with_tests', substantiveFiles: [] });
    expect(formatReviewQualification(result)).toBe(`REVIEW-QUALIFIED: completed zero-finding review covers current canonical product-release documentation and its tests head ${SHA}`);
  });

  it('CONTROL: the existing scopes are unchanged — a document alone, tests alone, and implementation keep theirs', () => {
    expect(receipt(['product_release/RELEASE_STATUS.md']).reviewScope).toBe('canonical_product_release_documentation');
    expect(receipt(['tests/config/mvpAcceptanceMap.test.ts']).reviewScope).toBe('test_integrity');
    expect(receipt([...PR_1796, 'scripts/review-qualification.mjs']).reviewScope).toBe('implementation');
  });

  it('CASUALTY: any file that is neither a canonical document nor test source removes the scope', () => {
    for (const extra of [
      'product_release/archive/OLD_STATUS.md', // not one of the canonical documents
      'product_release/evidence/notes.md',
      'docs/findings/x.md',
      'tests/fixtures/sessions.json',
      'tools/aht-rationalization/mapping.json',
      'random.cfg',
      'README.md',
    ]) {
      expect({ extra, reasons: receipt([...PR_1796, extra]).reasons }).toEqual({ extra, reasons: ['no_substantive_implementation'] });
    }
    // A non-canonical Markdown file beside a test has no documentation to claim.
    expect(receipt(['product_release/archive/OLD_STATUS.md', 'tests/config/mvpAcceptanceMap.test.ts']).reasons).toEqual(['no_substantive_implementation']);
  });

  it('CASUALTY: the scope relaxes nothing else — findings, a wrong or missing review, and staleness still refuse', () => {
    expect(receipt(PR_1796, { findingCount: 1 }).reasons).toEqual(['open_findings:1']);
    expect(receipt(PR_1796, { reviewedSha: OTHER }).reasons).toEqual(['reviewed_sha_is_not_current_head']);
    expect(receipt(PR_1796, { reviewStatus: undefined }).reasons).toEqual(['review_not_completed:missing']);
    expect(receipt(PR_1796, { generatedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString() }).reasons[0]).toMatch(/^receipt_stale:/);
  });
});
