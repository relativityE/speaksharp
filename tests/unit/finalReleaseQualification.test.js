import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  evaluateReviewQualification,
  isSubstantiveImplementationFile,
} from '../../scripts/review-qualification.mjs';
import { buildReviewReceipt } from '../../scripts/collect-review-qualification.mjs';
import {
  CANONICAL_PRODUCTION_ORIGIN,
  classifyDiagnosticEvidence,
  evaluateProductionEvidenceTarget,
  extractDeployedRelease,
  qualifyEvidenceTarget,
} from '../../scripts/lib/releaseEvidenceEligibility.mjs';
import {
  COVERAGE_RELEASE_FLOOR,
  MEANINGFUL_COVERAGE_MANIFEST,
  validateSoftwareQualityEvidence,
} from '../../scripts/lib/softwareQualityEvidenceQualification.mjs';

const SHA = 'a97b740b39f678e8b5e8f769725e272d59428c64';
const OTHER_SHA = 'b97b740b39f678e8b5e8f769725e272d59428c64';

describe('Q-08 automated review qualification', () => {
  const complete = (over = {}) => ({
    currentSha: SHA,
    reviewedSha: SHA,
    reviewStatus: 'completed',
    findingCount: 0,
    changedFiles: ['scripts/review-qualification.mjs', 'tests/unit/finalReleaseQualification.test.js'],
    ...over,
  });

  it('qualifies a completed zero-finding review of the exact substantive head', () => {
    expect(evaluateReviewQualification(complete())).toMatchObject({ qualified: true, reasons: [] });
  });

  it('CASUALTY: a zero-finding review of a scaffold is not green', () => {
    const result = evaluateReviewQualification(complete({
      changedFiles: ['docs/findings/final-release-qualification.md'],
    }));
    expect(result.qualified).toBe(false);
    expect(result.reasons).toContain('no_substantive_implementation');
  });

  it('CASUALTY: zero findings without an explicitly completed review is not green', () => {
    for (const reviewStatus of [undefined, 'pending', 'failed', 'in_progress']) {
      const result = evaluateReviewQualification(complete({ reviewStatus }));
      expect(result.qualified).toBe(false);
      expect(result.reasons.some((reason) => reason.startsWith('review_not_completed:'))).toBe(true);
    }
  });

  it('CASUALTY: a completed scaffold review cannot survive an implementation commit', () => {
    const result = evaluateReviewQualification(complete({ reviewedSha: OTHER_SHA }));
    expect(result.qualified).toBe(false);
    expect(result.reasons).toContain('reviewed_sha_is_not_current_head');
  });

  it('fails closed on missing or malformed receipt fields and on open findings', () => {
    expect(evaluateReviewQualification({}).qualified).toBe(false);
    expect(evaluateReviewQualification(complete({ findingCount: 1 })).reasons).toContain('open_findings:1');
    expect(evaluateReviewQualification(complete({ findingCount: '0' })).reasons)
      .toContain('finding_count_missing_or_invalid');
  });

  it('implementation means executable production/control code, not tests or prose alone', () => {
    expect(isSubstantiveImplementationFile('.github/workflows/rc-gates.yml')).toBe(true);
    expect(isSubstantiveImplementationFile('scripts/review-qualification.mjs')).toBe(true);
    expect(isSubstantiveImplementationFile('tests/unit/finalReleaseQualification.test.js')).toBe(false);
    expect(isSubstantiveImplementationFile('docs/findings/final-release-qualification.md')).toBe(false);
  });

  it('qualifies only live GitHub state with a current Codex review and no current unresolved release finding', () => {
    const github = {
      number: 1430,
      headRefOid: SHA,
      files: { nodes: [{ path: 'scripts/review-qualification.mjs' }], pageInfo: { hasNextPage: false } },
      reviews: {
        nodes: [{ author: { login: 'chatgpt-codex-connector' }, commit: { oid: SHA }, submittedAt: '2026-09-08T10:00:00Z' }],
        pageInfo: { hasPreviousPage: false },
      },
      reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
    };
    expect(buildReviewReceipt({ pullRequest: github, expectedHeadSha: SHA })).toMatchObject({ qualified: true, findingCount: 0 });

    const fabricated = { ...github, headRefOid: OTHER_SHA };
    expect(buildReviewReceipt({ pullRequest: fabricated, expectedHeadSha: SHA }).reasons)
      .toContain('github_pr_head_is_not_workflow_head');
  });

  it('CASUALTY: an unresolved current-head Codex P0/P1/P2 fails qualification', () => {
    const github = {
      number: 1430,
      headRefOid: SHA,
      files: { nodes: [{ path: 'scripts/review-qualification.mjs' }], pageInfo: { hasNextPage: false } },
      reviews: {
        nodes: [{ author: { login: 'chatgpt-codex-connector[bot]' }, commit: { oid: SHA }, submittedAt: '2026-09-08T10:00:00Z' }],
        pageInfo: { hasPreviousPage: false },
      },
      reviewThreads: {
        nodes: [{
          isResolved: false,
          comments: { nodes: [{ author: { login: 'chatgpt-codex-connector' }, commit: { oid: SHA }, originalCommit: { oid: SHA }, pullRequestReview: { commit: { oid: SHA } }, body: 'P1 Badge: current defect' }], pageInfo: { hasPreviousPage: false } },
        }],
        pageInfo: { hasNextPage: false },
      },
    };
    expect(buildReviewReceipt({ pullRequest: github, expectedHeadSha: SHA })).toMatchObject({ qualified: false, findingCount: 1 });
  });

  it('does not relabel an old unresolved thread as current when GitHub rebases its displayed commit', () => {
    const github = {
      number: 1430,
      headRefOid: SHA,
      files: { nodes: [{ path: 'scripts/review-qualification.mjs' }], pageInfo: { hasNextPage: false } },
      reviews: {
        nodes: [{ author: { login: 'chatgpt-codex-connector' }, commit: { oid: SHA }, submittedAt: '2026-09-08T10:00:00Z' }],
        pageInfo: { hasPreviousPage: false },
      },
      reviewThreads: {
        nodes: [{
          isResolved: false,
          comments: { nodes: [{
            author: { login: 'chatgpt-codex-connector' },
            commit: { oid: SHA },
            originalCommit: { oid: OTHER_SHA },
            pullRequestReview: { commit: { oid: OTHER_SHA } },
            body: 'P1 Badge: fixed on a later head',
          }], pageInfo: { hasPreviousPage: false } },
        }],
        pageInfo: { hasNextPage: false },
      },
    };
    expect(buildReviewReceipt({ pullRequest: github, expectedHeadSha: SHA })).toMatchObject({ qualified: true, findingCount: 0 });
  });

  it('fails closed when GitHub pagination could hide files, reviews, or findings', () => {
    const base = {
      number: 1430,
      headRefOid: SHA,
      files: { nodes: [{ path: 'scripts/review-qualification.mjs' }], pageInfo: { hasNextPage: false } },
      reviews: {
        nodes: [{ author: { login: 'chatgpt-codex-connector' }, commit: { oid: SHA }, submittedAt: '2026-09-08T10:00:00Z' }],
        pageInfo: { hasPreviousPage: false },
      },
      reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
    };
    expect(buildReviewReceipt({ pullRequest: { ...base, files: { ...base.files, pageInfo: { hasNextPage: true } } }, expectedHeadSha: SHA }).qualified).toBe(false);
    expect(buildReviewReceipt({ pullRequest: { ...base, reviews: { ...base.reviews, pageInfo: { hasPreviousPage: true } } }, expectedHeadSha: SHA }).qualified).toBe(false);
    expect(buildReviewReceipt({ pullRequest: { ...base, reviewThreads: { ...base.reviewThreads, pageInfo: { hasNextPage: true } } }, expectedHeadSha: SHA }).qualified).toBe(false);
    expect(buildReviewReceipt({ pullRequest: {
      ...base,
      reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: [], pageInfo: { hasPreviousPage: true } } }], pageInfo: { hasNextPage: false } },
    }, expectedHeadSha: SHA }).reasons).toContain('review_thread_comments_incomplete');
  });

  it('does not accept a lookalike reviewer login or a dismissed exact-head review', () => {
    const base = {
      number: 1430,
      headRefOid: SHA,
      files: { nodes: [{ path: 'scripts/review-qualification.mjs' }], pageInfo: { hasNextPage: false } },
      reviews: { nodes: [], pageInfo: { hasPreviousPage: false } },
      reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
    };
    for (const review of [
      { author: { login: 'fake-chatgpt-codex-connector' }, state: 'COMMENTED', commit: { oid: SHA }, submittedAt: '2026-09-08T10:00:00Z' },
      { author: { login: 'chatgpt-codex-connector' }, state: 'DISMISSED', commit: { oid: SHA }, submittedAt: '2026-09-08T10:00:00Z' },
    ]) {
      expect(buildReviewReceipt({ pullRequest: { ...base, reviews: { ...base.reviews, nodes: [review] } }, expectedHeadSha: SHA }))
        .toMatchObject({ qualified: false, reviewStatus: 'missing' });
    }
  });

  it('CASUALTY: a change-requesting exact-head review body cannot qualify', () => {
    const github = {
      number: 1430,
      headRefOid: SHA,
      files: { nodes: [{ path: 'scripts/review-qualification.mjs' }], pageInfo: { hasNextPage: false } },
      reviews: {
        nodes: [{
          author: { login: 'chatgpt-codex-connector' }, state: 'CHANGES_REQUESTED',
          commit: { oid: SHA }, submittedAt: '2026-09-08T10:00:00Z', body: 'P1: release blocker',
        }],
        pageInfo: { hasPreviousPage: false },
      },
      reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
    };
    expect(buildReviewReceipt({ pullRequest: github, expectedHeadSha: SHA })).toMatchObject({
      qualified: false,
      reviewStatus: 'changes_requested',
    });
  });

  it('CASUALTY: an exact-head P0/P1/P2 in the overall review body cannot qualify', () => {
    const github = {
      number: 1430,
      headRefOid: SHA,
      files: { nodes: [{ path: 'scripts/review-qualification.mjs' }], pageInfo: { hasNextPage: false } },
      reviews: {
        nodes: [{
          author: { login: 'chatgpt-codex-connector' }, state: 'COMMENTED',
          commit: { oid: SHA }, submittedAt: '2026-09-08T10:00:00Z', body: 'P1 Badge: release blocker',
        }],
        pageInfo: { hasPreviousPage: false },
      },
      reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
    };
    expect(buildReviewReceipt({ pullRequest: github, expectedHeadSha: SHA })).toMatchObject({
      qualified: false,
      findingCount: 1,
    });
  });

  it('the full CI lane invokes authenticated GitHub review qualification after evidence', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(workflow).toContain('name: exact-head-review-qualification');
    expect(workflow).toContain('node scripts/collect-review-qualification.mjs');
    expect(workflow).toContain('GITHUB_TOKEN: ${{ github.token }}');
    expect(workflow).toContain('needs: [scope, full-evidence]');
    expect(workflow).toContain('full-evidence, review-qualification]');
    expect(workflow).toContain('[...REQUIRED_JOBS, "review-qualification"]');
    expect(workflow).toMatch(/pull_request_review:[\s\S]{0,120}types:\s*\[submitted, edited, dismissed\]/);
    expect(workflow).toMatch(/pull_request_review_comment:[\s\S]{0,120}types:\s*\[created, edited, deleted\]/);
    expect(workflow).toContain("github.event_name == 'pull_request_review'");
    expect(workflow).toContain("github.event_name == 'pull_request_review_comment'");
    expect(workflow).toContain('postMergePush ? formatPostMergeVerification(decision) : formatQualification(decision)');
  });
});

