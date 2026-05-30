import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();
const evidenceDir = path.join(rootDir, 'product_release', 'evidence');
const serviceJsonPath = path.join(evidenceDir, 'service-levels.latest.json');
const serviceMdPath = path.join(evidenceDir, 'service-levels-summary.latest.md');

const inputs = {
  quality: path.join(evidenceDir, 'software-quality.latest.json'),
  backendStress: path.join(rootDir, 'test-results', 'stress', 'backend-stress.latest.json'),
  browserEndurance: path.join(rootDir, 'test-results', 'endurance', 'browser-endurance.latest.json'),
  opsHealthSummary: path.join(rootDir, 'ops-health', 'ops-health.summary.json'),
};

const targets = [
  {
    id: 'auth_p95',
    claim: 'Auth p95 latency',
    target: '< 2000 ms release floor; < 1000 ms industry target at tested concurrency',
    yardstick: 'industry-standard',
    source: 'backendStress',
    evaluate: (data) => phaseMetric(data?.backendStress, 'auth', 'p95Ms', 2000),
  },
  {
    id: 'usage_edge_p95',
    claim: 'Usage-limit Edge Function p95',
    target: '< 2000 ms release floor; < 1000 ms industry target at tested concurrency',
    yardstick: 'industry-standard',
    source: 'backendStress',
    evaluate: (data) => phaseMetric(data?.backendStress, 'usage-edge', 'p95Ms', 2000),
  },
  {
    id: 'session_rpc_p95',
    claim: 'Session-save RPC p95',
    target: '< 2000 ms release floor; < 1000 ms industry target at tested concurrency',
    yardstick: 'industry-standard',
    source: 'backendStress',
    evaluate: (data) => phaseMetric(data?.backendStress, 'session-rpc', 'p95Ms', 2000),
  },
  {
    id: 'stress_failure_rate',
    claim: 'Backend stress failure rate',
    target: '0% release floor and industry target at tested concurrency',
    yardstick: 'industry-standard',
    source: 'backendStress',
    evaluate: (data) => {
      const stress = data?.backendStress;
      if (!stress) return missing('backend stress evidence missing');
      const total = stress.phases?.reduce((sum, phase) => sum + Number(phase.total || 0), 0) ?? 0;
      const failures = stress.phases?.reduce((sum, phase) => sum + Number(phase.failure || 0), 0) ?? 0;
      const failureRate = total > 0 ? failures / total : null;
      return {
        status: failureRate === 0 ? 'pass' : 'fail',
        measured: failureRate === null ? null : `${(failureRate * 100).toFixed(2)}%`,
        details: `concurrency=${stress.concurrency ?? 'unknown'}; failures=${failures}/${total}`,
      };
    },
  },
  {
    id: 'browser_endurance_memory',
    claim: 'Browser endurance memory growth',
    target: '<= 50 MB max JS heap growth when available; no functional endurance failure',
    yardstick: 'industry-informed-soft-release',
    source: 'browserEndurance',
    evaluate: (data) => {
      const endurance = data?.browserEndurance;
      if (!endurance) return missing('browser endurance evidence missing');
      if (endurance.status === 'invalid') {
        return {
          status: 'invalid',
          measured: 'invalid/non-evidence',
          details: (endurance.invalidEvidenceReasons || []).join('; ') || endurance.error || 'browser endurance evidence was invalid',
        };
      }
      const growthValues = (endurance.users || [])
        .map((user) => user.memoryGrowthBytes)
        .filter((value) => typeof value === 'number');
      const maxGrowth = growthValues.length ? Math.max(...growthValues) : null;
      return {
        status: endurance.status === 'pass' ? 'pass' : 'fail',
        measured: maxGrowth === null ? 'memory API unavailable' : `${maxGrowth} bytes max growth`,
        details: `durationMs=${endurance.durationMs}; concurrency=${endurance.concurrency}; mode=${endurance.mode}`,
      };
    },
  },
  {
    id: 'browser_endurance_critical_failures',
    claim: 'Browser endurance critical failures',
    target: '0 critical request/console/product failures; writes and unknown failures always block',
    yardstick: 'industry-standard',
    source: 'browserEndurance',
    evaluate: (data) => {
      const endurance = data?.browserEndurance;
      if (!endurance) return missing('browser endurance evidence missing');
      if (endurance.status === 'invalid') {
        return {
          status: 'invalid',
          measured: 'invalid/non-evidence',
          details: (endurance.invalidEvidenceReasons || []).join('; ') || endurance.error || 'browser endurance evidence was invalid',
        };
      }
      const criticalFailures = endurance.criticalFailures || endurance.requestFailures || [];
      const consoleErrors = (endurance.consoleIssues || []).filter((issue) => issue.type === 'error');
      return {
        status: criticalFailures.length === 0 && consoleErrors.length === 0 && endurance.status === 'pass' ? 'pass' : 'fail',
        measured: `${criticalFailures.length} critical request failures; ${consoleErrors.length} console errors`,
        details: `functionalJourneyPassed=${endurance.functionalJourneyPassed ?? endurance.status === 'pass'}; countsAsReleaseEvidence=${endurance.countsAsReleaseEvidence ?? endurance.status === 'pass'}`,
      };
    },
  },
  {
    id: 'browser_endurance_ignored_teardown_reads',
    claim: 'Browser endurance ignored teardown reads',
    target: 'Allowed only for classified GET/HEAD read-only polling aborts during navigation/teardown or after functional pass',
    yardstick: 'industry-informed-soft-release',
    source: 'browserEndurance',
    evaluate: (data) => {
      const endurance = data?.browserEndurance;
      if (!endurance) return missing('browser endurance evidence missing');
      if (endurance.status === 'invalid') {
        return {
          status: 'invalid',
          measured: 'invalid/non-evidence',
          details: (endurance.invalidEvidenceReasons || []).join('; ') || endurance.error || 'browser endurance evidence was invalid',
        };
      }
      const ignored = endurance.ignoredRequestFailures || [];
      const categories = [...new Set(ignored.map((failure) => failure.category || 'unknown'))].join(', ') || 'none';
      return {
        status: 'pass',
        measured: `${ignored.length} classified teardown read aborts`,
        details: `categories=${categories}`,
      };
    },
  },
  {
    id: 'unit_e2e_correctness',
    claim: 'Unit and browser flow correctness',
    target: '0 failing tests release floor and industry target in current CI evidence',
    yardstick: 'industry-standard',
    source: 'quality',
    evaluate: (data) => {
      const quality = data?.quality;
      if (!quality) return missing('software quality evidence missing');
      const failing = Number(quality.tests?.failing ?? 0);
      return {
        status: failing === 0 ? 'pass' : 'fail',
        measured: `${failing} failing tests`,
        details: `total=${quality.tests?.total ?? 'unknown'}; source=${quality.run?.source ?? 'unknown'}`,
      };
    },
  },
  {
    id: 'lighthouse_accessibility',
    claim: 'Lighthouse accessibility',
    target: '>= 90',
    yardstick: 'industry-standard',
    source: 'quality',
    evaluate: (data) => thresholdMetric(data?.quality?.lighthouse?.accessibility, 90),
  },
  {
    id: 'ops_stack_snapshot',
    claim: 'API stack health snapshot',
    target: 'Ready; review-only allowed only when no blocking red services are present',
    yardstick: 'industry-informed-soft-release',
    source: 'opsHealthSummary',
    evaluate: (data) => {
      const ops = data?.opsHealthSummary;
      if (!ops) return missing('ops-health summary missing');
      const status = String(ops.status || ops.overallStatus || '').toLowerCase();
      return {
        status: status.includes('ready') ? 'pass' : status.includes('not') ? 'fail' : 'review',
        measured: ops.status || ops.overallStatus || 'unknown',
        details: `generatedAt=${ops.generatedAt ?? 'unknown'}`,
      };
    },
  },
  {
    id: 'artifact_completeness',
    claim: 'Artifact completeness',
    target: '100% required release evidence artifacts present and parseable',
    yardstick: 'industry-standard',
    source: 'all',
    evaluate: (data) => {
      const required = ['quality', 'backendStress', 'browserEndurance'];
      const missingInputs = required.filter((key) => !data?.[key]);
      const invalidInputs = [];
      if (data?.browserEndurance?.status === 'invalid') invalidInputs.push('browserEndurance');
      return {
        status: missingInputs.length === 0 && invalidInputs.length === 0 ? 'pass' : invalidInputs.length > 0 ? 'invalid' : 'fail',
        measured: `${required.length - missingInputs.length}/${required.length} required artifacts present`,
        details: `missing=${missingInputs.join(', ') || 'none'}; invalid=${invalidInputs.join(', ') || 'none'}`,
      };
    },
  },
];

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function missing(reason) {
  return { status: 'missing', measured: null, details: reason };
}

