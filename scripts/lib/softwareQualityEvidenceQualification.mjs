import { COVERAGE_THRESHOLDS } from '../coverage-thresholds.mjs';

export const COVERAGE_RELEASE_FLOOR = Math.min(...Object.values(COVERAGE_THRESHOLDS.global));

/**
 * QUALITY.md's release-priority paths. Each receipt is a behavioral/casualty test exercised by the
 * full Vitest lane; aggregate coverage alone is never substituted for these product-risk contracts.
 */
export const MEANINGFUL_COVERAGE_MANIFEST = Object.freeze([
  { id: 'stt', evidenceType: 'behavior-casualty', testFile: 'frontend/src/services/transcription/__tests__/TranscriptionService.race.test.ts' },
  { id: 'session-lifecycle', evidenceType: 'behavior-casualty', testFile: 'frontend/src/hooks/__tests__/useSessionLifecycle.test.tsx' },
  { id: 'quota-billing', evidenceType: 'behavior-casualty', testFile: 'frontend/src/services/__tests__/billingEntitlementIndependence.test.ts' },
  { id: 'pdf', evidenceType: 'behavior-casualty', testFile: 'frontend/src/lib/__tests__/pdfGenerator.test.ts' },
  { id: 'analytics-truth', evidenceType: 'behavior-casualty', testFile: 'frontend/src/lib/__tests__/analyticsEvidenceValidity.test.ts' },
  { id: 'failure-handling', evidenceType: 'behavior-casualty', testFile: 'frontend/src/components/__tests__/ErrorBoundary.staleChunk.test.tsx' },
]);

const positiveFinite = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const nonNegativeInteger = (value) => Number.isInteger(Number(value)) && Number(value) >= 0;
const matchNumber = (content, regex) => {
  const match = content.match(regex);
  return match ? Number(match[1]) : null;
};

export function parseCiAuditOverride(content) {
  const unitPassed = matchNumber(content, /Unit Tests[\s\S]*?- \*\*Passed\*\*:\s*(\d+)\s*\/\s*\d+/);
  const unitTotal = matchNumber(content, /Unit Tests[\s\S]*?- \*\*Passed\*\*:\s*\d+\s*\/\s*(\d+)/);
  const unitFailed = matchNumber(content, /Unit Tests[\s\S]*?- \*\*Failed\*\*:\s*(\d+)/);
  const e2ePassed = matchNumber(content, /E2E Tests[\s\S]*?- \*\*Passed\*\*:\s*(\d+)\s*\/\s*\d+/);
  const e2eTotal = matchNumber(content, /E2E Tests[\s\S]*?- \*\*Passed\*\*:\s*\d+\s*\/\s*(\d+)/);
  const e2eFailed = matchNumber(content, /E2E Tests[\s\S]*?- \*\*Failed\*\*:\s*(\d+)/);

  if (
    unitPassed === null || unitTotal === null || unitFailed === null
    || e2ePassed === null || e2eTotal === null || e2eFailed === null
  ) return null;

  return {
    unit_tests: {
      passed: unitPassed,
      failed: unitFailed,
      skipped: Math.max(0, unitTotal - unitPassed - unitFailed),
      total: unitTotal,
    },
    e2e_tests: {
      passed: e2ePassed,
      failed: e2eFailed,
      skipped: Math.max(0, e2eTotal - e2ePassed - e2eFailed),
      total: e2eTotal,
    },
    lighthouse: {
      performance: matchNumber(content, /- \*\*Performance\*\*:\s*(\d+)/),
      accessibility: matchNumber(content, /- \*\*Accessibility\*\*:\s*(\d+)/),
      best_practices: matchNumber(content, /- \*\*Best Practices\*\*:\s*(\d+)/),
      seo: matchNumber(content, /- \*\*SEO\*\*:\s*(\d+)/),
    },
  };
}

