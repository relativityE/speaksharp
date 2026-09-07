import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  evaluateReviewQualification,
  isSubstantiveImplementationFile,
} from '../../scripts/review-qualification.mjs';
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
    expect(workflow).toContain('gate-3-dast-diagnostic-ineligible-${{ github.sha }}');
    expect(workflow).not.toMatch(/name:\s*gate-3-dast-artifacts\s*$/m);
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
});