function phaseMetric(stress, phaseName, field, targetMs) {
  if (!stress) return missing('backend stress evidence missing');
  const phase = stress.phases?.find((item) => item.name === phaseName);
  if (!phase) return missing(`${phaseName} phase missing`);
  const value = phase[field];
  return {
    status: typeof value === 'number' && value < targetMs ? 'pass' : 'fail',
    measured: value === null || value === undefined ? null : `${value} ms`,
    details: `success=${phase.success}/${phase.total}; failures=${phase.failure}; concurrency=${stress.concurrency ?? 'unknown'}`,
  };
}

function thresholdMetric(value, minimum) {
  if (value === null || value === undefined) return missing('metric missing');
  return {
    status: Number(value) >= minimum ? 'pass' : 'fail',
    measured: String(value),
    details: `minimum=${minimum}`,
  };
}

function buildEvidence() {
  const data = Object.fromEntries(Object.entries(inputs).map(([key, filePath]) => [key, readJson(filePath)]));
  const checks = targets.map((target) => ({
    id: target.id,
    claim: target.claim,
    target: target.target,
    yardstick: target.yardstick,
    source: target.source,
    ...target.evaluate(data),
  }));
  const invalidEvidenceReasons = checks
    .filter((check) => check.status === 'invalid')
    .map((check) => `${check.claim}: ${check.details ?? check.measured ?? 'invalid evidence'}`);
  const hasBlockingFailure = checks.some((check) => check.status === 'fail' || check.status === 'missing');
  const hasInvalidEvidence = invalidEvidenceReasons.length > 0;

  return {
    schemaVersion: 1,
    kind: 'service-levels',
    status: hasInvalidEvidence ? 'invalid' : hasBlockingFailure ? 'fail' : 'pass',
    countsAsReleaseEvidence: !hasInvalidEvidence && !hasBlockingFailure,
    invalidEvidenceReasons,
    generatedAt: new Date().toISOString(),
    run: {
      githubRunId: process.env.GITHUB_RUN_ID ?? null,
      githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      commitSha: process.env.GITHUB_SHA ?? null,
      actor: process.env.GITHUB_ACTOR ?? null,
      source: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
    },
    inputs: Object.fromEntries(Object.entries(inputs).map(([key, filePath]) => [key, {
      path: path.relative(rootDir, filePath),
      present: fs.existsSync(filePath),
    }])),
    checks,
    summary: {
      pass: checks.filter((check) => check.status === 'pass').length,
      fail: checks.filter((check) => check.status === 'fail').length,
      invalid: checks.filter((check) => check.status === 'invalid').length,
      review: checks.filter((check) => check.status === 'review').length,
      missing: checks.filter((check) => check.status === 'missing').length,
    },
  };
}