function validateTestOutcome(name, outcome, reasons) {
  if (!positiveFinite(outcome?.total) || !positiveFinite(outcome?.passed)) {
    reasons.push(`${name}_metrics_missing_or_empty`);
    return;
  }

  if (!nonNegativeInteger(outcome?.failed)) {
    reasons.push(`${name}_failed_count_missing_or_invalid`);
  } else if (Number(outcome.failed) > 0) {
    reasons.push(`${name}_tests_failed:${Number(outcome.failed)}`);
  }

  if (!nonNegativeInteger(outcome?.skipped)) {
    reasons.push(`${name}_skipped_count_missing_or_invalid`);
  }

  if (
    nonNegativeInteger(outcome?.failed)
    && nonNegativeInteger(outcome?.skipped)
    && Number(outcome.passed) + Number(outcome.failed) + Number(outcome.skipped) !== Number(outcome.total)
  ) {
    reasons.push(`${name}_test_counts_inconsistent`);
  }
}

/**
 * Machine evidence must distinguish "measured zero" from "measurement never arrived". A successful
 * full CI lane necessarily runs unit tests, consumes time, and builds a non-empty entry chunk.
 */
export function validateSoftwareQualityEvidence(
  evidence,
  { meaningfulCoverageManifest = MEANINGFUL_COVERAGE_MANIFEST } = {},
) {
  const reasons = [];
  const unit = evidence?.tests?.unit;
  const e2e = evidence?.tests?.e2e;
  validateTestOutcome('unit', unit, reasons);
  validateTestOutcome('e2e', e2e, reasons);
  if (!positiveFinite(evidence?.runtime?.totalRuntimeSeconds)) {
    reasons.push('runtime_metric_missing_or_zero');
  }

  const chunk = evidence?.performance?.initialChunkSize;
  if (typeof chunk !== 'string' || !/^\d+(?:\.\d+)?[KMG]$/i.test(chunk) || /^0(?:\.0+)?[KMG]$/i.test(chunk)) {
    reasons.push('initial_chunk_metric_missing_or_unknown');
  }

  if (evidence?.targets?.coverage?.releaseFloor !== COVERAGE_RELEASE_FLOOR) {
    reasons.push('coverage_release_floor_not_authoritative');
  }
  for (const [metric, floor] of Object.entries(COVERAGE_THRESHOLDS.global)) {
    const observed = Number(evidence?.coverage?.[metric]);
    if (!Number.isFinite(observed)) reasons.push(`coverage_metric_missing:${metric}`);
    else if (observed < floor) reasons.push(`coverage_below_release_floor:${metric}`);
  }

  if (!Array.isArray(meaningfulCoverageManifest) || meaningfulCoverageManifest.length === 0) {
    reasons.push('meaningful_coverage_manifest_missing');
  } else {
    const executed = new Set(Array.isArray(unit?.testFiles) ? unit.testFiles : []);
    if (executed.size === 0) reasons.push('meaningful_coverage_execution_receipt_missing');
    for (const requirement of meaningfulCoverageManifest) {
      if (requirement.evidenceType !== 'behavior-casualty') {
        reasons.push(`meaningful_coverage_not_behavioral:${requirement.id}`);
      }
      if (!executed.has(requirement.testFile)) {
        reasons.push(`meaningful_coverage_path_missing:${requirement.id}`);
      }
    }
  }

  return {
    valid: reasons.length === 0,
    reasons,
    meaningfulCoverage: {
      manifestVersion: 1,
      requiredPaths: Array.isArray(meaningfulCoverageManifest)
        ? meaningfulCoverageManifest.map(({ id, evidenceType, testFile }) => ({ id, evidenceType, testFile }))
        : [],
    },
  };
}

export function assertSoftwareQualityEvidence(evidence) {
  const result = validateSoftwareQualityEvidence(evidence);
  if (!result.valid) {
    throw new Error(`Software quality evidence is incomplete: ${result.reasons.join(', ')}`);
  }
  return result;
}