describe('Q-10 canonical Production evidence eligibility', () => {
  it('qualifies only the exact canonical root with exact deployed release equality', () => {
    expect(evaluateProductionEvidenceTarget({
      baseUrl: `${CANONICAL_PRODUCTION_ORIGIN}/`,
      expectedReleaseSha: SHA,
      observedReleaseSha: SHA,
    })).toMatchObject({
      releaseProofEligible: true,
      evidenceScope: 'canonical-production',
      origin: CANONICAL_PRODUCTION_ORIGIN,
      reasons: [],
    });
  });

  it('CASUALTY: Preview and lookalike URLs cannot become canonical proof', () => {
    for (const baseUrl of [
      'https://speaksharp-git-fix.vercel.app',
      'https://speaksharp-public.vercel.app.evil.example',
      'http://speaksharp-public.vercel.app',
      'https://speaksharp-public.vercel.app/a-preview-path',
    ]) {
      const result = evaluateProductionEvidenceTarget({
        baseUrl,
        expectedReleaseSha: SHA,
        observedReleaseSha: SHA,
      });
      expect(result.releaseProofEligible).toBe(false);
      expect(result.reasons).toContain('not_canonical_production_url');
    }
  });

  it('rejects Preview before making a network request', async () => {
    const fetchImpl = vi.fn();
    const result = await qualifyEvidenceTarget({
      baseUrl: 'https://speaksharp-git-fix.vercel.app',
      expectedReleaseSha: SHA,
      evidenceScope: 'canonical-production',
      fetchImpl,
    });
    expect(result.releaseProofEligible).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('CASUALTY: a canonical host serving the wrong or unknown release is not proof', () => {
    expect(evaluateProductionEvidenceTarget({
      baseUrl: CANONICAL_PRODUCTION_ORIGIN,
      expectedReleaseSha: SHA,
      observedReleaseSha: OTHER_SHA,
    }).reasons).toContain('deployed_release_sha_mismatch');
    expect(evaluateProductionEvidenceTarget({
      baseUrl: CANONICAL_PRODUCTION_ORIGIN,
      expectedReleaseSha: SHA,
      observedReleaseSha: null,
    }).reasons).toContain('deployed_release_sha_missing_or_invalid');
  });

  it('reads the deployed release marker from served HTML', () => {
    expect(extractDeployedRelease(`<script>window.__APP_RELEASE__ = "${SHA}";</script>`)).toBe(SHA);
    expect(extractDeployedRelease('<script>window.__APP_RELEASE__ = "unknown";</script>')).toBeNull();
  });

  it('CASUALTY: a failed deployed identity read fails closed', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network unavailable'));
    const result = await qualifyEvidenceTarget({
      baseUrl: CANONICAL_PRODUCTION_ORIGIN,
      expectedReleaseSha: SHA,
      evidenceScope: 'canonical-production',
      fetchImpl,
    });
    expect(result.releaseProofEligible).toBe(false);
    expect(result.reasons).toContain('deployed_release_read_failed');
  });

  it('diagnostic/Preview evidence is explicitly and machine-readably ineligible', () => {
    expect(classifyDiagnosticEvidence({ baseUrl: 'https://example-preview.vercel.app' })).toMatchObject({
      evidenceScope: 'diagnostic',
      releaseProofEligible: false,
      reasons: ['preview_or_noncanonical_run_ineligible_for_release_proof'],
    });
  });

  it('the workflow uses distinct artifact identities and carries the eligibility receipt', () => {
    const workflow = readFileSync('.github/workflows/rc-gates.yml', 'utf8');
    expect(workflow).toContain('Classify Gate 3 evidence target');
    expect(workflow).toContain('gate-3-evidence-eligibility.json');
    expect(workflow).toContain('gate-3-dast-production-${{ github.sha }}');
    expect(workflow).toContain("if: ${{ success() && github.event.inputs.diagnostic_dast_spec == '' }}");
    expect(workflow).toContain('gate-3-dast-canonical-ineligible-${{ github.sha }}');
    expect(workflow).toContain('gate-3-dast-diagnostic-ineligible-${{ github.sha }}');
    expect(workflow).not.toMatch(/name:\s*gate-3-dast-artifacts\s*$/m);
  });

  it('CASUALTY: a diagnostic run ends the Gate 3 job red even when its selected spec passes', () => {
    const workflow = readFileSync('.github/workflows/rc-gates.yml', 'utf8');
    expect(workflow).toContain('Reject diagnostic run as release qualification');
    expect(workflow).toMatch(/Reject diagnostic run as release qualification[\s\S]*diagnostic_dast_spec != ''[\s\S]*exit 1/);
  });
});

describe('Q-08 software-quality evidence completeness', () => {
  const complete = (over = {}) => ({
    tests: { unit: {
      passed: 100,
      failed: 0,
      skipped: 0,
      total: 100,
      testFiles: MEANINGFUL_COVERAGE_MANIFEST.map(({ testFile }) => testFile),
    } },
    runtime: { totalRuntimeSeconds: 120 },
    performance: { initialChunkSize: '412K' },
    targets: { coverage: { releaseFloor: COVERAGE_RELEASE_FLOOR } },
    coverage: { statements: 80, branches: 80, functions: 80, lines: 80 },
    ...over,
  });

  it('accepts complete metrics using the shared coverage authority', () => {
    expect(COVERAGE_RELEASE_FLOOR).toBe(75);
    expect(validateSoftwareQualityEvidence(complete())).toMatchObject({ valid: true, reasons: [] });
  });

  it('CASUALTY: unit 0/0 is missing evidence, not a plausible green count', () => {
    const result = validateSoftwareQualityEvidence(complete({
      tests: { unit: {
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        testFiles: MEANINGFUL_COVERAGE_MANIFEST.map(({ testFile }) => testFile),
      } },
    }));
    expect(result.reasons).toContain('unit_metrics_missing_or_empty');
  });

  it('CASUALTY: zero runtime is missing evidence, not a valid measurement', () => {
    const result = validateSoftwareQualityEvidence(complete({ runtime: { totalRuntimeSeconds: 0 } }));
    expect(result.reasons).toContain('runtime_metric_missing_or_zero');
  });

  it('CASUALTY: an unknown initial chunk cannot publish qualified evidence', () => {
    for (const initialChunkSize of [null, undefined, 'unknown', 'N/A', '0K']) {
      const result = validateSoftwareQualityEvidence(complete({ performance: { initialChunkSize } }));
      expect(result.reasons).toContain('initial_chunk_metric_missing_or_unknown');
    }
  });

  it('CASUALTY: the historical 60% floor cannot override the shared 75% authority', () => {
    const result = validateSoftwareQualityEvidence(complete({
      targets: { coverage: { releaseFloor: 60 } },
    }));
    expect(result.reasons).toContain('coverage_release_floor_not_authoritative');
  });

  it('CASUALTY: aggregate 75%+ without meaningful-path execution receipts cannot qualify', () => {
    const result = validateSoftwareQualityEvidence(complete({
      coverage: { statements: 90, branches: 90, functions: 90, lines: 90 },
      tests: { unit: { passed: 100, failed: 0, skipped: 0, total: 100, testFiles: [] } },
    }));
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('meaningful_coverage_execution_receipt_missing');
    for (const { id } of MEANINGFUL_COVERAGE_MANIFEST) {
      expect(result.reasons).toContain(`meaningful_coverage_path_missing:${id}`);
    }
  });

  it('enforces the authoritative floor against every aggregate coverage metric', () => {
    const result = validateSoftwareQualityEvidence(complete({
      coverage: { statements: 75, branches: 74.99, functions: 75, lines: 75 },
    }));
    expect(result.reasons).toContain('coverage_below_release_floor:branches');
  });

  it('the meaningful manifest admits behavior/casualty evidence only', () => {
    expect(MEANINGFUL_COVERAGE_MANIFEST.map(({ id }) => id)).toEqual([
      'stt', 'session-lifecycle', 'quota-billing', 'pdf', 'analytics-truth', 'failure-handling',
    ]);
    expect(MEANINGFUL_COVERAGE_MANIFEST.every(({ evidenceType }) => evidenceType === 'behavior-casualty'))
      .toBe(true);
  });

  it('fails closed when the meaningful-coverage manifest is absent', () => {
    const result = validateSoftwareQualityEvidence(complete(), { meaningfulCoverageManifest: [] });
    expect(result.reasons).toContain('meaningful_coverage_manifest_missing');
  });

  it('the workflow aggregates before generating evidence and preserves canonical unit counts', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(workflow.indexOf('- name: Aggregate CI Metrics')).toBeLessThan(
      workflow.indexOf('- name: Generate qualified software quality evidence'),
    );
    expect(workflow).toContain('test-results/unit/results.json');
  });

  it('publishes qualified evidence only after final assertions and never under always()', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    const assertAt = workflow.indexOf('- name: Assert Required Evidence Is Present');
    const verifyAt = workflow.indexOf('- name: Verify Canonical Artifacts');
    const generateAt = workflow.indexOf('- name: Generate qualified software quality evidence');
    const uploadAt = workflow.indexOf('- name: Upload CI Metrics');
    expect(assertAt).toBeGreaterThan(0);
    expect(assertAt).toBeLessThan(verifyAt);
    expect(verifyAt).toBeLessThan(generateAt);
    expect(generateAt).toBeLessThan(uploadAt);
    expect(workflow.slice(uploadAt, uploadAt + 120)).not.toContain('if: always()');
  });
});
