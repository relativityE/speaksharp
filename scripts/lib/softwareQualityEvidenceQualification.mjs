import { COVERAGE_THRESHOLDS } from '../coverage-thresholds.mjs';

export const COVERAGE_RELEASE_FLOOR = Math.min(...Object.values(COVERAGE_THRESHOLDS.global));

// Bounded pilot: other meaningful-coverage paths retain their existing gates, but make no
// mutation-efficacy claim until their actual seams and semantic casualties are registered.
export const TEST_EFFICACY_CONTRACTS = Object.freeze([
  {
    id: 'analytics-truth',
    testFile: 'frontend/src/lib/__tests__/analyticsEvidenceValidity.test.ts',
    sourceFile: 'frontend/src/utils/metricValidity.ts',
    control: [
      { anchor: "if (value.trim() === '') return false;", replacement: "if ('' === value.trim()) return false;" },
      { anchor: 'return Number.isFinite(n);', replacement: 'return (Number.isFinite(n));' },
    ],
    mutants: [
      {
        id: 'blank-is-zero',
        anchor: "if (value.trim() === '') return false;",
        replacement: "if (value.trim() === '') return true;",
        assertion: '#1045 metric validity predicate rejects a blank string — Number("") is 0, which would be a fabricated zero',
        assertionAnchor: "expect(isValidMetric('')).toBe(false);",
      },
      {
        id: 'nonfinite-is-valid',
        anchor: 'return Number.isFinite(n);',
        replacement: 'return true;',
        assertion: '#1045 metric validity predicate rejects only the values we cannot stand behind',
        assertionAnchor: 'expect(isValidMetric(NaN)).toBe(false);',
      },
    ],
  },
]);

