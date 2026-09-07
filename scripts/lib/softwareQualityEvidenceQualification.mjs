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
  if (!positiveFinite(unit?.total) || !positiveFinite(unit?.passed)) {
    reasons.push('unit_metrics_missing_or_empty');
  }
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