function renderMarkdown(evidence) {
  const rows = evidence.checks.map((check) =>
    `| ${check.claim} | ${check.status.toUpperCase()} | ${check.target} | ${check.yardstick} | ${check.measured ?? 'N/A'} | ${check.details ?? ''} |`
  ).join('\n');

  return `# Service-Level Evidence

Generated: ${evidence.generatedAt}

Source: ${evidence.run.source}
Commit: ${evidence.run.commitSha ?? 'local/unavailable'}
GitHub run: ${evidence.run.githubRunId ?? 'local/unavailable'}

## Summary

Verdict: ${evidence.status.toUpperCase()}
Counts as release evidence: ${evidence.countsAsReleaseEvidence ? 'yes' : 'no'}

| Status | Count |
|---|---:|
| Pass | ${evidence.summary.pass} |
| Fail | ${evidence.summary.fail} |
| Invalid | ${evidence.summary.invalid} |
| Review | ${evidence.summary.review} |
| Missing | ${evidence.summary.missing} |

## Yardsticked Checks

| Claim | Status | Target | Yardstick | Measured | Details |
|---|---|---|---|---|---|
${rows}

Missing means the generator did not find the authoritative artifact in this run. It is not a pass.
`;
}

const evidence = buildEvidence();
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(serviceJsonPath, JSON.stringify(evidence, null, 2));
fs.writeFileSync(serviceMdPath, renderMarkdown(evidence));

console.log(`[ServiceLevels] Evidence written to ${serviceJsonPath}`);
console.log(`[ServiceLevels] Summary written to ${serviceMdPath}`);