export function qualifyEfficacyPhase(report, execution, { assertion, baselineNames, envelope, binding, assertionLocation } = {}) {
  if (execution.error || execution.signal || execution.status !== (assertion ? 1 : 0)) {
    throw new Error('Efficacy process failed or timed out');
  }
  if (/Unhandled (?:Error|Rejection)|uncaughtException|Error during test collection/i.test(
    `${execution.stdout || ''}\n${execution.stderr || ''}`,
  )) throw new Error('Efficacy unhandled runtime/setup error');
  // JSON 3.2.4 has no numRuntimeErrorTestSuites and discards hook/unhandled errors.
  // It cannot independently qualify a RED; require the companion's raw lifecycle evidence.
  if (!binding || !binding.runId || !binding.phaseId || !binding.inputSha256
    || !binding.command?.length || binding.runtime?.adapter !== 'vitest-3.2.4-raw-v1'
    || envelope?.schemaVersion !== 2 || JSON.stringify(envelope.binding) !== JSON.stringify(binding)
    || JSON.stringify(envelope.observed) !== JSON.stringify({ command: binding.command, cwd: binding.cwd, runtime: binding.runtime })
    || envelope.collectionCalls !== 1 || envelope.finishedCalls !== 1 || envelope.endCalls !== 1
    || envelope.timedOut !== false || envelope.ended?.reason !== (assertion ? 'failed' : 'passed')
    || !Array.isArray(envelope.ended?.errors) || envelope.ended.errors.length
    || !Array.isArray(envelope.finished?.errors) || envelope.finished.errors.length
    || envelope.collected?.length !== 1 || envelope.finished?.files?.length !== 1
    || envelope.collected[0].file !== binding.testFile || envelope.finished.files[0].file !== binding.testFile) {
    throw new Error('Missing, stale, interrupted or inconsistent raw phase evidence');
  }
  const tasks = envelope.finished.files[0].tasks;
  if (!Array.isArray(tasks) || !tasks.length || new Set(tasks.map(task => task.id)).size !== tasks.length
    || tasks.some(task => !task.id || !['test', 'suite'].includes(task.type) || task.mode !== 'run'
      || task.fails || task.retry || task.repeats || !['pass', 'fail'].includes(task.result?.state)
      || task.result.pending || task.result.retryCount || task.result.repeatCount
      || !task.result.hooks || Object.values(task.result.hooks).some(state => state !== 'pass')
      || !Array.isArray(task.result.errors)
      || (task.type === 'suite' && task.result.errors.length)
      || (task.result.state === 'pass' && task.result.errors.length))) {
    throw new Error('Raw task setup/hook/suite failure or incomplete execution');
  }
  const rawTests = tasks.filter(task => task.type === 'test');
  const suites = tasks.filter(task => task.type === 'suite');
  const roots = tasks.filter(task => task.parentId === null);
  if (roots.length !== 1 || roots[0].type !== 'suite') throw new Error('Raw suite hierarchy missing');
  const descendants = suite => rawTests.filter(test => {
    let node = test; const visited = new Set();
    while (node.parentId !== null) {
      if (visited.has(node.id)) throw new Error('Raw suite hierarchy cycle');
      visited.add(node.id);
      node = tasks.find(item => item.id === node.parentId);
      if (!node || node.type !== 'suite') throw new Error('Raw suite hierarchy invalid');
      if (node.id === suite.id) return true;
    }
    return false;
  });
  for (const suite of suites) {
    const children = descendants(suite);
    if (!children.length || suite.result.state !== (children.some(test => test.result.state === 'fail') ? 'fail' : 'pass')) {
      throw new Error('Raw suite status contradicts descendant tests');
    }
  }
  const collection = rawTests.map(({ id, name, mode }) => ({ id, name, mode }));
  if (!rawTests.length || JSON.stringify(collection) !== JSON.stringify(envelope.collected[0].tests)
    || rawTests.some(task => task.result.state === 'fail'
      && (!task.result.errors.length || task.result.errors.some(error => error.name !== 'AssertionError'
        || !error.stack?.includes(`${binding.testFile}:`))))
    || (!rawTests.some(task => task.result.state === 'fail') && tasks.some(task => task.result.state === 'fail'))) {
    throw new Error('Raw collection or semantic failure mismatch');
  }
  if (assertion) {
    const casualty = rawTests.find(task => task.name === assertion);
    // A registered expectation location distinguishes the body assertion from a hook/cleanup
    // AssertionError attached to the same test. The anchor is resolved against the copied test.
    if (casualty?.result.state !== 'fail' || !assertionLocation
      || !casualty.result.errors.every(error => error.stack.includes(`${binding.testFile}:${assertionLocation}:`))) {
      throw new Error('Designated assertion body did not fail');
    }
  }
  if (!report || report.testResults?.length !== 1) {
    throw new Error('Efficacy collection/setup failed');
  }
  const tests = report.testResults[0].assertionResults;
  if (!Array.isArray(tests) || !tests.length
    || tests.some(test => !['passed', 'failed'].includes(test.status))) {
    throw new Error('Efficacy tests missing or skipped');
  }
  const names = tests.map(test => test.fullName).sort();
  if (rawTests.length !== tests.length || rawTests.some(task => !tests.some(test =>
    test.fullName === task.name && test.status === (task.result.state === 'pass' ? 'passed' : 'failed')))) {
    throw new Error('JSON/raw evidence mismatch');
  }
  if (new Set(names).size !== names.length || names.some(name => typeof name !== 'string')
    || (baselineNames && JSON.stringify(names) !== JSON.stringify(baselineNames))) {
    throw new Error('Efficacy collection changed');
  }
  const failures = tests.filter(test => test.status === 'failed');
  if (report.testResults[0].status !== (failures.length ? 'failed' : 'passed')
    || report.success !== (failures.length === 0)) throw new Error('JSON suite status contradicts phase tests');
  if (report.numTotalTests !== tests.length || report.numFailedTests !== failures.length
    || report.numPassedTests !== tests.length - failures.length
    || report.numPendingTests !== 0 || report.numTodoTests !== 0) {
    throw new Error('Efficacy counts missing or inconsistent');
  }
  if (!assertion) {
    if (failures.length || report.success !== true || report.testResults[0].status !== 'passed') {
      throw new Error('Efficacy baseline failed');
    }
  } else {
    if (report.success !== false || !failures.some(test => test.fullName === assertion)
      || failures.some(test => !test.failureMessages?.length
        || test.failureMessages.some(message => {
          // Runtime frames such as Vitest's runWithTimeout are present on ordinary
          // assertion stacks. Classify the diagnostic heading, not helper names or
          // expected application values mentioned later in the stack/message.
          const heading = message.split(/\r?\n/, 1)[0];
          return !/AssertionError|expected .* to /s.test(heading)
            || /^(?:(?:Error|AssertionError):\s*)?(?:timeout\b|test timed out\b|timed out\b|Cannot find module\b|SyntaxError\b|ReferenceError\b)/i.test(heading);
        }))) {
      throw new Error('Mutant survived or failed without designated semantic assertion');
    }
  }
  return names;
}

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
  // Absence is legacy data; a present malformed value must survive to validation.
  // Bound the search to the E2E summary so a later section cannot supply its count.
  const e2eSection = content.split('E2E Tests')[1]?.split(/\r?\n#{1,6} /)[0] ?? '';
  const flakyFields = [...e2eSection.matchAll(/^[ \t]*-[ \t]+\*\*Flaky\*\*:[ \t]*([^\r\n]*)/gm)];
  const flakyRaw = flakyFields[0]?.[1].trim();
  const e2eFlaky = flakyFields.length > 1 ? 'duplicate Flaky field'
    : flakyRaw === undefined ? null
      : /^\d+$/.test(flakyRaw) && Number.isSafeInteger(Number(flakyRaw)) ? Number(flakyRaw) : flakyRaw;

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
      ...(e2eFlaky !== null ? { flaky: e2eFlaky } : {}),
      skipped: Math.max(0, e2eTotal - e2ePassed - e2eFailed - (typeof e2eFlaky === 'number' ? e2eFlaky : 0)),
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
  // Playwright terminal buckets are disjoint: expected, unexpected, skipped, flaky.
  // A pass on retry is disclosed and refused, never promoted to a clean first-pass result.
  // Older three-bucket producers have no flaky field; preserve their existing contract.
  const flaky = outcome?.flaky === undefined ? 0 : outcome.flaky;
  const validFlaky = typeof flaky === 'number' && Number.isInteger(flaky) && flaky >= 0;
  if (!validFlaky) reasons.push(`${name}_flaky_count_missing_or_invalid`);
  else if (flaky > 0) reasons.push(`${name}_tests_flaky:${flaky}`);

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
    && validFlaky
    && Number(outcome.passed) + Number(outcome.failed) + Number(outcome.skipped) + flaky !== Number(outcome.total)
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
    /**
     * #1430 P1 — A RELEASE PATH MAY NOT BE SIGNED OFF BY A NEIGHBOUR'S PASSING TEST.
     *
     * `testFiles` admits a file as soon as ONE test in it asserted, so a manifest-listed release-path
     * file could hold one passing test and a SKIPPED acceptance casualty, appear here as executed, and
     * satisfy the requirement while the criterion it exists to prove never ran. The zero-skip release
     * floor was declared and then not enforced at the only granularity that matters.
     *
     * Rejected per PATH rather than suite-wide: a skip elsewhere in the unit suite is not a release
     * claim, and failing on it would push people to delete the manifest rather than fix the skip.
     */
    const skippedPaths = new Set(Array.isArray(unit?.skippedTestFiles) ? unit.skippedTestFiles : []);
    if (executed.size === 0) reasons.push('meaningful_coverage_execution_receipt_missing');
    for (const requirement of meaningfulCoverageManifest) {
      if (requirement.evidenceType !== 'behavior-casualty') {
        reasons.push(`meaningful_coverage_not_behavioral:${requirement.id}`);
      }
      if (!executed.has(requirement.testFile)) {
        reasons.push(`meaningful_coverage_path_missing:${requirement.id}`);
      }
      if (skippedPaths.has(requirement.testFile)) {
        reasons.push(`meaningful_coverage_path_skipped:${requirement.id}`);
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
